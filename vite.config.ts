import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// https://vite.dev/config/
// On GitHub Pages the site is served from a subpath (/webcam-filter/), so the
// production build needs a matching base. Dev stays at root.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/webcam-filter/" : "/",
  plugins: [svelte()],
}));
