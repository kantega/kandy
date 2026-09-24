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
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager};
use transcribe_cpp::{
    Backend, Model, ModelOptions, RunExtension, RunOptions, Session, Task, WhisperRunOptions,
};

/// Unload the model after this much idle time.
const MODEL_IDLE_UNLOAD: Duration = Duration::from_secs(5 * 60);

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

#[derive(Clone)]
pub struct TranscriptionManager {
    /// The loaded transcribe-cpp `Session`; it keeps its `Model` alive
    /// internally, so repeated dictation reuses the session without reloading.
    engine: Arc<Mutex<Option<Session>>>,
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
    pub fn new(app_handle: &AppHandle, model_manager: Arc<ModelManager>) -> Result<Self> {
        let manager = Self {
            engine: Arc::new(Mutex::new(None)),
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

        let model_languages = engine.model().capabilities().languages;
        debug!(
            "transcribe-cpp model '{}' on '{}': languages={:?}",
            active_model,
            engine.model().backend(),
            model_languages
        );

        let transcribe_result = catch_unwind(AssertUnwindSafe(|| -> Result<String> {
            // Custom words become the whisper initial prompt.
            let family = if settings.custom_words.is_empty() {
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
    if effective_language == "auto" {
        return None;
    }
    model_languages
        .iter()
        .any(|l| l == effective_language)
        .then(|| effective_language.to_string())
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
    fn text_post_processing_applies_custom_words_and_fillers() {
        let settings = AppSettings {
            custom_words: vec!["Kandy".to_string()],
            ..Default::default()
        };
        let result = post_process_transcription_text("uhm Kandee is  ready".to_string(), &settings);
        assert_eq!(result, "Kandy is ready");
    }
}
