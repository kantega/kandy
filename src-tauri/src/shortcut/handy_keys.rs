//! handy-keys based keyboard shortcut implementation.
//!
//! A dedicated manager thread owns the `HotkeyManager` (it is single-thread
//! only). Register/unregister commands travel over an mpsc channel and the
//! caller waits for the reply, so the public API is synchronous.
//!
//! For UI key capture, a separate `KeyboardListener` is created on demand and
//! polled from a recording thread that emits `handy-keys-event` to the frontend.

use handy_keys::{Hotkey, HotkeyId, HotkeyManager, HotkeyState, KeyboardListener};
use log::{debug, error, info};
use serde::Serialize;
use specta::Type;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use tauri::{AppHandle, Emitter, Manager};

use crate::settings::{self, get_settings, ShortcutBinding};

use super::handler::handle_shortcut_event;

enum ManagerCommand {
    Register {
        binding_id: String,
        hotkey_string: String,
        response: Sender<Result<(), String>>,
    },
    Unregister {
        binding_id: String,
        response: Sender<Result<(), String>>,
    },
    Shutdown,
}

pub struct KandyKeysState {
    command_sender: Mutex<Sender<ManagerCommand>>,
    thread_handle: Mutex<Option<JoinHandle<()>>>,
    /// Recording listener for UI key capture (only active during recording)
    recording_listener: Mutex<Option<KeyboardListener>>,
    is_recording: AtomicBool,
    /// Flag to stop recording loop
    recording_running: Arc<AtomicBool>,
}

/// Key event sent to frontend during recording mode
#[derive(Debug, Clone, Serialize, Type)]
pub struct FrontendKeyEvent {
    pub modifiers: Vec<String>,
    pub key: Option<String>,
    pub is_key_down: bool,
    /// The full hotkey string (e.g., "option+space")
    pub hotkey_string: String,
}

impl KandyKeysState {
    /// Spawn the manager thread and wait until its `HotkeyManager` exists, so
    /// a failing construction surfaces here instead of silently registering
    /// nothing later.
    pub fn new(app: AppHandle) -> Result<Self, String> {
        let (cmd_tx, cmd_rx) = mpsc::channel::<ManagerCommand>();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();

        let thread_handle = thread::spawn(move || {
            Self::manager_thread(cmd_rx, ready_tx, app);
        });

        match ready_rx.recv() {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                let _ = thread_handle.join();
                return Err(e);
            }
            Err(_) => {
                let _ = thread_handle.join();
                return Err("handy-keys manager thread exited before reporting readiness".into());
            }
        }

        Ok(Self {
            command_sender: Mutex::new(cmd_tx),
            thread_handle: Mutex::new(Some(thread_handle)),
            recording_listener: Mutex::new(None),
            is_recording: AtomicBool::new(false),
            recording_running: Arc::new(AtomicBool::new(false)),
        })
    }

    fn manager_thread(
        cmd_rx: Receiver<ManagerCommand>,
        ready_tx: Sender<Result<(), String>>,
        app: AppHandle,
    ) {
        info!("handy-keys manager thread started");

        let manager = match HotkeyManager::new_with_blocking() {
            Ok(m) => m,
            Err(e) => {
                error!("Failed to create HotkeyManager: {}", e);
                let _ = ready_tx.send(Err(format!("Failed to create HotkeyManager: {}", e)));
                return;
            }
        };
        let _ = ready_tx.send(Ok(()));

        let mut binding_to_hotkey: HashMap<String, HotkeyId> = HashMap::new();
        // HotkeyId -> (binding_id, hotkey_string)
        let mut hotkey_to_binding: HashMap<HotkeyId, (String, String)> = HashMap::new();

        loop {
            while let Some(event) = manager.try_recv() {
                if let Some((binding_id, hotkey_string)) = hotkey_to_binding.get(&event.id) {
                    debug!(
                        "handy-keys event: binding={}, hotkey={}, state={:?}",
                        binding_id, hotkey_string, event.state
                    );
                    let is_pressed = event.state == HotkeyState::Pressed;
                    handle_shortcut_event(&app, binding_id, hotkey_string, is_pressed);
                }
            }

            match cmd_rx.recv_timeout(std::time::Duration::from_millis(10)) {
                Ok(ManagerCommand::Register {
                    binding_id,
                    hotkey_string,
                    response,
                }) => {
                    let result = Self::do_register(
                        &manager,
                        &mut binding_to_hotkey,
                        &mut hotkey_to_binding,
                        &binding_id,
                        &hotkey_string,
                    );
                    let _ = response.send(result);
                }
                Ok(ManagerCommand::Unregister {
                    binding_id,
                    response,
                }) => {
                    let result = Self::do_unregister(
                        &manager,
                        &mut binding_to_hotkey,
                        &mut hotkey_to_binding,
                        &binding_id,
                    );
                    let _ = response.send(result);
                }
                Ok(ManagerCommand::Shutdown) => {
                    info!("handy-keys manager thread shutting down");
                    break;
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    info!("Command channel disconnected, shutting down");
                    break;
                }
            }
        }

        info!("handy-keys manager thread stopped");
    }

    fn do_register(
        manager: &HotkeyManager,
        binding_to_hotkey: &mut HashMap<String, HotkeyId>,
        hotkey_to_binding: &mut HashMap<HotkeyId, (String, String)>,
        binding_id: &str,
        hotkey_string: &str,
    ) -> Result<(), String> {
        if binding_to_hotkey.contains_key(binding_id) {
            return Err(format!("Shortcut '{}' is already registered", binding_id));
        }
        let hotkey: Hotkey = hotkey_string
            .parse()
            .map_err(|e| format!("Failed to parse hotkey '{}': {}", hotkey_string, e))?;

        let id = manager
            .register(hotkey)
            .map_err(|e| format!("Failed to register hotkey: {}", e))?;

        binding_to_hotkey.insert(binding_id.to_string(), id);
        hotkey_to_binding.insert(id, (binding_id.to_string(), hotkey_string.to_string()));

        debug!(
            "Registered handy-keys shortcut: {} -> {:?}",
            binding_id, hotkey
        );
        Ok(())
    }

    fn do_unregister(
        manager: &HotkeyManager,
        binding_to_hotkey: &mut HashMap<String, HotkeyId>,
        hotkey_to_binding: &mut HashMap<HotkeyId, (String, String)>,
        binding_id: &str,
    ) -> Result<(), String> {
        if let Some(id) = binding_to_hotkey.remove(binding_id) {
            manager
                .unregister(id)
                .map_err(|e| format!("Failed to unregister hotkey: {}", e))?;
            hotkey_to_binding.remove(&id);
            debug!("Unregistered handy-keys shortcut: {}", binding_id);
        }
        Ok(())
    }

    pub fn register(&self, binding: &ShortcutBinding) -> Result<(), String> {
        let (tx, rx) = mpsc::channel();
        self.command_sender
            .lock()
            .map_err(|_| "Failed to lock command_sender")?
            .send(ManagerCommand::Register {
                binding_id: binding.id.clone(),
                hotkey_string: binding.current_binding.clone(),
                response: tx,
            })
            .map_err(|_| "Failed to send register command")?;

        rx.recv()
            .map_err(|_| "Failed to receive register response")?
    }

    pub fn unregister(&self, binding: &ShortcutBinding) -> Result<(), String> {
        let (tx, rx) = mpsc::channel();
        self.command_sender
            .lock()
            .map_err(|_| "Failed to lock command_sender")?
            .send(ManagerCommand::Unregister {
                binding_id: binding.id.clone(),
                response: tx,
            })
            .map_err(|_| "Failed to send unregister command")?;

        rx.recv()
            .map_err(|_| "Failed to receive unregister response")?
    }

    /// Start recording mode for UI key capture of `binding_id`.
    pub fn start_recording(&self, app: &AppHandle, binding_id: &str) -> Result<(), String> {
        if self.is_recording.load(Ordering::SeqCst) {
            return Err("Already recording".into());
        }

        let listener = KeyboardListener::new()
            .map_err(|e| format!("Failed to create keyboard listener: {}", e))?;

        *self
            .recording_listener
            .lock()
            .map_err(|_| "Failed to lock recording_listener")? = Some(listener);

        self.is_recording.store(true, Ordering::SeqCst);
        self.recording_running.store(true, Ordering::SeqCst);

        let app_clone = app.clone();
        let recording_running = Arc::clone(&self.recording_running);
        thread::spawn(move || {
            Self::recording_loop(app_clone, recording_running);
        });

        debug!("Started handy-keys recording mode for '{}'", binding_id);
        Ok(())
    }

    fn recording_loop(app: AppHandle, running: Arc<AtomicBool>) {
        while running.load(Ordering::SeqCst) {
            let event = {
                let state = match app.try_state::<KandyKeysState>() {
                    Some(s) => s,
                    None => break,
                };
                let listener = state.recording_listener.lock().ok();
                listener.as_ref().and_then(|l| l.as_ref()?.try_recv())
            };

            if let Some(key_event) = event {
                let frontend_event = FrontendKeyEvent {
                    modifiers: modifiers_to_strings(key_event.modifiers),
                    key: key_event.key.map(|k| k.to_string().to_lowercase()),
                    is_key_down: key_event.is_key_down,
                    hotkey_string: key_event
                        .as_hotkey()
                        .map(|h| h.to_handy_string())
                        .unwrap_or_default(),
                };

                if let Err(e) = app.emit("handy-keys-event", &frontend_event) {
                    error!("Failed to emit key event: {}", e);
                }
            } else {
                thread::sleep(std::time::Duration::from_millis(10));
            }
        }

        debug!("Recording loop ended");
    }

    pub fn stop_recording(&self) -> Result<(), String> {
        self.is_recording.store(false, Ordering::SeqCst);
        self.recording_running.store(false, Ordering::SeqCst);

        *self
            .recording_listener
            .lock()
            .map_err(|_| "Failed to lock recording_listener")? = None;

        debug!("Stopped handy-keys recording mode");
        Ok(())
    }
}

impl Drop for KandyKeysState {
    fn drop(&mut self) {
        self.recording_running.store(false, Ordering::SeqCst);
        self.is_recording.store(false, Ordering::SeqCst);

        if let Ok(sender) = self.command_sender.lock() {
            let _ = sender.send(ManagerCommand::Shutdown);
        }

        if let Ok(mut handle) = self.thread_handle.lock() {
            if let Some(h) = handle.take() {
                let _ = h.join();
            }
        }
    }
}

fn modifiers_to_strings(modifiers: handy_keys::Modifiers) -> Vec<String> {
    let mut result = Vec::new();

    if modifiers.contains(handy_keys::Modifiers::CTRL) {
        result.push("ctrl".to_string());
    }
    if modifiers.contains(handy_keys::Modifiers::OPT) {
        result.push("option".to_string());
    }
    if modifiers.contains(handy_keys::Modifiers::SHIFT) {
        result.push("shift".to_string());
    }
    if modifiers.contains(handy_keys::Modifiers::CMD) {
        result.push("command".to_string());
    }
    if modifiers.contains(handy_keys::Modifiers::FN) {
        result.push("fn".to_string());
    }

    result
}

/// Validate a shortcut string. handy-keys accepts modifier-only, key-only and
/// modifier+key combos; the string only has to parse.
pub fn validate_shortcut(raw: &str) -> Result<(), String> {
    if raw.trim().is_empty() {
        return Err("Shortcut cannot be empty".into());
    }
    raw.parse::<Hotkey>()
        .map(|_| ())
        .map_err(|e| format!("Invalid shortcut for KandyKeys: {}", e))
}

/// Initialize handy-keys and register every binding except the dynamic cancel.
pub fn init_shortcuts(app: &AppHandle) -> Result<(), String> {
    let state = KandyKeysState::new(app.clone())?;

    let default_bindings = settings::get_default_settings().bindings;
    let user_settings = get_settings(app);

    for (id, default_binding) in default_bindings {
        if id == "cancel" {
            continue;
        }

        let binding = user_settings
            .bindings
            .get(&id)
            .cloned()
            .unwrap_or(default_binding);

        if let Err(e) = state.register(&binding) {
            error!(
                "Failed to register handy-keys shortcut {} during init: {}",
                id, e
            );
        }
    }

    app.manage(state);
    info!("handy-keys shortcuts initialized");
    Ok(())
}

/// Register the cancel shortcut (called when recording starts)
pub fn register_cancel_shortcut(app: &AppHandle) {
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Some(cancel_binding) = get_settings(&app_clone).bindings.get("cancel").cloned() {
            if let Some(state) = app_clone.try_state::<KandyKeysState>() {
                if let Err(e) = state.register(&cancel_binding) {
                    error!("Failed to register cancel shortcut: {}", e);
                }
            }
        }
    });
}

/// Unregister the cancel shortcut (called when recording stops)
pub fn unregister_cancel_shortcut(app: &AppHandle) {
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Some(cancel_binding) = get_settings(&app_clone).bindings.get("cancel").cloned() {
            if let Some(state) = app_clone.try_state::<KandyKeysState>() {
                let _ = state.unregister(&cancel_binding);
            }
        }
    });
}

pub fn register_shortcut(app: &AppHandle, binding: ShortcutBinding) -> Result<(), String> {
    let state = app
        .try_state::<KandyKeysState>()
        .ok_or("KandyKeysState not initialized")?;
    state.register(&binding)
}

pub fn unregister_shortcut(app: &AppHandle, binding: ShortcutBinding) -> Result<(), String> {
    let state = app
        .try_state::<KandyKeysState>()
        .ok_or("KandyKeysState not initialized")?;
    state.unregister(&binding)
}

/// Start key recording mode for the shortcut editor.
#[tauri::command]
#[specta::specta]
pub fn start_kandy_keys_recording(app: AppHandle, binding_id: String) -> Result<(), String> {
    // While Secure Input is active the tap receives no KeyDown/KeyUp, so the
    // recorder would silently capture just the modifier and overwrite the
    // binding with it. Refuse instead; the frontend maps this marker to a
    // localized explanation.
    if crate::secure_input::is_enabled_now() {
        crate::secure_input::note_recorder_blocked(&app);
        return Err("secure-input-active".into());
    }

    let state = app
        .try_state::<KandyKeysState>()
        .ok_or("KandyKeysState not initialized")?;

    // Suspend every registered shortcut so a combo that overlaps an existing
    // binding can't fire it (or have its keys swallowed) mid-capture.
    super::suspend_all_shortcuts(&app);

    let result = state.start_recording(&app, &binding_id);
    if result.is_err() {
        super::resume_all_shortcuts(&app);
    }
    result
}

/// Stop key recording mode.
#[tauri::command]
#[specta::specta]
pub fn stop_kandy_keys_recording(app: AppHandle) -> Result<(), String> {
    let state = app
        .try_state::<KandyKeysState>()
        .ok_or("KandyKeysState not initialized")?;

    // Restore shortcuts from settings regardless of how recording ended.
    // A commit has already registered the new binding via change_binding;
    // re-registering it here fails cleanly and is ignored.
    let result = state.stop_recording();
    super::resume_all_shortcuts(&app);
    result
}
