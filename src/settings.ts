// User settings, saved in the app's local storage (kept by WebView2 per user).

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
}

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
});

let current: Settings | null = null;
const listeners: (() => void)[] = [];

export const settings = {
  init(registered: string[], defaultOrder: string[]) {
    let s: Settings;
    try {
      s = { ...DEFAULTS(defaultOrder), ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
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
    try {
      localStorage.setItem(KEY, JSON.stringify(current));
    } catch {
      /* storage unavailable: settings last for this session only */
    }
  },
};
