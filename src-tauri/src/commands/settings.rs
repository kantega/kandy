//! `change_*_setting` commands: persist one field and apply any runtime side
//! effect (overlay cache, tray language, autostart, shortcut registration).

use log::warn;
use tauri::{AppHandle, Emitter, Manager};

use crate::settings::{
    self, AutoSubmitKey, OverlayPosition, OverlayStyle, PasteMethod, ShortcutActivation,
    SoundTheme, Theme, VadBackend,
};
use crate::shortcut;
use crate::tray;

#[tauri::command]
#[specta::specta]
pub fn change_shortcut_activation_setting(
    app: AppHandle,
    activation: ShortcutActivation,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.shortcut_activation = activation;
    settings::write_settings(&app, settings);
    Ok(())
}

/// Experimental detector implementation; Silero remains the stable default.
#[tauri::command]
#[specta::specta]
pub fn change_vad_backend_setting(app: AppHandle, backend: VadBackend) -> Result<(), String> {
    // Swap the live detector first: a failure here (recording in progress, or
    // the microphone refusing to reopen) must leave the stored setting alone.
    app.state::<std::sync::Arc<crate::managers::audio::AudioRecordingManager>>()
        .update_vad_backend(backend)
        .map_err(|e| e.to_string())?;

    let mut settings = settings::get_settings(&app);
    settings.vad_backend = backend;
    settings::write_settings(&app, settings);
    Ok(())
}

/// Hold-or-toggle only: presses held at least this long are push-to-talk.
#[tauri::command]
#[specta::specta]
pub fn change_hold_threshold_setting(app: AppHandle, threshold_ms: u32) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.hold_threshold_ms = u64::from(threshold_ms);
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_audio_feedback_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.audio_feedback = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_audio_feedback_volume_setting(app: AppHandle, volume: f32) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.audio_feedback_volume = volume;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_sound_theme_setting(app: AppHandle, theme: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.sound_theme = match theme.as_str() {
        "marimba" => SoundTheme::Marimba,
        "pop" => SoundTheme::Pop,
        other => {
            warn!("Invalid sound theme '{}', defaulting to marimba", other);
            SoundTheme::Marimba
        }
    };
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_theme_setting(app: AppHandle, theme: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    let parsed = match theme.as_str() {
        "system" => Theme::System,
        "light" => Theme::Light,
        "dark" => Theme::Dark,
        other => {
            warn!("Invalid theme '{}', defaulting to system", other);
            Theme::System
        }
    };
    settings.theme = parsed;
    settings::write_settings(&app, settings);
    apply_window_theme(&app, parsed);
    // Notify other webviews (the recording overlay) so they re-apply the palette
    // live. They set `data-theme` on their own document and can't see this one.
    let _ = app.emit("theme-changed", parsed);
    Ok(())
}

/// Applies the appearance setting to the native window chrome (title bar), which
/// CSS `data-theme` cannot reach. `System` clears the override so the window
/// follows the OS. `set_theme` sets `NSApp.appearance` app-wide, which darkens
/// the title bar and keeps the overlay in step.
pub fn apply_window_theme(app: &AppHandle, theme: Theme) {
    let window_theme = match theme {
        Theme::System => None,
        Theme::Light => Some(tauri::Theme::Light),
        Theme::Dark => Some(tauri::Theme::Dark),
    };
    if let Some(window) = app.get_webview_window("main") {
        if let Err(e) = window.set_theme(window_theme) {
            warn!("Failed to apply window theme: {}", e);
        }
    }
}

#[tauri::command]
#[specta::specta]
pub fn change_selected_language_setting(app: AppHandle, language: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.selected_language = language;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_overlay_position_setting(app: AppHandle, position: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.overlay_position = match position.as_str() {
        "bottom" => OverlayPosition::Bottom,
        "top" => OverlayPosition::Top,
        other => {
            warn!("Invalid overlay position '{}', defaulting to bottom", other);
            OverlayPosition::Bottom
        }
    };
    settings::write_settings(&app, settings);
    crate::overlay::update_overlay_position(&app);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_overlay_style_setting(app: AppHandle, style: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    let parsed = match style.as_str() {
        "none" => OverlayStyle::None,
        "minimal" => OverlayStyle::Minimal,
        other => {
            warn!("Invalid overlay style '{}', defaulting to minimal", other);
            OverlayStyle::Minimal
        }
    };
    settings.overlay_style = parsed;
    settings::write_settings(&app, settings);

    // Keep the cached overlay-enabled flag in sync so emit_levels stops (or
    // resumes) emitting on the next audio callback.
    crate::overlay::update_overlay_enabled_cache(parsed != OverlayStyle::None);
    crate::overlay::update_overlay_position(&app);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_autostart_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.autostart_enabled = enabled;
    settings::write_settings(&app, settings);

    crate::autostart::apply_autostart(&app, enabled);

    let _ = app.emit(
        "settings-changed",
        serde_json::json!({
            "setting": "autostart_enabled",
            "value": enabled
        }),
    );
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn update_custom_words(app: AppHandle, words: Vec<String>) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.custom_words = words;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_paste_method_setting(app: AppHandle, method: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.paste_method = match method.as_str() {
        "ctrl_v" => PasteMethod::CtrlV,
        "direct" => PasteMethod::Direct,
        "none" => PasteMethod::None,
        other => {
            warn!("Invalid paste method '{}', defaulting to ctrl_v", other);
            PasteMethod::CtrlV
        }
    };
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_auto_submit_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.auto_submit = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_auto_submit_key_setting(app: AppHandle, key: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.auto_submit_key = match key.as_str() {
        "enter" => AutoSubmitKey::Enter,
        "ctrl_enter" => AutoSubmitKey::CtrlEnter,
        "cmd_enter" => AutoSubmitKey::CmdEnter,
        other => {
            warn!("Invalid auto submit key '{}', defaulting to enter", other);
            AutoSubmitKey::Enter
        }
    };
    settings::write_settings(&app, settings);
    Ok(())
}

/// Toggle automatic post-processing of every dictation. The
/// `transcribe_with_post_process` shortcut stays registered regardless, so a
/// single dictation can always be post-processed on demand.
#[tauri::command]
#[specta::specta]
pub fn change_post_process_enabled_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.post_process_enabled = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_post_process_prompt_setting(app: AppHandle, prompt: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.post_process_prompt = prompt;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_llm_model_setting(app: AppHandle, model: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.llm_model = model;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_meeting_summary_prompt_setting(app: AppHandle, prompt: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.meeting_summary_prompt = prompt;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_meeting_auto_summarize_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.meeting_auto_summarize = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_meeting_auto_title_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.meeting_auto_title = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

/// Set or clear the Kantega LLM proxy key. An empty (or whitespace-only)
/// `api_key` removes the entry so the key genuinely disappears from the
/// settings file; see `settings::set_llm_api_key`.
#[tauri::command]
#[specta::specta]
pub fn change_llm_api_key_setting(app: AppHandle, api_key: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings::set_llm_api_key(&mut settings, &api_key);
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_mute_while_recording_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.mute_while_recording = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_vad_enabled_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.vad_enabled = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_filler_word_removal_enabled_setting(
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.filler_word_removal_enabled = enabled;
    settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_app_language_setting(app: AppHandle, language: String) -> Result<(), String> {
    let mut settings = settings::get_settings(&app);
    settings.app_language = language.clone();
    settings::write_settings(&app, settings);
    tray::update_tray_menu(&app);
    Ok(())
}

/// Temporarily unregister all bindings while the user is recording a
/// shortcut in the UI, so no existing shortcut fires mid-capture.
#[tauri::command]
#[specta::specta]
pub fn suspend_all_bindings(app: AppHandle) -> Result<(), String> {
    shortcut::suspend_all_shortcuts(&app);
    Ok(())
}

/// Re-register all bindings after the user has finished recording.
#[tauri::command]
#[specta::specta]
pub fn resume_all_bindings(app: AppHandle) -> Result<(), String> {
    shortcut::resume_all_shortcuts(&app);
    Ok(())
}
