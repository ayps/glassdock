// CPU, RAM and GPU as square tiles: an icon and the number inside a ring,
// drawn in the Windows accent colour.
// Live, from the Rust side. A reading that isn't available shows "—", never 0.
import { defineWidget, Widget } from "./types";
import { esc } from "../ui";
import { systemStats, SystemStats } from "../native";

const CHIP = '<rect x="6.5" y="6.5" width="11" height="11" rx="2.5"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9.5 3v2.5M14.5 3v2.5M9.5 18.5V21M14.5 18.5V21M3 9.5h2.5M3 14.5h2.5M18.5 9.5H21M18.5 14.5H21"/>';
const MEMORY = '<rect x="3" y="7" width="18" height="9" rx="1.6"/><path d="M6.5 16v2.5M9.5 16v2.5M12.5 16v2.5M15.5 16v2.5M18 16v2.5M7 10.5h2.5M11 10.5h2.5M15 10.5h2"/>';
const GPU = '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="9" cy="12" r="3"/><path d="M15.5 10h3M15.5 14h3"/>';

const gb = (b: number) => `${(b / 1e9).toFixed(1)} GB`;

/** The big ring with an icon above the number, like the reference tiles. */
function tile(pct: number | null, icon: string, color: string, title: string): string {
  const size = 60, stroke = 5;
  const r = (size - stroke) / 2, circ = 2 * Math.PI * r;
  const p = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  return `<div class="tile" title="${esc(title)}">
    <svg class="tring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${stroke}"/>
      ${pct == null ? "" : `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
        stroke-linecap="round" stroke-dasharray="${((circ * p) / 100).toFixed(1)} ${circ.toFixed(1)}"/>`}
    </svg>
    <div class="tin">
      <svg class="ic" width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>
      <span class="v" style="font-size:16px;font-weight:700">${pct == null ? "—" : Math.round(p)}</span>
    </div>
  </div>`;
}

function hw(id: string, name: string, icon: string, color: string, read: (s: SystemStats) => { pct: number | null; title: string }): Widget<SystemStats | null> {
  return defineWidget<SystemStats | null>({
    id,
    name,
    size: "small",
    icon,
    bare: true,
    everyMs: 2000,
    load: () => systemStats(),
    view(s) {
      if (!s) return tile(null, icon, color, `${name}: not available`);
      const { pct, title } = read(s);
      return tile(pct, icon, color, title);
    },
  });
}

export const cpu = hw("cpu", "CPU", CHIP, "var(--accent)", (s) => ({ pct: s.cpu, title: `CPU ${Math.round(s.cpu)}%` }));

export const ram = hw("ram", "RAM", MEMORY, "var(--accent)", (s) => {
  const pct = s.ramTotal ? (s.ramUsed / s.ramTotal) * 100 : null;
  return { pct, title: `Memory ${gb(s.ramUsed)} of ${gb(s.ramTotal)}` };
});

export const gpu = hw("gpu", "GPU", GPU, "var(--accent)", (s) => ({
  pct: s.gpu,
  title: s.gpu == null ? "GPU: no NVIDIA reading" : `GPU ${s.gpu}%${s.gpuTemp != null ? ` · ${s.gpuTemp} °C` : ""}`,
}));
