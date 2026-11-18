// System monitor: live CPU, memory, NVIDIA GPU and network, read by the Rust side.
// A reading that isn't available shows "—", never 0.
import { defineWidget } from "./types";
import { ICONS, ring } from "../ui";
import { systemStats, SystemStats } from "../native";

function rate(bps: number): string {
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} MB/s`;
  if (bps >= 1e3) return `${Math.round(bps / 1e3)} KB/s`;
  return `${Math.round(bps)} B/s`;
}

export default defineWidget<SystemStats | null>({
  id: "system",
  name: "System",
  size: "standard",
  icon: ICONS.system,
  everyMs: 2000,
  load: () => systemStats(),
  headerRight(s) {
    return s ? `↓ ${rate(s.down)}  ↑ ${rate(s.up)}` : "";
  },
  view(s) {
    if (!s) return `<div class="c">Not connected</div>`;
    const cell = (label: string, pct: number | null, color: string) => `
      <div class="stack" style="align-items:center;gap:4px">
        ${ring(pct, 34, `var(--${color})`, undefined, 3)}
        <span class="lbl" style="color:var(--${color})">${label}</span>
      </div>`;
    const ram = s.ramTotal ? (s.ramUsed / s.ramTotal) * 100 : null;
    return `<div class="row" style="padding:0 8px">
      ${cell("CPU", s.cpu, "teal")}${cell("RAM", ram, "purple")}${cell("GPU", s.gpu, "green")}
    </div>`;
  },
});
