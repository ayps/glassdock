// Weather: live, from Open-Meteo (free for personal use, no account or key needed;
// data under CC BY 4.0, credited in the tooltip). Refreshed every 15 minutes
// while the dock is open.
import { defineWidget } from "./types";
import { ICONS, esc } from "../ui";
import { settings } from "../settings";

interface Weather {
  place: string;
  temp: number;
  feels: number;
  hi: number;
  lo: number;
  cond: string;
  updated: string;
}

// WMO weather codes, as Open-Meteo reports them.
function describe(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Cloudy";
  if (code <= 48) return "Fog";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  if (code <= 86) return "Snow showers";
  return "Thunderstorm";
}

const deg = (n: number) => `${Math.round(n) < 0 ? "−" : ""}${Math.abs(Math.round(n))}°`;

export default defineWidget<Weather | null>({
  id: "weather",
  // The header shows the city, like Apple's weather widget.
  get name() { return settings.get().weather.name; },
  size: "standard",
  icon: ICONS.weather,
  everyMs: 15 * 60_000,
  async load() {
    const { name, lat, lon } = settings.get().weather;
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,apparent_temperature,weather_code` +
      `&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`;
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      const j = await r.json();
      return {
        place: name,
        temp: j.current.temperature_2m,
        feels: j.current.apparent_temperature,
        hi: j.daily.temperature_2m_max[0],
        lo: j.daily.temperature_2m_min[0],
        cond: describe(j.current.weather_code),
        updated: new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
      };
    } catch {
      return null; // offline: shown as unavailable, never as old data
    }
  },
  // Balanced layout: city | condition on top, temperature | high-low and feels-like below.
  headerRight(w) {
    return w ? `<span title="Updated ${esc(w.updated)} · Weather data by Open-Meteo.com">${esc(w.cond)}</span>` : "";
  },
  view(w) {
    if (!w) return `<div class="c">Weather unavailable.<br>Check your connection.</div>`;
    return `<div class="row" style="align-items:center">
      <span class="v" style="font-size:32px;font-weight:500;letter-spacing:-0.03em">${deg(w.temp)}</span>
      <div class="stack" style="align-items:flex-end;gap:4px">
        <span class="c">H ${deg(w.hi)}  L ${deg(w.lo)}</span>
        <span class="c">Feels like ${deg(w.feels)}</span>
      </div>
    </div>`;
  },
});
