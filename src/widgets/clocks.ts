// World clocks: live, from the Windows time-zone database (via Intl).
// Time-zone names (not fixed offsets) keep daylight saving correct.
// Click the card to edit: remove, add any city, drag to reorder, 12/24-hour.
import { defineWidget } from "./types";
import { ICONS, esc } from "../ui";
import { settings } from "../settings";

interface Row { city: string; tz: string; time: string; period: string; note: string; otherDay: string }

const CODES: Record<string, string> = {
  "New York": "NYC", "Los Angeles": "LAX", "San Francisco": "SFO", "Tokyo": "TYO", "London": "LON",
  "Hong Kong": "HKG", "Kuala Lumpur": "KUL", "Mexico City": "MEX", "Rio de Janeiro": "RIO", "Buenos Aires": "BUE",
};
/** Short label under an analog face: NYC, LON, TYO, or the first three letters. */
const code = (city: string) => CODES[city] ?? city.replace(/[^\p{L}]/gu, "").slice(0, 3).toUpperCase();

/** An analog face: white during the day there (6 am to 6 pm), dark at night. */
function face(tz: string, size: number): string {
  const t = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
  const h = t.getHours(), m = t.getMinutes();
  const day = h >= 6 && h < 18;
  const bg = day ? "#f4f4f6" : "#1c1c1e";
  const ink = day ? "#1c1c1e" : "#f4f4f6";
  const tick = day ? "rgba(0,0,0,0.32)" : "rgba(255,255,255,0.42)";
  const hand = (deg: number, len: number, w: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return `<line x1="50" y1="50" x2="${(50 + Math.cos(a) * len).toFixed(1)}" y2="${(50 + Math.sin(a) * len).toFixed(1)}"
      stroke="${ink}" stroke-width="${w}" stroke-linecap="round"/>`;
  };
  const ticks = [0, 90, 180, 270].map((d) => {
    const a = ((d - 90) * Math.PI) / 180;
    return `<line x1="${(50 + Math.cos(a) * 36).toFixed(1)}" y1="${(50 + Math.sin(a) * 36).toFixed(1)}"
      x2="${(50 + Math.cos(a) * 43).toFixed(1)}" y2="${(50 + Math.sin(a) * 43).toFixed(1)}" stroke="${tick}" stroke-width="4" stroke-linecap="round"/>`;
  }).join("");
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="${day ? 49 : 48}" fill="${bg}" ${day ? "" : 'stroke="rgba(255,255,255,0.28)" stroke-width="2"'}/>
    ${ticks}${hand((h % 12 + m / 60) * 30, 23, 7)}${hand(m * 6, 35, 5)}
    <circle cx="50" cy="50" r="5.5" fill="#ff9f0a"/>
  </svg>`;
}

const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Minutes that `zone` is ahead of the local time zone at instant `d`. */
function offsetMinutes(zone: string, d: Date): number {
  const at = (tz: string) => new Date(d.toLocaleString("en-US", { timeZone: tz })).getTime();
  return Math.round((at(zone) - at(localZone)) / 60000);
}

function fmtOffset(min: number): string {
  if (min === 0) return "";
  const a = Math.abs(min);
  return `${min < 0 ? "−" : "+"}${Math.floor(a / 60)}${a % 60 ? ":" + String(a % 60).padStart(2, "0") : ""}`;
}

function rowFor(city: string, tz: string, now = new Date()): Row {
  const h24 = settings.get().clock24;
  const localDay = now.toLocaleDateString("en-CA", { timeZone: localZone });
  const day = now.toLocaleDateString("en-CA", { timeZone: tz });
  const parts = now
    .toLocaleTimeString("en-US", { timeZone: tz, hour: h24 ? "2-digit" : "numeric", minute: "2-digit", hour12: !h24 })
    .split(" ");
  return {
    city,
    tz,
    time: parts[0],
    period: parts[1] ?? "",
    note: fmtOffset(offsetMinutes(tz, now)),
    otherDay: day !== localDay ? now.toLocaleDateString("en-US", { timeZone: tz, weekday: "short" }) : "",
  };
}

const dayNote = (r: Row) =>
  `${r.otherDay ? `<span style="color:var(--accent)">${esc(r.otherDay)}</span>` : "Today"}${r.note ? ` ${esc(r.note)}` : ""}`;

const timeHtml = (r: Row, size: number) =>
  `<span class="v" style="font-size:${size}px;font-weight:500">${esc(r.time)}${
    r.period ? `<span class="c" style="font-size:10.5px;margin-left:2px;letter-spacing:0">${esc(r.period)}</span>` : ""
  }</span>`;

interface Place { name: string; admin1?: string; country?: string; timezone: string }

async function searchCities(q: string): Promise<Place[]> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const j = await r.json();
  return (j.results ?? []).filter((p: Place) => p.timezone);
}

export default defineWidget<Row[]>({
  id: "clocks",
  name: "World clocks",
  // Analog faces: up to two fit a standard card; three to five make it wide.
  get size() {
    const s = settings.get();
    return s.clockStyle === "analog" && s.cities.length > 2 ? "wide" : "standard";
  },
  icon: ICONS.clock,
  bare: true, // like Apple's World Clock widget: no header, more room for the times
  everyMs: 1000,
  load() {
    const s = settings.get();
    const max = s.clockStyle === "analog" ? (s.cities.length > 2 ? 5 : 2) : 2;
    return s.cities.slice(0, max).map(({ city, tz }) => rowFor(city, tz));
  },
  view(rows) {
    if (!rows.length) return `<div class="c" style="margin:auto">Click to add a city</div>`;
    if (settings.get().clockStyle === "analog") {
      const size = rows.length > 2 ? 48 : 46;
      return `<div class="faces">${rows
        .map((r) => `<div class="facebox" title="${esc(r.city)} · ${esc(r.time)} ${esc(r.period)}${r.note ? " · " + esc(r.note) : ""}">
            ${face(r.tz, size)}<span class="lbl" style="color:var(--t2)">${esc(code(r.city))}</span></div>`)
        .join("")}</div>`;
    }
    return `<div class="stack" style="gap:6px;height:100%;justify-content:center">${rows
      .map(
        (r) => `<div class="row" style="gap:4px">
          <div class="stack" style="gap:2px">
            <span class="b ell" style="font-weight:600">${esc(r.city)}</span>
            <span class="c ell" style="font-size:11px">${dayNote(r)}</span>
          </div>
          ${timeHtml(r, 18)}
        </div>`
      )
      .join("")}</div>`;
  },

  panel(root, ctx) {
    root.innerHTML = `
      <div class="xhead"><span class="xtitle">World clocks</span>
        <div class="row" style="gap:6px">
          <div class="segs small"><button class="seg" data-style="analog">Analog</button><button class="seg" data-style="digital">Digital</button></div>
          <div class="segs small"><button class="seg" data-fmt="12">12h</button><button class="seg" data-fmt="24">24h</button></div>
        </div>
      </div>
      <div class="xlist" data-list></div>
      <div class="xnote">Analog shows up to five (three or more widen the card); digital shows the first two. Drag to reorder.</div>
      <label class="search">
        <svg class="ic" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>
        <input type="text" placeholder="Add a city" aria-label="Add a city" data-q autocomplete="off" spellcheck="false">
      </label>
      <div class="xresults" data-results></div>`;
    const list = root.querySelector<HTMLElement>("[data-list]")!;
    const results = root.querySelector<HTMLElement>("[data-results]")!;
    const input = root.querySelector<HTMLInputElement>("[data-q]")!;
    let dragFrom = -1;

    const drawList = () => {
      const s = settings.get();
      root.querySelectorAll<HTMLElement>("[data-fmt]").forEach((b) => {
        const on = (b.dataset.fmt === "24") === s.clock24;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", String(on));
      });
      root.querySelectorAll<HTMLElement>("[data-style]").forEach((b) => {
        const on = b.dataset.style === s.clockStyle;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", String(on));
      });
      list.innerHTML = s.cities.length
        ? s.cities
            .map((c, i) => {
              const r = rowFor(c.city, c.tz);
              return `<div class="xrow" draggable="true" data-i="${i}">
                <svg class="ic grip" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h14M5 15h14"/></svg>
                <div class="stack" style="flex:1;gap:2px"><span class="b ell" style="font-weight:600">${esc(c.city)}</span>
                  <span class="c ell">${dayNote(r)}</span></div>
                ${timeHtml(r, 20)}
                <button class="rm" aria-label="Remove ${esc(c.city)}" data-rm="${i}">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 12h10"/></svg></button>
              </div>`;
            })
            .join("")
        : `<div class="c" style="padding:10px 4px">No cities yet. Search below to add one.</div>`;
    };

    const save = (fn: (cities: { city: string; tz: string }[]) => void) => {
      settings.update((s) => fn(s.cities));
      drawList();
      void ctx.reload();
    };

    root.addEventListener("click", async (e) => {
      const t = e.target as HTMLElement;
      const fmt = t.closest<HTMLElement>("[data-fmt]")?.dataset.fmt;
      if (fmt) {
        settings.update((s) => { s.clock24 = fmt === "24"; });
        drawList();
        void ctx.reload();
      }
      const style = t.closest<HTMLElement>("[data-style]")?.dataset.style;
      if (style) {
        settings.update((s) => { s.clockStyle = style as "analog" | "digital"; });
        drawList();
        void ctx.reload();
      }
      const rm = t.closest<HTMLElement>("[data-rm]")?.dataset.rm;
      if (rm != null) save((c) => c.splice(Number(rm), 1));
      const add = t.closest<HTMLElement>("[data-add]");
      if (add) {
        const city = add.dataset.city!, tz = add.dataset.tz!;
        save((c) => { if (!c.some((x) => x.city === city && x.tz === tz)) c.push({ city, tz }); });
        input.value = "";
        results.innerHTML = "";
      }
    });

    // Drag a row to reorder.
    list.addEventListener("dragstart", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
      dragFrom = row ? Number(row.dataset.i) : -1;
      row?.classList.add("dragging");
    });
    list.addEventListener("dragover", (e) => e.preventDefault());
    list.addEventListener("drop", (e) => {
      e.preventDefault();
      const row = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
      const to = row ? Number(row.dataset.i) : settings.get().cities.length - 1;
      if (dragFrom >= 0 && to !== dragFrom) save((c) => { const [m] = c.splice(dragFrom, 1); c.splice(to, 0, m); });
      dragFrom = -1;
    });
    list.addEventListener("dragend", () => list.querySelectorAll(".dragging").forEach((r) => r.classList.remove("dragging")));

    // City search (Open-Meteo geocoding: includes each place's time zone).
    let timer = 0, seq = 0;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { results.innerHTML = ""; return; }
      timer = window.setTimeout(async () => {
        const mine = ++seq;
        let places: Place[] = [];
        try { places = await searchCities(q); } catch { /* offline */ }
        if (mine !== seq) return; // a newer search started
        results.innerHTML = places.length
          ? places
              .map((p) => {
                const sub = [p.admin1, p.country].filter(Boolean).join(", ");
                return `<button class="xres" data-add data-city="${esc(p.name)}" data-tz="${esc(p.timezone)}">
                  <span class="stack" style="flex:1;gap:1px;align-items:flex-start"><span class="b">${esc(p.name)}</span>
                  <span class="c">${esc(sub)} · ${esc(p.timezone.replace(/_/g, " "))}</span></span>
                  <span class="plus" aria-hidden="true">+</span></button>`;
              })
              .join("")
          : `<div class="c" style="padding:8px 4px">No matches.</div>`;
      }, 250);
    });

    drawList();
    const tick = window.setInterval(() => {
      if (!list.querySelector(".dragging")) drawList();
    }, 15_000);
    return () => clearInterval(tick);
  },
});
