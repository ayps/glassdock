// The contract every GlassDock widget follows.
//
// A widget is a plain object. The dock draws the card, the header (icon + title)
// and handles theming, ordering and hiding; the widget only supplies its data
// and the HTML for the area under the header.

/** Apple system colours, available as CSS variables inside every card. */
export type Size = "small" | "standard" | "wide";

export type Accent = "orange" | "red" | "yellow" | "green" | "teal" | "blue" | "purple";

export interface Widget<D = unknown> {
  /** Unique, never changes. Used to save order and settings. */
  id: string;
  /** Shown in the card header and in "Edit widgets". */
  name: string;
  /**
   * Three size classes that line up: small (79 px, two make a standard),
   * standard (168 px) and wide (346 px, two standards). May be a getter.
   */
  size: Size;
  /** Inner SVG markup for a 24×24 line icon (paths only). */
  icon: string;
  /** Colours the header icon and title, the way Apple colours Notes yellow. */
  accent?: Accent;
  /** True while the widget shows sample data instead of a real source. */
  sample?: boolean;
  /** Skip the standard header (the media card fills the whole card). */
  bare?: boolean;
  /** How often to call load() while the dock is open. Default: once per open. */
  everyMs?: number;

  /** Fetch or compute the data. Called when the dock opens and every `everyMs`. */
  load(): D | Promise<D>;
  /** HTML for the card body. Use the helpers in ui.ts. */
  view(data: D): string;
  /** Optional HTML shown at the right end of the header. */
  headerRight?(data: D): string;
  /** Buttons with data-action="name" call this. */
  onAction?(action: string, data: D): void | Promise<void>;
  /**
   * Optional expanded panel, opened by clicking the card. Fill `root` with
   * anything (forms, lists); return a cleanup function if needed.
   */
  panel?(root: HTMLElement, ctx: PanelContext<D>): void | (() => void);
}

export interface PanelContext<D> {
  data: D;
  /** Reload the widget's data (updates the card and ctx.data). */
  reload(): Promise<D>;
  close(): void;
  /** Keep the panel open while the window loses focus (e.g. a browser sign-in). */
  keepOpen(on: boolean): void;
}

/** Helper so each widget file gets type checking for its own data. */
export function defineWidget<D>(w: Widget<D>): Widget<D> {
  return w;
}
