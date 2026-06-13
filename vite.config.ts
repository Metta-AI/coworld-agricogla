import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset base: the built index.html references ./assets/* so the
  // bundle resolves against the document's <base href> (set by the inline
  // script in index.html). This lets one build work both at the root locally
  // and behind the Observatory hosted-replay path prefix
  // (.../sessions/<id>/proxy/client/replay).
  base: "./",
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
