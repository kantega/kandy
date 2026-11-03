use crate::input::{self, EnigoState};
use crate::settings::{get_settings, AutoSubmitKey, PasteMethod};
use enigo::{Direction, Enigo, Key, Keyboard};
use log::info;
use std::sync::{mpsc, Mutex, PoisonError};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

/// Wait between writing the clipboard and sending the paste chord.
const PASTE_DELAY: Duration = Duration::from_millis(60);
/// Wait after the paste chord before restoring the clipboard.
const PASTE_DELAY_AFTER: Duration = Duration::from_millis(60);

/// Serializes pastes. Each one snapshots and restores the clipboard, so two
/// overlapping pastes would save each other's transcript as "the user's
/// clipboard". Only taken by `paste`, which never runs on the main thread.
static PASTE_LOCK: Mutex<()> = Mutex::new(());

/// Runs `f` with the shared Enigo on the main thread and waits for its result.
///
/// Paste runs on a worker thread so the main thread stays free while it
/// sleeps, which lets Kandy's own windows handle a paste aimed at them. Input
/// injection hops back here because macOS's TIS keyboard layout APIs must run
/// on the main thread. Tauri runs the closure inline when already on the main
/// thread, so nested calls can't deadlock.
fn with_enigo<T: Send + 'static>(
    app_handle: &AppHandle,
    f: impl FnOnce(&mut Enigo) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (tx, rx) = mpsc::sync_channel(1);
    let app = app_handle.clone();
    app_handle
        .run_on_main_thread(move || {
            let result = (|| {
                let enigo_state = app
                    .try_state::<EnigoState>()
                    .ok_or("Enigo state not initialized")?;
                let mut enigo = enigo_state
                    .0
                    .lock()
                    .map_err(|e| format!("Failed to lock Enigo: {}", e))?;
                f(&mut enigo)
            })();
            let _ = tx.send(result);
        })
        .map_err(|e| format!("Failed to run input on the main thread: {}", e))?;
    // A dropped closure (event loop shutting down) closes the channel.
    rx.recv()
        .map_err(|_| "Main thread dropped the input request".to_string())?
}

fn write_text_to_clipboard(app_handle: &AppHandle, text: &str) -> Result<(), String> {
    app_handle
        .clipboard()
        .write_text(text)
        .map_err(|e| format!("Failed to write to clipboard: {}", e))
}

fn finish_clipboard_paste(
    paste_result: Result<(), String>,
    paste_delay_after: Duration,
    restore_clipboard: impl FnOnce(),
) -> Result<(), String> {
    std::thread::sleep(paste_delay_after);
    restore_clipboard();
    paste_result
}

/// Pastes text using the clipboard: saves current content, writes text, sends paste keystroke, restores clipboard.
fn paste_via_clipboard(
    text: &str,
    app_handle: &AppHandle,
    paste_method: &PasteMethod,
) -> Result<(), String> {
    let clipboard = app_handle.clipboard();
    let saved_text = clipboard.read_text().ok().filter(|t| !t.is_empty());
    // Only probe for an image when there is no text to restore. Text is by far the
    // common case, and reading an image decodes the full bitmap, so this keeps the
    // text path exactly as cheap as it was before.
    let saved_image = if saved_text.is_none() {
        clipboard.read_image().ok().map(|image| image.to_owned())
    } else {
        None
    };

    // Write text to clipboard first
    write_text_to_clipboard(app_handle, text)?;

    std::thread::sleep(PASTE_DELAY);

    // Capture key injection errors so the original clipboard is restored before
    // propagating them to the caller.
    let paste_method = *paste_method;
    let paste_result = with_enigo(app_handle, move |enigo| match paste_method {
        // A mistimed chord cannot be detected, so keep the conservative 100ms
        // modifier hold.
        PasteMethod::CtrlV => input::send_paste_ctrl_v(enigo, 100),
        _ => Err("Invalid paste method for clipboard paste".into()),
    });

    finish_clipboard_paste(paste_result, PASTE_DELAY_AFTER, || {
        // Restore original clipboard content even when key injection failed.
        // Text takes priority; an image is only restored when the clipboard
        // held no text at all.
        if let Some(clipboard_content) = saved_text {
            let _ = write_text_to_clipboard(app_handle, &clipboard_content);
        } else if let Some(image) = saved_image {
            info!("Restoring image to clipboard");
            let _ = clipboard.write_image(&image);
        } else {
            // Nothing was there to begin with, so don't leave the transcription behind.
            let _ = clipboard.clear();
        }
    })
}

/// Types text directly by simulating individual key presses.
fn paste_direct(text: &str, app_handle: &AppHandle) -> Result<(), String> {
    let text = text.to_string();
    with_enigo(app_handle, move |enigo| {
        input::paste_text_direct(enigo, &text)
    })
}

fn send_return_key(enigo: &mut Enigo, key_type: AutoSubmitKey) -> Result<(), String> {
    match key_type {
        AutoSubmitKey::Enter => {
            enigo
                .key(Key::Return, Direction::Press)
                .map_err(|e| format!("Failed to press Return key: {}", e))?;
            enigo
                .key(Key::Return, Direction::Release)
                .map_err(|e| format!("Failed to release Return key: {}", e))?;
        }
        AutoSubmitKey::CtrlEnter => {
            enigo
                .key(Key::Control, Direction::Press)
                .map_err(|e| format!("Failed to press Control key: {}", e))?;
            enigo
                .key(Key::Return, Direction::Press)
                .map_err(|e| format!("Failed to press Return key: {}", e))?;
            enigo
                .key(Key::Return, Direction::Release)
                .map_err(|e| format!("Failed to release Return key: {}", e))?;
            enigo
                .key(Key::Control, Direction::Release)
                .map_err(|e| format!("Failed to release Control key: {}", e))?;
        }
        AutoSubmitKey::CmdEnter => {
            enigo
                .key(Key::Meta, Direction::Press)
                .map_err(|e| format!("Failed to press Meta/Cmd key: {}", e))?;
            enigo
                .key(Key::Return, Direction::Press)
                .map_err(|e| format!("Failed to press Return key: {}", e))?;
            enigo
                .key(Key::Return, Direction::Release)
                .map_err(|e| format!("Failed to release Return key: {}", e))?;
            enigo
                .key(Key::Meta, Direction::Release)
                .map_err(|e| format!("Failed to release Meta/Cmd key: {}", e))?;
        }
    }

    Ok(())
}

fn should_send_auto_submit(auto_submit: bool, paste_method: PasteMethod) -> bool {
    auto_submit && paste_method != PasteMethod::None
}

/// Pastes `text` into the focused application. Call it from a worker thread,
/// never the main thread: it sleeps between steps, and only the input
/// injection hops to the main thread (see `with_enigo`).
pub fn paste(text: String, app_handle: AppHandle) -> Result<(), String> {
    let _paste = PASTE_LOCK.lock().unwrap_or_else(PoisonError::into_inner);
    let settings = get_settings(&app_handle);
    let paste_method = settings.paste_method;

    info!("Using paste method: {:?}", paste_method);

    match paste_method {
        PasteMethod::None => {
            info!("PasteMethod::None selected - skipping paste action");
        }
        PasteMethod::Direct => paste_direct(&text, &app_handle)?,
        PasteMethod::CtrlV => paste_via_clipboard(&text, &app_handle, &paste_method)?,
    }

    if should_send_auto_submit(settings.auto_submit, paste_method) {
        std::thread::sleep(Duration::from_millis(50));
        let auto_submit_key = settings.auto_submit_key;
        if let Err(error) = with_enigo(&app_handle, move |enigo| {
            send_return_key(enigo, auto_submit_key)
        }) {
            log::warn!("Paste succeeded, but auto-submit failed: {error}");
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn auto_submit_requires_setting_enabled() {
        assert!(!should_send_auto_submit(false, PasteMethod::CtrlV));
        assert!(!should_send_auto_submit(false, PasteMethod::Direct));
    }

    #[test]
    fn auto_submit_skips_none_paste_method() {
        assert!(!should_send_auto_submit(true, PasteMethod::None));
    }

    #[test]
    fn auto_submit_runs_for_active_paste_methods() {
        assert!(should_send_auto_submit(true, PasteMethod::CtrlV));
        assert!(should_send_auto_submit(true, PasteMethod::Direct));
    }

    #[test]
    fn clipboard_is_restored_before_key_injection_error_is_returned() {
        let restored = Cell::new(false);
        let result = finish_clipboard_paste(Err("input failed".into()), Duration::ZERO, || {
            restored.set(true);
        });

        assert_eq!(result.unwrap_err(), "input failed");
        assert!(restored.get());
    }
}
