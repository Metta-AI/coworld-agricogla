import express, { Express } from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { GameRunner } from "./game-runner";
import { redactState } from "./redact";

export function createApp(runner: GameRunner, distDir: string): Express {
  const app = express();

  app.get("/health", (_req, res) => {
    res.type("text/plain").send("ok");
  });

  app.get("/state.json", (req, res) => {
    const playerIdx = req.query.player !== undefined ? Number(req.query.player) : null;
    res.json({ ...redactState(runner.state, playerIdx), status: runner.status() });
  });

  if (existsSync(distDir)) {
    app.use(express.static(distDir));
    // SPA fallback for client routes.
    for (const route of ["/", "/player/:idx", "/score"]) {
      app.get(route, (_req, res) => {
        res.sendFile(join(distDir, "index.html"));
      });
    }
  }

  return app;
}
