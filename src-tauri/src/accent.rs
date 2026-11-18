// The Windows accent colour (Settings > Personalization > Colors), in the shades
// Windows itself uses: a lighter one for dark surfaces, a darker one for light.

#[derive(serde::Serialize)]
pub struct Accent {
    /// For text and rings on dark cards.
    on_dark: String,
    /// For text and rings on light cards.
    on_light: String,
}

#[cfg(windows)]
pub fn read() -> Option<Accent> {
    use windows::UI::ViewManagement::{UIColorType, UISettings};
    let s = UISettings::new().ok()?;
    let hex = |t: UIColorType| s.GetColorValue(t).ok().map(|c| format!("#{:02x}{:02x}{:02x}", c.R, c.G, c.B));
    Some(Accent { on_dark: hex(UIColorType::AccentLight2)?, on_light: hex(UIColorType::AccentDark1)? })
}

#[cfg(not(windows))]
pub fn read() -> Option<Accent> {
    None
}
