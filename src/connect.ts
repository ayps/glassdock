// The "Connect Google" view, shared by the Calendar and Tasks panels.
import { esc } from "./ui";
import { googleSetClient, googleSignIn, googleSignOut, googleStatus, inTauri } from "./native";
import { accountLabel } from "./google";
import type { PanelContext } from "./widgets/types";

/** Draws the accounts view into `box`; calls `done` when the user goes back. */
export async function drawConnect(box: HTMLElement, ctx: PanelContext<any>, done: () => void): Promise<void> {
  const st = await googleStatus();
  const accounts = st.accounts
    .map(
      (a) => `<div class="xrow"><div class="stack" style="flex:1;gap:2px"><span class="b ell">${esc(a)}</span>
        <span class="c">${accountLabel(a)}</span></div>
        <button class="btn ghost" data-signout="${esc(a)}">Remove</button></div>`
    )
    .join("");
  box.innerHTML = `
    <div class="xhead"><span class="xtitle">Google accounts</span>
      ${st.accounts.length ? `<button class="btn ghost" data-back>Done</button>` : ""}</div>
    ${!inTauri ? `<div class="c">Available in the desktop app.</div>` : ""}
    ${st.hasClient
      ? `${accounts || `<div class="c" style="padding:4px">No accounts yet.</div>`}
         <button class="btn" data-signin>Add a Google account</button>
         <div class="xnote">Opens Google's sign-in in your browser. Add your work and personal accounts one at a time.</div>`
      : `<div class="b" style="line-height:1.45">Step 1: choose the client JSON you downloaded from Google Cloud
           (APIs &amp; Services › Credentials › your Desktop-app client).</div>
         <label class="btn"><input type="file" accept=".json,application/json" data-file hidden>Choose client JSON…</label>`}
    <div class="xmsg" data-msg></div>`;
  const msg = box.querySelector<HTMLElement>("[data-msg]")!;
  const say = (t: string, bad = false) => { msg.textContent = t; msg.classList.toggle("bad", bad); };

  box.querySelector<HTMLInputElement>("[data-file]")?.addEventListener("change", async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      await googleSetClient(await f.text());
      await drawConnect(box, ctx, done);
    } catch (err) {
      say(String(err), true);
    }
  });
  box.querySelector("[data-signin]")?.addEventListener("click", async () => {
    say("Waiting for you to sign in in your browser…");
    ctx.keepOpen(true); // the browser takes focus; don't close the panel
    try {
      const email = await googleSignIn();
      ctx.keepOpen(false);
      say(`Connected ${email}.`);
      await drawConnect(box, ctx, done);
      void ctx.reload();
    } catch (err) {
      ctx.keepOpen(false);
      say(String(err), true);
    }
  });
  box.querySelectorAll<HTMLElement>("[data-signout]").forEach((b) =>
    b.addEventListener("click", async () => {
      await googleSignOut(b.dataset.signout!);
      await drawConnect(box, ctx, done);
      void ctx.reload();
    })
  );
  box.querySelector("[data-back]")?.addEventListener("click", done);
}
