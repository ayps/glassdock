// The lip: a small black capsule at the top centre of the screen, like the iPhone's
// Dynamic Island. Push the pointer up past the top edge and it stretches out, with a
// miniature of your dock's cards fading in, until the real dock takes over. Before
// a meeting it shows a small red dot. The window lets every click through.
import { listen } from "@tauri-apps/api/event";

interface LipState { p: number; alert: string | null; theme: string }
/** One mini card per widget in the dock: its width class and header colour. */
interface MiniCard { size: "small" | "std" | "wide"; color: string | null }

const css = document.createElement("style");
css.textContent = `
  html, body { margin: 0; background: transparent; overflow: hidden; }
  #isl {
    position: absolute; top: 6px; left: 50%; transform: translateX(-50%);
    width: 0; height: 0; opacity: 0; box-sizing: border-box; overflow: hidden;
    border-radius: 999px; background: #000;
    box-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.16), 0 6px 16px rgba(0, 0, 0, 0.35);
    transition: width 80ms ease-out, height 80ms ease-out, opacity 140ms ease;
    display: flex; align-items: center; justify-content: center;
  }
  #row { display: flex; gap: 3px; width: 100%; height: 100%; padding: 5px 13px; box-sizing: border-box; opacity: 0; transition: opacity 120ms ease; }
  #row i {
    position: relative; display: block; height: 100%; min-width: 0; border-radius: 6px;
    background: rgba(255, 255, 255, 0.14);
  }
  #row i b { position: absolute; top: 3px; left: 3px; width: 3px; height: 3px; border-radius: 50%; }
  #dot { width: 6px; height: 6px; border-radius: 50%; display: none; animation: breathe 2.2s ease-in-out infinite; }
  #isl.alert #dot { display: block; }
  #isl.alert #row { display: none; }
  @keyframes breathe { 50% { opacity: 0.35 } }
  @media (prefers-reduced-motion: reduce) { #isl, #row { transition: none; } #dot { animation: none; } }
`;
document.head.append(css);

const isl = document.createElement("div");
isl.id = "isl";
isl.setAttribute("aria-hidden", "true");
isl.innerHTML = `<div id="row"></div><div id="dot"></div>`;
document.body.replaceChildren(isl);
const row = isl.querySelector<HTMLElement>("#row")!;
const dot = isl.querySelector<HTMLElement>("#dot")!;

// Placeholder until the dock tells us its cards.
let cards: MiniCard[] = Array.from({ length: 6 }, (_, i) => ({ size: i === 3 ? "wide" : "std", color: null }));
const WEIGHT = { small: 1, std: 2, wide: 4 };

function drawCards() {
  row.innerHTML = cards
    .map((c) => `<i style="flex:${WEIGHT[c.size] ?? 2} 1 0">${c.color ? `<b style="background:${c.color}"></b>` : ""}</i>`)
    .join("");
}
drawCards();

void listen<MiniCard[]>("lip:cards", ({ payload }) => {
  if (Array.isArray(payload) && payload.length) {
    cards = payload.slice(0, 14);
    drawCards();
  }
});

void listen<LipState>("lip:state", ({ payload: s }) => {
  if (s.p > 0) {
    // Pushing: an eased stretch, so the first bit of push already shows clearly.
    const e = 1 - Math.pow(1 - Math.min(1, s.p), 2);
    isl.classList.remove("alert");
    isl.style.width = `${(14 + e * 236).toFixed(1)}px`;
    isl.style.height = `${(10 + e * 26).toFixed(1)}px`;
    isl.style.opacity = "1";
    // The mini cards fade in once there's room for them.
    row.style.opacity = String(Math.max(0, Math.min(1, (e - 0.3) / 0.4)));
  } else if (s.alert) {
    isl.classList.add("alert");
    dot.style.background = s.alert;
    isl.style.width = "30px";
    isl.style.height = "12px";
    isl.style.opacity = "1";
  } else {
    isl.classList.remove("alert");
    isl.style.width = "0";
    isl.style.height = "0";
    isl.style.opacity = "0";
    row.style.opacity = "0";
  }
});
