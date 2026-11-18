// Notes: stored on this PC only (in the app's local storage). No account needed.
// Card: the pinned note (or the latest). Panel: search, list, edit, pin, delete.
import { defineWidget } from "./types";
import { ICONS, esc } from "../ui";

interface Note { id: string; text: string; pinned: boolean; updated: number }
const KEY = "glassdock.notes.v1";

function all(): Note[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}
function saveAll(n: Note[]) {
  try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* storage full or unavailable */ }
}
/** Pinned first, then most recently edited. */
const sorted = (n: Note[]) => [...n].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated - a.updated);
const titleOf = (t: string) => t.trim().split("\n")[0] || "New note";
const restOf = (t: string) => t.trim().split("\n").slice(1).join(" ").trim();
const when = (ms: number) => {
  const d = new Date(ms), now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
const STAR = '<path d="m12 3.5 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8Z"/>';

export default defineWidget<Note[]>({
  id: "notes",
  name: "Notes",
  size: "standard",
  icon: ICONS.notes,
  accent: "yellow",
  everyMs: 5000,
  load: () => sorted(all()),
  headerRight: (n) => (n.length ? String(n.length) : ""),
  view(notes) {
    const n = notes[0];
    if (!n) return `<div class="c">No notes yet.<br>Click to write one.</div>`;
    const rest = restOf(n.text);
    return `<div class="stack" style="gap:2px">
      <span class="b ell" style="font-weight:600">${esc(titleOf(n.text))}</span>
      ${rest ? `<span class="c clamp2" style="line-height:1.3">${esc(rest)}</span>` : ""}
    </div>`;
  },

  panel(root, ctx) {
    let editing: string | null = null;
    let query = "";
    let saveTimer = 0;

    const drawList = () => {
      const notes = sorted(all()).filter((n) => !query || n.text.toLowerCase().includes(query.toLowerCase()));
      root.innerHTML = `
        <div class="xhead"><span class="xtitle" style="color:var(--yellow)">Notes</span>
          <button class="btn" data-new>+ New</button></div>
        <label class="search">
          <svg class="ic" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>
          <input type="text" placeholder="Search" aria-label="Search notes" data-q value="${esc(query)}" autocomplete="off">
        </label>
        <div class="xlist scroll">${notes.map((n) => `
          <div class="xrow ev" data-edit="${n.id}">
            <div class="stack" style="flex:1;gap:2px"><span class="b ell" style="font-weight:600">${esc(titleOf(n.text))}</span>
              <span class="c ell">${when(n.updated)}${restOf(n.text) ? " · " + esc(restOf(n.text)) : ""}</span></div>
            ${n.pinned ? `<svg class="pin on" viewBox="0 0 24 24" aria-label="Pinned">${STAR}</svg>` : ""}
          </div>`).join("") || `<div class="c" style="padding:10px 4px">${query ? "No matches." : "No notes yet."}</div>`}</div>`;
      const q = root.querySelector<HTMLInputElement>("[data-q]")!;
      q.addEventListener("input", () => {
        query = q.value;
        const pos = q.selectionStart;
        drawList();
        const nq = root.querySelector<HTMLInputElement>("[data-q]")!;
        nq.focus();
        nq.setSelectionRange(pos, pos);
      });
    };

    const drawEditor = () => {
      const n = all().find((x) => x.id === editing);
      if (!n) { editing = null; return drawList(); }
      root.innerHTML = `
        <div class="xhead"><button class="btn ghost" data-back>‹ Notes</button>
          <div class="row" style="gap:6px">
            <button class="btn ghost iconbtn${n.pinned ? " on" : ""}" data-pin aria-label="${n.pinned ? "Unpin" : "Pin"}" aria-pressed="${n.pinned}">
              <svg viewBox="0 0 24 24" aria-hidden="true">${STAR}</svg></button>
            <button class="btn ghost" data-copy>Copy</button>
            <button class="btn ghost" data-del style="color:var(--red)">Delete</button>
          </div></div>
        <textarea class="notearea" data-text aria-label="Note" spellcheck="true">${esc(n.text)}</textarea>
        <div class="xnote" data-status>Saved automatically</div>`;
      const ta = root.querySelector<HTMLTextAreaElement>("[data-text]")!;
      ta.addEventListener("input", () => {
        clearTimeout(saveTimer);
        saveTimer = window.setTimeout(() => {
          saveAll(all().map((x) => (x.id === editing ? { ...x, text: ta.value, updated: Date.now() } : x)));
          void ctx.reload();
        }, 400);
      });
      setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 30);
    };

    const draw = () => (editing ? drawEditor() : drawList());

    root.addEventListener("click", async (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-new]")) {
        const n: Note = { id: crypto.randomUUID(), text: "", pinned: false, updated: Date.now() };
        saveAll([...all(), n]);
        editing = n.id;
        return draw();
      }
      const ed = t.closest<HTMLElement>("[data-edit]")?.dataset.edit;
      if (ed) { editing = ed; return draw(); }
      if (t.closest("[data-back]")) {
        // Drop notes left empty.
        saveAll(all().filter((x) => x.text.trim() || x.id !== editing));
        editing = null;
        void ctx.reload();
        return draw();
      }
      if (t.closest("[data-pin]")) {
        saveAll(all().map((x) => (x.id === editing ? { ...x, pinned: !x.pinned } : x)));
        void ctx.reload();
        return draw();
      }
      if (t.closest("[data-copy]")) {
        const n = all().find((x) => x.id === editing);
        if (n) await navigator.clipboard.writeText(n.text).catch(() => undefined);
        const st = root.querySelector<HTMLElement>("[data-status]");
        if (st) st.textContent = "Copied";
        return;
      }
      if (t.closest("[data-del]")) {
        saveAll(all().filter((x) => x.id !== editing));
        editing = null;
        void ctx.reload();
        return draw();
      }
    });

    draw();
    return () => {
      // Save straight away if the panel closes mid-typing.
      const ta = root.querySelector<HTMLTextAreaElement>("[data-text]");
      if (ta && editing) {
        clearTimeout(saveTimer);
        saveAll(all().map((x) => (x.id === editing ? { ...x, text: ta.value, updated: Date.now() } : x)).filter((x) => x.text.trim()));
      }
    };
  },
});
