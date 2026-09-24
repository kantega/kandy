use crate::audio_feedback::{play_feedback_sound, play_feedback_sound_blocking, SoundType};
use crate::audio_toolkit::{is_microphone_access_denied, is_no_input_device_error, VadPolicy};
use crate::managers::audio::AudioRecordingManager;
use crate::managers::history::HistoryManager;
use crate::managers::transcription::TranscriptionManager;
use crate::overlay::{
    hide_recording_overlay, show_processing_overlay, show_recording_overlay,
    show_transcribing_overlay,
};
use crate::settings::{get_settings, AppSettings};
use crate::shortcut;
use crate::tray::{set_tray_state, TrayIconState};
use crate::TranscriptionCoordinator;
use log::{debug, error};
use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};
use tauri::Manager;
use tauri::{AppHandle, Emitter};

const CANCELLATION_POLL_INTERVAL: Duration = Duration::from_millis(25);

#[derive(Clone, serde::Serialize)]
struct RecordingErrorEvent {
    error_type: String,
    detail: Option<String>,
}

/// Drop guard that notifies the [`TranscriptionCoordinator`] when the
/// transcription pipeline finishes, whether it completes normally or panics.
struct FinishGuard(AppHandle);
impl Drop for FinishGuard {
    fn drop(&mut self) {
        if let Some(c) = self.0.try_state::<TranscriptionCoordinator>() {
            c.notify_processing_finished();
        }
    }
}

pub trait ShortcutAction: Send + Sync {
    /// Returns `true` when a recording actually started.
    fn start(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str) -> bool;
    fn stop(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str);
}

struct TranscribeAction {
    /// Force LLM post-processing for this dictation regardless of the
    /// `post_process_enabled` setting.
    force_post_process: bool,
}

/// Strip invisible Unicode characters that some LLMs may insert
fn strip_invisible_chars(s: &str) -> String {
    s.replace(['\u{200B}', '\u{200C}', '\u{200D}', '\u{FEFF}'], "")
}

/// Returns `true` when a transcription has no meaningful content to
/// post-process (empty or whitespace-only), so the LLM call is skipped instead
/// of making the model reply with an error message.
fn is_blank_transcription(transcription: &str) -> bool {
    transcription.trim().is_empty()
}

async fn complete_unless_cancelled<F, C>(operation: F, is_cancelled: C) -> Option<F::Output>
where
    F: Future,
    C: Fn() -> bool,
{
    tokio::pin!(operation);

    loop {
        if is_cancelled() {
            return None;
        }

        if let Ok(result) =
            tokio::time::timeout(CANCELLATION_POLL_INTERVAL, operation.as_mut()).await
        {
            return Some(result);
        }
    }
}

/// Clean `transcription` through the Kantega LLM proxy. `None` means the raw
/// transcription should be used (no key, empty input, or a failed request).
async fn post_process_transcription(settings: &AppSettings, transcription: &str) -> Option<String> {
    if is_blank_transcription(transcription) {
        debug!("Post-processing skipped because the transcription is empty");
        return None;
    }

    let api_key = settings.llm_api_key();
    if api_key.trim().is_empty() {
        debug!("Post-processing skipped because no LLM proxy key is configured");
        return None;
    }

    let model = settings.llm_model.trim();
    if model.is_empty() {
        debug!("Post-processing skipped because no model is configured");
        return None;
    }

    let prompt = settings.post_process_prompt.trim();
    if prompt.is_empty() {
        debug!("Post-processing skipped because the prompt is empty");
        return None;
    }

    debug!("Starting LLM post-processing (model: {})", model);
    match crate::kantega_llm::complete(&api_key, model, prompt, transcription).await {
        Ok(content) => {
            let content = strip_invisible_chars(&content);
            debug!(
                "LLM post-processing succeeded. Output length: {} chars",
                content.len()
            );
            Some(content)
        }
        Err(e) => {
            error!(
                "LLM post-processing failed: {}. Falling back to original transcription.",
                e
            );
            None
        }
    }
}

pub(crate) struct ProcessedTranscription {
    pub final_text: String,
    pub post_processed_text: Option<String>,
    pub post_process_prompt: Option<String>,
}

pub(crate) async fn process_transcription_output(
    app: &AppHandle,
    transcription: &str,
    post_process: bool,
) -> ProcessedTranscription {
    let settings = get_settings(app);
    let mut final_text = transcription.to_string();
    let mut post_processed_text: Option<String> = None;
    let mut post_process_prompt: Option<String> = None;

    if post_process {
        if let Some(processed_text) = post_process_transcription(&settings, &final_text).await {
            post_processed_text = Some(processed_text.clone());
            final_text = processed_text;
            post_process_prompt = Some(settings.post_process_prompt.clone());
        }
    }

    ProcessedTranscription {
        final_text,
        post_processed_text,
        post_process_prompt,
    }
}

impl ShortcutAction for TranscribeAction {
    fn start(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) -> bool {
        let start_time = Instant::now();
        debug!("TranscribeAction::start called for binding: {}", binding_id);

        let tm = app.state::<Arc<TranscriptionManager>>();
        let rm = app.state::<Arc<AudioRecordingManager>>();

        // Load ASR model and VAD model in parallel
        tm.initiate_model_load();
        let rm_clone = Arc::clone(&rm);
        std::thread::spawn(move || {
            if let Err(e) = rm_clone.preload_vad() {
                debug!("VAD pre-load failed: {}", e);
            }
        });

        let binding_id = binding_id.to_string();
        set_tray_state(app, TrayIconState::Recording);

        let settings = get_settings(app);
        let vad_policy = if settings.vad_enabled {
            VadPolicy::Enabled
        } else {
            VadPolicy::Disabled
        };
        show_recording_overlay(app);

        match rm.try_start_recording(&binding_id, vad_policy) {
            Ok(readiness) => {
                debug!("Recording request accepted; waiting for first microphone samples");
                let generation = readiness.generation();
                let app_clone = app.clone();
                let rm_clone = Arc::clone(&rm);
                std::thread::spawn(move || {
                    if !readiness.wait() {
                        debug!("Microphone readiness wait ended without receiving samples");
                        return;
                    }

                    if !rm_clone.is_recording_readiness_current(generation) {
                        debug!("Microphone became ready for an inactive recording");
                        return;
                    }

                    debug!("Microphone is receiving samples; recording is ready");
                    crate::overlay::emit_recording_ready(&app_clone);

                    // The start chime is a readiness cue, so it must follow the
                    // first real input callback rather than Stream::play() or a
                    // fixed delay. The helper returns immediately when feedback
                    // is disabled; mute still follows the same readiness point.
                    if rm_clone.is_recording_readiness_current(generation) {
                        play_feedback_sound_blocking(&app_clone, SoundType::Start);
                    }
                    if rm_clone.is_recording_readiness_current(generation) {
                        rm_clone.apply_mute();
                    }
                });

                shortcut::register_cancel_shortcut(app);
                debug!(
                    "TranscribeAction::start completed in {:?}",
                    start_time.elapsed()
                );
                true
            }
            Err(err) => {
                debug!("Failed to start recording: {}", err);
                // Revert UI state so we don't stay stuck in the recording overlay.
                hide_recording_overlay(app);
                set_tray_state(app, TrayIconState::Idle);
                let error_type = if is_microphone_access_denied(&err) {
                    "microphone_permission_denied"
                } else if is_no_input_device_error(&err) {
                    "no_input_device"
                } else {
                    "unknown"
                };
                let _ = app.emit(
                    "recording-error",
                    RecordingErrorEvent {
                        error_type: error_type.to_string(),
                        detail: Some(err),
                    },
                );
                false
            }
        }
    }

    fn stop(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        // Prevent a slow microphone from emitting a ready event or start chime
        // after the user has already requested stop.
        app.state::<Arc<AudioRecordingManager>>()
            .invalidate_recording_readiness();

        shortcut::unregister_cancel_shortcut(app);

        let stop_time = Instant::now();
        debug!("TranscribeAction::stop called for binding: {}", binding_id);

        let ah = app.clone();
        let rm = Arc::clone(&app.state::<Arc<AudioRecordingManager>>());
        let tm = Arc::clone(&app.state::<Arc<TranscriptionManager>>());
        let hm = Arc::clone(&app.state::<Arc<HistoryManager>>());

        set_tray_state(app, TrayIconState::Transcribing);
        show_transcribing_overlay(app);

        // Unmute before playing audio feedback so the stop sound is audible
        rm.remove_mute();
        play_feedback_sound(app, SoundType::Stop);

        let binding_id = binding_id.to_string();
        let post_process = self.force_post_process || get_settings(app).post_process_enabled;
        let cancel_generation = rm.cancel_generation();

        tauri::async_runtime::spawn(async move {
            let _guard = FinishGuard(ah.clone());
            debug!(
                "Starting async transcription task for binding: {}",
                binding_id
            );

            let Some(samples) = rm.stop_recording(&binding_id, cancel_generation) else {
                debug!("No samples retrieved from recording stop");
                hide_recording_overlay(&ah);
                set_tray_state(&ah, TrayIconState::Idle);
                return;
            };

            if rm.was_cancelled_since(cancel_generation) {
                debug!("Transcription operation cancelled after recording stop");
                hide_recording_overlay(&ah);
                set_tray_state(&ah, TrayIconState::Idle);
                return;
            }

            if samples.is_empty() {
                debug!("Recording produced no audio samples; skipping persistence");
                hide_recording_overlay(&ah);
                set_tray_state(&ah, TrayIconState::Idle);
                return;
            }

            // Save WAV concurrently with transcription
            let sample_count = samples.len();
            let file_name = format!("kandy-{}.wav", chrono::Utc::now().timestamp());
            let wav_path = hm.get_audio_file_path(&file_name);
            let wav_path_for_verify = wav_path.clone();
            let samples_for_wav = samples.clone();
            let wav_handle = tauri::async_runtime::spawn_blocking(move || {
                crate::audio_toolkit::save_wav_file(&wav_path, &samples_for_wav)
            });

            let transcription_time = Instant::now();
            let transcription_result = tm.transcribe(samples);

            let wav_saved = match wav_handle.await {
                Ok(Ok(())) => {
                    match crate::audio_toolkit::verify_wav_file(&wav_path_for_verify, sample_count)
                    {
                        Ok(()) => true,
                        Err(e) => {
                            error!("WAV verification failed: {}", e);
                            false
                        }
                    }
                }
                Ok(Err(e)) => {
                    error!("Failed to save WAV file: {}", e);
                    false
                }
                Err(e) => {
                    error!("WAV save task panicked: {}", e);
                    false
                }
            };

            if rm.was_cancelled_since(cancel_generation) {
                debug!("Transcription operation cancelled before output handling");
                hide_recording_overlay(&ah);
                set_tray_state(&ah, TrayIconState::Idle);
                return;
            }

            let transcription = match transcription_result {
                Ok(transcription) => transcription,
                Err(err) => {
                    if rm.was_cancelled_since(cancel_generation) {
                        debug!("Transcription operation cancelled after transcription error");
                    } else {
                        error!("Transcription failed: {}", err);
                        // Surface the failure to the UI (toast). The full
                        // message is also in kandy.log via the line above.
                        let _ = ah.emit("transcription-error", err.to_string());
                        // Save entry with empty text so user can retry
                        if wav_saved {
                            if let Err(save_err) =
                                hm.save_entry(file_name, String::new(), post_process, None, None)
                            {
                                error!("Failed to save failed history entry: {}", save_err);
                            }
                        }
                    }
                    hide_recording_overlay(&ah);
                    set_tray_state(&ah, TrayIconState::Idle);
                    return;
                }
            };

            debug!(
                "Transcription completed in {:?}: '{}'",
                transcription_time.elapsed(),
                transcription
            );

            if post_process {
                show_processing_overlay(&ah);
            }
            let Some(processed) = complete_unless_cancelled(
                process_transcription_output(&ah, &transcription, post_process),
                || rm.was_cancelled_since(cancel_generation),
            )
            .await
            else {
                debug!("Transcription operation cancelled during output handling");
                hide_recording_overlay(&ah);
                set_tray_state(&ah, TrayIconState::Idle);
                return;
            };

            if rm.was_cancelled_since(cancel_generation) {
                debug!("Transcription operation cancelled before paste");
                hide_recording_overlay(&ah);
                set_tray_state(&ah, TrayIconState::Idle);
                return;
            }

            if wav_saved {
                if let Err(err) = hm.save_entry(
                    file_name,
                    transcription,
                    post_process,
                    processed.post_processed_text.clone(),
                    processed.post_process_prompt.clone(),
                ) {
                    error!("Failed to save history entry: {}", err);
                }
            }

            if processed.final_text.is_empty() {
                hide_recording_overlay(&ah);
                set_tray_state(&ah, TrayIconState::Idle);
                return;
            }

            let ah_clone = ah.clone();
            let paste_time = Instant::now();
            let final_text = processed.final_text;
            let rm_for_paste = Arc::clone(&rm);
            ah.run_on_main_thread(move || {
                if rm_for_paste.was_cancelled_since(cancel_generation) {
                    debug!("Transcription operation cancelled before paste");
                    hide_recording_overlay(&ah_clone);
                    set_tray_state(&ah_clone, TrayIconState::Idle);
                    return;
                }

                match crate::clipboard::paste(final_text, ah_clone.clone()) {
                    Ok(()) => debug!("Text pasted successfully in {:?}", paste_time.elapsed()),
                    Err(e) => {
                        error!("Failed to paste transcription: {}", e);
                        let _ = ah_clone.emit("paste-error", ());
                    }
                }
                hide_recording_overlay(&ah_clone);
                set_tray_state(&ah_clone, TrayIconState::Idle);
            })
            .unwrap_or_else(|e| {
                error!("Failed to run paste on main thread: {:?}", e);
                hide_recording_overlay(&ah);
                set_tray_state(&ah, TrayIconState::Idle);
            });
        });

        debug!(
            "TranscribeAction::stop completed in {:?}",
            stop_time.elapsed()
        );
    }
}

struct CancelAction;

impl ShortcutAction for CancelAction {
    fn start(&self, app: &AppHandle, _binding_id: &str, _shortcut_str: &str) -> bool {
        crate::utils::cancel_current_operation(app);
        false
    }

    fn stop(&self, _app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {}
}

pub static ACTION_MAP: LazyLock<HashMap<String, Arc<dyn ShortcutAction>>> = LazyLock::new(|| {
    let mut map: HashMap<String, Arc<dyn ShortcutAction>> = HashMap::new();
    map.insert(
        "transcribe".to_string(),
        Arc::new(TranscribeAction {
            force_post_process: false,
        }),
    );
    map.insert(
        "transcribe_with_post_process".to_string(),
        Arc::new(TranscribeAction {
            force_post_process: true,
        }),
    );
    map.insert("cancel".to_string(), Arc::new(CancelAction));
    map
});

#[cfg(test)]
mod tests {
    use super::{complete_unless_cancelled, is_blank_transcription};
    use std::future;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn blank_transcription_is_detected() {
        assert!(is_blank_transcription(""));
        assert!(is_blank_transcription("   "));
        assert!(is_blank_transcription("\t\n  \r\n"));
        assert!(!is_blank_transcription("  hello  "));
    }

    #[test]
    fn completed_operation_returns_its_output() {
        let result = tauri::async_runtime::block_on(complete_unless_cancelled(
            future::ready("done"),
            || false,
        ));

        assert_eq!(result, Some("done"));
    }

    #[test]
    fn pending_operation_stops_after_cancellation() {
        let cancelled = Arc::new(AtomicBool::new(false));
        let cancelled_for_thread = Arc::clone(&cancelled);
        let cancel_thread = thread::spawn(move || {
            thread::sleep(Duration::from_millis(10));
            cancelled_for_thread.store(true, Ordering::Release);
        });

        let result = tauri::async_runtime::block_on(complete_unless_cancelled(
            future::pending::<()>(),
            || cancelled.load(Ordering::Acquire),
        ));

        cancel_thread.join().unwrap();
        assert_eq!(result, None);
    }
}
