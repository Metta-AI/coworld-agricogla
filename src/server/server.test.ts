import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { GameRunner } from "./game-runner";
import { redactState } from "./redact";
import { startServer, ServerHandle } from "./runtime";
import { ServerMessage } from "../shared/protocol";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("redactState", () => {
  it("hides other hands but keeps sizes", () => {
    const runner = new GameRunner({
      seed: 7,
      numPlayers: 2,
      controllers: ["human", "human"],
      paceMs: 0,
    });
    const { state, handSizes } = redactState(runner.state!, 0);
    expect(state.players[0]!.handOccupations).toHaveLength(7);
    expect(state.players[1]!.handOccupations).toHaveLength(0);
    expect(handSizes[1]).toEqual({ occupations: 7, minors: 7 });
    const spectator = redactState(runner.state!, null);
    expect(spectator.state.players[0]!.handOccupations).toHaveLength(0);
  });
});

describe("GameRunner", () => {
  it("autoplays scripted players to completion", async () => {
    const runner = new GameRunner({
      seed: 5,
      numPlayers: 2,
      controllers: ["scripted", "scripted"],
      paceMs: 0,
    });
    await runner.tick();
    expect(runner.state!.phase).toBe("finished");
    expect(runner.status().finished).toBe(true);
  });

  it("waits for human decisions and applies them", async () => {
    const runner = new GameRunner({
      seed: 5,
      numPlayers: 2,
      controllers: ["human", "scripted"],
      paceMs: 0,
    });
    await runner.tick();
    // Runner stops when the human is up.
    expect(runner.pendingPlayer()).not.toBeNull();
    const humanTurns: number[] = [];
    let guard = 0;
    while (runner.state!.phase !== "finished" && guard++ < 200) {
      const pending = runner.pendingPlayer();
      if (pending === null) break;
      expect(runner.status().controllers[pending]).toBe("human");
      if (runner.state!.phase === "work") {
        humanTurns.push(runner.state!.round);
        // Human always fishes or takes wood — first available simple space.
        const free = ["fishing", "forest", "clay_pit", "reed_bank", "day_laborer", "grain_seeds"].find(
          (id) => runner.state!.actionSpaces.find((s) => s.id === id)!.occupiedBy === null,
        )!;
        runner.humanPlace(pending, { action: free } as never);
      } else {
        runner.humanFeed(pending, { conversions: [] });
      }
      await runner.tick();
      await sleep(1);
    }
    expect(runner.state!.phase).toBe("finished");
    expect(humanTurns.length).toBeGreaterThan(20);
  });

  it("rejects out-of-turn human actions", async () => {
    const runner = new GameRunner({
      seed: 5,
      numPlayers: 2,
      controllers: ["human", "human"],
      paceMs: 0,
    });
    const current = runner.pendingPlayer()!;
    const other = (current + 1) % 2;
    expect(() => runner.humanPlace(other, { action: "fishing" } as never)).toThrow(/turn/);
  });

  it("reset mid-game restarts the autopilot loop", async () => {
    const runner = new GameRunner({
      seed: 5,
      numPlayers: 2,
      controllers: ["scripted", "scripted"],
      paceMs: 5,
    });
    void runner.tick();
    await sleep(40); // mid-game
    expect(runner.state!.phase).not.toBe("finished");
    runner.reset(99);
    expect(runner.state!.seed).toBe(99);
    for (let i = 0; i < 2000 && runner.state!.phase !== "finished"; i++) await sleep(10);
    expect(runner.state!.phase).toBe("finished");
  });

  it("new game (toLobby) returns to the lobby with the roster intact", async () => {
    const runner = new GameRunner({
      seed: 5,
      numPlayers: 2,
      controllers: ["scripted", "scripted"],
      paceMs: 5,
    });
    void runner.tick();
    await sleep(40); // mid-game
    expect(runner.status().started).toBe(true);

    runner.toLobby();
    const status = runner.status();
    expect(status.started).toBe(false);
    expect(status.phase).toBe("lobby");
    expect(status.roster.map((r) => r.controller)).toEqual(["scripted", "scripted"]);

    // Bots stay idle in the lobby (paused) — no rounds advance.
    const round = runner.state!.round;
    await sleep(40);
    expect(runner.state!.round).toBe(round);
  });

  it("controller can be switched to autopilot mid-game", async () => {
    const runner = new GameRunner({
      seed: 5,
      numPlayers: 2,
      controllers: ["human", "scripted"],
      paceMs: 0,
    });
    await runner.tick();
    expect(runner.state!.phase).not.toBe("finished");
    runner.setController(0, "scripted");
    await sleep(50);
    await runner.tick();
    // Give chained ticks a moment to drain.
    for (let i = 0; i < 100 && runner.state!.phase !== "finished"; i++) await sleep(10);
    expect(runner.state!.phase).toBe("finished");
  });
});

describe("server + websocket", () => {
  let handle: ServerHandle | null = null;
  afterEach(async () => {
    await handle?.close();
    handle = null;
  });

  it("serves health and state, streams snapshots over ws", async () => {
    handle = await startServer({
      port: 0,
      seed: 6,
      numPlayers: 2,
      controllers: ["human", "human"],
      paceMs: 0,
      distDir: "/nonexistent",
    });
    const base = `http://localhost:${handle.port}`;
    const health = await fetch(`${base}/health`);
    expect(await health.text()).toBe("ok");
    const stateRes = await fetch(`${base}/state.json`);
    const body = (await stateRes.json()) as { state: { round: number } };
    expect(body.state.round).toBe(1);

    const ws = new WebSocket(`ws://localhost:${handle.port}/ws`);
    const messages: ServerMessage[] = [];
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve) => ws.on("open", resolve));
    await sleep(100);
    const snapshot = messages.find((m) => m.type === "state");
    expect(snapshot).toBeTruthy();
    if (snapshot?.type === "state") {
      // Spectator sees no hands.
      expect(snapshot.state!.players[0]!.handOccupations).toHaveLength(0);
    }

    // Seat as player 0 and act.
    ws.send(JSON.stringify({ type: "hello", playerIdx: 0 }));
    await sleep(100);
    const seated = [...messages].reverse().find((m) => m.type === "state");
    if (seated?.type === "state") {
      expect(seated.state!.players[0]!.handOccupations.length).toBe(7);
    }

    const current = handle.runner.pendingPlayer()!;
    if (current === 0) {
      ws.send(
        JSON.stringify({ type: "place", playerIdx: 0, placement: { action: "fishing" } }),
      );
      await sleep(150);
      expect(handle.runner.state!.actionSpaces.find((s) => s.id === "fishing")!.occupiedBy).toBe(0);
    }

    // Illegal action gets an error back.
    ws.send(
      JSON.stringify({ type: "place", playerIdx: 1, placement: { action: "fishing" } }),
    );
    await sleep(100);
    expect(messages.some((m) => m.type === "error")).toBe(true);
    ws.close();
  });

  it("setController over ws flips a player to autopilot", async () => {
    handle = await startServer({
      port: 0,
      seed: 8,
      numPlayers: 2,
      controllers: ["human", "scripted"],
      paceMs: 0,
      distDir: "/nonexistent",
    });
    const ws = new WebSocket(`ws://localhost:${handle.port}/ws`);
    await new Promise<void>((resolve) => ws.on("open", resolve));
    ws.send(JSON.stringify({ type: "setController", playerIdx: 0, controller: "scripted" }));
    for (let i = 0; i < 200 && handle.runner.state!.phase !== "finished"; i++) await sleep(10);
    expect(handle.runner.state!.phase).toBe("finished");
    ws.close();
  });
});
