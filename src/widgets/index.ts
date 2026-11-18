// THE WIDGET REGISTRY
//
// To add a widget:
//   1. Create a file in this folder that exports `defineWidget({...})`
//      (copy clocks.ts or hardware.ts as a starting point).
//   2. Import it below and add it to WIDGETS.
// It then appears in the dock's "Edit widgets" panel, where it can be switched
// on or off. New widgets start switched off, so nothing appears unannounced.
import type { Widget } from "./types";
import claude from "./claude";
import clocks from "./clocks";
import weather from "./weather";
import { cpu, ram, gpu } from "./hardware";
import system from "./system";
import media from "./media";
import calendar from "./calendar";
import tasks from "./tasks";
import notes from "./notes";
import github from "./github";
import recycle from "./recycle";

export const WIDGETS: Widget<any>[] = [claude, clocks, weather, cpu, ram, gpu, system, media, calendar, tasks, notes, github, recycle];

/**
 * First-run arrangement, symmetric around the media card:
 * left  = Claude, clocks, weather, CPU + RAM (two small tiles = one standard)
 * right = calendar, tasks, notes, GitHub. GPU, System and Recycle Bin start switched off.
 */
export const DEFAULT_ORDER = ["claude", "clocks", "weather", "cpu", "ram", "media", "calendar", "tasks", "notes", "github"];

export const byId = (id: string) => WIDGETS.find((w) => w.id === id);
