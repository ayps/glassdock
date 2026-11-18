// GitHub: live, with your personal access token.
// Card: today / this week / streak over a contribution grid.
// Panel: review requests, your open pull requests, issues assigned to you.
import { defineWidget } from "./types";
import { ICONS, esc } from "../ui";
import { githubClear, githubQuery, githubSetToken, githubStatus, openUrl } from "../native";

interface Item { title: string; url: string; repo: string }
interface Data {
  login: string | null;
  days: { date: string; count: number }[];
  today: number;
  week: number;
  streak: number;
  reviews: Item[];
  prs: Item[];
  issues: Item[];
  error?: string;
}

const COLS = 10, ROWS = 3; // 30 days fit a standard card

const QUERY = `query($reviews: String!, $prs: String!, $issues: String!) {
  viewer { contributionsCollection { contributionCalendar { weeks { contributionDays { date contributionCount } } } } }
  reviews: search(query: $reviews, type: ISSUE, first: 6) { nodes { ... on PullRequest { title url repository { nameWithOwner } } } }
  prs: search(query: $prs, type: ISSUE, first: 6) { nodes { ... on PullRequest { title url repository { nameWithOwner } } } }
  issues: search(query: $issues, type: ISSUE, first: 6) { nodes { ... on Issue { title url repository { nameWithOwner } } } }
}`;

const items = (n: any): Item[] =>
  (n?.nodes ?? []).filter((x: any) => x?.url).map((x: any) => ({ title: x.title, url: x.url, repo: x.repository?.nameWithOwner ?? "" }));

const FLAME = '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3 1.8-5.1 3.6-6.9.4 1.6 1.3 2.8 2.4 3.3-.2-3.3 1.4-6.2 3.9-8.2.2 2.6 1.4 4.3 2.8 5.9 1.1 1.3 1.8 3 1.8 5 0 4.3-3.1 7.1-8 7.1Z"/>';

/** Green levels, like GitHub: 0 = empty, then four steps by quartile. */
function levels(counts: number[]): (c: number) => number {
  const nz = counts.filter((c) => c > 0).sort((a, b) => a - b);
  const q = (f: number) => nz[Math.min(nz.length - 1, Math.floor(f * nz.length))] ?? 1;
  const [a, b, c] = [q(0.25), q(0.5), q(0.75)];
  return (n) => (n <= 0 ? 0 : n <= a ? 1 : n <= b ? 2 : n <= c ? 3 : 4);
}

export default defineWidget<Data>({
  id: "github",
  name: "GitHub",
  size: "standard",
  icon: ICONS.github,
  bare: true,
  everyMs: 10 * 60_000,
  async load() {
    const login = await githubStatus();
    const empty: Data = { login, days: [], today: 0, week: 0, streak: 0, reviews: [], prs: [], issues: [] };
    if (!login) return empty;
    try {
      const d = await githubQuery<any>(QUERY, {
        reviews: `is:open is:pr review-requested:${login} archived:false`,
        prs: `is:open is:pr author:${login} archived:false`,
        issues: `is:open is:issue assignee:${login} archived:false`,
      });
      const days: Data["days"] = (d.viewer.contributionsCollection.contributionCalendar.weeks as any[])
        .flatMap((w) => w.contributionDays)
        .map((x: any) => ({ date: x.date, count: x.contributionCount }));
      const today = days.at(-1)?.count ?? 0;
      const week = days.slice(-7).reduce((a, x) => a + x.count, 0);
      // The streak counts back from today (or from yesterday if today has none yet).
      let streak = 0;
      for (let i = days.length - 1 - (today === 0 ? 1 : 0); i >= 0 && days[i].count > 0; i--) streak++;
      return { login, days, today, week, streak, reviews: items(d.reviews), prs: items(d.prs), issues: items(d.issues) };
    } catch (e) {
      return { ...empty, error: String(e) };
    }
  },
  view(d) {
    if (!d.login) return `<div class="hdr"><span class="title" style="color:var(--green)">${`<svg class="ic" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">${ICONS.github}</svg>`}GitHub</span></div>
      <div class="b" style="font-weight:600">Connect GitHub</div><div class="c">Click to add your token</div>`;
    if (d.error && !d.days.length) return `<div class="c">GitHub: ${esc(d.error.includes("token") ? "token rejected" : "unavailable")}</div>`;
    const last = d.days.slice(-COLS * ROWS);
    const lv = levels(d.days.slice(-90).map((x) => x.count));
    const cells = last.map((x) => `<span class="gh l${lv(x.count)}" title="${esc(x.date)}: ${x.count}"></span>`).join("");
    return `<div class="ghstats">
        <span><b class="v">${d.today}</b> today</span>
        <span><b class="v">${d.week}</b> week</span>
        <span><svg class="flame" viewBox="0 0 24 24" aria-hidden="true">${FLAME}</svg><b class="v">${d.streak}</b></span>
      </div>
      <div class="ghgrid">${cells}</div>`;
  },

  panel(root, ctx) {
    const draw = () => {
      const d = ctx.data;
      if (!d.login) {
        root.innerHTML = `
          <div class="xhead"><span class="xtitle" style="color:var(--green)">Connect GitHub</span></div>
          <div class="b" style="line-height:1.45">Paste a <b>fine-grained personal access token</b> with read-only access
            (Contents, Issues, Pull requests, Metadata). It's stored in Windows Credential Manager.</div>
          <form class="xform" data-token>
            <input type="password" name="token" placeholder="github_pat_…" aria-label="GitHub token" autocomplete="off">
            <div class="xmsg" data-msg></div>
            <div class="frow end"><button type="button" class="btn ghost" data-new>Create a token…</button>
              <button type="submit" class="btn">Connect</button></div>
          </form>`;
        setTimeout(() => root.querySelector<HTMLInputElement>("[name=token]")?.focus(), 30);
        return;
      }
      const section = (title: string, list: Item[], empty: string) => `
        <div class="xday">${title}</div>
        ${list.length ? list.map((i) => `<div class="xrow ev" data-open="${esc(i.url)}">
          <div class="stack" style="flex:1;gap:2px"><span class="b ell">${esc(i.title)}</span><span class="c ell">${esc(i.repo)}</span></div>
        </div>`).join("") : `<div class="c" style="padding:4px 6px 8px">${empty}</div>`}`;
      root.innerHTML = `
        <div class="xhead"><span class="xtitle" style="color:var(--green)">@${esc(d.login)}</span>
          <div class="row" style="gap:6px"><button class="btn ghost" data-disconnect>Disconnect</button>
          <button class="btn" data-open="https://github.com/${esc(d.login)}">Profile</button></div></div>
        <div class="row" style="justify-content:flex-start;gap:16px;padding:0 6px">
          <span class="c"><b class="v" style="font-size:15px">${d.today}</b> today</span>
          <span class="c"><b class="v" style="font-size:15px">${d.week}</b> this week</span>
          <span class="c"><b class="v" style="font-size:15px;color:var(--orange)">${d.streak}</b> day streak</span>
        </div>
        <div class="xlist scroll">
          ${section("Review requests", d.reviews, "Nothing waiting for your review.")}
          ${section("Your open pull requests", d.prs, "No open pull requests.")}
          ${section("Assigned issues", d.issues, "No issues assigned to you.")}
        </div>
        ${d.error ? `<div class="xmsg bad">${esc(d.error)}</div>` : ""}`;
    };

    root.addEventListener("click", async (e) => {
      const t = e.target as HTMLElement;
      const open = t.closest<HTMLElement>("[data-open]")?.dataset.open;
      if (open) return void openUrl(open);
      if (t.closest("[data-new]")) return void openUrl("https://github.com/settings/personal-access-tokens/new");
      if (t.closest("[data-disconnect]")) {
        await githubClear();
        await ctx.reload();
        draw();
      }
    });
    root.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = root.querySelector<HTMLInputElement>("[name=token]")!;
      const msg = root.querySelector<HTMLElement>("[data-msg]")!;
      msg.textContent = "Checking…";
      msg.classList.remove("bad");
      try {
        await githubSetToken(input.value);
        input.value = "";
        await ctx.reload();
        draw();
      } catch (err) {
        msg.textContent = String(err);
        msg.classList.add("bad");
      }
    });
    draw();
  },
});
