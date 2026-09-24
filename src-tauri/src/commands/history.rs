use crate::actions::process_transcription_output;
use crate::managers::{
    history::{HistoryEntry, HistoryManager, HistoryStats, PaginatedHistory},
    transcription::TranscriptionManager,
};
use std::sync::Arc;
use tauri::{AppHandle, State};

#[tauri::command]
#[specta::specta]
pub async fn get_history_entries(
    history_manager: State<'_, Arc<HistoryManager>>,
    cursor: Option<i64>,
    limit: Option<usize>,
) -> Result<PaginatedHistory, String> {
    history_manager
        .get_history_entries(cursor, limit)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn toggle_history_entry_saved(
    history_manager: State<'_, Arc<HistoryManager>>,
    id: i64,
) -> Result<(), String> {
    history_manager
        .toggle_saved_status(id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_audio_file_path(
    history_manager: State<'_, Arc<HistoryManager>>,
    file_name: String,
) -> Result<String, String> {
    let path = history_manager.get_audio_file_path(&file_name);
    path.to_str()
        .ok_or_else(|| "Invalid file path".to_string())
        .map(|s| s.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_history_entry(
    history_manager: State<'_, Arc<HistoryManager>>,
    id: i64,
) -> Result<(), String> {
    history_manager
        .delete_entry(id)
        .await
        .map_err(|e| e.to_string())
}

/// Delete several entries in one transaction, audio files included.
///
/// Preferred over looping `delete_history_entry` from the frontend: a single
/// round trip, and either the whole selection goes or none of it does.
#[tauri::command]
#[specta::specta]
pub async fn delete_history_entries(
    history_manager: State<'_, Arc<HistoryManager>>,
    ids: Vec<i64>,
) -> Result<usize, String> {
    history_manager
        .delete_entries(&ids)
        .await
        .map_err(|e| e.to_string())
}

/// Wipe the history. Starred entries are kept unless `include_saved` is set.
#[tauri::command]
#[specta::specta]
pub async fn delete_all_history_entries(
    history_manager: State<'_, Arc<HistoryManager>>,
    include_saved: bool,
) -> Result<usize, String> {
    history_manager
        .delete_all_entries(include_saved)
        .await
        .map_err(|e| e.to_string())
}

/// Row counts for the whole history, so the "delete all" confirmation can name
/// the real numbers rather than only the entries scrolled into view.
#[tauri::command]
#[specta::specta]
pub async fn get_history_stats(
    history_manager: State<'_, Arc<HistoryManager>>,
) -> Result<HistoryStats, String> {
    history_manager.get_stats().map_err(|e| e.to_string())
}

/// Replace an entry's transcript with text the user corrected by hand.
#[tauri::command]
#[specta::specta]
pub async fn update_history_entry_text(
    history_manager: State<'_, Arc<HistoryManager>>,
    id: i64,
    text: String,
) -> Result<HistoryEntry, String> {
    history_manager
        .update_transcription_text(id, text)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn retry_history_entry_transcription(
    app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
    id: i64,
) -> Result<(), String> {
    let entry = history_manager
        .get_entry_by_id(id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("History entry {} not found", id))?;

    let audio_path = history_manager.get_audio_file_path(&entry.file_name);
    let samples = crate::audio_toolkit::read_wav_samples(&audio_path)
        .map_err(|e| format!("Failed to load audio: {}", e))?;

    if samples.is_empty() {
        return Err("Recording has no audio samples".to_string());
    }

    transcription_manager.initiate_model_load();

    let tm = Arc::clone(&transcription_manager);
    let transcription = tauri::async_runtime::spawn_blocking(move || tm.transcribe(samples))
        .await
        .map_err(|e| format!("Transcription task panicked: {}", e))?
        .map_err(|e| e.to_string())?;

    if transcription.is_empty() {
        return Err("Recording contains no speech".to_string());
    }

    let processed =
        process_transcription_output(&app, &transcription, entry.post_process_requested).await;
    history_manager
        .update_transcription(
            id,
            transcription,
            processed.post_processed_text,
            processed.post_process_prompt,
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
}
