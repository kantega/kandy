//! Keyboard shortcut management: binding commands and the handy-keys backend.

pub(crate) mod handler;
pub mod handy_keys;

use log::{debug, error, warn};
use serde::Serialize;
use specta::Type;
use tauri::AppHandle;

use crate::settings::{self, get_settings, ShortcutBinding};

/// Initialize shortcuts. A failure is fatal for shortcuts: nothing is
/// registered and the error is logged.
pub fn init_shortcuts(app: &AppHandle) {
    if let Err(e) = handy_keys::init_shortcuts(app) {
        error!("Failed to initialize handy-keys shortcuts: {}", e);
    }
}

/// Register the cancel shortcut (called when recording starts)
pub fn register_cancel_shortcut(app: &AppHandle) {
    crate::secure_input::register_cancel_fallback(app);
    handy_keys::register_cancel_shortcut(app);
}

/// Unregister the cancel shortcut (called when recording stops)
pub fn unregister_cancel_shortcut(app: &AppHandle) {
    crate::secure_input::unregister_cancel_fallback(app);
    handy_keys::unregister_cancel_shortcut(app);
}

pub fn register_shortcut(app: &AppHandle, binding: ShortcutBinding) -> Result<(), String> {
    handy_keys::register_shortcut(app, binding)
}

pub fn unregister_shortcut(app: &AppHandle, binding: ShortcutBinding) -> Result<(), String> {
    handy_keys::unregister_shortcut(app, binding)
}

#[derive(Serialize, Type)]
pub struct BindingResponse {
    success: bool,
    binding: Option<ShortcutBinding>,
    error: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub fn change_binding(
    app: AppHandle,
    id: String,
    binding: String,
) -> Result<BindingResponse, String> {
    if binding.trim().is_empty() {
        return Err("Binding cannot be empty".to_string());
    }

    let mut settings = settings::get_settings(&app);

    // Get the binding to modify, or create it from defaults if it doesn't exist
    let binding_to_modify = match settings.bindings.get(&id) {
        Some(binding) => binding.clone(),
        None => {
            let default_settings = settings::get_default_settings();
            match default_settings.bindings.get(&id) {
                Some(default_binding) => {
                    warn!(
                        "Binding '{}' not found in settings, creating from defaults",
                        id
                    );
                    default_binding.clone()
                }
                None => {
                    let error_msg = format!("Binding with id '{}' not found in defaults", id);
                    warn!("change_binding error: {}", error_msg);
                    return Ok(BindingResponse {
                        success: false,
                        binding: None,
                        error: Some(error_msg),
                    });
                }
            }
        }
    };

    // The cancel binding is registered dynamically around recordings, so only
    // the stored value changes here.
    if id == "cancel" {
        let mut b = binding_to_modify.clone();
        b.current_binding = binding;
        settings.bindings.insert(id.clone(), b.clone());
        settings::write_settings(&app, settings);
        crate::secure_input::reconcile_fallback(&app);
        return Ok(BindingResponse {
            success: true,
            binding: Some(b),
            error: None,
        });
    }

    if let Err(e) = unregister_shortcut(&app, binding_to_modify.clone()) {
        error!("change_binding error: Failed to unregister shortcut: {}", e);
    }

    if let Err(e) = handy_keys::validate_shortcut(&binding) {
        warn!("change_binding validation error: {}", e);
        restore_registration(&app, &binding_to_modify);
        return Err(e);
    }

    let mut updated_binding = binding_to_modify.clone();
    updated_binding.current_binding = binding;

    if let Err(e) = register_shortcut(&app, updated_binding.clone()) {
        let error_msg = format!("Failed to register shortcut: {}", e);
        error!("change_binding error: {}", error_msg);
        restore_registration(&app, &binding_to_modify);
        return Ok(BindingResponse {
            success: false,
            binding: None,
            error: Some(error_msg),
        });
    }

    settings.bindings.insert(id, updated_binding.clone());
    settings::write_settings(&app, settings);
    crate::secure_input::reconcile_fallback(&app);

    Ok(BindingResponse {
        success: true,
        binding: Some(updated_binding),
        error: None,
    })
}

/// Best-effort re-register of the previous binding after a failed change,
/// so a failure leaves the user's shortcut working exactly as before.
fn restore_registration(app: &AppHandle, binding: &ShortcutBinding) {
    if let Err(e) = register_shortcut(app, binding.clone()) {
        error!(
            "Failed to restore previous binding '{}' ({}): {}",
            binding.id, binding.current_binding, e
        );
    }
}

#[tauri::command]
#[specta::specta]
pub fn reset_binding(app: AppHandle, id: String) -> Result<BindingResponse, String> {
    let binding = settings::get_stored_binding(&app, &id)
        .ok_or_else(|| format!("Unknown binding: {}", id))?;
    change_binding(app, id, binding.default_binding)
}

/// Unregister every binding while the user is recording a new shortcut in
/// the UI, so no existing shortcut can fire (or swallow the keystrokes)
/// mid-capture. The "cancel" binding is untouched: it is managed dynamically
/// by the recording lifecycle.
pub fn suspend_all_shortcuts(app: &AppHandle) {
    for (id, binding) in get_settings(app).bindings {
        if id == "cancel" {
            continue;
        }
        if let Err(e) = unregister_shortcut(app, binding) {
            debug!(
                "suspend_all_shortcuts: could not unregister '{}': {}",
                id, e
            );
        }
    }
}

/// Re-register every binding from settings after shortcut recording ends.
/// Registering an already-registered shortcut fails cleanly, so this is
/// idempotent and safe on every exit path.
pub fn resume_all_shortcuts(app: &AppHandle) {
    for (id, binding) in get_settings(app).bindings {
        if id == "cancel" {
            continue;
        }
        if let Err(e) = register_shortcut(app, binding) {
            debug!("resume_all_shortcuts: could not register '{}': {}", id, e);
        }
    }
}

#[cfg(test)]
mod tests {
    use handy_keys::Hotkey;

    /// Compound keys must be stored as compact tokens. The frontend recorder
    /// (`getKeyName`) emits these names, and handy-keys is the only parser
    /// they reach, so a spaced variant would silently fail to register.
    #[test]
    fn compound_shortcut_keys_parse() {
        for key in [
            "scrolllock",
            "capslock",
            "numlock",
            "pageup",
            "pagedown",
            "printscreen",
        ] {
            assert!(key.parse::<Hotkey>().is_ok(), "HandyKeys rejected {key}");
        }
    }
}
