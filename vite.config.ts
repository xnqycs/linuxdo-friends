import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const isWatchMode = process.argv.includes("--watch") || process.argv.includes("-w");

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: !isWatchMode,
    sourcemap: true,
    rollupOptions: {
      input: {
        sidePanel: resolve(__dirname, "src/side-panel/index.html"),
        options: resolve(__dirname, "src/options/index.html"),
        serviceWorker: resolve(__dirname, "src/background/serviceWorker.ts")
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === "serviceWorker") return "service-worker.js";
          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
