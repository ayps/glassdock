// Recycle Bin: a small tile with the number of items in it (all drives).
// Panel: size, Open (File Explorer) and Empty, which always asks first.
import { defineWidget } from "./types";
import { esc } from "../ui";
import { Bin, recycleBin, recycleEmpty, recycleOpen } from "../native";

// A plain outline bin (lid, handle and body), like the reference.
const BIN = '<path d="M4.5 7h15"/><path d="M9.5 7V5.3c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3V7"/><path d="M6.7 7l.8 11.3c.1 1.2 1 2.2 2.2 2.2h4.6c1.2 0 2.1-1 2.2-2.2L17.3 7"/>';

function size(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b >= 1e6) return `${Math.round(b / 1e6)} MB`;
  if (b >= 1e3) return `${Math.round(b / 1e3)} KB`;
  return `${b} bytes`;
}
const items = (n: number) => `${n.toLocaleString()} item${n === 1 ? "" : "s"}`;

export default defineWidget<Bin | null>({
  id: "recycle",
  name: "Recycle Bin",
  size: "small",
  icon: BIN,
  bare: true,
  everyMs: 10_000,
  load: () => recycleBin(),
  view(b) {
    const empty = !b || b.items === 0;
    const count = empty ? "" : b!.items > 999 ? "999+" : String(b!.items);
    // Rounded tile, soft circle, outline bin; the bin takes the accent colour when it has something in it.
    return `<div class="bintile${empty ? " empty" : ""}" title="${b ? esc(`${items(b.items)} · ${size(b.bytes)}`) : "Recycle Bin"}">
      <div class="bincircle">
        <svg class="ic" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">${BIN}</svg>
      </div>
      ${count ? `<span class="v bincount">${count}</span>` : ""}
    </div>`;
  },

  panel(root, ctx) {
    const draw = (confirming = false, msg = "", bad = false) => {
      const b = ctx.data;
      const empty = !b || b.items === 0;
      root.innerHTML = `
        <div class="xhead"><span class="xtitle">Recycle Bin</span>
          <button class="btn ghost" data-open>Open</button></div>
        <div class="row" style="justify-content:flex-start;gap:14px;padding:4px 6px">
          <svg class="ic" width="34" height="34" viewBox="0 0 24 24" aria-hidden="true" style="color:${empty ? "var(--t2)" : "var(--accent)"}">${BIN}</svg>
          <div class="stack" style="gap:2px">
            <span class="b" style="font-weight:600;font-size:15px">${empty ? "Empty" : items(b!.items)}</span>
            <span class="c">${empty ? "Nothing to clean up" : `${size(b!.bytes)} across all drives`}</span>
          </div>
        </div>
        ${confirming
          ? `<div class="confirm"><span class="b">Permanently delete ${items(b!.items)} (${size(b!.bytes)})? This can't be undone.</span>
             <div class="frow end"><button class="btn ghost" data-cancel>Cancel</button><button class="btn danger" data-really>Empty</button></div></div>`
          : `<div class="frow end"><button class="btn danger" data-empty ${empty ? "disabled" : ""}>Empty Recycle Bin…</button></div>`}
        <div class="xmsg${bad ? " bad" : ""}">${esc(msg)}</div>`;
    };
    root.addEventListener("click", async (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-open]")) { await recycleOpen(); return ctx.close(); }
      if (t.closest("[data-empty]")) return draw(true);
      if (t.closest("[data-cancel]")) return draw(false);
      if (t.closest("[data-really]")) {
        draw(false, "Emptying…");
        try {
          await recycleEmpty();
          await ctx.reload();
          draw(false, "Recycle Bin emptied.");
        } catch (err) {
          await ctx.reload();
          draw(false, String(err), true);
        }
      }
    });
    draw();
  },
});
