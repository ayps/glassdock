// The few things that need Windows' own APIs. Other platforms get harmless
// stand-ins so the project still compiles there.

#[cfg(windows)]
mod imp {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON};
    use windows::Win32::UI::Shell::{
        SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN,
    };
    use std::sync::atomic::{AtomicIsize, Ordering};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowLongPtrW, SetForegroundWindow, SetWindowDisplayAffinity, SetWindowLongPtrW,
        ShowWindow, GWL_EXSTYLE, SW_HIDE, SW_SHOWNOACTIVATE, WDA_EXCLUDEFROMCAPTURE, WDA_NONE, WS_EX_NOACTIVATE,
        WS_EX_TOOLWINDOW,
    };

    /// The window that had focus before a panel took it, to hand focus back.
    static PREVIOUS: AtomicIsize = AtomicIsize::new(0);

    fn set_noactivate(h: HWND, on: bool) {
        unsafe {
            let ex = GetWindowLongPtrW(h, GWL_EXSTYLE);
            let flag = WS_EX_NOACTIVATE.0 as isize;
            SetWindowLongPtrW(h, GWL_EXSTYLE, if on { ex | flag } else { ex & !flag });
        }
    }

    /// A panel with text fields is open: let the dock take keyboard focus.
    pub fn take_focus(w: &tauri::WebviewWindow) {
        let Some(h) = hwnd(w) else { return };
        unsafe {
            let prev = GetForegroundWindow();
            if prev != h {
                PREVIOUS.store(prev.0 as isize, Ordering::SeqCst);
            }
            set_noactivate(h, false);
            let _ = SetForegroundWindow(h);
        }
        let _ = w.set_focus();
    }

    /// The panel closed: stop taking focus and give it back to the previous app.
    pub fn release_focus(w: &tauri::WebviewWindow) {
        let Some(h) = hwnd(w) else { return };
        set_noactivate(h, true);
        let prev = PREVIOUS.swap(0, Ordering::SeqCst);
        unsafe {
            if prev != 0 && GetForegroundWindow() == h {
                let _ = SetForegroundWindow(HWND(prev as *mut core::ffi::c_void));
            }
        }
    }

    fn hwnd(w: &tauri::WebviewWindow) -> Option<HWND> {
        // Go through a raw pointer so this works whatever `windows` version Tauri uses.
        w.hwnd().ok().map(|h| HWND(h.0 as *mut core::ffi::c_void))
    }

    /// Clicking the dock must never take keyboard focus away from your app,
    /// and the dock should not appear in Alt+Tab.
    pub fn prepare_window(w: &tauri::WebviewWindow) {
        if let Some(h) = hwnd(w) {
            unsafe {
                let ex = GetWindowLongPtrW(h, GWL_EXSTYLE);
                SetWindowLongPtrW(h, GWL_EXSTYLE, ex | (WS_EX_NOACTIVATE.0 | WS_EX_TOOLWINDOW.0) as isize);
            }
        }
    }

    pub fn show_without_focus(w: &tauri::WebviewWindow) {
        match hwnd(w) {
            Some(h) => unsafe {
                let _ = ShowWindow(h, SW_SHOWNOACTIVATE);
            },
            None => {
                let _ = w.show();
            }
        }
        let _ = w.set_always_on_top(true);
    }

    /// Hide with the same direct call used to show. (Tauri's own hide() would do
    /// nothing here, because Tauri never saw the window being shown, and the
    /// invisible window would keep blocking clicks at the top of the screen.)
    pub fn hide_window(w: &tauri::WebviewWindow) {
        match hwnd(w) {
            Some(h) => unsafe {
                let _ = ShowWindow(h, SW_HIDE);
            },
            None => {
                let _ = w.hide();
            }
        }
    }

    pub fn mouse_button_down() -> bool {
        [VK_LBUTTON, VK_RBUTTON, VK_MBUTTON]
            .iter()
            .any(|k| unsafe { (GetAsyncKeyState(k.0 as i32) as u16) & 0x8000 != 0 })
    }

    /// Keep a window out of screen sharing, recordings and screenshots (Windows 10 2004 and later).
    pub fn exclude_from_capture(w: &tauri::WebviewWindow, on: bool) {
        if let Some(h) = hwnd(w) {
            unsafe {
                let _ = SetWindowDisplayAffinity(h, if on { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE });
            }
        }
    }

    /// PowerPoint (or another app) is presenting, or Windows' presentation settings are on.
    pub fn presentation_mode() -> bool {
        matches!(unsafe { SHQueryUserNotificationState() }, Ok(s) if s == QUNS_PRESENTATION_MODE)
    }

    /// A full-screen game, video or presentation is running.
    pub fn fullscreen_app_running() -> bool {
        match unsafe { SHQueryUserNotificationState() } {
            Ok(s) => s == QUNS_BUSY || s == QUNS_RUNNING_D3D_FULL_SCREEN || s == QUNS_PRESENTATION_MODE,
            Err(_) => false,
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn prepare_window(_w: &tauri::WebviewWindow) {}
    pub fn take_focus(w: &tauri::WebviewWindow) {
        let _ = w.set_focus();
    }
    pub fn release_focus(_w: &tauri::WebviewWindow) {}
    pub fn hide_window(w: &tauri::WebviewWindow) {
        let _ = w.hide();
    }
    pub fn show_without_focus(w: &tauri::WebviewWindow) {
        let _ = w.show();
    }
    pub fn mouse_button_down() -> bool {
        false
    }
    pub fn fullscreen_app_running() -> bool {
        false
    }
    pub fn presentation_mode() -> bool {
        false
    }
    pub fn exclude_from_capture(_w: &tauri::WebviewWindow, _on: bool) {}
}

pub use imp::*;
