// The dock: lays out the cards, plays the slide animation, keeps widgets fresh
// while open, paints the wallpaper glass, and runs the right-click menu and the
// "Edit widgets" panel.
import { DEFAULT_ORDER, WIDGETS, byId } from "./widgets";
import type { PanelContext, Widget } from "./widgets/types";
import { settings, CardTheme, Settings } from "./settings";
import { esc, icon } from "./ui";
import { MonitorInfo, Wallpaper, autostartEnabled, canAutostart, getWallpaper, hideDone, inTauri, panelFocus, setAutostart, setDockSize, setHold, systemAccent } from "./native";

const TOP = 4; // gap above the dock
const SIDE = 24; // transparent room around the dock for its shadow
const BOTTOM = 44;
const DOCK_H = 84 + 16; // card height + padding
const SCREEN_MARGIN = 40; // the dock never comes closer than this to the screen sides

/**
 * A real spring (stiffness 260, damping 24): fast start, a slight overshoot,
 * soft landing. Expressed as a CSS linear() curve so CSS transitions and the
 * Web Animations API can both use it.
 */
const SPRING = (() => {
  const k = 260, c = 24, w0 = Math.sqrt(k), z = c / (2 * Math.sqrt(k)), wd = w0 * Math.sqrt(1 - z * z);
  const x = (t: number) => 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t));
  const T = -Math.log(0.002) / (z * w0); // seconds until it has settled
  const pts = Array.from({ length: 61 }, (_, i) => x((T * i) / 60).toFixed(4));
  return { easing: `linear(${pts.join(", ")})`, ms: Math.round(T * 1000) };
})();

/** The "Liquid" move: cards stretch as they travel and snap back as they arrive. */
const LIQUID = { ms: 640, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };

interface Drag {
  l: Live;
  pointerId: number;
  startX: number;
  started: boolean;
  from: number; // index before the drag
  to: number; // index it would drop at
  mids: number[]; // centre x of every card when the drag started
  shift: number; // how far neighbours move aside: dragged width + gap
  shifts: Map<HTMLElement, number>; // where each neighbour currently sits
  lastX: number;
  lastT: number;
  vel: number; // pointer speed, px per ms (smoothed)
  dx: number;
  raf: number;
}

interface Live {
  w: Widget<any>;
  el: HTMLElement;
  data: unknown;
  last: number;
}

export class Dock {
  private root: HTMLElement;
  private wrap!: HTMLElement;
  private dock!: HTMLElement;
  private glass!: HTMLElement;
  private track!: HTMLElement;
  private rail!: HTMLElement;
  /** Elastic scrolling: offset (0 or negative), velocity, and the last wheel time. */
  private sx = 0;
  private sv = 0;
  private lastWheel = 0;
  private scrollRaf = 0;
  private overlay!: HTMLElement;
  private live: Live[] = [];
  private monitor: MonitorInfo = { width: window.innerWidth, height: window.innerHeight, scale: 1 };
  private wallpaper: Wallpaper | null = null;
  private wpImg: HTMLImageElement | null = null;
  private timer: number | null = null;
  private open = false;
  private extraH = 0; // room needed below the dock for a menu or panel
  private extraW = 0;
  private overlayRO: ResizeObserver | null = null;
  private panelCleanup: (() => void) | null = null;
  private panelKeepOpen = false;
  private drag: Drag | null = null;
  private suppressClick = false;
  private settleTimer = 0;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  async init() {
    settings.init(WIDGETS.map((w) => w.id), DEFAULT_ORDER);
    this.root.innerHTML = `
      <div class="wrap"><div class="dock" role="toolbar" aria-label="GlassDock">
        <div class="glass" aria-hidden="true"></div><div class="tint" aria-hidden="true"></div>
        <div class="track"><div class="rail"></div></div>
      </div></div>
      <div class="overlay"></div>`;
    this.wrap = this.root.querySelector(".wrap")!;
    this.dock = this.root.querySelector(".dock")!;
    this.glass = this.root.querySelector(".glass")!;
    this.track = this.root.querySelector(".track")!;
    this.rail = this.root.querySelector(".rail")!;
    this.overlay = this.root.querySelector(".overlay")!;
    this.wrap.style.top = `${TOP}px`;

    this.track.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    this.track.addEventListener("click", (e) => this.onClick(e));
    this.track.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    window.addEventListener("pointermove", (e) => this.onPointerMove(e));
    window.addEventListener("pointerup", (e) => this.onPointerUp(e));
    window.addEventListener("pointercancel", (e) => this.onPointerUp(e));
    document.documentElement.style.setProperty("--spring", SPRING.easing);
    document.documentElement.style.setProperty("--spring-ms", `${SPRING.ms}ms`);
    // Hold the dock open only while you're typing in a field.
    this.overlay.addEventListener("focusin", (e) => {
      if ((e.target as HTMLElement).matches("input, textarea, select")) void setHold(true);
    });
    this.overlay.addEventListener("focusout", () => {
      setTimeout(() => {
        const a = document.activeElement as HTMLElement | null;
        if (!a?.matches("input, textarea, select") && !this.panelKeepOpen) void setHold(false);
      }, 0);
    });
    this.root.addEventListener("contextmenu", (e) => this.onContextMenu(e));
    document.addEventListener("pointerdown", (e) => {
      if (!(e.target as HTMLElement).closest(".menu, .panel, .xpanel, .card.active")) this.closeOverlay();
    });
    this.overlay.addEventListener("click", (e) => this.onOverlayClick(e));
    // Clicking another app closes an open panel (unless it asked to stay, e.g. during sign-in).
    window.addEventListener("blur", () => {
      if (this.menuFor?.startsWith("xpanel:") && !this.panelKeepOpen) this.closeOverlay();
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.closeOverlay();
    });
    settings.onChange(() => this.build());

    this.build();
    // First run of the installed app: start with Windows by default (switch it off in Edit widgets).
    if (canAutostart && !settings.get().autostartSet) {
      try {
        await setAutostart(true);
        settings.update((x) => { x.autostartSet = true; });
      } catch (e) {
        console.warn("couldn't enable start with Windows", e);
      }
    }
    await this.loadWallpaper();
    if (!inTauri) this.show(this.monitor); // browser preview: just show it
  }

  // ---------------------------------------------------------------- layout
  private build() {
    const s = settings.get();
    this.live = s.order
      .map((id) => byId(id))
      .filter((w): w is Widget<any> => !!w)
      .map((w) => {
        const prev = this.live.find((l) => l.w.id === w.id);
        const el = document.createElement("section");
        el.dataset.id = w.id;
        el.setAttribute("aria-label", w.name);
        return { w, el, data: prev?.data, last: prev?.last ?? 0 };
      });
    this.rail.replaceChildren(...this.live.map((l) => l.el));
    if (!this.live.length) {
      this.rail.innerHTML = `<div class="card std empty"><div class="c">No widgets.<br>Right-click to add some.</div></div>`;
    }
    this.live.forEach((l) => this.paint(l));
    this.applyTheme();
    this.layout();
  }

  private themeOf(id: string, s: Settings): "light" | "dark" {
    const t: CardTheme = s.themes[id] ?? "auto";
    return t === "auto" ? s.dockTheme : t;
  }

  private paint(l: Live) {
    const s = settings.get();
    const w = l.w;
    const active = this.menuFor === `xpanel:${w.id}`;
    const size = w.size === "wide" ? "wide" : w.size === "small" ? "small" : "std";
    // A card set explicitly to Light or Dark gets a solid fill, so it reads as that
    // colour over any wallpaper. "Auto" cards stay see-through and follow the dock.
    const solid = (s.themes[w.id] ?? "auto") !== "auto" ? " solid" : "";
    l.el.className = `card ${size} ${this.themeOf(w.id, s)}${solid}${w.panel ? " has-panel" : ""}${active ? " active" : ""}`;
    if (l.data === undefined) {
      l.el.innerHTML = w.bare ? "" : this.header(w, "");
      return;
    }
    let body: string;
    try {
      body = w.view(l.data);
    } catch (e) {
      console.error(w.id, e);
      body = `<div class="c">Something went wrong</div>`;
    }
    const right = w.headerRight ? w.headerRight(l.data) : "";
    l.el.innerHTML = (w.bare ? "" : this.header(w, right)) + `<div class="body">${body}</div>`;
  }

  private header(w: Widget<any>, right: string): string {
    const accent = w.accent ? ` style="color:var(--${w.accent})"` : "";
    const sample = w.sample ? `<span class="pill">Sample</span>` : "";
    return `<div class="hdr"><span class="title"${accent}>${icon(w.icon)}${esc(w.name)}</span>${sample}
      ${right ? `<span class="right">${right}</span>` : ""}</div>`;
  }

  private applyTheme() {
    const s = settings.get();
    this.dock.classList.toggle("light", s.dockTheme === "light");
    this.dock.classList.toggle("dark", s.dockTheme === "dark");
    let tint = s.dockTheme === "dark" ? [24, 28, 36] : [238, 241, 245];
    if (s.tint === "wallpaper" && this.wallpaper) {
      // Restrained tint: mostly neutral glass with a hint of the wallpaper colour.
      const base = s.dockTheme === "dark" ? [14, 17, 24] : [240, 243, 247];
      const k = s.dockTheme === "dark" ? 0.25 : 0.22;
      tint = base.map((b, i) => Math.round(b * (1 - k) + this.wallpaper!.tint[i] * k));
    }
    // The dark glass needs more body than the light one to stay dark over bright wallpapers.
    const a = s.dockTheme === "dark" ? 0.7 : 0.6;
    this.dock.style.setProperty("--dock-tint", `rgba(${tint.join(",")},${a})`);
  }

  /** Size the dock to its cards, cap it to the screen, and tell Rust the window size. */
  private layout() {
    const maxW = this.monitor.width - SCREEN_MARGIN * 2;
    const content = this.rail.scrollWidth;
    const dockW = Math.min(content + 16, maxW);
    this.dock.style.width = `${dockW}px`;
    const lo = this.minScroll();
    if (this.sx < lo || this.sx > 0) this.setScroll(Math.max(lo, Math.min(0, this.sx)));
    this.updateFades();
    this.placeGlass(dockW);
    const winW = Math.min(this.monitor.width, Math.max(dockW, this.extraW, 360) + SIDE * 2);
    void setDockSize(winW, TOP + DOCK_H + BOTTOM + this.extraH);
  }

  /** Furthest the row can scroll (0 when everything fits). */
  private minScroll(): number {
    return Math.min(0, this.track.clientWidth - 8 - this.rail.scrollWidth); // 8 = the 4 px lift room each side
  }

  private updateFades() {
    const lo = this.minScroll();
    this.track.classList.toggle("fade-l", lo < 0 && this.sx < -2);
    this.track.classList.toggle("fade-r", lo < 0 && this.sx > lo + 2);
  }

  private setScroll(x: number) {
    this.sx = x;
    this.rail.style.transform = x ? `translateX(${x}px)` : "";
    this.updateFades();
  }

  /**
   * Elastic edges: the wheel moves the row freely; past either end it gives
   * way with resistance, and once the wheel stops it springs back, like an
   * iPhone list. A small glide carries on after the wheel stops.
   */
  private onWheel(e: WheelEvent) {
    const lo = this.minScroll();
    if (lo >= 0 && this.sx === 0) return; // everything fits: nothing to scroll
    e.preventDefault();
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const px = e.deltaMode === 1 ? d * 30 : d; // lines -> pixels
    let x = this.sx - px;
    // Past an end, each further step only moves a fraction (resistance).
    if (x > 0) x = this.sx > 0 ? this.sx - px * 0.25 : x * 0.35;
    if (x < lo) x = this.sx < lo ? this.sx - px * 0.25 : lo + (x - lo) * 0.35;
    x = Math.max(lo - 80, Math.min(80, x));
    this.sv = -px * 0.12;
    this.lastWheel = performance.now();
    this.setScroll(x);
    if (!this.scrollRaf) this.scrollRaf = requestAnimationFrame(() => this.scrollStep());
  }

  private scrollStep() {
    const lo = this.minScroll();
    const idle = performance.now() - this.lastWheel > 90;
    let x = this.sx;
    if (idle) {
      if (x > 0 || x < lo) {
        // Spring back to the nearest end.
        const target = x > 0 ? 0 : lo;
        this.sv = (this.sv + (target - x) * 0.14) * 0.74;
      } else {
        this.sv *= 0.9; // glide
      }
      const wasOut = this.sx > 0 || this.sx < lo;
      x += this.sv;
      // Springing back from past an end: stop exactly at the edge, don't coast on.
      if (wasOut && this.sx > 0 && x <= 0) { x = 0; this.sv = 0; }
      if (wasOut && this.sx < lo && x >= lo) { x = lo; this.sv = 0; }
      // Gliding into an end: hand over to the spring with less speed.
      if (!wasOut && (x > 0 || x < lo)) this.sv *= 0.4;
    }
    this.setScroll(x);
    const settled = idle && Math.abs(this.sv) < 0.05 && x <= 0.5 && x >= lo - 0.5;
    if (settled) {
      this.setScroll(Math.round(Math.max(lo, Math.min(0, x))));
      this.scrollRaf = 0;
    } else {
      this.scrollRaf = requestAnimationFrame(() => this.scrollStep());
    }
  }

  // ---------------------------------------------------------------- glass
  async loadWallpaper() {
    this.wallpaper = await getWallpaper();
    if (!this.wallpaper) {
      this.glass.style.backgroundImage = "";
      this.applyTheme();
      return;
    }
    const img = new Image();
    img.src = this.wallpaper.dataUrl;
    await img.decode().catch(() => undefined);
    this.wpImg = img;
    this.glass.style.backgroundImage = `url("${this.wallpaper.dataUrl}")`;
    this.applyTheme();
    this.layout();
  }

  /**
   * The glass shows the part of the wallpaper that sits behind the dock, blurred.
   * The wallpaper is assumed to "fill" the screen (the Windows default).
   */
  private placeGlass(dockW: number) {
    const img = this.wpImg;
    if (!img || !img.naturalWidth) return;
    const { width: mw, height: mh } = this.monitor;
    const k = Math.max(mw / img.naturalWidth, mh / img.naturalHeight);
    const bw = img.naturalWidth * k, bh = img.naturalHeight * k;
    const dockX = (mw - dockW) / 2, dockY = TOP;
    const BLEED = 60; // .glass extends 60 px past the dock so the blur has no edges
    this.glass.style.backgroundSize = `${bw}px ${bh}px`;
    this.glass.style.backgroundPosition = `${(mw - bw) / 2 - dockX + BLEED}px ${(mh - bh) / 2 - dockY + BLEED}px`;
  }

  // ---------------------------------------------------------------- open / close
  /** Follow the Windows accent colour (checked each time the dock opens). */
  private async loadAccent() {
    const a = await systemAccent();
    if (!a) return;
    const root = document.documentElement.style;
    root.setProperty("--sys-accent-on-dark", a.on_dark);
    root.setProperty("--sys-accent-on-light", a.on_light);
  }

  show(m: MonitorInfo) {
    void this.loadAccent();
    this.monitor = m;
    this.open = true;
    this.closeOverlay();
    this.layout();
    // Cards ripple outward from the centre of the dock, by distance.
    const tr = this.track.getBoundingClientRect();
    const mid = tr.left + tr.width / 2;
    this.live.forEach((l) => {
      const r = l.el.getBoundingClientRect();
      l.el.style.animationDelay = `${140 + Math.round((Math.abs(r.left + r.width / 2 - mid) / 180) * 45)}ms`;
    });
    this.dock.classList.remove("out", "settled");
    void this.dock.offsetWidth; // restart the animation
    this.dock.classList.add("in");
    // Once the slide-in is over, rebuilding cards (reordering) mustn't replay it.
    clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => this.dock.classList.add("settled"), 1100);
    void this.refresh(true);
    if (this.timer == null) this.timer = window.setInterval(() => void this.refresh(false), 1000);
  }

  hide() {
    this.open = false;
    this.closeOverlay();
    if (this.timer != null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.dock.classList.remove("in");
    this.dock.classList.add("out");
    window.setTimeout(() => void hideDone(), 210);
  }

  /** Reload widgets that are due. Nothing refreshes while the dock is hidden. */
  private async refresh(all: boolean) {
    const now = Date.now();
    await Promise.all(
      this.live.map(async (l) => {
        const due = all ? l.data === undefined || l.w.everyMs != null || now - l.last > 60_000
                        : l.w.everyMs != null && now - l.last >= l.w.everyMs;
        if (!due) return;
        try {
          l.data = await l.w.load();
          l.last = now;
        } catch (e) {
          console.warn(l.w.id, e);
        }
        this.paint(l);
      })
    );
  }

  private async onClick(e: MouseEvent) {
    if (this.suppressClick) {
      this.suppressClick = false;
      return; // this click ended a drag
    }
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
    const card = (e.target as HTMLElement).closest<HTMLElement>(".card");
    const l = this.live.find((x) => x.el === card);
    if (!l) return;
    if (btn) {
      if (l.w.onAction) {
        await l.w.onAction(btn.dataset.action!, l.data);
        l.data = await l.w.load();
        this.paint(l);
      }
      return;
    }
    if (l.w.panel) {
      if (this.menuFor === `xpanel:${l.w.id}`) this.closeOverlay();
      else this.openWidgetPanel(l);
    }
  }

  /** Open a widget's expanded panel under its card. */
  private openWidgetPanel(l: Live) {
    this.closeOverlay();
    const theme = this.themeOf(l.w.id, settings.get());
    const root = document.createElement("div");
    root.className = `xpanel ${theme}`;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", l.w.name);
    this.menuFor = `xpanel:${l.w.id}`;
    l.el.classList.add("active");
    const ctx: PanelContext<any> = {
      data: l.data,
      reload: async () => {
        // The card may have been rebuilt since the panel opened (e.g. a settings change).
        const cur = this.live.find((x) => x.w.id === l.w.id) ?? l;
        cur.data = await cur.w.load();
        cur.last = Date.now();
        this.paint(cur);
        ctx.data = cur.data;
        return cur.data;
      },
      close: () => this.closeOverlay(),
      keepOpen: (on) => { this.panelKeepOpen = on; void setHold(on); },
    };
    this.showOverlay(root, l.el.getBoundingClientRect());
    try {
      const cleanup = l.w.panel!(root, ctx);
      this.panelCleanup = typeof cleanup === "function" ? cleanup : null;
    } catch (e) {
      console.error(l.w.id, e);
      root.innerHTML = `<div class="c" style="padding:12px">Something went wrong.</div>`;
    }
    void panelFocus(true); // hold the dock open and let it take typing
  }

  // ---------------------------------------------------------------- reordering
  /**
   * Run `change` (which rebuilds the cards in a new order), then glide every card
   * from where it was to where it is now on the spring (the FLIP technique).
   */
  private animateReorder(change: () => void, from?: Map<string, { x: number; t: string }>, primary?: string) {
    const before = from ?? new Map(this.live.map((l) => [l.w.id, { x: l.el.getBoundingClientRect().left, t: "" }]));
    change();
    for (const l of this.live) {
      const b = before.get(l.w.id);
      if (!b) continue;
      const dx = b.x - l.el.getBoundingClientRect().left;
      if (Math.abs(dx) < 0.5 && !b.t) continue;
      const dir = dx < 0 ? 1 : -1; // direction it travels
      const mover = l.w.id === primary;
      // The moving card stretches forward; the ones making way squeeze.
      const amount = Math.min(1, Math.abs(dx) / 180);
      l.el.style.transformOrigin = mover === (dir > 0) ? "left center" : "right center";
      const mid = mover
        ? `translateX(${dx * 0.45}px) scaleX(${1 + 0.28 * amount}) scaleY(${1 - 0.1 * amount})`
        : `translateX(${dx * 0.55}px) scaleX(${1 - 0.18 * amount})`;
      const anim = l.el.animate(
        [{ transform: `translateX(${dx}px)${b.t}` }, { transform: mid, offset: 0.4 }, { transform: "none" }],
        { duration: LIQUID.ms, easing: LIQUID.easing }
      );
      anim.onfinish = anim.oncancel = () => (l.el.style.transformOrigin = "");
    }
  }

  private onPointerDown(e: PointerEvent) {
    if (e.button !== 0 || this.drag) return;
    const t = e.target as HTMLElement;
    if (t.closest("button, input, textarea, a, [data-action]")) return; // let controls work
    const card = t.closest<HTMLElement>(".card[data-id]");
    const l = this.live.find((x) => x.el === card);
    if (!l) return;
    const rects = this.live.map((x) => x.el.getBoundingClientRect());
    const i = this.live.indexOf(l);
    this.drag = {
      l, pointerId: e.pointerId, startX: e.clientX, started: false, from: i, to: i,
      mids: rects.map((r) => r.left + r.width / 2),
      shift: rects[i].width + 10,
      shifts: new Map(), lastX: e.clientX, lastT: performance.now(), vel: 0, dx: 0, raf: 0,
    };
  }

  private onPointerMove(e: PointerEvent) {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    if (!d.started) {
      if (Math.abs(dx) < 6) return; // a click, not a drag (yet)
      d.started = true;
      this.closeOverlay();
      d.l.el.setPointerCapture(e.pointerId);
      d.l.el.classList.add("dragging");
      d.raf = requestAnimationFrame(() => this.dragFrame());
    }
    const now = performance.now();
    d.vel = d.vel * 0.6 + ((e.clientX - d.lastX) / Math.max(1, now - d.lastT)) * 0.4;
    d.lastX = e.clientX;
    d.lastT = now;
    d.dx = dx;
    // Where would it land? Count the cards whose centre it has passed.
    const centre = d.mids[d.from] + dx;
    let to = 0;
    this.live.forEach((x, i) => { if (i !== d.from && d.mids[i] < centre) to++; });
    d.to = to;
    // Neighbours between the old and new spot flow aside, squeezing as they go.
    this.live.forEach((x, i) => {
      if (x === d.l) return;
      let move = 0;
      if (d.from < to && i > d.from && i <= to) move = -d.shift;
      if (to < d.from && i >= to && i < d.from) move = d.shift;
      const was = d.shifts.get(x.el) ?? 0;
      if (was === move) return;
      d.shifts.set(x.el, move);
      x.el.getAnimations().forEach((a) => a.cancel());
      x.el.style.transformOrigin = move < was ? "right center" : "left center";
      x.el.style.transform = move ? `translateX(${move}px)` : "";
      x.el.animate(
        [
          { transform: `translateX(${was}px)` },
          { transform: `translateX(${was + (move - was) * 0.55}px) scaleX(0.84)`, offset: 0.4 },
          { transform: move ? `translateX(${move}px)` : "none" },
        ],
        { duration: 520, easing: LIQUID.easing }
      );
    });
  }

  /** Every frame while dragging: the lifted card stretches with your speed and relaxes when you slow down. */
  private dragFrame() {
    const d = this.drag;
    if (!d || !d.started) return;
    if (performance.now() - d.lastT > 40) d.vel *= 0.82; // pointer resting: relax
    const v = Math.max(-1, Math.min(1, d.vel / 2.2));
    const sx = 1 + Math.abs(v) * 0.22, sy = 1 - Math.abs(v) * 0.08;
    d.l.el.style.transformOrigin = v > 0 ? "left center" : "right center";
    d.l.el.style.transform = `translateX(${d.dx}px) scale(${(1.04 * sx).toFixed(3)}, ${(1.04 * sy).toFixed(3)})`;
    d.raf = requestAnimationFrame(() => this.dragFrame());
  }

  private onPointerUp(e: PointerEvent) {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    this.drag = null;
    if (!d.started) return; // it was a click
    cancelAnimationFrame(d.raf);
    this.suppressClick = true;
    setTimeout(() => (this.suppressClick = false), 50);
    // Remember where everything is on screen right now, then commit the new order.
    const before = new Map(this.live.map((x) => [x.w.id, { x: x.el.getBoundingClientRect().left, t: x === d.l ? " scale(1.04)" : "" }]));
    const id = d.l.w.id;
    this.animateReorder(() => {
      this.live.forEach((x) => {
        x.el.getAnimations().forEach((a) => a.cancel());
        x.el.style.transform = "";
        x.el.style.transformOrigin = "";
        x.el.classList.remove("dragging");
      });
      if (d.to === d.from) return;
      settings.update((s) => {
        const order = s.order.filter((o) => o !== id);
        const visible = this.live.map((x) => x.w.id).filter((o) => o !== id);
        // Insert after the card it landed behind (or first).
        const after = d.to > 0 ? visible[d.to - 1] : null;
        order.splice(after ? order.indexOf(after) + 1 : 0, 0, id);
        s.order = order;
      });
    }, before, id);
  }

  // ---------------------------------------------------------------- menu and panel
  private onContextMenu(e: MouseEvent) {
    e.preventDefault();
    const card = (e.target as HTMLElement).closest<HTMLElement>(".card[data-id]");
    if ((e.target as HTMLElement).closest(".menu, .panel")) return;
    if (card) this.openMenu(card);
    else if ((e.target as HTMLElement).closest(".dock")) this.openPanel();
  }

  private menuFor: string | null = null; // widget id of the open menu, or "panel"

  private openMenu(card: HTMLElement) {
    this.closeOverlay(); // also releases an open widget panel properly
    this.menuFor = card.dataset.id!;
    this.showOverlay(this.menuHtml(this.menuFor), card.getBoundingClientRect());
  }

  private autostartOn = false;

  private openPanel() {
    if (canAutostart) void autostartEnabled().then((on) => {
      if (on !== this.autostartOn && this.menuFor === "panel") { this.autostartOn = on; this.openPanel(); }
      this.autostartOn = on;
    });
    if (this.menuFor !== "panel") this.closeOverlay();
    this.menuFor = "panel";
    const r = this.dock.getBoundingClientRect();
    this.showOverlay(this.panelHtml(), new DOMRect(r.left + r.width / 2 - 1, r.top, 2, r.height));
  }

  private menuHtml(id: string): string {
    const w = byId(id)!;
    const s = settings.get();
    const theme = s.themes[id] ?? "auto";
    const idx = s.order.indexOf(id);
    const seg = (v: CardTheme, label: string) =>
      `<button class="seg${theme === v ? " on" : ""}" aria-pressed="${theme === v}" data-theme="${v}">${label}</button>`;
    return `<div class="menu ${s.dockTheme}" role="menu">
      <div class="mtitle">${esc(w.name)} · Appearance</div>
      <div class="segs">${seg("auto", "Auto")}${seg("light", "Light")}${seg("dark", "Dark")}</div>
      <div class="sep"></div>
      <button class="mi" data-do="left" ${idx <= 0 ? "disabled" : ""}>Move left</button>
      <button class="mi" data-do="right" ${idx >= s.order.length - 1 ? "disabled" : ""}>Move right</button>
      <button class="mi" data-do="hide">Hide widget</button>
      <div class="sep"></div>
      <button class="mi" data-do="edit">Edit widgets…</button>
    </div>`;
  }

  private panelHtml(): string {
    const s = settings.get();
    const rows = WIDGETS.map((w) => {
      const on = s.order.includes(w.id);
      return `<div class="prow">
        <span class="pname" ${w.accent ? `style="color:var(--${w.accent})"` : ""}>${icon(w.icon)}<span>${esc(w.name)}</span></span>
        ${w.sample ? `<span class="pill">Sample</span>` : ""}
        <button class="switch${on ? " on" : ""}" role="switch" aria-checked="${on}" aria-label="Show ${esc(w.name)}" data-toggle="${w.id}"><span></span></button>
      </div>`;
    }).join("");
    const seg = (key: string, v: string, label: string, cur: string) =>
      `<button class="seg${cur === v ? " on" : ""}" aria-pressed="${cur === v}" data-${key}="${v}">${label}</button>`;
    return `<div class="panel ${s.dockTheme}" role="dialog" aria-label="Edit widgets">
      <div class="mtitle">Widgets</div>${rows}
      <div class="sep"></div>
      <div class="mtitle">Dock</div>
      <div class="segs">${seg("dock", "dark", "Dark", s.dockTheme)}${seg("dock", "light", "Light", s.dockTheme)}</div>
      <div class="segs">${seg("tint", "wallpaper", "Match wallpaper", s.tint)}${seg("tint", "neutral", "Neutral", s.tint)}</div>
      ${canAutostart ? `<div class="prow"><span class="pname"><span>Start with Windows</span></span>
        <button class="switch${this.autostartOn ? " on" : ""}" role="switch" aria-checked="${this.autostartOn}" aria-label="Start with Windows" data-autostart><span></span></button></div>` : ""}
    </div>`;
  }

  /** One click handler for whichever menu or panel is open. */
  private onOverlayClick(ev: MouseEvent) {
    const t = ev.target as HTMLElement;
    const id = this.menuFor;
    if (!id || id.startsWith("xpanel:")) return; // panels handle their own clicks
    const get = (k: string) => t.closest<HTMLElement>(`[data-${k}]`)?.getAttribute(`data-${k}`) ?? null;
    if (id === "panel") {
      const tog = get("toggle"), dock = get("dock"), tint = get("tint");
      if (tog) settings.update((x) => {
        x.order = x.order.includes(tog) ? x.order.filter((o) => o !== tog) : [...x.order, tog];
      });
      if (dock) settings.update((x) => { x.dockTheme = dock as Settings["dockTheme"]; });
      if (tint) settings.update((x) => { x.tint = tint as Settings["tint"]; });
      if (t.closest("[data-autostart]")) {
        const on = !this.autostartOn;
        void setAutostart(on).then(() => { this.autostartOn = on; if (this.menuFor === "panel") this.openPanel(); });
        return;
      }
      if (tog || dock || tint) this.openPanel(); // redraw in place
      return;
    }
    const theme = get("theme"), act = get("do");
    if (theme) settings.update((x) => { x.themes[id] = theme as CardTheme; });
    else if (act === "left" || act === "right") this.animateReorder(() => settings.update((x) => {
      const i = x.order.indexOf(id), j = act === "left" ? i - 1 : i + 1;
      [x.order[i], x.order[j]] = [x.order[j], x.order[i]];
    }), undefined, id);
    else if (act === "hide") settings.update((x) => { x.order = x.order.filter((o) => o !== id); });
    else if (act === "edit") return this.openPanel();
    if (theme || act) this.closeOverlay();
  }

  private showOverlay(content: string | HTMLElement, anchor: DOMRect): HTMLElement {
    this.overlayRO?.disconnect();
    if (typeof content === "string") this.overlay.innerHTML = content;
    else this.overlay.replaceChildren(content);
    const el = this.overlay.firstElementChild as HTMLElement;
    const place = () => {
      const w = el.offsetWidth;
      const dr = this.dock.getBoundingClientRect();
      const centre = dr.left + dr.width / 2;
      let x = anchor.left + anchor.width / 2 - w / 2;
      x = w <= dr.width ? Math.max(dr.left, Math.min(x, dr.right - w)) : centre - w / 2;
      // Relative to the centre, so it stays put when the window is resized.
      el.style.left = `calc(50% + ${Math.round(x - centre)}px)`;
      el.style.top = `${Math.round(dr.bottom + 8)}px`;
    };
    place();
    this.overlayRO = new ResizeObserver(() => {
      this.extraH = el.offsetHeight + 16;
      this.extraW = el.offsetWidth;
      this.layout();
    });
    this.overlayRO.observe(el);
    return el;
  }

  private closeOverlay() {
    if (!this.overlay || !this.overlay.firstElementChild) return;
    const wasPanel = this.menuFor?.startsWith("xpanel:");
    this.overlayRO?.disconnect();
    this.overlayRO = null;
    if (this.panelCleanup) {
      try { this.panelCleanup(); } catch { /* ignore */ }
      this.panelCleanup = null;
    }
    this.overlay.innerHTML = "";
    this.live.forEach((l) => l.el.classList.remove("active"));
    this.menuFor = null;
    this.panelKeepOpen = false;
    this.extraH = 0;
    this.extraW = 0;
    if (wasPanel) void panelFocus(false);
    void setHold(false);
    this.layout();
  }

  get isOpen() {
    return this.open;
  }
}
