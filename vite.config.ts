import { defineConfig } from "vite";

// Tauri expects a fixed dev-server port.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Don't watch the Rust side: its build folder has files that are locked
    // while compiling, which crashes the watcher on Windows.
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "es2022",
    // Two pages: the dock, and the small "lip" window at the top of the screen.
    rollupOptions: { input: { main: "index.html", lip: "lip.html" } },
  },
});
