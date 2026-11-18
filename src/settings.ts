// User settings. Saved to settings.json in GlassDock's folder (through the Rust
// side), with a copy in local storage. Local storage alone could lose the latest
// changes when Windows shuts down, which is why widgets sometimes came back off.
import { settingsLoad, settingsSave } from "./native";

export type CardTheme = "auto" | "light" | "dark";

export interface Settings {
  /** Widgets shown in the dock, left to right. */
  order: string[];
  /** Widgets the user has seen; a registered widget not in here is new. */
  known: string[];
  themes: Record<string, CardTheme>;
  dockTheme: "dark" | "light";
  /** "wallpaper" tints the glass from the current wallpaper; "neutral" uses grey. */
  tint: "wallpaper" | "neutral";
  cities: { city: string; tz: string }[];
  /** Weather location (independent of the clock cities). */
  weather: { name: string; lat: number; lon: number };
  clock24: boolean;
  clockStyle: "analog" | "digital";
  /** Google account used for the last meeting or task created from the dock. */
  lastAccount: string;
  /** Set once the installed app has turned on "Start with Windows" the first time. */
  autostartSet: boolean;
  /** Keep the dock out of screen sharing, recordings and screenshots. */
  privateShare: boolean;
  /** Glow on the lip a few minutes before a meeting. */
  meetingGlow: boolean;
  /** How far to push the pointer past the top edge to open the dock. */
  push: "short" | "medium" | "long";
}

/** Push distances in mouse counts. */
export const PUSH_COUNTS = { short: 35, medium: 70, long: 130 } as const;

const KEY = "glassdock.settings.v1";

const DEFAULTS = (order: string[]): Settings => ({
  order: [...order],
  known: [],
  themes: {},
  dockTheme: "dark",
  tint: "wallpaper",
  cities: [
    { city: "Toronto", tz: "America/Toronto" },
    { city: "Chennai", tz: "Asia/Kolkata" },
  ],
  weather: { name: "Toronto", lat: 43.6532, lon: -79.3832 },
  clock24: false,
  clockStyle: "analog",
  lastAccount: "",
  autostartSet: false,
  privateShare: true,
  meetingGlow: true,
  push: "medium",
});

let current: Settings | null = null;
const listeners: (() => void)[] = [];

export const settings = {
  async init(registered: string[], defaultOrder: string[]) {
    let s: Settings;
    const fromFile = await settingsLoad();
    let saved: string | null = fromFile;
    if (!saved) {
      try { saved = localStorage.getItem(KEY); } catch { saved = null; } // first run after updating: move over
    }
    try {
      s = { ...DEFAULTS(defaultOrder), ...JSON.parse(saved ?? "{}") };
    } catch {
      s = DEFAULTS(defaultOrder);
    }
    // 0.3: the combined System card became separate CPU and RAM tiles.
    if (!s.known.includes("cpu") && s.order.includes("system")) {
      s.order.splice(s.order.indexOf("system"), 1, "cpu", "ram");
    }
    // Forget widgets that no longer exist; new ones stay off until enabled.
    s.order = s.order.filter((id) => registered.includes(id));
    s.known = Array.from(new Set([...s.known.filter((id) => registered.includes(id)), ...registered]));
    current = s;
    this.save();
  },
  get(): Settings {
    if (!current) throw new Error("settings.init() first");
    return current;
  },
  update(fn: (s: Settings) => void) {
    fn(this.get());
    this.save();
    listeners.forEach((l) => l());
  },
  onChange(fn: () => void) {
    listeners.push(fn);
  },
  save() {
    const json = JSON.stringify(current);
    try {
      localStorage.setItem(KEY, json);
    } catch {
      /* storage unavailable */
    }
    settingsSave(json).catch((e) => console.warn("couldn't save settings", e));
  },
};
