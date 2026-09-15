import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The console builds into `public/`, which `vercel.json` already serves as the output directory. That
 * keeps the deployment shape unchanged: the same project serves the static console and the `api/*`
 * functions, and nothing about routing or function config moves.
 *
 * `emptyOutDir` is deliberate — Vite owns `public/` now, so the hand-written `index.html`, `app.js`
 * and `style.css` that used to live there are replaced rather than merged with.
 */
export default defineConfig({
  root: "console",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../public",
    emptyOutDir: true,
    // The console is a single page over an API that already returns structured data, so there is no
    // route table to split on and no benefit to shipping a runtime router.
    target: "es2022",
  },
});
