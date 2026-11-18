// Calls into the Rust side. When the page runs in a normal browser (for design
// previews) there is no Rust side, so each call has a preview fallback.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import * as autostart from "@tauri-apps/plugin-autostart";

export const inTauri = "__TAURI_INTERNALS__" in window;

export interface MonitorInfo {
  width: number; // logical px
  height: number;
  scale: number;
}

export interface Wallpaper {
  dataUrl: string; // downscaled JPEG of the current wallpaper
  tint: [number, number, number]; // average colour of the strip the dock sits on
}

export interface SystemStats {
  cpu: number; // %
  ramUsed: number; // bytes
  ramTotal: number;
  gpu: number | null; // % or null when no reading is available
  gpuTemp: number | null; // °C or null
  down: number; // bytes per second
  up: number;
}

export async function setDockSize(width: number, height: number): Promise<void> {
  if (inTauri) await invoke("set_dock_size", { width, height });
}

export async function hideDone(): Promise<void> {
  if (inTauri) await invoke("hide_done");
}

export async function getWallpaper(): Promise<Wallpaper | null> {
  if (!inTauri) return null;
  try {
    return await invoke<Wallpaper>("get_wallpaper");
  } catch (e) {
    console.warn("wallpaper unavailable", e);
    return null;
  }
}

// The CPU, RAM and GPU tiles all ask at once; share one reading per second.
let statsCache: { at: number; p: Promise<SystemStats | null> } | null = null;
export function systemStats(): Promise<SystemStats | null> {
  if (!inTauri) return Promise.resolve(null);
  if (statsCache && Date.now() - statsCache.at < 900) return statsCache.p;
  const p = invoke<SystemStats>("system_stats").catch((e) => {
    console.warn("system stats unavailable", e);
    return null;
  });
  statsCache = { at: Date.now(), p };
  return p;
}

export function on<T>(event: string, fn: (payload: T) => void): void {
  if (inTauri) void listen<T>(event, (e) => fn(e.payload));
}

export interface NowPlaying {
  key: string;
  title: string;
  artist: string;
  app: string;
  playing: boolean;
  canPrev: boolean;
  canNext: boolean;
  canToggle: boolean;
  position: number | null; // seconds
  duration: number | null;
  art: string | null; // only sent when the track changes
}

export async function mediaNow(artKey: string | null): Promise<NowPlaying | null> {
  if (!inTauri) return null;
  try {
    return await invoke<NowPlaying | null>("media_now", { artKey });
  } catch (e) {
    console.warn("media unavailable", e);
    return null;
  }
}

export async function mediaAction(action: "toggle" | "next" | "prev"): Promise<void> {
  if (inTauri) await invoke("media_action", { action });
}

/** Panel opened or closed: hold the dock open and take / return keyboard focus. */
export async function panelFocus(on: boolean): Promise<void> {
  if (inTauri) await invoke("panel_focus", { on });
}

/** Keep the dock open while the pointer is away (typing, sign-in). */
export async function setHold(hold: boolean): Promise<void> {
  if (inTauri) await invoke("set_hold", { hold });
}

export async function openUrl(url: string): Promise<void> {
  if (inTauri) await invoke("open_url", { url });
  else window.open(url, "_blank");
}

// ---- Google (the Rust side keeps the tokens; the page never sees them)
export interface GoogleStatus { hasClient: boolean; accounts: string[] }

export async function googleStatus(): Promise<GoogleStatus> {
  if (!inTauri) return { hasClient: false, accounts: [] };
  return invoke<GoogleStatus>("google_status");
}
export const googleSetClient = (json: string) => invoke<void>("google_set_client", { json });
export const googleSignIn = () => invoke<string>("google_sign_in");
export const googleSignOut = (email: string) => invoke<void>("google_sign_out", { email });
export function googleApi<T = any>(email: string, method: string, url: string, body?: unknown): Promise<T> {
  return invoke<T>("google_api", { email, method, url, body: body ?? null });
}

// ---- GitHub (token kept by the Rust side)
export const githubStatus = (): Promise<string | null> => (inTauri ? invoke<string | null>("github_status") : Promise.resolve(null));
export const githubSetToken = (token: string) => invoke<string>("github_set_token", { token });
export const githubClear = () => invoke<void>("github_clear");
export const githubQuery = <T = any>(query: string, variables: Record<string, unknown> = {}) =>
  invoke<T>("github_query", { query, variables });

// ---- Claude usage (from Claude Code's status line)
export interface ClaudeWindow { used_percentage?: number; resets_at?: number }
export interface ClaudeUsage {
  configured: boolean;
  data: { updated?: number; rate_limits?: { five_hour?: ClaudeWindow; seven_day?: ClaudeWindow } } | null;
}
export const claudeUsage = (): Promise<ClaudeUsage> =>
  inTauri ? invoke<ClaudeUsage>("claude_usage") : Promise.resolve({ configured: false, data: null });
export const claudeSetup = (replace: boolean) => invoke<void>("claude_setup", { replace });

/** Windows accent colour, in shades for dark and light cards. Null outside Windows. */
export interface Accent { on_dark: string; on_light: string }
export const systemAccent = (): Promise<Accent | null> =>
  inTauri ? invoke<Accent | null>("system_accent").catch(() => null) : Promise.resolve(null);

// ---- Recycle Bin
export interface Bin { items: number; bytes: number }
export const recycleBin = (): Promise<Bin | null> => (inTauri ? invoke<Bin | null>("recycle_bin").catch(() => null) : Promise.resolve(null));
export const recycleEmpty = () => invoke<void>("recycle_empty");
export const recycleOpen = () => invoke<void>("recycle_open");

// ---- Start with Windows (only meaningful in the installed app, not in `tauri dev`)
export const canAutostart = inTauri && import.meta.env.PROD;
export const autostartEnabled = (): Promise<boolean> => (canAutostart ? autostart.isEnabled() : Promise.resolve(false));
export const setAutostart = (on: boolean): Promise<void> => (on ? autostart.enable() : autostart.disable());
