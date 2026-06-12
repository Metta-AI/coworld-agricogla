import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist" },
  server: {
    proxy: {
      "/ws": { target: "ws://localhost:8484", ws: true },
      "/state.json": "http://localhost:8484",
      "/health": "http://localhost:8484",
    },
  },
});
