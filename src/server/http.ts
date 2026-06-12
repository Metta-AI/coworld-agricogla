import express, { Express } from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { GameRunner } from "./game-runner";
import { redactState } from "./redact";

export interface CreateAppOpts {
  /** Tournament mode: /state.json never reveals a hand (hands are only
   *  visible over /ws with a valid seat token). */
  spectatorOnly?: boolean;
}

export function createApp(runner: GameRunner, distDir: string, opts: CreateAppOpts = {}): Express {
  const app = express();

  app.get("/health", (_req, res) => {
    res.type("text/plain").send("ok");
  });

  // Coworld game contract health probe.
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/state.json", (req, res) => {
    const playerIdx =
      !opts.spectatorOnly && req.query.player !== undefined ? Number(req.query.player) : null;
    res.json({ ...redactState(runner.state, playerIdx), status: runner.status() });
  });

  if (existsSync(distDir)) {
    app.use(express.static(distDir));
    // SPA fallback for client routes. The /client/* family is the coworld
    // browser-client contract (player seat, live global view, replay).
    for (const route of [
      "/",
      "/player/:idx",
      "/score",
      "/client/player",
      "/client/global",
      "/client/replay",
    ]) {
      app.get(route, (_req, res) => {
        res.sendFile(join(distDir, "index.html"));
      });
    }
  }

  return app;
}
