use crate::audio_toolkit::{decode_to_mono_16k, WHISPER_SAMPLE_RATE};
use crate::managers::history::HistoryManager;
use crate::managers::model::{ModelInfo, ModelManager};
use crate::managers::transcription::TranscriptionManager;
use crate::settings::{get_settings, write_settings};
use log::{error, info};
use serde::Serialize;
use specta::Type;
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager, State};

/// One model's result in a side-by-side comparison.
#[derive(Clone, Debug, Serialize, Type)]
pub struct ModelComparisonResult {
    pub model_id: String,
    pub text: String,
    /// Wall-clock seconds for load + transcription.
    pub seconds: f64,
    /// Set when this model failed; `text` is then empty.
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Type)]
pub struct ModelComparison {
    /// File name of the clip that was transcribed.
    pub source_name: String,
    pub audio_seconds: f64,
    pub results: Vec<ModelComparisonResult>,
}

/// Transcribe one clip with several downloaded models, one after another, for
/// side-by-side comparison. `file_path` is any audio file; `None` uses the
/// latest dictation from history. Each model loads into its own session, so
/// the active model is not switched.
#[tauri::command]
#[specta::specta]
pub async fn compare_models(
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
    history_manager: State<'_, Arc<HistoryManager>>,
    file_path: Option<String>,
    model_ids: Vec<String>,
) -> Result<ModelComparison, String> {
    if model_ids.is_empty() {
        return Err("No models selected".to_string());
    }
    let path = match file_path {
        Some(path) => std::path::PathBuf::from(path),
        None => {
            let entry = history_manager
                .get_latest_completed_entry()
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "No dictation in history yet".to_string())?;
            history_manager.get_audio_file_path(&entry.file_name)
        }
    };
    let source_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();

    let tm = Arc::clone(&transcription_manager);
    tauri::async_runtime::spawn_blocking(move || {
        let samples =
            decode_to_mono_16k(&path).map_err(|e| format!("Could not read audio: {e}"))?;
        if samples.is_empty() {
            return Err("The audio file contained no samples".to_string());
        }
        let audio_seconds = samples.len() as f64 / WHISPER_SAMPLE_RATE as f64;
        let results = model_ids
            .into_iter()
            .map(|model_id| {
                let started = Instant::now();
                let outcome = tm.transcribe_with_model(&model_id, &samples);
                let seconds = started.elapsed().as_secs_f64();
                info!("Comparison: {} took {:.1}s", model_id, seconds);
                match outcome {
                    Ok(text) => ModelComparisonResult {
                        model_id,
                        text,
                        seconds,
                        error: None,
                    },
                    Err(e) => {
                        error!("Comparison: {} failed: {}", model_id, e);
                        ModelComparisonResult {
                            model_id,
                            text: String::new(),
                            seconds,
                            error: Some(e.to_string()),
                        }
                    }
                }
            })
            .collect();
        Ok(ModelComparison {
            source_name,
            audio_seconds,
            results,
        })
    })
    .await
    .map_err(|e| format!("Comparison task panicked: {e}"))?
}

#[tauri::command]
#[specta::specta]
pub async fn get_available_models(
    model_manager: State<'_, Arc<ModelManager>>,
) -> Result<Vec<ModelInfo>, String> {
    Ok(model_manager.get_available_models())
}

/// Re-scan local sources (custom models dir + shared HF cache) for models added
/// since launch
#[tauri::command]
#[specta::specta]
pub async fn rescan_local_models(
    model_manager: State<'_, Arc<ModelManager>>,
) -> Result<(), String> {
    let mm = model_manager.inner().clone();
    tokio::task::spawn_blocking(move || mm.rescan_local_models())
        .await
        .map_err(|e| format!("rescan task panicked: {e}"))?
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn download_model(
    app_handle: AppHandle,
    model_manager: State<'_, Arc<ModelManager>>,
    model_id: String,
) -> Result<(), String> {
    let result = model_manager
        .download_model(&model_id)
        .await
        .map_err(|e| e.to_string());

    if let Err(ref error) = result {
        // Log as well as emit: the toast is transient, and failed downloads have
        // historically been undiagnosable because logs showed nothing (#1579).
        error!("Model download failed for {}: {}", model_id, error);
        let _ = app_handle.emit(
            "model-download-failed",
            serde_json::json!({ "model_id": &model_id, "error": error }),
        );
    }

    result
}

#[tauri::command]
#[specta::specta]
pub async fn delete_model(
    app_handle: AppHandle,
    model_manager: State<'_, Arc<ModelManager>>,
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
    model_id: String,
) -> Result<(), String> {
    // If deleting the active model, unload it and clear the setting
    let mut settings = get_settings(&app_handle);
    if settings.selected_model == model_id {
        transcription_manager.unload_model();
        settings.selected_model = String::new();
        write_settings(&app_handle, settings);
    }

    model_manager
        .delete_model(&model_id)
        .map_err(|e| e.to_string())
}

/// Shared logic for switching the active model, used by both the Tauri command
/// and the tray menu handler.
///
/// Validates the model, updates the persisted setting, and loads the model.
pub fn switch_active_model(app: &AppHandle, model_id: &str) -> Result<(), String> {
    let model_manager = app.state::<Arc<ModelManager>>();
    let transcription_manager = app.state::<Arc<TranscriptionManager>>();

    // Atomically claim the loading slot — prevents concurrent model loads
    // from tray double-clicks or overlapping commands. The guard resets the
    // flag on drop (including early returns, errors, and panics).
    let _loading_guard = transcription_manager
        .try_start_loading()
        .ok_or_else(|| "Model load already in progress".to_string())?;

    // Check if model exists and is available
    let model_info = model_manager
        .get_model_info(model_id)
        .ok_or_else(|| format!("Model not found: {}", model_id))?;

    if !model_info.is_downloaded {
        return Err(format!("Model not downloaded: {}", model_id));
    }

    let settings = get_settings(app);
    let old_model = settings.selected_model.clone();
    let old_onboarding_completed = settings.onboarding_completed;

    // Persist the new selection early so the frontend sees the correct model
    // when it reacts to events emitted by load_model.
    let mut settings = settings;
    settings.selected_model = model_id.to_string();
    settings.onboarding_completed = true;

    write_settings(app, settings);

    // Load the model. On failure, revert the persisted selection.
    if let Err(e) = transcription_manager.load_model(model_id) {
        let mut settings = get_settings(app);
        settings.selected_model = old_model;
        settings.onboarding_completed = old_onboarding_completed;
        write_settings(app, settings);
        return Err(e.to_string());
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn set_active_model(app_handle: AppHandle, model_id: String) -> Result<(), String> {
    switch_active_model(&app_handle, &model_id).inspect_err(|e| {
        error!("Failed to switch to model {}: {}", model_id, e);
    })
}

#[tauri::command]
#[specta::specta]
pub async fn get_current_model(app_handle: AppHandle) -> Result<String, String> {
    let settings = get_settings(&app_handle);
    Ok(settings.selected_model)
}

#[tauri::command]
#[specta::specta]
pub async fn get_transcription_model_status(
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
) -> Result<Option<String>, String> {
    Ok(transcription_manager.get_current_model())
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_download(
    model_manager: State<'_, Arc<ModelManager>>,
    model_id: String,
) -> Result<(), String> {
    model_manager
        .cancel_download(&model_id)
        .map_err(|e| e.to_string())
}
