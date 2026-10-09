use crate::audio_toolkit::{
    apply_custom_words, normalize_transcription_output, remove_filler_words,
};
use crate::managers::audio::AudioRecordingManager;
use crate::managers::model::ModelManager;
use crate::settings::{get_settings, AppSettings};
use anyhow::Result;
use log::{debug, error, info, warn};
use serde::Serialize;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager};
use transcribe_cpp::{
    Backend, Model, ModelOptions, RunExtension, RunOptions, Session, StreamOptions, Task,
    WhisperRunOptions,
};

/// Unload the model after this much idle time.
const MODEL_IDLE_UNLOAD: Duration = Duration::from_secs(5 * 60);

/// How long `finalize_stream` waits for the worker. Generous because the
/// worker may still be waiting for the first model load, with queued frames.
const STREAM_FINALIZE_REPLY_TIMEOUT: Duration = Duration::from_secs(60);

/// Fuzzy custom-word correction threshold (lower = stricter).
const WORD_CORRECTION_THRESHOLD: f64 = 0.18;

fn panic_payload_message(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        (*message).to_string()
    } else if let Some(message) = payload.downcast_ref::<String>() {
        message.clone()
    } else {
        "unknown panic".to_string()
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct ModelStateEvent {
    pub event_type: String,
    pub model_id: Option<String>,
    pub model_name: Option<String>,
    pub error: Option<String>,
}

/// RAII guard that clears the `is_loading` flag and notifies waiters on drop.
/// Ensures the loading flag is always reset, even on early returns or panics.
pub struct LoadingGuard {
    is_loading: Arc<Mutex<bool>>,
    loading_condvar: Arc<Condvar>,
}

impl Drop for LoadingGuard {
    fn drop(&mut self) {
        // Recover from a poisoned mutex instead of panicking: a panic inside
        // Drop calls abort().
        let mut is_loading = match self.is_loading.lock() {
            Ok(g) => g,
            Err(e) => {
                warn!("Recovered poisoned is_loading mutex during LoadingGuard drop");
                e.into_inner()
            }
        };
        *is_loading = false;
        self.loading_condvar.notify_all();
    }
}

/// Commands sent to the streaming worker thread. Frames and the finalize
/// request share one channel, so FIFO order guarantees every fed frame is
/// processed before finalize runs.
enum StreamCmd {
    Feed(Vec<f32>),
    /// Flush the stream and reply with the raw final text, or `None` when no
    /// stream was active (the caller falls back to batch transcription).
    Finalize(mpsc::Sender<Option<String>>),
    Cancel,
}

/// Routes 16 kHz frames from the audio recorder to the active streaming
/// worker. Shared between the [`TranscriptionManager`] (opens and closes the
/// route) and the recorder's frame callback (feeds frames). A frame with no
/// stream open costs one relaxed atomic load.
pub struct StreamRouter {
    tx: Mutex<Option<mpsc::Sender<StreamCmd>>>,
    open: AtomicBool,
}

impl StreamRouter {
    pub fn new() -> Self {
        Self {
            tx: Mutex::new(None),
            open: AtomicBool::new(false),
        }
    }

    fn open(&self) -> mpsc::Receiver<StreamCmd> {
        let (tx, rx) = mpsc::channel();
        *self.tx.lock().unwrap() = Some(tx);
        self.open.store(true, Ordering::Release);
        rx
    }

    /// Close the route to new frames and hand back the sender for the final
    /// `Finalize`/`Cancel` command.
    fn take(&self) -> Option<mpsc::Sender<StreamCmd>> {
        self.open.store(false, Ordering::Release);
        self.tx.lock().unwrap().take()
    }

    fn clear(&self) {
        let _ = self.take();
    }

    /// Forward one frame to the active streaming worker, if any.
    pub fn feed(&self, frame: &[f32]) {
        if !self.open.load(Ordering::Acquire) {
            return;
        }
        if let Some(tx) = self.tx.lock().unwrap().as_ref() {
            let _ = tx.send(StreamCmd::Feed(frame.to_vec()));
        }
    }

    pub fn is_open(&self) -> bool {
        self.open.load(Ordering::Acquire)
    }
}

impl Default for StreamRouter {
    fn default() -> Self {
        Self::new()
    }
}

/// Clears the worker flag on every worker exit, including a panic inside a
/// native call that unwinds the detached worker thread.
struct StreamWorkerGuard {
    worker_running: Arc<AtomicBool>,
}

impl Drop for StreamWorkerGuard {
    fn drop(&mut self) {
        self.worker_running.store(false, Ordering::Release);
    }
}

#[derive(Clone)]
pub struct TranscriptionManager {
    /// The loaded transcribe-cpp `Session`; it keeps its `Model` alive
    /// internally, so repeated dictation reuses the session without reloading.
    engine: Arc<Mutex<Option<Session>>>,
    router: Arc<StreamRouter>,
    /// True from `start_stream` until the worker thread exits.
    stream_worker_running: Arc<AtomicBool>,
    model_manager: Arc<ModelManager>,
    app_handle: AppHandle,
    current_model_id: Arc<Mutex<Option<String>>>,
    last_activity: Arc<AtomicU64>,
    shutdown_signal: Arc<AtomicBool>,
    watcher_handle: Arc<Mutex<Option<thread::JoinHandle<()>>>>,
    is_loading: Arc<Mutex<bool>>,
    loading_condvar: Arc<Condvar>,
    reload_model_on_next_use: Arc<AtomicBool>,
}

impl TranscriptionManager {
    pub fn new(
        app_handle: &AppHandle,
        model_manager: Arc<ModelManager>,
        router: Arc<StreamRouter>,
    ) -> Result<Self> {
        let manager = Self {
            engine: Arc::new(Mutex::new(None)),
            router,
            stream_worker_running: Arc::new(AtomicBool::new(false)),
            model_manager,
            app_handle: app_handle.clone(),
            current_model_id: Arc::new(Mutex::new(None)),
            last_activity: Arc::new(AtomicU64::new(Self::now_ms())),
            shutdown_signal: Arc::new(AtomicBool::new(false)),
            watcher_handle: Arc::new(Mutex::new(None)),
            is_loading: Arc::new(Mutex::new(false)),
            loading_condvar: Arc::new(Condvar::new()),
            reload_model_on_next_use: Arc::new(AtomicBool::new(false)),
        };

        // Idle watcher: unload the model after MODEL_IDLE_UNLOAD without use.
        {
            let app_handle_cloned = app_handle.clone();
            let manager_cloned = manager.clone();
            let shutdown_signal = manager.shutdown_signal.clone();
            let handle = thread::spawn(move || {
                debug!("Idle watcher thread started");
                while !shutdown_signal.load(Ordering::Relaxed) {
                    thread::sleep(Duration::from_secs(10));

                    if shutdown_signal.load(Ordering::Relaxed) {
                        break;
                    }

                    // While recording, keep the idle timer fresh so the
                    // model is never unloaded mid-session.
                    let is_recording = app_handle_cloned
                        .try_state::<Arc<AudioRecordingManager>>()
                        .is_some_and(|a| a.is_recording());
                    if is_recording {
                        manager_cloned.touch_activity();
                        continue;
                    }

                    let last = manager_cloned.last_activity.load(Ordering::Relaxed);
                    let idle_ms = TranscriptionManager::now_ms().saturating_sub(last);
                    if idle_ms > MODEL_IDLE_UNLOAD.as_millis() as u64
                        && manager_cloned.is_model_loaded()
                    {
                        info!(
                            "Model idle for {}s (limit: {}s), unloading",
                            idle_ms / 1000,
                            MODEL_IDLE_UNLOAD.as_secs()
                        );
                        manager_cloned.unload_model();
                    }
                }
                debug!("Idle watcher thread shutting down gracefully");
            });
            *manager.watcher_handle.lock().unwrap() = Some(handle);
        }

        Ok(manager)
    }

    /// Lock the engine mutex, recovering from poison if a previous transcription panicked.
    fn lock_engine(&self) -> MutexGuard<'_, Option<Session>> {
        self.engine.lock().unwrap_or_else(|poisoned| {
            warn!("Engine mutex was poisoned by a previous panic, recovering");
            poisoned.into_inner()
        })
    }

    pub fn is_model_loaded(&self) -> bool {
        self.lock_engine().is_some()
    }

    /// Atomically check whether a model load is in progress and, if not, mark
    /// one as starting. Returns a [`LoadingGuard`] whose [`Drop`] impl will
    /// clear the flag and wake waiters. Returns `None` if a load is already in
    /// progress.
    pub fn try_start_loading(&self) -> Option<LoadingGuard> {
        let mut is_loading = self.is_loading.lock().unwrap();
        if *is_loading {
            return None;
        }
        *is_loading = true;
        Some(LoadingGuard {
            is_loading: self.is_loading.clone(),
            loading_condvar: self.loading_condvar.clone(),
        })
    }

    pub fn unload_model(&self) {
        let unload_start = std::time::Instant::now();
        debug!("Starting to unload model");

        // Dropping the session frees all native resources.
        *self.lock_engine() = None;
        *self.current_model_id.lock().unwrap() = None;

        let _ = self.app_handle.emit(
            "model-state-changed",
            ModelStateEvent {
                event_type: "unloaded".to_string(),
                model_id: None,
                model_name: None,
                error: None,
            },
        );

        debug!(
            "Model unloaded (took {}ms)",
            unload_start.elapsed().as_millis()
        );
    }

    fn now_ms() -> u64 {
        SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
    }

    /// Reset the idle timer to now.
    fn touch_activity(&self) {
        self.last_activity.store(Self::now_ms(), Ordering::Relaxed);
    }

    pub fn load_model(&self, model_id: &str) -> Result<()> {
        self.load_model_with_device(model_id, None)
    }

    /// Like [`load_model`](Self::load_model), but lets a caller hard-select the
    /// compute device for this one load by its `transcribe_cpp::devices()`
    /// registry index (the index shown by `--list-devices`). `None` selects the
    /// device automatically. The selection is not persisted.
    pub fn load_model_with_device(
        &self,
        model_id: &str,
        device_index: Option<usize>,
    ) -> Result<()> {
        let load_start = std::time::Instant::now();
        debug!("Starting to load model: {}", model_id);

        let model_info = self
            .model_manager
            .get_model_info(model_id)
            .ok_or_else(|| anyhow::anyhow!("Model not found: {}", model_id))?;

        // Emit loading started only once the model is known, so every
        // `loading_started` is paired with a `loading_completed`/`loading_failed`.
        let emit_state = |event_type: &str, error: Option<String>| {
            let _ = self.app_handle.emit(
                "model-state-changed",
                ModelStateEvent {
                    event_type: event_type.to_string(),
                    model_id: Some(model_id.to_string()),
                    model_name: Some(model_info.name.clone()),
                    error,
                },
            );
        };
        emit_state("loading_started", None);

        if !model_info.is_downloaded {
            let error_msg = "Model not downloaded";
            emit_state("loading_failed", Some(error_msg.to_string()));
            return Err(anyhow::anyhow!(error_msg));
        }

        let model_path = match self.model_manager.get_model_path(model_id) {
            Ok(path) => path,
            Err(e) => {
                emit_state("loading_failed", Some(e.to_string()));
                return Err(e);
            }
        };

        // Drop the current engine BEFORE building the new one so transcribe-cpp
        // frees the previous native context first, avoiding two models in
        // memory at once. Clear the id too: if the new load fails, status
        // should read "no loaded model", not the dropped engine.
        *self.lock_engine() = None;
        *self.current_model_id.lock().unwrap() = None;

        let (backend, device) = match device_index {
            Some(index) => resolve_device_index(index).inspect_err(|e| {
                emit_state("loading_failed", Some(e.to_string()));
            })?,
            None => (Backend::Auto, None),
        };
        let requested_device = device
            .as_ref()
            .map(transcribe_device_label)
            .unwrap_or_else(|| "automatic".to_string());
        let model_options = ModelOptions { backend, device };
        let model = Model::load_with(&model_path, &model_options).map_err(|e| {
            let error_msg = format!("Failed to load whisper model {}: {}", model_id, e);
            emit_state("loading_failed", Some(error_msg.clone()));
            anyhow::anyhow!(error_msg)
        })?;
        // The bound backend may differ from the request (e.g. CPU fallback
        // under Auto); log what actually loaded.
        let bound_backend = model.backend();
        let session = model.session().map_err(|e| {
            let error_msg = format!(
                "Failed to create session for whisper model {}: {}",
                model_id, e
            );
            emit_state("loading_failed", Some(error_msg.clone()));
            anyhow::anyhow!(error_msg)
        })?;
        // Reconcile the registry's advertised capabilities with the loaded
        // model's real ones (GGUF metadata) so language gating reflects runtime
        // truth, not the pre-download probe.
        let caps = session.model().capabilities();
        self.model_manager.set_runtime_capabilities(
            model_id,
            caps.supports_language_detect,
            caps.languages.clone(),
        );
        let bound_device = model
            .device()
            .map(|device| transcribe_device_label(&device))
            .unwrap_or_else(|_| "unknown".to_string());
        info!(
            "Loaded whisper model '{}' (requested {:?}, requested device '{}', \
             bound backend '{}', bound device '{}', supports_language_detect={})",
            model_id,
            backend,
            requested_device,
            bound_backend,
            bound_device,
            caps.supports_language_detect
        );

        *self.lock_engine() = Some(session);
        *self.current_model_id.lock().unwrap() = Some(model_id.to_string());

        // Reset idle timer so the watcher doesn't immediately unload a just-loaded model
        self.touch_activity();

        emit_state("loading_completed", None);

        debug!(
            "Successfully loaded transcription model: {} (took {}ms)",
            model_id,
            load_start.elapsed().as_millis()
        );
        Ok(())
    }

    /// Kick off model loading in a background thread if the model is not
    /// already loaded (or a reload has been requested).
    pub fn initiate_model_load(&self) {
        let Some(guard) = self.try_start_loading() else {
            return;
        };

        let reload_pending = self.reload_model_on_next_use.load(Ordering::Acquire);
        if !reload_pending && self.is_model_loaded() {
            // `guard` drops here and clears the flag.
            return;
        }

        let self_clone = self.clone();
        thread::spawn(move || {
            // The guard lives for the whole load, so a panic inside the native
            // load still clears `is_loading` and wakes waiters.
            let _guard = guard;
            let settings = get_settings(&self_clone.app_handle);
            match self_clone.load_model(&settings.selected_model) {
                Ok(()) => {
                    self_clone
                        .reload_model_on_next_use
                        .store(false, Ordering::Release);
                }
                Err(e) => error!("Failed to load model: {}", e),
            }
        });
    }

    pub fn get_current_model(&self) -> Option<String> {
        self.current_model_id.lock().unwrap().clone()
    }

    /// The compute backend the currently-loaded engine is bound to, for
    /// diagnostics (e.g. confirming `--device-index` actually bound a GPU rather
    /// than falling back to CPU/auto). `None` when no model is loaded.
    pub fn current_backend(&self) -> Option<String> {
        self.lock_engine()
            .as_ref()
            .map(|session| session.model().backend().to_string())
    }

    /// Return the engine to the mutex, unless the model was switched or
    /// unloaded during transcription (in which case the stale engine is dropped).
    fn return_engine(&self, engine: Session, expected_model_id: &str) {
        let still_current =
            self.current_model_id.lock().unwrap().as_deref() == Some(expected_model_id);
        if still_current {
            *self.lock_engine() = Some(engine);
        } else {
            info!(
                "Model changed/unloaded during transcription; dropping stale engine (was '{}')",
                expected_model_id
            );
        }
    }

    /// Begin live streaming transcription for a dictation. Non-blocking: a
    /// worker waits for any in-progress model load, checks that the loaded
    /// model can stream, and begins the stream. Frames fed before that queue
    /// on the channel. Models that cannot stream (Whisper) make the worker
    /// return the engine at once; `finalize_stream` then reports `None` and
    /// the caller transcribes in batch as before.
    pub fn start_stream(&self) {
        if self.router.is_open()
            || self
                .stream_worker_running
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .is_err()
        {
            warn!("start_stream called while a stream worker is already active");
            return;
        }
        let rx = self.router.open();
        let manager = self.clone();
        thread::spawn(move || manager.run_stream_worker(rx));
    }

    fn run_stream_worker(&self, rx: mpsc::Receiver<StreamCmd>) {
        let _guard = StreamWorkerGuard {
            worker_running: Arc::clone(&self.stream_worker_running),
        };

        {
            let mut is_loading = self.is_loading.lock().unwrap();
            while *is_loading {
                is_loading = self.loading_condvar.wait(is_loading).unwrap();
            }
        }

        let model_id = self.get_current_model().unwrap_or_default();
        // Take the engine for the whole stream; this excludes a concurrent
        // batch run. It is returned when the worker finishes.
        let taken = self.lock_engine().take();
        let Some(mut engine) = taken else {
            info!("Live text: no model loaded, using batch transcription");
            self.router.clear();
            drain_until_finalize(rx);
            return;
        };

        let (supports_streaming, languages) = {
            let model = engine.model();
            let caps = model.capabilities();
            info!(
                "Live text: model '{}' arch='{}' supports_streaming={}",
                model_id,
                model.arch(),
                caps.supports_streaming
            );
            (caps.supports_streaming, caps.languages)
        };
        if !supports_streaming {
            self.return_engine(engine, &model_id);
            self.router.clear();
            drain_until_finalize(rx);
            return;
        }

        let settings = get_settings(&self.app_handle);
        let effective_language =
            effective_language_for_model(&settings, self.model_manager.as_ref(), &model_id);
        let hint_languages = self.hint_languages(&model_id, languages);
        let run_options = RunOptions {
            task: Task::Transcribe,
            language: run_language(&effective_language, &hint_languages),
            ..Default::default()
        };

        let mut reply: Option<mpsc::Sender<Option<String>>> = None;
        let mut result: Option<String> = None;
        let started = 'stream: {
            let mut stream = match engine.stream(&run_options, &StreamOptions::default()) {
                Ok(s) => s,
                Err(e) => {
                    error!("Live text: failed to begin stream: {}", e);
                    break 'stream false;
                }
            };
            self.touch_activity();
            info!(
                "Live text started (model '{}', language {:?})",
                model_id, run_options.language
            );

            while let Ok(cmd) = rx.recv() {
                match cmd {
                    StreamCmd::Feed(pcm) => match stream.feed(&pcm) {
                        Ok(update) => {
                            if update.committed_changed || update.tentative_changed {
                                let text = stream.text();
                                crate::overlay::emit_stream_text(
                                    &self.app_handle,
                                    &text.committed,
                                    &text.tentative,
                                );
                            }
                        }
                        Err(e) => warn!("Live text: feed failed: {}", e),
                    },
                    StreamCmd::Finalize(tx) => {
                        result = match stream.finalize() {
                            Ok(_) => Some(stream.text().full),
                            Err(e) => {
                                error!("Live text: finalize failed: {}; using batch", e);
                                None
                            }
                        };
                        reply = Some(tx);
                        break;
                    }
                    StreamCmd::Cancel => {
                        stream.reset();
                        break;
                    }
                }
            }
            true
        };

        self.return_engine(engine, &model_id);
        if !started {
            self.router.clear();
            drain_until_finalize(rx);
            return;
        }
        if let Some(tx) = reply {
            let _ = tx.send(result);
        }
    }

    /// Flush the live stream and return its post-processed text. `Ok(None)`
    /// means no usable stream ran and the caller should transcribe in batch.
    pub fn finalize_stream(&self) -> Result<Option<String>> {
        let Some(tx) = self.router.take() else {
            return Ok(None);
        };
        let (reply_tx, reply_rx) = mpsc::channel();
        if tx.send(StreamCmd::Finalize(reply_tx)).is_err() {
            return Ok(None);
        }
        let raw = match reply_rx.recv_timeout(STREAM_FINALIZE_REPLY_TIMEOUT) {
            Ok(Some(text)) => text,
            Ok(None) | Err(mpsc::RecvTimeoutError::Disconnected) => return Ok(None),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                return Err(anyhow::anyhow!(
                    "Timed out waiting {:?} for live transcription to finalize",
                    STREAM_FINALIZE_REPLY_TIMEOUT
                ));
            }
        };
        let settings = get_settings(&self.app_handle);
        let text = post_process_transcription_text(raw, &settings);
        info!("Live text finalized: {}", crate::utils::redact_text(&text));
        Ok(Some(text))
    }

    /// Abandon any live stream without producing text.
    pub fn cancel_stream(&self) {
        if let Some(tx) = self.router.take() {
            let _ = tx.send(StreamCmd::Cancel);
        }
    }

    /// Languages to validate a language hint against. The loaded model's own
    /// list wins. Some GGUFs (Nemotron 3.5) omit `general.languages`, so the
    /// engine reports none even though its prompt table knows them; then the
    /// catalog list is used, so an explicit Norwegian choice still reaches the
    /// model instead of silently falling back to auto-detect.
    fn hint_languages(&self, model_id: &str, engine_languages: Vec<String>) -> Vec<String> {
        if !engine_languages.is_empty() {
            return engine_languages;
        }
        self.model_manager
            .get_model_info(model_id)
            .map(|info| info.supported_languages)
            .unwrap_or_default()
    }

    /// Prefer the live stream's text; fall back to batch transcription of the
    /// recorded samples when no stream ran or it produced nothing.
    pub fn finalize_stream_or_transcribe(&self, audio: Vec<f32>) -> Result<String> {
        match self.finalize_stream()? {
            Some(text) if !text.trim().is_empty() => Ok(text),
            _ => self.transcribe(audio),
        }
    }

    /// Transcribe `audio` with a specific downloaded model, loaded into its own
    /// session and dropped afterwards. The active engine is left untouched, so
    /// this is safe to use for side-by-side model comparison. Uses the same
    /// language and text post-processing as dictation.
    pub fn transcribe_with_model(&self, model_id: &str, audio: &[f32]) -> Result<String> {
        let path = self.model_manager.get_model_path(model_id)?;
        let model = Model::load_with(
            &path,
            &ModelOptions {
                backend: Backend::Auto,
                device: None,
            },
        )
        .map_err(|e| anyhow::anyhow!("Failed to load model {}: {}", model_id, e))?;
        let mut session = model
            .session()
            .map_err(|e| anyhow::anyhow!("Failed to create session for {}: {}", model_id, e))?;

        let settings = get_settings(&self.app_handle);
        let effective_language =
            effective_language_for_model(&settings, self.model_manager.as_ref(), model_id);
        let hint_languages = self.hint_languages(model_id, model.capabilities().languages);
        let family = if settings.custom_words.is_empty() || model.arch() != "whisper" {
            None
        } else {
            Some(RunExtension::Whisper(WhisperRunOptions {
                initial_prompt: Some(settings.custom_words.join(", ")),
                ..Default::default()
            }))
        };
        let run_options = RunOptions {
            task: Task::Transcribe,
            language: run_language(&effective_language, &hint_languages),
            family,
            ..Default::default()
        };
        let raw = session
            .run(audio, &run_options)
            .map(|t| t.text)
            .map_err(|e| anyhow::anyhow!("{} failed: {}", model_id, e))?;
        Ok(post_process_transcription_text(raw, &settings))
    }

    pub fn transcribe(&self, audio: Vec<f32>) -> Result<String> {
        self.touch_activity();

        let st = std::time::Instant::now();
        let audio_len = audio.len();
        debug!("Audio vector length: {}", audio_len);

        if audio.is_empty() {
            debug!("Empty audio vector");
            return Ok(String::new());
        }

        // If the model is loading, wait for it to complete.
        {
            let mut is_loading = self.is_loading.lock().unwrap();
            while *is_loading {
                is_loading = self.loading_condvar.wait(is_loading).unwrap();
            }
        }

        let settings = get_settings(&self.app_handle);

        // Validate against the model that's actually loaded (which can differ
        // from settings.selected_model when a caller loaded a specific model,
        // e.g. the --transcribe-file path's --model), not the persisted
        // selection. The coercion is capability-aware and computed fresh here;
        // it is never written back, so the intent survives switching models.
        let active_model = self
            .get_current_model()
            .unwrap_or_else(|| settings.selected_model.clone());
        let validated_language =
            effective_language_for_model(&settings, self.model_manager.as_ref(), &active_model);
        if validated_language != settings.selected_language {
            debug!(
                "Language intent '{}' resolved to '{}' for model '{}'",
                settings.selected_language, validated_language, active_model
            );
        }

        // Take the engine out so we own it during transcription. If the engine
        // panics, it is not put back (effectively unloading it) instead of
        // poisoning the mutex.
        let mut engine = match self.lock_engine().take() {
            Some(e) => e,
            None => {
                return Err(anyhow::anyhow!("Model is not loaded for transcription."));
            }
        };

        let model_languages =
            self.hint_languages(&active_model, engine.model().capabilities().languages);
        debug!(
            "transcribe-cpp model '{}' on '{}': languages={:?}",
            active_model,
            engine.model().backend(),
            model_languages
        );

        let transcribe_result = catch_unwind(AssertUnwindSafe(|| -> Result<String> {
            // Custom words become the whisper initial prompt. Other families
            // (parakeet) have no prompt slot; they still get the fuzzy
            // post-correction in `post_process_transcription_text`.
            let family = if settings.custom_words.is_empty() || engine.model().arch() != "whisper" {
                None
            } else {
                Some(RunExtension::Whisper(WhisperRunOptions {
                    initial_prompt: Some(settings.custom_words.join(", ")),
                    ..Default::default()
                }))
            };

            let run_options = RunOptions {
                task: Task::Transcribe,
                language: run_language(&validated_language, &model_languages),
                family,
                ..Default::default()
            };

            debug!(
                "transcribe-cpp run: task={:?}, language={:?}, initial_prompt={}",
                run_options.task,
                run_options.language,
                run_options.family.is_some()
            );

            engine
                .run(&audio, &run_options)
                .map(|t| t.text)
                .map_err(|e| anyhow::anyhow!("transcribe-cpp transcription failed: {}", e))
        }));

        let text = match transcribe_result {
            Ok(inner_result) => {
                self.return_engine(engine, &active_model);
                inner_result?
            }
            Err(panic_payload) => {
                // Engine panicked: do NOT put it back (it's in an unknown state).
                let panic_msg = panic_payload_message(panic_payload.as_ref());
                error!(
                    "Transcription engine panicked: {}. Model has been unloaded.",
                    panic_msg
                );

                *self
                    .current_model_id
                    .lock()
                    .unwrap_or_else(|e| e.into_inner()) = None;

                let _ = self.app_handle.emit(
                    "model-state-changed",
                    ModelStateEvent {
                        event_type: "unloaded".to_string(),
                        model_id: None,
                        model_name: None,
                        error: Some(format!("Engine panicked: {}", panic_msg)),
                    },
                );

                return Err(anyhow::anyhow!(
                    "Transcription engine panicked: {}. The model has been unloaded and will reload on next attempt.",
                    panic_msg
                ));
            }
        };

        let final_result = post_process_transcription_text(text, &settings);

        // Real-time factor: audio_secs / elapsed_secs, e.g. 4.00x means
        // transcribed 4x faster than real time.
        let elapsed_secs = st.elapsed().as_secs_f64();
        let audio_secs = audio_len as f64 / crate::audio_toolkit::WHISPER_SAMPLE_RATE as f64;
        let speedup = if elapsed_secs > 0.0 {
            audio_secs / elapsed_secs
        } else {
            0.0
        };
        info!(
            "Transcription completed in {:.2}s for {:.2}s of audio ({:.2}x real-time)",
            elapsed_secs, audio_secs, speedup
        );

        if final_result.is_empty() {
            info!("Transcription result is empty");
        } else {
            info!(
                "Transcription result: {}",
                crate::utils::redact_text(&final_result)
            );
        }

        Ok(final_result)
    }
}

/// Resolve the persisted language intent into the language a specific model can
/// use without writing the coerced value back to settings.
fn effective_language_for_model(
    settings: &AppSettings,
    model_manager: &ModelManager,
    model_id: &str,
) -> String {
    match model_manager.get_model_info(model_id) {
        Some(info) => crate::managers::model::effective_language(
            &settings.selected_language,
            &info.supported_languages,
            info.supports_language_detection,
        ),
        None => settings.selected_language.clone(),
    }
}

/// The language hint to pass to transcribe-cpp. Only a language the loaded
/// model actually advertises (per capabilities().languages) is passed;
/// otherwise auto-detect rather than failing with UNSUPPORTED_LANGUAGE.
fn run_language(effective_language: &str, model_languages: &[String]) -> Option<String> {
    use crate::managers::model::base_language;
    if effective_language == "auto" {
        return None;
    }
    // Exact code first, then the same base language in the model's own
    // spelling (`nb` intent → `nb-NO`), so a catalog/engine spelling mismatch
    // cannot drop the hint.
    let chosen = model_languages
        .iter()
        .find(|l| *l == effective_language)
        .or_else(|| {
            let wanted = base_language(effective_language);
            model_languages.iter().find(|l| base_language(l) == wanted)
        })
        .cloned();
    if chosen.is_none() && !model_languages.is_empty() {
        warn!(
            "Language '{}' not advertised by the model; using auto-detect",
            effective_language
        );
    }
    chosen
}

/// Answer a pending `Finalize` with `None` so `finalize_stream` falls back to
/// batch without waiting for the timeout. Exits on `Cancel` or a closed channel.
fn drain_until_finalize(rx: mpsc::Receiver<StreamCmd>) {
    while let Ok(cmd) = rx.recv() {
        match cmd {
            StreamCmd::Feed(_) => {}
            StreamCmd::Finalize(tx) => {
                let _ = tx.send(None);
                return;
            }
            StreamCmd::Cancel => return,
        }
    }
}

/// Custom-word correction (whisper already saw the words as its initial
/// prompt, so this only catches what the prompt did not), filler removal and
/// whitespace normalisation.
fn post_process_transcription_text(raw: String, settings: &AppSettings) -> String {
    fail_open_text_transform(raw, |raw| {
        let corrected = if settings.custom_words.is_empty() {
            raw
        } else {
            apply_custom_words(&raw, &settings.custom_words, WORD_CORRECTION_THRESHOLD)
        };
        let without_fillers = remove_filler_words(&corrected, settings.filler_word_removal_enabled);
        normalize_transcription_output(&without_fillers)
    })
}

/// Optional text cleanup must never discard a successful model result. The
/// transform is pure and owns its input, so recovering the untouched text is
/// safe even if a bug in custom-word or filler filtering unwinds.
fn fail_open_text_transform<F>(raw: String, transform: F) -> String
where
    F: FnOnce(String) -> String,
{
    let fallback = raw.clone();
    match catch_unwind(AssertUnwindSafe(|| transform(raw))) {
        Ok(processed) => processed,
        Err(payload) => {
            error!(
                "Optional transcription text post-processing panicked: {}; using the raw transcription",
                panic_payload_message(payload.as_ref())
            );
            fallback
        }
    }
}

/// Initialize the transcribe-cpp native backend once at startup: route native +
/// ggml diagnostics into the `log` facade and register compute backend modules.
/// In a static build (macOS Metal) `init_backends_default` is a harmless no-op;
/// in a `dynamic-backends` build it loads the per-ISA CPU / GPU modules. Must run
/// before the first model load.
pub fn init_transcribe_backend() {
    transcribe_cpp::init_logging();
    match transcribe_cpp::init_backends_default() {
        Ok(()) => {
            let devices = transcribe_cpp::devices();
            info!(
                "transcribe-cpp initialized with {} compute device(s): [{}]",
                devices.len(),
                devices
                    .iter()
                    .map(|d| format!("{} ({})", d.name, d.kind))
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        }
        Err(e) => warn!("Failed to initialize transcribe-cpp backends: {}", e),
    }
}

/// Human-readable list of the transcribe-cpp compute devices registered at
/// startup, for the `--list-devices` flag. The reported `index` is the
/// value to pass to `--device-index`. Backends must be initialized first
/// (see [`init_transcribe_backend`]).
pub fn describe_compute_devices() -> Vec<String> {
    transcribe_cpp::devices()
        .into_iter()
        .map(|d| {
            let idx = d
                .index
                .map(|i| i.to_string())
                .unwrap_or_else(|| "-".to_string());
            let name = if d.description.is_empty() {
                d.name
            } else {
                d.description
            };
            let vram_mb = d.memory_total / (1024 * 1024);
            format!(
                "index={} kind={} name={} vram={}MB",
                idx, d.kind, name, vram_mb
            )
        })
        .collect()
}

/// Resolve a `--list-devices` registry index to an exact opaque device handle
/// for a transcribe-cpp model load (the `--device-index` flag). Errors if the
/// index isn't a registered, loadable primary device.
fn resolve_device_index(index: usize) -> Result<(Backend, Option<transcribe_cpp::Device>)> {
    let device = transcribe_cpp::devices()
        .into_iter()
        .find(|d| d.index == Some(index))
        .ok_or_else(|| {
            anyhow::anyhow!("No compute device with index {index} (see --list-devices)")
        })?;
    if matches!(
        device.device_type,
        transcribe_cpp::DeviceType::Accel | transcribe_cpp::DeviceType::Unknown
    ) {
        return Err(anyhow::anyhow!(
            "Device index {index} ({}) cannot host a model",
            device.kind
        ));
    }

    // Backend::Auto accepts any primary device and cannot conflict with the
    // selected device's vendor backend.
    Ok((Backend::Auto, Some(device)))
}

fn transcribe_device_label(device: &transcribe_cpp::Device) -> String {
    if device.description.is_empty() {
        device.name.clone()
    } else {
        device.description.clone()
    }
}

impl Drop for TranscriptionManager {
    fn drop(&mut self) {
        // Skip shutdown unless this is the very last clone. The watcher thread
        // holds its own clone, so engine's strong_count is always >= 2 while
        // the watcher is alive.
        if Arc::strong_count(&self.engine) > 1 {
            return;
        }

        self.shutdown_signal.store(true, Ordering::Relaxed);

        // Use match instead of unwrap to avoid panicking if the mutex is
        // poisoned: a panic inside Drop calls abort().
        let mut guard = match self.watcher_handle.lock() {
            Ok(g) => g,
            Err(e) => {
                warn!("Recovered poisoned watcher_handle mutex during TranscriptionManager drop");
                e.into_inner()
            }
        };
        if let Some(handle) = guard.take() {
            if let Err(e) = handle.join() {
                warn!("Failed to join idle watcher thread: {:?}", e);
            } else {
                debug!("Idle watcher thread joined successfully");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn languages(codes: &[&str]) -> Vec<String> {
        codes.iter().map(|code| (*code).to_string()).collect()
    }

    #[test]
    fn closed_router_drops_frames() {
        let router = StreamRouter::new();
        assert!(!router.is_open());
        router.feed(&[0.0; 480]);
        assert!(router.take().is_none());
    }

    #[test]
    fn open_router_forwards_frames_until_taken() {
        let router = StreamRouter::new();
        let rx = router.open();
        router.feed(&[0.25; 3]);
        match rx.try_recv() {
            Ok(StreamCmd::Feed(frame)) => assert_eq!(frame, vec![0.25; 3]),
            _ => panic!("expected a fed frame"),
        }
        assert!(router.take().is_some());
        assert!(!router.is_open());
        router.feed(&[0.5; 3]);
        assert!(rx.try_recv().is_err());
    }

    #[test]
    fn drain_answers_finalize_with_none_after_skipping_frames() {
        let (tx, rx) = mpsc::channel();
        let (reply_tx, reply_rx) = mpsc::channel();
        tx.send(StreamCmd::Feed(vec![0.0; 10])).unwrap();
        tx.send(StreamCmd::Finalize(reply_tx)).unwrap();
        drain_until_finalize(rx);
        assert_eq!(reply_rx.recv().unwrap(), None);
    }

    #[test]
    fn drain_stops_on_cancel() {
        let (tx, rx) = mpsc::channel();
        tx.send(StreamCmd::Cancel).unwrap();
        drain_until_finalize(rx);
    }

    #[test]
    fn norwegian_intent_selects_nemotron_locale() {
        let nemotron = languages(&["en-US", "sv-SE", "nb-NO", "da-DK"]);
        let effective = crate::managers::model::effective_language("nb", &nemotron, true);
        assert_eq!(effective, "nb-NO");
        assert_eq!(
            run_language(&effective, &nemotron),
            Some("nb-NO".to_string())
        );
    }

    #[test]
    fn optional_text_transform_falls_back_to_raw_text_after_panic() {
        let raw = "rå transkripsjon".to_string();
        let result = fail_open_text_transform(raw.clone(), |_| {
            panic!("simulated optional cleanup failure")
        });

        assert_eq!(result, raw);
    }

    #[test]
    fn run_language_passes_only_advertised_languages() {
        assert_eq!(run_language("auto", &languages(&["en", "nb"])), None);
        assert_eq!(
            run_language("nb", &languages(&["en", "nb"])),
            Some("nb".to_string())
        );
        // Language-agnostic models report an empty list and stay on auto.
        assert_eq!(run_language("en", &languages(&[])), None);
        assert_eq!(run_language("fr", &languages(&["en", "nb"])), None);
    }

    #[test]
    fn run_language_matches_base_language_in_model_spelling() {
        assert_eq!(
            run_language("nb", &languages(&["en-US", "nb-NO"])),
            Some("nb-NO".to_string())
        );
        assert_eq!(
            run_language("no", &languages(&["en", "nb"])),
            Some("nb".to_string())
        );
    }

    #[test]
    fn text_post_processing_applies_custom_words_and_fillers() {
        let settings = AppSettings {
            custom_words: vec!["Kandy".to_string()],
            ..Default::default()
        };
        let result = post_process_transcription_text("uhm Kandee is  ready".to_string(), &settings);
        assert_eq!(result, "Kandy is ready");
    }
}
