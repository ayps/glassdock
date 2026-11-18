// Calendar: live from every connected Google account (main calendar of each).
// Card: the next event. Panel: the coming week, and a form to create a meeting
// (guests, Google Meet, location, description) or a task.
import { defineWidget } from "./types";
import { ICONS, esc } from "../ui";
import { settings } from "../settings";
import { googleStatus, openUrl } from "../native";
import {
  AccountError, CalEvent, accountColor, accountLabel, createMeeting, createTask, dayLabel, defaultSlot, timeLabel, upcoming,
} from "../google";
import { drawConnect } from "../connect";

interface Data {
  hasClient: boolean;
  accounts: string[];
  events: CalEvent[];
  errors: AccountError[];
}

const headerName = () => `${new Date().toLocaleDateString("en-US", { weekday: "long" })} ${new Date().getDate()}`;

function countdown(e: CalEvent): string {
  const now = Date.now();
  if (e.allDay) return dayLabel(e.start);
  if (+e.start <= now) return `<span style="color:var(--green)">Now</span>`;
  const min = Math.round((+e.start - now) / 60_000);
  if (min < 60) return `<span style="color:var(--orange)">in ${min} min</span>`;
  if (dayLabel(e.start) === "Today") return `in ${Math.round(min / 60)} h`;
  return dayLabel(e.start);
}

/** A meeting starting within `minutes` (or under way): the one to show a Join button for. */
export function meetingSoon(events: CalEvent[], minutes: number): CalEvent | undefined {
  const now = Date.now();
  return events.find((e) => !e.allDay && +e.start - now <= minutes * 60_000 && +e.end > now);
}

function nextEvent(d: Data): CalEvent | undefined {
  // Prefer the next timed event; fall back to today's all-day ones.
  return d.events.find((e) => !e.allDay) ?? d.events.find((e) => e.allDay && dayLabel(e.start) === "Today");
}

/** "3:30 – 4:00 PM", or "11:30 AM – 12:00 PM" when the range crosses noon. */
function whenText(e: CalEvent): string {
  if (e.allDay) return "All day";
  const a = timeLabel(e.start), b = timeLabel(e.end);
  const [at, ap] = a.split(" "), [, bp] = b.split(" ");
  return ap === bp ? `${at} – ${b}` : `${a} – ${b}`;
}

/** Short name for an account in pickers: "Work", "Personal", or the address. */
function accountName(a: string, all: string[]): string {
  const label = accountLabel(a);
  return all.filter((x) => accountLabel(x) === label).length > 1 ? a.split("@")[0] : label;
}

const calendar = defineWidget<Data>({
  id: "calendar",
  name: headerName(),
  size: "standard",
  icon: ICONS.calendar,
  accent: "red",
  everyMs: 5 * 60_000,
  async load() {
    calendar.name = headerName(); // keep the date right past midnight
    const st = await googleStatus();
    if (!st.accounts.length) return { hasClient: st.hasClient, accounts: [], events: [], errors: [] };
    const { events, errors } = await upcoming(st.accounts, 7);
    return { hasClient: true, accounts: st.accounts, events, errors };
  },
  headerRight(d) {
    const e = nextEvent(d);
    return e ? countdown(e) : "";
  },
  view(d) {
    if (!d.accounts.length) return `<div class="b" style="font-weight:600">Connect Google</div><div class="c">Click to set up</div>`;
    const e = nextEvent(d);
    if (!e) return `<div class="c">${d.errors.length ? "Couldn't reach Google" : "Nothing in the next 7 days"}</div>`;
    const color = accountColor(e.account, d.accounts);
    // Ten minutes before a meeting with a Meet link, the card offers to join it.
    const join = e.meet && meetingSoon([e], 10) === e
      ? `<button class="btn small join" data-action="join" aria-label="Join ${esc(e.title)}">Join</button>` : "";
    return `<div class="row" style="gap:9px;align-items:stretch;justify-content:flex-start">
      <div style="width:3px;border-radius:2px;background:${color};flex:none"></div>
      <div class="stack" style="gap:3px;min-width:0;flex:1">
        <span class="b ell" style="font-weight:600">${esc(e.title)}</span>
        <span class="c ell" style="color:${color}">${join ? "" : dayLabel(e.start) === "Today" ? "" : dayLabel(e.start) + " · "}${join ? timeLabel(e.start) : whenText(e)}${join ? "" : ` · ${accountLabel(e.account)}`}</span>
      </div>
      ${join}
    </div>`;
  },

  async onAction(action, d) {
    const e = nextEvent(d);
    if (action === "join" && e?.meet) await openUrl(e.meet);
  },

  panel(root, ctx) {
    let mode: "list" | "new" | "connect" = ctx.data?.accounts?.length ? "list" : "connect";
    let kind: "meeting" | "task" = "meeting";

    const draw = () => {
      if (mode === "connect") return void drawConnect(root, ctx, () => { mode = "list"; draw(); });
      if (mode === "new") return drawForm();
      drawList();
    };

    const drawList = () => {
      const d = ctx.data;
      const groups = new Map<string, CalEvent[]>();
      for (const e of d.events.slice(0, 30)) {
        const k = dayLabel(e.start);
        groups.set(k, [...(groups.get(k) ?? []), e]);
      }
      const rows = [...groups.entries()]
        .map(([day, evs]) => `<div class="xday">${esc(day)}</div>${evs.map((e) => {
          const color = accountColor(e.account, d.accounts);
          return `<div class="xrow ev" data-open="${esc(e.link ?? "")}" title="Open in Google Calendar">
            <div class="evbar" style="background:${color}"></div>
            <div class="stack" style="flex:1;gap:2px"><span class="b ell" style="font-weight:600">${esc(e.title)}</span>
              <span class="c ell">${whenText(e)}${e.location ? ` · ${esc(e.location)}` : ""} · <span style="color:${color}">${accountLabel(e.account)}</span></span></div>
            ${e.meet ? `<button class="btn small" data-join="${esc(e.meet)}">Join</button>` : ""}
          </div>`;
        }).join("")}`)
        .join("");
      const errs = d.errors.map((x) =>
        `<div class="xmsg bad">${esc(x.account)}: ${x.message.includes("reauth") ? "sign in again (Accounts)" : esc(x.message)}</div>`).join("");
      root.innerHTML = `
        <div class="xhead"><span class="xtitle" style="color:var(--red)">${esc(headerName())}</span>
          <div class="row" style="gap:6px">
            <button class="btn ghost" data-accounts>Accounts</button>
            <button class="btn" data-new>+ New</button>
          </div></div>
        <div class="xlist scroll">${rows || `<div class="c" style="padding:10px 4px">Nothing in the next 7 days.</div>`}</div>
        ${errs}`;
    };

    const drawForm = () => {
      const d = ctx.data;
      const slot = defaultSlot();
      const acct = d.accounts.includes(settings.get().lastAccount) ? settings.get().lastAccount : d.accounts[0];
      const acctSegs = d.accounts
        .map((a) => `<button class="seg${a === acct ? " on" : ""}" data-acct="${esc(a)}" title="${esc(a)}">${esc(accountName(a, d.accounts))}</button>`)
        .join("");
      root.innerHTML = `
        <div class="xhead"><span class="xtitle">New ${kind}</span>
          <div class="segs small"><button class="seg${kind === "meeting" ? " on" : ""}" data-kind="meeting">Meeting</button>
          <button class="seg${kind === "task" ? " on" : ""}" data-kind="task">Task</button></div></div>
        <form class="xform" data-form novalidate>
          <input name="title" placeholder="${kind === "meeting" ? "Meeting title" : "Task"}" aria-label="Title" required autocomplete="off">
          ${kind === "meeting"
            ? `<input type="date" name="date" value="${slot.date}" aria-label="Date">
               <div class="frow">
                 <input type="time" name="start" value="${slot.start}" aria-label="Start time">
                 <span class="c" style="flex:none">to</span>
                 <input type="time" name="end" value="${slot.end}" aria-label="End time">
               </div>
               <input name="guests" placeholder="Guests: name@company.com, …" aria-label="Guests" autocomplete="off">
               <div class="frow sw"><span class="b">Google Meet link</span>
                 <button type="button" class="switch on" role="switch" aria-checked="true" aria-label="Add Google Meet" data-meet><span></span></button></div>
               <input name="location" placeholder="Location" aria-label="Location" autocomplete="off">
               <textarea name="description" rows="2" placeholder="Description" aria-label="Description"></textarea>`
            : `<div class="frow"><span class="c" style="flex:none">Due</span><input type="date" name="due" value="${slot.date}" aria-label="Due date"></div>
               <textarea name="notes" rows="2" placeholder="Notes" aria-label="Notes"></textarea>`}
          <div class="frow"><span class="c" style="flex:none">Account</span><div class="segs small" style="flex:1">${acctSegs}</div></div>
          <div class="xmsg" data-msg></div>
          <div class="frow end"><button type="button" class="btn ghost" data-cancel>Cancel</button>
            <button type="submit" class="btn" data-save>${kind === "meeting" ? "Create meeting" : "Add task"}</button></div>
        </form>`;
      setTimeout(() => root.querySelector<HTMLInputElement>("[name=title]")?.focus(), 30);
    };

    root.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const join = t.closest<HTMLElement>("[data-join]")?.dataset.join;
      if (join) { e.stopPropagation(); void openUrl(join); return; }
      const open = t.closest<HTMLElement>("[data-open]")?.dataset.open;
      if (open) { void openUrl(open); return; }
      if (t.closest("[data-new]")) { mode = "new"; draw(); return; }
      if (t.closest("[data-accounts]")) { mode = "connect"; draw(); return; }
      if (t.closest("[data-cancel]")) { mode = "list"; draw(); return; }
      const k = t.closest<HTMLElement>("[data-kind]")?.dataset.kind;
      if (k) { kind = k as typeof kind; draw(); return; }
      const a = t.closest<HTMLElement>("[data-acct]");
      if (a) {
        root.querySelectorAll("[data-acct]").forEach((b) => b.classList.toggle("on", b === a));
        return;
      }
      const meet = t.closest<HTMLElement>("[data-meet]");
      if (meet) {
        const on = !meet.classList.contains("on");
        meet.classList.toggle("on", on);
        meet.setAttribute("aria-checked", String(on));
      }
    });

    root.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const f = new FormData(form);
      const msg = root.querySelector<HTMLElement>("[data-msg]")!;
      const say = (s: string, bad = false) => { msg.textContent = s; msg.classList.toggle("bad", bad); };
      const title = String(f.get("title") ?? "").trim();
      const account = root.querySelector<HTMLElement>("[data-acct].on")?.dataset.acct ?? ctx.data.accounts[0];
      if (!title) return say("Add a title.", true);
      const save = root.querySelector<HTMLButtonElement>("[data-save]")!;
      save.disabled = true;
      try {
        if (kind === "meeting") {
          const date = String(f.get("date"));
          const start = new Date(`${date}T${f.get("start")}`);
          const end = new Date(`${date}T${f.get("end")}`);
          if (!(end > start)) { save.disabled = false; return say("The end time must be after the start.", true); }
          const guests = String(f.get("guests") ?? "").split(/[\s,;]+/).filter(Boolean);
          const bad = guests.find((g) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(g));
          if (bad) { save.disabled = false; return say(`"${bad}" isn't an email address.`, true); }
          say("Creating…");
          await createMeeting(account, {
            title, start, end, guests,
            meet: root.querySelector("[data-meet]")?.classList.contains("on") ?? false,
            location: String(f.get("location") ?? "").trim(),
            description: String(f.get("description") ?? "").trim(),
          });
        } else {
          say("Adding…");
          await createTask(account, title, String(f.get("due") || "") || null, String(f.get("notes") ?? "").trim());
        }
        settings.update((s) => { s.lastAccount = account; });
        await ctx.reload();
        mode = "list";
        draw();
      } catch (err) {
        save.disabled = false;
        say(String(err).includes("reauth") ? "This account needs to sign in again (Accounts)." : String(err), true);
      }
    });

    draw();
  },
});

export default calendar;
