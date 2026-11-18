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

interface Place { name: string; admin1?: string; country?: string; latitude: number; longitude: number }

async function searchPlaces(q: string): Promise<Place[]> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`;
  const r = await fetch(url);
  if (!r.ok) return [];
  return (await r.json()).results ?? [];
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

  // Click the card to change the city.
  panel(root, ctx) {
    let results: Place[] = [];
    let msg = "";
    const draw = () => {
      const cur = settings.get().weather;
      root.innerHTML = `
        <div class="xhead"><span class="xtitle">Weather location</span><span class="c">Now: ${esc(cur.name)}</span></div>
        <form class="search" data-find>
          <svg class="ic" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
          <input name="q" placeholder="Search for a city, then press Enter" aria-label="Search for a city" autocomplete="off">
        </form>
        <div class="xresults">${results.map((p, i) => `
          <button class="xres" data-pick="${i}">
            <span class="b" style="font-weight:600">${esc(p.name)}</span>
            <span class="c ell">${esc([p.admin1, p.country].filter(Boolean).join(", "))}</span>
          </button>`).join("")}</div>
        <div class="xmsg" data-msg>${esc(msg)}</div>
        <div class="xnote">Weather data by Open-Meteo.com</div>`;
    };
    root.addEventListener("submit", async (e) => {
      e.preventDefault();
      const q = (root.querySelector<HTMLInputElement>("[name=q]")!.value || "").trim();
      if (!q) return;
      msg = "Searching…"; results = []; draw();
      try {
        results = await searchPlaces(q);
        msg = results.length ? "" : `No place called "${q}" found.`;
      } catch {
        msg = "Couldn't search. Check your connection.";
      }
      draw();
      const input = root.querySelector<HTMLInputElement>("[name=q]");
      if (input) input.value = q;
    });
    root.addEventListener("click", async (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-pick]");
      if (!b) return;
      const p = results[Number(b.dataset.pick)];
      settings.update((s) => { s.weather = { name: p.name, lat: p.latitude, lon: p.longitude }; });
      await ctx.reload();
      ctx.close();
    });
    draw();
  },
});
