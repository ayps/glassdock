// Media: live. Shows and controls whatever is playing in Windows (Spotify,
// browsers, Media Player...), through Windows' own media controls.
import { defineWidget } from "./types";
import { ICONS, bar, esc } from "../ui";
import { NowPlaying, mediaAction, mediaNow } from "../native";

// Album art is only sent when the track changes, so keep the last one here.
let artKey: string | null = null;
let artUrl: string | null = null;

const PREV = '<path d="M18 18.5 10 12l8-6.5v13Z"/><rect x="6" y="5.5" width="2.2" height="13" rx="1.1"/>';
const PLAY = '<path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.4-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6Z"/>';
const PAUSE = '<rect x="6.5" y="5" width="4" height="14" rx="1.4"/><rect x="13.5" y="5" width="4" height="14" rx="1.4"/>';
const NEXT = '<path d="M6 18.5 14 12 6 5.5v13Z"/><rect x="15.8" y="5.5" width="2.2" height="13" rx="1.1"/>';

const mbtn = (paths: string, label: string, action: string, enabled: boolean, big = false) =>
  `<button class="mbtn${big ? " big" : ""}" aria-label="${label}" data-action="${action}" ${enabled ? "" : "disabled"}>
     <svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg></button>`;

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default defineWidget<NowPlaying | null>({
  id: "media",
  name: "Media",
  size: "wide",
  icon: ICONS.media,
  bare: true,
  everyMs: 1000,
  async load() {
    const np = await mediaNow(artKey);
    if (np && np.key !== artKey) {
      artKey = np.key;
      artUrl = np.art;
    }
    return np;
  },
  view(np) {
    if (!np) {
      return `<div class="row" style="gap:12px;height:100%;justify-content:flex-start">
        <div class="art empty">${`<svg class="ic" width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">${ICONS.media}</svg>`}</div>
        <div class="stack" style="gap:3px"><span class="b" style="font-weight:600">Nothing playing</span>
        <span class="c">Play something in Spotify, a browser or any media app</span></div>
      </div>`;
    }
    const art = artUrl
      ? `<div class="art" style="background:center/cover no-repeat url('${artUrl}')"></div>`
      : `<div class="art empty"><svg class="ic" width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">${ICONS.media}</svg></div>`;
    const line2 = [np.artist, np.app].filter(Boolean).map(esc).join(" · ");
    const timeline =
      np.position != null && np.duration
        ? `<div class="row" style="gap:8px">
            <span class="c tnum" style="font-size:10.5px">${mmss(np.position)}</span>
            <div style="flex:1">${bar((np.position / np.duration) * 100, "var(--ink)")}</div>
            <span class="c tnum" style="font-size:10.5px">−${mmss(np.duration - np.position)}</span>
          </div>`
        : "";
    return `<div class="row" style="gap:12px;height:100%">
      ${art}
      <div class="stack" style="flex:1;gap:8px;min-width:0">
        <div class="row" style="gap:8px">
          <div class="stack" style="gap:3px;flex:1;min-width:0">
            <span class="b ell" style="font-weight:600">${esc(np.title || "Unknown title")}</span>
            <span class="c ell">${line2}</span>
          </div>
          <div class="row" style="gap:2px">
            ${mbtn(PREV, "Previous", "prev", np.canPrev)}
            ${mbtn(np.playing ? PAUSE : PLAY, np.playing ? "Pause" : "Play", "toggle", np.canToggle, true)}
            ${mbtn(NEXT, "Next", "next", np.canNext)}
          </div>
        </div>
        ${timeline}
      </div>
    </div>`;
  },
  async onAction(action) {
    if (action === "toggle" || action === "next" || action === "prev") await mediaAction(action);
  },
});
