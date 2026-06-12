import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // index.html lives with the client code so the repo root holds no static
  // entry point (preview tooling would otherwise serve it as a plain file).
  root: "src/client",
  publicDir: "../../public",
  plugins: [react()],
  build: { outDir: "../../dist", emptyOutDir: true },
  server: {
    proxy: {
      "/ws": { target: "ws://localhost:8484", ws: true },
      "/state.json": "http://localhost:8484",
      "/health": "http://localhost:8484",
    },
  },
});
