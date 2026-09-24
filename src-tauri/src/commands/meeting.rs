//! Tauri commands for the Meeting feature: record → transcribe → summarise.
//!
//! Recording drives `AudioRecordingManager` directly (binding id "meeting",
//! VAD disabled so the full meeting is captured, not just detected speech).
//! Transcription reuses the existing batch `TranscriptionManager::transcribe`.
//! Summaries go through the Kantega LLM proxy; if no key is configured the
//! transcript is still saved and returned (the mandatory no-key fallback).
//! Whether a summary is requested automatically after transcription is the
//! frontend's call (`meeting_auto_summarize`).

use crate::audio_toolkit::{decode_to_mono_16k, save_wav_file, VadPolicy, WHISPER_SAMPLE_RATE};
use crate::kantega_llm;
use crate::managers::audio::AudioRecordingManager;
use crate::managers::meeting::{Meeting, MeetingManager};
use crate::managers::transcription::TranscriptionManager;
use crate::settings::get_settings;
use chrono::Utc;
use std::sync::Arc;
use tauri::{AppHandle, State};

/// Binding id the meeting recorder uses so it is distinct from dictation.
const MEETING_BINDING: &str = "meeting";

#[tauri::command]
#[specta::specta]
pub async fn start_meeting_recording(
    recording_manager: State<'_, Arc<AudioRecordingManager>>,
) -> Result<(), String> {
    // VAD disabled: capture the whole meeting, including silences, so nothing is
    // trimmed before transcription.
    recording_manager
        .try_start_recording(MEETING_BINDING, VadPolicy::Disabled)
        .map(|_| ())
}

#[tauri::command]
#[specta::specta]
pub fn is_meeting_recording(recording_manager: State<'_, Arc<AudioRecordingManager>>) -> bool {
    recording_manager.is_recording()
}

/// Stop the meeting recording, save the audio, transcribe it, and persist the
/// meeting. Returns the saved meeting (without a summary yet).
#[tauri::command]
#[specta::specta]
pub async fn stop_meeting_recording(
    recording_manager: State<'_, Arc<AudioRecordingManager>>,
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
    meeting_manager: State<'_, Arc<MeetingManager>>,
) -> Result<Meeting, String> {
    let generation = recording_manager.cancel_generation();
    let samples = recording_manager
        .stop_recording(MEETING_BINDING, generation)
        .ok_or_else(|| "No active meeting recording".to_string())?;

    if samples.is_empty() {
        return Err("Recording captured no audio".to_string());
    }

    let duration_secs = (samples.len() / WHISPER_SAMPLE_RATE as usize) as i64;

    // Persist the WAV before the (slow) transcription so the audio survives even
    // if transcription fails.
    let file_name = format!("meeting_{}.wav", Utc::now().timestamp_millis());
    let audio_path = meeting_manager.audio_file_path(&file_name);
    save_wav_file(&audio_path, &samples).map_err(|e| format!("Failed to save audio: {}", e))?;

    transcription_manager.initiate_model_load();
    let tm = Arc::clone(&transcription_manager);
    let transcript = tauri::async_runtime::spawn_blocking(move || tm.transcribe(samples))
        .await
        .map_err(|e| format!("Transcription task panicked: {}", e))?
        .map_err(|e| e.to_string())?;

    meeting_manager
        .save_meeting(file_name, transcript, duration_secs)
        .map_err(|e| e.to_string())
}

/// Prefix of the error returned when Symphonia could not make sense of the
/// file. The frontend matches on it to show "this file cannot be read" rather
/// than "transcription failed", so keep the two in sync.
const DECODE_ERROR_PREFIX: &str = "Failed to decode audio:";

/// Transcribe an audio file the user picked from disk or dropped on the meeting
/// tab, and persist it as a meeting. Same downstream path as
/// `stop_meeting_recording`, just with pre-recorded audio.
///
/// Which containers and codecs are accepted follows straight from the
/// `symphonia` feature list in `Cargo.toml`.
#[tauri::command]
#[specta::specta]
pub async fn upload_meeting_audio(
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
    meeting_manager: State<'_, Arc<MeetingManager>>,
    file_path: String,
) -> Result<Meeting, String> {
    // Decoding can block for a while on large files — push it off the async
    // runtime so we do not stall other Tauri commands.
    let decoded_path = file_path.clone();
    let samples = tauri::async_runtime::spawn_blocking(move || decode_to_mono_16k(&decoded_path))
        .await
        .map_err(|e| format!("Decode task panicked: {}", e))?
        .map_err(|e| format!("{} {}", DECODE_ERROR_PREFIX, e))?;

    if samples.is_empty() {
        return Err(format!(
            "{} the file contained no audio samples",
            DECODE_ERROR_PREFIX
        ));
    }

    let duration_secs = (samples.len() / WHISPER_SAMPLE_RATE as usize) as i64;

    let file_name = format!("meeting_upload_{}.wav", Utc::now().timestamp_millis());
    let audio_path = meeting_manager.audio_file_path(&file_name);
    save_wav_file(&audio_path, &samples).map_err(|e| format!("Failed to save audio: {}", e))?;

    transcription_manager.initiate_model_load();
    let tm = Arc::clone(&transcription_manager);
    let transcript = tauri::async_runtime::spawn_blocking(move || tm.transcribe(samples))
        .await
        .map_err(|e| format!("Transcription task panicked: {}", e))?
        .map_err(|e| e.to_string())?;

    meeting_manager
        .save_meeting(file_name, transcript, duration_secs)
        .map_err(|e| e.to_string())
}

/// Generate (or regenerate) a Norwegian summary for a saved meeting via the
/// Kantega LLM proxy. `prompt` overrides the global summary prompt for this
/// meeting only; `None` or blank falls back to the setting. The prompt used is
/// stored on the meeting so a later regenerate starts from it.
#[tauri::command]
#[specta::specta]
pub async fn summarize_meeting(
    app: AppHandle,
    meeting_manager: State<'_, Arc<MeetingManager>>,
    id: i64,
    prompt: Option<String>,
) -> Result<Meeting, String> {
    let meeting = meeting_manager
        .get_by_id(id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Meeting {} not found", id))?;

    if meeting.transcript.trim().is_empty() {
        return Err("Meeting has no transcript to summarise".to_string());
    }

    let settings = get_settings(&app);
    let api_key = settings.llm_api_key();
    let prompt = prompt
        .filter(|p| !p.trim().is_empty())
        .unwrap_or_else(|| settings.meeting_summary_prompt.clone());
    let model = settings.llm_model.clone();

    let summary = kantega_llm::summarize(&api_key, &model, &prompt, &meeting.transcript).await?;

    let updated = meeting_manager
        .update_summary(id, summary.clone(), prompt, model.clone())
        .map_err(|e| e.to_string())?;

    // Name the meeting from its summary, but only while the title is still the
    // automatic timestamp so a hand-written title is never overwritten.
    if settings.meeting_auto_title
        && MeetingManager::is_automatic_title(&updated.title, updated.timestamp)
    {
        if let Some(title) = kantega_llm::suggest_title(&api_key, &model, &summary).await {
            return meeting_manager.rename(id, title).map_err(|e| e.to_string());
        }
    }

    Ok(updated)
}

#[tauri::command]
#[specta::specta]
pub fn get_meetings(
    meeting_manager: State<'_, Arc<MeetingManager>>,
) -> Result<Vec<Meeting>, String> {
    meeting_manager.get_meetings().map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn delete_meeting(
    meeting_manager: State<'_, Arc<MeetingManager>>,
    id: i64,
) -> Result<(), String> {
    meeting_manager.delete(id).map_err(|e| e.to_string())
}

/// Absolute path to a meeting's audio file, for playback via the asset
/// protocol and for the "download audio" save dialog. Mirrors
/// `commands::history::get_audio_file_path`.
#[tauri::command]
#[specta::specta]
pub async fn get_meeting_audio_path(
    meeting_manager: State<'_, Arc<MeetingManager>>,
    file_name: String,
) -> Result<String, String> {
    let path = meeting_manager.audio_file_path(&file_name);
    path.to_str()
        .ok_or_else(|| "Invalid file path".to_string())
        .map(|s| s.to_string())
}

/// Persist a hand-edited summary. Prompt and model are left as they were.
#[tauri::command]
#[specta::specta]
pub fn update_meeting_summary(
    meeting_manager: State<'_, Arc<MeetingManager>>,
    id: i64,
    summary: String,
) -> Result<Meeting, String> {
    meeting_manager
        .set_summary(id, summary)
        .map_err(|e| e.to_string())
}

/// Persist a hand-edited transcript, so a corrected transcript can be fed back
/// into a regenerated summary.
#[tauri::command]
#[specta::specta]
pub fn update_meeting_transcript(
    meeting_manager: State<'_, Arc<MeetingManager>>,
    id: i64,
    transcript: String,
) -> Result<Meeting, String> {
    meeting_manager
        .set_transcript(id, transcript)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn rename_meeting(
    meeting_manager: State<'_, Arc<MeetingManager>>,
    id: i64,
    title: String,
) -> Result<Meeting, String> {
    meeting_manager.rename(id, title).map_err(|e| e.to_string())
}
