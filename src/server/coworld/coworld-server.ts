import { randomInt } from "node:crypto";
import { createServer, IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import express from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { GameRunner } from "../game-runner";
import { createApp } from "../http";
import { redactState } from "../redact";
import { SocketHub } from "../websocket";
import { artifactMethod, decodeReplayBytes, readData, writeData } from "./io";
import { RemoteAgent } from "./remote-agent";
import {
  CoworldConfig,
  CoworldResults,
  coworldConfigSchema,
  ReplayAction,
  ReplayPayload,
} from "../../shared/coworld-protocol";
import { GameState } from "../../shared/engine/types";

export interface CoworldGameOpts {
  host: string;
  port: number;
  distDir: string;
  configUri: string;
  resultsUri: string;
  saveReplayUri: string;
}

export interface CoworldGameHandle {
  server: Server;
  port: number;
  runner: GameRunner;
  config: CoworldConfig;
  seed: number;
  /** Resolves once results and replay artifacts are written. */
  finished: Promise<CoworldResults>;
  close(): Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function computeResults(state: GameState): CoworldResults {
  if (!state.scores) throw new Error("game is not finished");
  const scores = state.players.map(
    (p) => state.scores!.find((s) => s.playerIdx === p.idx)!.total,
  );
  const best = Math.max(...scores);
  const leaders = scores.filter((s) => s === best).length;
  return {
    scores,
    winner: leaders === 1 ? scores.indexOf(best) : -1,
    rounds: state.round,
  };
}

/** Rollout mode: run one tournament episode against remote player policies
 *  and write the results + replay artifacts when the game ends. */
export async function startCoworldGame(opts: CoworldGameOpts): Promise<CoworldGameHandle> {
  const config = coworldConfigSchema.parse(
    JSON.parse((await readData(opts.configUri)).toString()),
  );
  const numPlayers = config.tokens.length;
  const playerNames = config.players.map((p) => p.name);
  const seed = config.seed ?? randomInt(2 ** 31);
  const actions: ReplayAction[] = [];
  const agents = config.tokens.map(
    (_, slot) => new RemoteAgent(slot, config.act_timeout_seconds * 1000),
  );

  let resolveFinished!: (results: CoworldResults) => void;
  let rejectFinished!: (err: unknown) => void;
  const finished = new Promise<CoworldResults>((resolve, reject) => {
    resolveFinished = resolve;
    rejectFinished = reject;
  });

  const runner = new GameRunner({
    seed,
    numPlayers,
    names: playerNames,
    controllers: Array(numPlayers).fill("remote"),
    agents,
    paceMs: config.pace_ms,
    startPaused: true,
    onUpdate: () => {
      hub.broadcastState();
      void finish();
    },
    onAction: (action) => actions.push(action as ReplayAction),
    onError: (err) => console.error("[remote]", err),
  });
  const hub = new SocketHub(runner, { readOnly: true, seatTokens: config.tokens });
  const app = createApp(runner, opts.distDir, { spectatorOnly: true });
  const server = createServer(app);
  const playerWss = new WebSocketServer({ noServer: true });

  let started = false;
  const startGame = () => {
    if (started) return;
    started = true;
    clearTimeout(connectTimer);
    console.log("[coworld] starting game");
    runner.resume();
  };
  const connectTimer = setTimeout(() => {
    console.log("[coworld] player connect timeout reached; starting anyway");
    startGame();
  }, config.player_connect_timeout_seconds * 1000);

  for (const agent of agents) {
    agent.onConnect = () => {
      console.log(`[coworld] player slot ${agent.slot} connected`);
      if (agents.every((a) => a.connected)) startGame();
    };
  }

  const playerUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const slot = Number(url.searchParams.get("slot"));
    const token = url.searchParams.get("token");
    if (!Number.isInteger(slot) || slot < 0 || slot >= numPlayers || config.tokens[slot] !== token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    playerWss.handleUpgrade(req, socket, head, (ws) => {
      agents[slot]!.attach(ws, { type: "welcome", slot, numPlayers, playerNames });
    });
  };

  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname === "/ws" || pathname === "/global") {
      hub.upgrade(req, socket, head);
    } else if (pathname === "/player") {
      playerUpgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  let finishing = false;
  const finish = async () => {
    if (finishing || runner.state.phase !== "finished") return;
    finishing = true;
    try {
      const results = computeResults(runner.state);
      console.log(`[coworld] game over: scores=${JSON.stringify(results.scores)}`);
      await writeData(opts.resultsUri, JSON.stringify(results), {
        contentType: "application/json",
        method: artifactMethod("COGAME_RESULTS_METHOD"),
      });
      const replay: ReplayPayload = {
        game: "agricola",
        seed,
        numPlayers,
        playerNames,
        actions,
        results,
      };
      await writeData(opts.saveReplayUri, JSON.stringify(replay), {
        contentType: "application/json",
        method: artifactMethod("COGAME_SAVE_REPLAY_METHOD"),
      });
      for (const agent of agents) {
        agent.send({
          type: "final",
          results,
          state: redactState(runner.state, agent.slot).state,
        });
      }
      await sleep(500);
      for (const agent of agents) agent.closeSocket();
      hub.closeAll();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      resolveFinished(results);
    } catch (err) {
      rejectFinished(err);
    }
  };

  await new Promise<void>((resolve) => server.listen(opts.port, opts.host, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : opts.port;
  console.log(`[coworld] agricola game server on ${opts.host}:${port} (${numPlayers} players)`);

  return {
    server,
    port,
    runner,
    config,
    seed,
    finished,
    close: async () => {
      clearTimeout(connectTimer);
      for (const agent of agents) agent.closeSocket();
      hub.closeAll();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export interface ReplayServerOpts {
  host: string;
  port: number;
  distDir: string;
  loadReplayUri: string;
}

export interface ReplayServerHandle {
  server: Server;
  port: number;
  close(): Promise<void>;
}

/** Replay mode: serve the recorded episode through the browser replay
 *  viewer (/client/replay) and the /replay WebSocket. */
export async function startReplayServer(opts: ReplayServerOpts): Promise<ReplayServerHandle> {
  const payload = decodeReplayBytes(await readData(opts.loadReplayUri));

  const app = express();
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });
  if (existsSync(opts.distDir)) {
    app.use(express.static(opts.distDir));
    for (const route of ["/", "/client/replay", "/client/global"]) {
      app.get(route, (_req, res) => {
        res.sendFile(join(opts.distDir, "index.html"));
      });
    }
  }

  const server = createServer(app);
  const replayWss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname !== "/replay") {
      socket.destroy();
      return;
    }
    replayWss.handleUpgrade(req, socket, head, (ws) => {
      ws.send(JSON.stringify({ type: "replay", payload }));
    });
  });

  await new Promise<void>((resolve) => server.listen(opts.port, opts.host, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : opts.port;
  console.log(`[coworld] agricola replay server on ${opts.host}:${port}`);

  return {
    server,
    port,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
