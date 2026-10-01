import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    tanstackStart({
      server: { entry: "server" },
    }),
    viteReact(),
  ],
  resolve: {
    tsconfigPaths: true,
    alias: {
      "@": "/src",
    },
  },
  build: {
    modulePreload: false,
  },
  // MapLibre's web worker dynamically imports maplibre-gl-shared.mjs at runtime.
  // Vite emits it as a separate chunk but the worker can't resolve it (404).
  // Setting inlineDynamicImports: true bundles everything into a single worker file.
  worker: {
    format: "es",
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:8000",
    }
  }
});
