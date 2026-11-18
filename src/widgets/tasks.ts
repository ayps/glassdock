// Tasks: live from Google Tasks ("My Tasks" list) in every connected account.
// Panel: tick tasks off, or add a new one.
import { defineWidget } from "./types";
import { ICONS, esc } from "../ui";
import { settings } from "../settings";
import { googleStatus } from "../native";
import { AccountError, Task, accountLabel, completeTask, createTask, dayLabel, openTasks } from "../google";
import { drawConnect } from "../connect";

interface Data { accounts: string[]; tasks: Task[]; errors: AccountError[] }

function due(t: Task): string {
  if (!t.due) return "";
  const label = dayLabel(t.due);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (+t.due < +today) return `<span style="color:var(--red);font-weight:600">Overdue</span>`;
  return label === "Today" ? `<span style="color:var(--red);font-weight:600">Today</span>` : esc(label);
}

export default defineWidget<Data>({
  id: "tasks",
  name: "Tasks",
  size: "standard",
  icon: ICONS.tasks,
  accent: "blue",
  everyMs: 5 * 60_000,
  async load() {
    const st = await googleStatus();
    if (!st.accounts.length) return { accounts: [], tasks: [], errors: [] };
    const { tasks, errors } = await openTasks(st.accounts);
    return { accounts: st.accounts, tasks, errors };
  },
  headerRight(d) {
    return d.accounts.length ? `<span class="v" style="font-size:12px;color:var(--blue)">${d.tasks.length}</span>` : "";
  },
  view(d) {
    if (!d.accounts.length) return `<div class="b" style="font-weight:600">Connect Google</div><div class="c">Click to set up</div>`;
    if (!d.tasks.length) return `<div class="c">${d.errors.length ? "Couldn't reach Google" : "All done"}</div>`;
    return `<div class="stack" style="gap:7px">${d.tasks.slice(0, 2).map((t) => `
      <div class="row" style="gap:8px"><span class="check"></span>
        <span class="b ell" style="flex:1">${esc(t.title)}</span><span class="c">${due(t)}</span></div>`).join("")}</div>`;
  },

  panel(root, ctx) {
    let mode: "list" | "connect" = ctx.data?.accounts?.length ? "list" : "connect";

    const draw = () => {
      if (mode === "connect") return void drawConnect(root, ctx, () => { mode = "list"; draw(); });
      const d = ctx.data;
      const acct = d.accounts.includes(settings.get().lastAccount) ? settings.get().lastAccount : d.accounts[0];
      const segs = d.accounts.length > 1
        ? `<div class="segs small">${d.accounts.map((a) =>
            `<button class="seg${a === acct ? " on" : ""}" data-acct="${esc(a)}" title="${esc(a)}">${esc(accountLabel(a))}</button>`).join("")}</div>`
        : "";
      root.innerHTML = `
        <div class="xhead"><span class="xtitle" style="color:var(--blue)">Tasks</span>
          <button class="btn ghost" data-accounts>Accounts</button></div>
        <form class="addrow" data-add>
          <span class="check plus" aria-hidden="true"></span>
          <input name="title" placeholder="New task" aria-label="New task" autocomplete="off">
          ${segs}
        </form>
        <div class="xlist scroll">${d.tasks.map((t, i) => `
          <div class="xrow">
            <button class="checkbtn" aria-label="Complete ${esc(t.title)}" data-done="${i}"><span class="check"></span></button>
            <div class="stack" style="flex:1;gap:2px"><span class="b ell">${esc(t.title)}</span>
              <span class="c ell">${[due(t), d.accounts.length > 1 ? accountLabel(t.account) : ""].filter(Boolean).join(" · ")}</span></div>
          </div>`).join("") || `<div class="c" style="padding:10px 4px">No open tasks.</div>`}</div>
        <div class="xmsg" data-msg></div>`;
    };

    const say = (s: string, bad = false) => {
      const m = root.querySelector<HTMLElement>("[data-msg]");
      if (m) { m.textContent = s; m.classList.toggle("bad", bad); }
    };

    root.addEventListener("click", async (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-accounts]")) { mode = "connect"; draw(); return; }
      const a = t.closest<HTMLElement>("[data-acct]");
      if (a) { root.querySelectorAll("[data-acct]").forEach((b) => b.classList.toggle("on", b === a)); return; }
      const done = t.closest<HTMLElement>("[data-done]");
      if (done) {
        const task = ctx.data.tasks[Number(done.dataset.done)];
        done.closest(".xrow")?.classList.add("completing");
        try {
          await completeTask(task);
          await ctx.reload();
          draw();
        } catch (err) {
          say(String(err), true);
        }
      }
    });

    root.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = root.querySelector<HTMLInputElement>("[name=title]")!;
      const title = input.value.trim();
      if (!title) return;
      const account = root.querySelector<HTMLElement>("[data-acct].on")?.dataset.acct ?? ctx.data.accounts[0];
      input.disabled = true;
      try {
        await createTask(account, title, null, "");
        settings.update((s) => { s.lastAccount = account; });
        await ctx.reload();
        draw();
      } catch (err) {
        input.disabled = false;
        say(String(err), true);
      }
    });

    draw();
  },
});
