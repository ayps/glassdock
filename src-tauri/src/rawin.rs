// Raw mouse and keyboard input, for "push to reveal".
//
// When the pointer reaches the top of the screen Windows stops it there, but the
// mouse (or touchpad) still reports how far your hand keeps moving. Reading that
// raw movement lets GlassDock tell "parked at the top" (clicking a Chrome tab)
// from "pushing up past the top" (asking for the dock). Clicks and key presses
// are noted too, so they can cancel a reveal.
//
// Only counts are kept: no keys, no positions, nothing is stored or sent.

use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};

/// Upward movement (device counts) since the last `take()`.
static UP: AtomicI64 = AtomicI64::new(0);
static CLICKED: AtomicBool = AtomicBool::new(false);
static KEY: AtomicBool = AtomicBool::new(false);
/// The last pointer movement came from an absolute device (pen, touch screen, remote desktop).
static ABSOLUTE: AtomicBool = AtomicBool::new(false);
/// A relative device (mouse, touchpad) has reported movement at least once.
static SEEN_RELATIVE: AtomicBool = AtomicBool::new(false);
static RUNNING: AtomicBool = AtomicBool::new(false);

pub struct Input {
    /// Upward push since the last call, in device counts.
    pub up: i64,
    pub clicked: bool,
    pub key: bool,
}

/// Collect (and reset) what happened since the last call.
pub fn take() -> Input {
    Input {
        up: UP.swap(0, Ordering::SeqCst),
        clicked: CLICKED.swap(false, Ordering::SeqCst),
        key: KEY.swap(false, Ordering::SeqCst),
    }
}

/// Raw input is working and the pointer is driven by a relative device,
/// so pushing against the edge can be measured.
pub fn push_available() -> bool {
    RUNNING.load(Ordering::SeqCst) && SEEN_RELATIVE.load(Ordering::SeqCst) && !ABSOLUTE.load(Ordering::SeqCst)
}

#[cfg(windows)]
pub fn start() {
    use windows::core::w;
    use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::Input::{
        GetRawInputData, RegisterRawInputDevices, HRAWINPUT, MOUSE_MOVE_ABSOLUTE, RAWINPUT, RAWINPUTDEVICE,
        RAWINPUTHEADER, RIDEV_INPUTSINK, RID_INPUT, RIM_TYPEKEYBOARD, RIM_TYPEMOUSE,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW, HWND_MESSAGE, MSG,
        WINDOW_EX_STYLE, WINDOW_STYLE, WM_INPUT, WNDCLASSW,
    };

    // Button-down flags in RAWMOUSE.usButtonFlags (left, right, middle, X1, X2).
    const DOWN_FLAGS: u16 = 0x0001 | 0x0004 | 0x0010 | 0x0040 | 0x0100;
    // RI_KEY_BREAK: the key was released (we only care about presses).
    const KEY_BREAK: u16 = 0x0001;

    unsafe extern "system" fn proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
        if msg == WM_INPUT {
            let mut raw = RAWINPUT::default();
            let mut size = std::mem::size_of::<RAWINPUT>() as u32;
            let got = unsafe {
                GetRawInputData(
                    HRAWINPUT(lp.0 as *mut core::ffi::c_void),
                    RID_INPUT,
                    Some(&mut raw as *mut RAWINPUT as *mut core::ffi::c_void),
                    &mut size,
                    std::mem::size_of::<RAWINPUTHEADER>() as u32,
                )
            };
            if got != u32::MAX && got > 0 {
                if raw.header.dwType == RIM_TYPEMOUSE.0 {
                    let m = unsafe { raw.data.mouse };
                    let buttons = unsafe { m.Anonymous.Anonymous.usButtonFlags };
                    if buttons & DOWN_FLAGS != 0 {
                        CLICKED.store(true, Ordering::SeqCst);
                    }
                    if m.usFlags.0 & MOUSE_MOVE_ABSOLUTE.0 != 0 {
                        if m.lLastX != 0 || m.lLastY != 0 {
                            ABSOLUTE.store(true, Ordering::SeqCst);
                        }
                    } else if m.lLastX != 0 || m.lLastY != 0 {
                        ABSOLUTE.store(false, Ordering::SeqCst);
                        SEEN_RELATIVE.store(true, Ordering::SeqCst);
                        if m.lLastY < 0 {
                            UP.fetch_add((-m.lLastY) as i64, Ordering::SeqCst);
                        }
                    }
                } else if raw.header.dwType == RIM_TYPEKEYBOARD.0 {
                    let k = unsafe { raw.data.keyboard };
                    if k.Flags & KEY_BREAK == 0 {
                        KEY.store(true, Ordering::SeqCst);
                    }
                }
            }
        }
        unsafe { DefWindowProcW(hwnd, msg, wp, lp) }
    }

    std::thread::spawn(|| unsafe {
        let Ok(module) = GetModuleHandleW(None) else { return };
        let hinst = HINSTANCE(module.0);
        let class = w!("GlassDockRawInput");
        let wc = WNDCLASSW { lpfnWndProc: Some(proc), hInstance: hinst, lpszClassName: class, ..Default::default() };
        RegisterClassW(&wc);
        let Ok(hwnd) = CreateWindowExW(
            WINDOW_EX_STYLE(0),
            class,
            w!(""),
            WINDOW_STYLE(0),
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            Some(hinst),
            None,
        ) else {
            return;
        };
        // Mouse (page 1, usage 2) and keyboard (page 1, usage 6), even while other apps have focus.
        let devices = [
            RAWINPUTDEVICE { usUsagePage: 1, usUsage: 2, dwFlags: RIDEV_INPUTSINK, hwndTarget: hwnd },
            RAWINPUTDEVICE { usUsagePage: 1, usUsage: 6, dwFlags: RIDEV_INPUTSINK, hwndTarget: hwnd },
        ];
        if RegisterRawInputDevices(&devices, std::mem::size_of::<RAWINPUTDEVICE>() as u32).is_err() {
            return;
        }
        RUNNING.store(true, Ordering::SeqCst);
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            DispatchMessageW(&msg);
        }
        RUNNING.store(false, Ordering::SeqCst);
    });
}

#[cfg(not(windows))]
pub fn start() {}
