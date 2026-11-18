import "@fontsource-variable/inter";
import "./styles.css";
import { Dock } from "./dock";
import { MonitorInfo, on } from "./native";

const dock = new Dock(document.getElementById("app")!);

// The Rust side watches the pointer and tells the page when to open or close.
on<MonitorInfo>("dock:show", (m) => dock.show(m));
on<null>("dock:hide", () => dock.hide());
on<null>("wallpaper:changed", () => void dock.loadWallpaper());

void dock.init();
