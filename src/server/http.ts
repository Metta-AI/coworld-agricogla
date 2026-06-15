import express, { Express } from "express";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { GameRunner } from "./game-runner";
import { redactState } from "./redact";
import { RuleError } from "../shared/engine/apply";

export interface CreateAppOpts {
  /** Tournament mode: /state.json never reveals a hand (hands are only
   *  visible over /ws with a valid seat token). */
  spectatorOnly?: boolean;
  /** Discord Activity mode: allow Discord to frame the app (CSP frame-ancestors).
   *  Mount the Discord routes separately via mountDiscord. */
  discordEnabled?: boolean;
}

export function createApp(runner: GameRunner, distDir: string, opts: CreateAppOpts = {}): Express {
  const app = express();
  // Stash the raw body so the Discord interactions webhook can verify Discord's
  // Ed25519 signature against the exact bytes (the parsed object is not enough).
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf.toString("utf8"); } }));

  // Discord serves the Activity inside an iframe on *.discordsays.com; allow it
  // to frame us. Harmless when standalone, but only emitted in Discord mode.
  if (opts.discordEnabled) {
    app.use((_req, res, next) => {
      res.setHeader(
        "Content-Security-Policy",
        "frame-ancestors https://discord.com https://*.discord.com https://*.discordsays.com",
      );
      next();
    });
  }

  app.get("/health", (_req, res) => {
    res.type("text/plain").send("ok");
  });

  // Coworld game contract health probe.
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  // Lobby: a human claims a seat by name. Refused when full / already started.
  app.post("/api/join", (req, res) => {
    if (opts.spectatorOnly) {
      res.status(403).json({ error: "this table is read-only" });
      return;
    }
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name) {
      res.status(400).json({ error: "name required" });
      return;
    }
    try {
      const playerIdx = runner.seat(name, "human");
      res.json({ playerIdx });
    } catch (err) {
      res.status(409).json({ error: err instanceof RuleError ? err.message : "could not join" });
    }
  });

  // Lightweight lobby status for the standalone /join page.
  app.get("/api/status", (_req, res) => {
    const s = runner.status();
    res.json({ started: s.started, players: s.roster.length, maxPlayers: s.maxPlayers });
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
    const state = runner.state;
    if (!state) {
      res.json({ state: null, handSizes: [], status: runner.status() });
      return;
    }
    const playerIdx =
      !opts.spectatorOnly && req.query.player !== undefined ? Number(req.query.player) : null;
    res.json({
      ...redactState(state, playerIdx, { maskFuture: opts.spectatorOnly }),
      status: runner.status(),
    });
  });

  if (existsSync(distDir)) {
    app.use(express.static(distDir));
    // SPA fallback for client routes. The /client/* family is the coworld
    // browser-client contract (player seat, live global view, replay).
    for (const route of [
      "/",
      "/join",
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
