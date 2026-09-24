/// The CPAL host for the current platform.
pub fn get_cpal_host() -> cpal::Host {
    cpal::default_host()
}
