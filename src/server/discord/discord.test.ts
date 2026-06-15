import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { GameRunner } from "../game-runner";
import { loadDiscordConfig } from "./config";
import { exchangeCode, fetchUser, displayName, DiscordUser } from "./oauth";
import { COMMAND_NAME, handleInteraction, InteractionCallbackType } from "./interactions";
import { DiscordSeats } from "./seats";
import { verifyInteractionSignature } from "./verify";

const CONFIG = { clientId: "123", clientSecret: "secret", publicKey: "ab".repeat(32) };

// ---------------------------------------------------------------- config

describe("loadDiscordConfig", () => {
  it("returns null when nothing is configured", () => {
    expect(loadDiscordConfig({})).toBeNull();
  });

  it("parses a complete environment", () => {
    const cfg = loadDiscordConfig({
      DISCORD_CLIENT_ID: "123",
      DISCORD_CLIENT_SECRET: "secret",
      DISCORD_PUBLIC_KEY: "ab".repeat(32),
    });
    expect(cfg).toEqual(CONFIG);
  });

  it("throws when partially configured (loud failure, not silent disable)", () => {
    expect(() => loadDiscordConfig({ DISCORD_CLIENT_ID: "123" })).toThrow();
  });

  it("rejects a malformed public key", () => {
    expect(() =>
      loadDiscordConfig({
        DISCORD_CLIENT_ID: "1",
        DISCORD_CLIENT_SECRET: "s",
        DISCORD_PUBLIC_KEY: "nothex",
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------- verify

describe("verifyInteractionSignature", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ type: "spki", format: "der" });
  const pubHex = Buffer.from(spki.subarray(spki.length - 32)).toString("hex");
  const ts = "1700000000";
  const body = JSON.stringify({ type: 1 });
  const goodSig = sign(null, Buffer.from(ts + body), privateKey).toString("hex");

  it("accepts a valid signature", () => {
    expect(verifyInteractionSignature(pubHex, goodSig, ts, body)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifyInteractionSignature(pubHex, goodSig, ts, body + " ")).toBe(false);
  });

  it("rejects a tampered timestamp", () => {
    expect(verifyInteractionSignature(pubHex, goodSig, "1700000001", body)).toBe(false);
  });

  it("rejects missing signature or timestamp", () => {
    expect(verifyInteractionSignature(pubHex, undefined, ts, body)).toBe(false);
    expect(verifyInteractionSignature(pubHex, goodSig, undefined, body)).toBe(false);
  });

  it("rejects non-hex / wrong-length signatures without throwing", () => {
    expect(verifyInteractionSignature(pubHex, "zz", ts, body)).toBe(false);
    expect(verifyInteractionSignature(pubHex, "abcd", ts, body)).toBe(false);
  });
});

// ---------------------------------------------------------------- interactions

describe("handleInteraction", () => {
  it("answers PING with PONG", () => {
    expect(handleInteraction({ type: 1 })).toEqual({ type: InteractionCallbackType.PONG });
  });

  it("launches the Activity for the /agricola command", () => {
    expect(handleInteraction({ type: 2, data: { name: COMMAND_NAME } })).toEqual({
      type: InteractionCallbackType.LAUNCH_ACTIVITY,
    });
  });

  it("replies with help for an unknown command", () => {
    const res = handleInteraction({ type: 2, data: { name: "nope" } });
    expect(res.type).toBe(InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE);
  });
});

// ---------------------------------------------------------------- oauth

describe("oauth", () => {
  const ok = (data: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(data), { status: 200 }));

  it("exchanges a code for an access token", async () => {
    const fetchImpl = ok({ access_token: "tok", token_type: "Bearer", expires_in: 3600, scope: "identify" });
    await expect(exchangeCode(CONFIG, "code", fetchImpl as never)).resolves.toBe("tok");
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String((init as RequestInit).body)).toContain("client_secret=secret");
  });

  it("throws when the token exchange fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad", { status: 400 }));
    await expect(exchangeCode(CONFIG, "code", fetchImpl as never)).rejects.toThrow();
  });

  it("resolves the user behind a token", async () => {
    const fetchImpl = ok({ id: "u1", username: "alice", global_name: "Alice" });
    await expect(fetchUser("tok", fetchImpl as never)).resolves.toMatchObject({ id: "u1" });
  });

  it("prefers the global display name", () => {
    expect(displayName({ id: "1", username: "alice", global_name: "Alice A" } as DiscordUser)).toBe("Alice A");
    expect(displayName({ id: "1", username: "alice" } as DiscordUser)).toBe("alice");
  });
});

// ---------------------------------------------------------------- seats (registry)

/** Minimal runner stub: records calls and hands back increasing seat indices. */
function fakeRunner() {
  let next = 0;
  return {
    seat: vi.fn(() => next++),
    fillWithBots: vi.fn(),
    resume: vi.fn(),
    clearSeats: vi.fn(),
  };
}

const USER = (id: string, name = id): DiscordUser => ({ id, username: name });

describe("DiscordSeats", () => {
  it("claims a seat and mints a token", () => {
    const runner = fakeRunner();
    const seats = new DiscordSeats(runner as never);
    const grant = seats.claim(USER("u1", "Alice"));
    expect(grant.playerIdx).toBe(0);
    expect(grant.token).toMatch(/^[0-9a-f]{48}$/);
    expect(runner.seat).toHaveBeenCalledWith("Alice", "human");
  });

  it("re-claims the same seat for a returning user", () => {
    const runner = fakeRunner();
    const seats = new DiscordSeats(runner as never);
    const first = seats.claim(USER("u1"));
    const again = seats.claim(USER("u1"));
    expect(again).toEqual(first);
    expect(runner.seat).toHaveBeenCalledTimes(1);
  });

  it("locks a claimed seat to its token but leaves unclaimed seats open", () => {
    const seats = new DiscordSeats(fakeRunner() as never);
    const grant = seats.claim(USER("u1"));
    // The claimed seat requires its minted token.
    expect(seats.validate(grant.playerIdx, grant.token)).toBe(true);
    expect(seats.validate(grant.playerIdx, "wrong")).toBe(false);
    expect(seats.validate(grant.playerIdx, undefined)).toBe(false);
    // An unclaimed seat (bot/empty) stays open to direct standalone seating.
    expect(seats.validate(99, undefined)).toBe(true);
    expect(seats.validate(99, grant.token)).toBe(true);
  });

  it("startWithBots fills the table then begins play", () => {
    const runner = fakeRunner();
    new DiscordSeats(runner as never).startWithBots();
    expect(runner.fillWithBots).toHaveBeenCalledOnce();
    expect(runner.resume).toHaveBeenCalledOnce();
  });

  it("reset clears grants and the table", () => {
    const runner = fakeRunner();
    const seats = new DiscordSeats(runner as never);
    const grant = seats.claim(USER("u1"));
    seats.reset();
    expect(runner.clearSeats).toHaveBeenCalledOnce();
    // The old grant no longer binds the seat; it's unclaimed and open again.
    expect(seats.validate(grant.playerIdx, grant.token)).toBe(true);
    expect(seats.validate(grant.playerIdx, undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------- runner lifecycle (real)

describe("GameRunner Discord lifecycle", () => {
  const runner = () =>
    new GameRunner({ seed: 1, numPlayers: 0, controllers: [], paceMs: 0, startPaused: true });

  it("fillWithBots tops an empty table up to the seat cap", () => {
    const r = runner();
    r.seat("Alice", "human");
    r.fillWithBots();
    const roster = r.status().roster;
    expect(roster).toHaveLength(4);
    expect(roster[0]).toMatchObject({ name: "Alice", controller: "human" });
    expect(roster.slice(1).every((s) => s.controller === "llm")).toBe(true);
  });

  it("fillWithBots keeps humans and only fills the remainder", () => {
    const r = runner();
    r.seat("Alice", "human");
    r.seat("Bob", "human");
    r.fillWithBots();
    const controllers = r.status().roster.map((s) => s.controller);
    expect(controllers).toEqual(["human", "human", "llm", "llm"]);
  });

  it("clearSeats returns to an empty lobby", () => {
    const r = runner();
    r.seat("Alice", "human");
    r.fillWithBots();
    r.clearSeats();
    expect(r.status().roster).toHaveLength(0);
    expect(r.state).toBeNull();
  });
});
