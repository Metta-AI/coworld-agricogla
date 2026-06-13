import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { ServerHandle, startServer } from "./runtime";
import { ChatMessage, ServerMessage } from "../shared/protocol";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const open = (ws: WebSocket) => new Promise<void>((r) => ws.on("open", () => r()));
const collect = (ws: WebSocket, bucket: ServerMessage[]) =>
  ws.on("message", (raw) => bucket.push(JSON.parse(raw.toString()) as ServerMessage));
const chatTexts = (bucket: ServerMessage[]): string[] =>
  bucket.filter((m): m is { type: "chat"; message: ChatMessage } => m.type === "chat").map((m) => m.message.text);

describe("table talk + guidance over ws", () => {
  let handle: ServerHandle | null = null;
  afterEach(async () => {
    await handle?.close();
    handle = null;
  });

  it("delivers DMs to participants and the global observer, hiding them from other seats", async () => {
    handle = await startServer({
      port: 0,
      seed: 6,
      numPlayers: 4,
      controllers: ["human", "human", "human", "human"],
      paceMs: 0,
      distDir: "/nonexistent",
    });
    const url = `ws://localhost:${handle.port}/ws`;
    const sender = new WebSocket(url);
    const bystander = new WebSocket(url);
    const observer = new WebSocket(url);
    const sMsgs: ServerMessage[] = [];
    const bMsgs: ServerMessage[] = [];
    const oMsgs: ServerMessage[] = [];
    collect(sender, sMsgs);
    collect(bystander, bMsgs);
    collect(observer, oMsgs);
    await Promise.all([open(sender), open(bystander), open(observer)]);
    sender.send(JSON.stringify({ type: "hello", playerIdx: 0 }));
    bystander.send(JSON.stringify({ type: "hello", playerIdx: 2 }));
    observer.send(JSON.stringify({ type: "hello", playerIdx: null }));
    await sleep(60);

    sender.send(JSON.stringify({ type: "chat", from: 0, to: null, text: "hello table" }));
    await sleep(50);
    sender.send(JSON.stringify({ type: "chat", from: 0, to: 1, text: "psst deal?" }));
    await sleep(80);

    // Public reaches everyone.
    expect(chatTexts(oMsgs)).toContain("hello table");
    expect(chatTexts(bMsgs)).toContain("hello table");
    // DM 0->1: sender + global observer see it; the seat-2 bystander does not.
    expect(chatTexts(sMsgs)).toContain("psst deal?");
    expect(chatTexts(oMsgs)).toContain("psst deal?");
    expect(chatTexts(bMsgs)).not.toContain("psst deal?");

    sender.close();
    bystander.close();
    observer.close();
  });

  it("rejects chat sent from a seat the client does not hold", async () => {
    handle = await startServer({
      port: 0,
      seed: 6,
      numPlayers: 4,
      controllers: ["human", "human", "human", "human"],
      paceMs: 0,
      distDir: "/nonexistent",
    });
    const ws = new WebSocket(`ws://localhost:${handle.port}/ws`);
    const msgs: ServerMessage[] = [];
    collect(ws, msgs);
    await open(ws);
    ws.send(JSON.stringify({ type: "hello", playerIdx: 0 }));
    await sleep(40);
    ws.send(JSON.stringify({ type: "chat", from: 1, to: null, text: "spoofed" }));
    await sleep(60);
    expect(msgs.some((m) => m.type === "error")).toBe(true);
    expect(chatTexts(msgs)).not.toContain("spoofed");
    ws.close();
  });

  it("broadcasts per-seat autopilot guidance in status", async () => {
    handle = await startServer({
      port: 0,
      seed: 6,
      numPlayers: 2,
      controllers: ["human", "scripted"],
      paceMs: 0,
      distDir: "/nonexistent",
    });
    const ws = new WebSocket(`ws://localhost:${handle.port}/ws`);
    const msgs: ServerMessage[] = [];
    collect(ws, msgs);
    await open(ws);
    ws.send(JSON.stringify({ type: "hello", playerIdx: 0 }));
    await sleep(40);
    ws.send(JSON.stringify({ type: "setGuidance", playerIdx: 0, text: "grow family early" }));
    await sleep(60);
    const status = [...msgs].reverse().find((m) => m.type === "status");
    expect(status?.type === "status" && status.status.guidance[0]).toBe("grow family early");
    ws.close();
  });
});
