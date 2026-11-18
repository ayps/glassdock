// Claude plan usage: the 5-hour session and the weekly limit, as reported by
// Claude Code's status line (see src-tauri/src/claude.rs). The numbers are real
// but only refresh while Claude Code is running, so the age is always shown.
import { defineWidget } from "./types";
import { ICONS, bar, esc, ring } from "../ui";
import { ClaudeUsage, ClaudeWindow, claudeSetup, claudeUsage, openUrl } from "../native";

interface Win { pct: number | null; resets: Date | null }
interface Data { configured: boolean; updated: Date | null; session: Win; week: Win }

/** Ignore missing windows, expired ones, and the occasional bogus value Claude Code sends after /clear. */
function win(w: ClaudeWindow | undefined): Win {
  const resets = w?.resets_at ? new Date(w.resets_at * 1000) : null;
  const pct = w?.used_percentage;
  if (pct == null || pct < 0 || pct > 100 || (resets && +resets < Date.now())) return { pct: null, resets };
  return { pct, resets };
}

function until(d: Date | null): string {
  if (!d) return "";
  const min = Math.round((+d - Date.now()) / 60_000);
  if (min <= 0) return "now";
  if (min < 60) return `${min}m`;
  if (min < 48 * 60) return `${Math.floor(min / 60)}h ${min % 60}m`;
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

function ago(d: Date | null): string {
  if (!d) return "";
  const min = Math.round((Date.now() - +d) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const toData = (u: ClaudeUsage): Data => ({
  configured: u.configured,
  updated: u.data?.updated ? new Date(u.data.updated * 1000) : null,
  session: win(u.data?.rate_limits?.five_hour),
  week: win(u.data?.rate_limits?.seven_day),
});

export default defineWidget<Data>({
  id: "claude",
  name: "Claude",
  size: "standard",
  icon: ICONS.claude,
  accent: "orange",
  everyMs: 30_000,
  load: async () => toData(await claudeUsage()),
  headerRight(d) {
    // Show the age once the numbers are more than 10 minutes old.
    return d.updated && Date.now() - +d.updated > 10 * 60_000 ? ago(d.updated) : "";
  },
  view(d) {
    if (!d.configured && !d.updated) return `<div class="b" style="font-weight:600">Connect Claude Code</div><div class="c">Click to set up</div>`;
    if (!d.updated) return `<div class="c">Waiting for Claude Code. Usage appears after you next use it.</div>`;
    const s = d.session, w = d.week;
    return `<div class="row" style="gap:11px">
      ${ring(s.pct, 42, "var(--orange)", s.pct == null ? "—" : `${Math.round(s.pct)}%`)}
      <div class="stack" style="flex:1;gap:4px">
        <div class="row"><span class="c">Session</span><span class="c">${s.resets ? until(s.resets) : "—"}</span></div>
        <div class="row"><span class="c">Week</span><span class="v" style="font-size:12px">${w.pct == null ? "—" : Math.round(w.pct) + "%"}</span></div>
        ${bar(w.pct ?? 0, "var(--orange)")}
      </div>
    </div>`;
  },

  panel(root, ctx) {
    const draw = (msg = "", bad = false) => {
      const d = ctx.data;
      const big = (label: string, x: Win) => `
        <div class="stack" style="align-items:center;gap:6px;flex:1">
          ${ring(x.pct, 76, "var(--orange)", x.pct == null ? "—" : `${Math.round(x.pct)}%`, 6)}
          <span class="b" style="font-weight:600">${label}</span>
          <span class="c">${x.resets ? `Resets in ${until(x.resets)}` : "No data"}</span>
        </div>`;
      root.innerHTML = `
        <div class="xhead"><span class="xtitle" style="color:var(--orange)">Claude usage</span>
          <button class="btn ghost" data-page>Usage page</button></div>
        ${d.updated ? `<div class="row" style="gap:8px;padding:6px 0">${big("Session (5 hours)", d.session)}${big("Week", d.week)}</div>` : ""}
        <div class="xnote">${d.updated
          ? `Reported by Claude Code ${esc(ago(d.updated))}. These numbers cover all your Claude use (chat, Claude Code, desktop), but only refresh while Claude Code is running.`
          : d.configured
            ? "Set up. The numbers appear the next time Claude Code runs (after your first message in a session)."
            : "GlassDock reads your plan usage from Claude Code's status line, the supported way to get it. Set-up adds a small status-line script to Claude Code's settings (a backup of your settings is kept)."}</div>
        ${d.configured ? "" : `<div class="frow end"><button class="btn" data-setup>Connect Claude Code</button></div>`}
        <div class="xmsg${bad ? " bad" : ""}" data-msg>${esc(msg)}</div>`;
    };

    const setup = async (replace: boolean) => {
      try {
        await claudeSetup(replace);
        await ctx.reload();
        draw("Done. Start (or keep using) Claude Code, and the numbers will appear here.");
      } catch (err) {
        const s = String(err);
        if (s.includes("existing:")) {
          const cmd = s.split("existing:")[1];
          draw("", false);
          const box = root.querySelector<HTMLElement>("[data-msg]")!;
          box.innerHTML = `You already have a status line (<code>${esc(cmd.slice(0, 80))}</code>). Replace it with GlassDock's?
            <div class="frow end" style="margin-top:6px"><button class="btn ghost" data-keep>Keep mine</button>
            <button class="btn" data-replace>Replace</button></div>`;
        } else draw(s, true);
      }
    };

    root.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-page]")) return void openUrl("https://claude.ai/settings/usage");
      if (t.closest("[data-setup]")) return void setup(false);
      if (t.closest("[data-replace]")) return void setup(true);
      if (t.closest("[data-keep]")) return draw("Left your status line as it is.");
    });
    draw();
  },
});
