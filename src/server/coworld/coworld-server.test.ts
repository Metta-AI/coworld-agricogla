import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { WebSocket } from "ws";
import { describe, expect, it } from "vitest";
import { decideReply } from "../../agents/coworld-player";
import {
  CoworldResults,
  CoworldServerMessage,
  ReplayPayload,
} from "../../shared/coworld-protocol";
import { startCoworldGame, startReplayServer } from "./coworld-server";

function workspace(config: object): {
  dir: string;
  configUri: string;
  resultsUri: string;
  saveReplayUri: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "agricola-coworld-"));
  writeFileSync(join(dir, "config.json"), JSON.stringify(config));
  return {
    dir,
    configUri: `file://${dir}/config.json`,
    resultsUri: `file://${dir}/results.json`,
    saveReplayUri: `file://${dir}/replay`,
  };
}

/** Minimal in-test policy: the bundled scripted player loop. */
function runScriptedPlayer(url: string): Promise<CoworldResults> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as CoworldServerMessage;
      if (message.type === "observation") {
        socket.send(JSON.stringify(decideReply(message)));
      } else if (message.type === "final") {
        resolve(message.results);
        socket.close();
      }
    });
    socket.on("error", reject);
  });
}

const BASE_CONFIG = {
  players: [{ name: "Scripted A" }, { name: "Scripted B" }],
  seed: 5,
  pace_ms: 0,
  act_timeout_seconds: 5,
  player_connect_timeout_seconds: 60,
};

describe("coworld game server", () => {
  it("plays a full remote episode and writes results + replay artifacts", async () => {
    const ws = workspace({ ...BASE_CONFIG, tokens: ["tok0", "tok1"] });
    const handle = await startCoworldGame({
      host: "127.0.0.1",
      port: 0,
      distDir: join(import.meta.dirname, "no-dist"),
      ...ws,
    });

    const playerResults = await Promise.all([
      runScriptedPlayer(`ws://127.0.0.1:${handle.port}/player?slot=0&token=tok0`),
      runScriptedPlayer(`ws://127.0.0.1:${handle.port}/player?slot=1&token=tok1`),
    ]);
    const results = await handle.finished;

    expect(playerResults[0]).toEqual(results);
    expect(results.scores).toHaveLength(2);
    expect(results.rounds).toBe(14);
    expect([-1, 0, 1]).toContain(results.winner);

    const written = JSON.parse(readFileSync(join(ws.dir, "results.json")).toString());
    expect(written).toEqual(results);

    const replay = JSON.parse(readFileSync(join(ws.dir, "replay")).toString()) as ReplayPayload;
    expect(replay.seed).toBe(5);
    expect(replay.numPlayers).toBe(2);
    expect(replay.playerNames).toEqual(["Scripted A", "Scripted B"]);
    expect(replay.actions.length).toBeGreaterThan(50);
    expect(replay.results).toEqual(results);
    // Tokens must never leak into the public replay artifact.
    expect(JSON.stringify(replay)).not.toContain("tok0");
  }, 30000);

  it("rejects bad player tokens at the handshake", async () => {
    const ws = workspace({ ...BASE_CONFIG, tokens: ["tok0", "tok1"] });
    const handle = await startCoworldGame({
      host: "127.0.0.1",
      port: 0,
      distDir: join(import.meta.dirname, "no-dist"),
      ...ws,
    });

    const rejected = await new Promise<boolean>((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${handle.port}/player?slot=0&token=bad`);
      socket.on("open", () => resolve(false));
      socket.on("error", () => resolve(true));
    });
    expect(rejected).toBe(true);

    const health = await fetch(`http://127.0.0.1:${handle.port}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });

    await handle.close();
  });

  it("falls back to scripted play for slots that never connect", async () => {
    const ws = workspace({
      ...BASE_CONFIG,
      tokens: ["tok0", "tok1"],
      player_connect_timeout_seconds: 0.2,
    });
    const handle = await startCoworldGame({
      host: "127.0.0.1",
      port: 0,
      distDir: join(import.meta.dirname, "no-dist"),
      ...ws,
    });
    // Nobody connects: the connect timeout starts the game and every
    // decision takes the scripted fallback, so the episode still ends.
    const results = await handle.finished;
    expect(results.scores).toHaveLength(2);
    expect(results.rounds).toBe(14);
  }, 30000);
});

describe("coworld replay server", () => {
  it("serves a zlib-compressed replay over /replay", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agricola-replay-"));
    const payload: ReplayPayload = {
      game: "agricola",
      seed: 5,
      numPlayers: 2,
      playerNames: ["A", "B"],
      actions: [],
      results: { scores: [10, 20], winner: 1, rounds: 14 },
    };
    writeFileSync(join(dir, "replay.json.z"), deflateSync(JSON.stringify(payload)));

    const handle = await startReplayServer({
      host: "127.0.0.1",
      port: 0,
      distDir: join(import.meta.dirname, "no-dist"),
      loadReplayUri: `file://${dir}/replay.json.z`,
    });

    const health = await fetch(`http://127.0.0.1:${handle.port}/healthz`);
    expect(health.status).toBe(200);

    const received = await new Promise<{ type: string; payload: ReplayPayload }>(
      (resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${handle.port}/replay`);
        socket.on("message", (raw) => {
          resolve(JSON.parse(raw.toString()));
          socket.close();
        });
        socket.on("error", reject);
      },
    );
    expect(received.type).toBe("replay");
    expect(received.payload).toEqual(payload);

    await handle.close();
  });
});
