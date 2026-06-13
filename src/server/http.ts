import express, { Express } from "express";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
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

  // Per-deploy identity, written by scripts/deploy-prod.sh into the app root.
  // The deploy script polls this for the deployId to prove a rollout end-to-end.
  app.get("/version", (_req, res) => {
    const versionFile = join(dirname(distDir), ".deploy-version.json");
    if (existsSync(versionFile)) {
      res.type("application/json").send(readFileSync(versionFile, "utf8"));
    } else {
      res.json({ deployId: "dev" });
    }
  });

  app.get("/state.json", (req, res) => {
    const playerIdx =
      !opts.spectatorOnly && req.query.player !== undefined ? Number(req.query.player) : null;
    res.json({
      ...redactState(runner.state, playerIdx, { maskFuture: opts.spectatorOnly }),
      status: runner.status(),
    });
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
