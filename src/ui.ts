// Small HTML helpers shared by widgets. They only use CSS variables, so the same
// markup works on light and dark cards.

/** Escape text before putting it into HTML. Always use this for outside data. */
export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A colour from the card palette, e.g. c("orange") -> var(--orange). */
export const c = (name: string) => `var(--${name})`;

/** Circular progress ring with a centred label. `pct` null = unavailable. */
export function ring(pct: number | null, size: number, color: string, label?: string, stroke = 3.5): string {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const p = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const text = label ?? (pct == null ? "—" : `${Math.round(p)}`);
  return `<div class="ring" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${stroke}"/>
      ${pct == null ? "" : `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
        stroke-linecap="round" stroke-dasharray="${((circ * p) / 100).toFixed(1)} ${circ.toFixed(1)}"/>`}
    </svg>
    <span class="v" style="font-size:${size >= 70 ? 19 : size > 36 ? 12 : 11}px">${esc(text)}</span>
  </div>`;
}

/** Thin rounded progress bar. */
export function bar(pct: number, color: string, h = 4): string {
  const p = Math.max(0, Math.min(100, pct));
  return `<div class="bar" style="height:${h}px"><div style="width:${p}%;background:${color}"></div></div>`;
}

/** Line icons used across the dock (24×24, drawn with currentColor). */
export const ICONS = {
  claude: '<path d="M4.5 15.5a7.5 7.5 0 1 1 15 0"/><path d="M12 15.5l3.6-4.4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  weather: '<path d="M7.5 18.5h9.5a4 4 0 0 0 .4-8 5.8 5.8 0 0 0-11.1 1.7 3.2 3.2 0 0 0 1.2 6.3Z"/>',
  system:
    '<rect x="6.5" y="6.5" width="11" height="11" rx="3"/><path d="M9.5 3v2.5M14.5 3v2.5M9.5 18.5V21M14.5 18.5V21M3 9.5h2.5M3 14.5h2.5M18.5 9.5H21M18.5 14.5H21"/>',
  media: '<path d="M9 17.5V6.5l10-2v11"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="3.5"/><path d="M4 10h16M8.5 3v4M15.5 3v4"/>',
  tasks: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.3l2.4 2.4 4.8-5"/>',
  notes: '<rect x="5" y="3.5" width="14" height="17" rx="3.5"/><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4"/>',
  github:
    '<circle cx="7" cy="6" r="2"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="8" r="2"/><path d="M7 8v8M17 10c0 3.5-4 4-10 6"/>',
};

export function icon(paths: string, size = 14): string {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
}
