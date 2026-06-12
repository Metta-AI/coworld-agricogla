import type { IncomingMessage } from "node:http";
import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { GameRunner } from "./game-runner";
import { redactState } from "./redact";
import { ActPromptEntry } from "../agents/types";
import { RuleError } from "../shared/engine/apply";
import { ClientMessage, clientMessageSchema, ServerMessage } from "../shared/protocol";

interface ClientInfo {
  socket: WebSocket;
  playerIdx: number | null;
}

export class SocketHub {
  #clients = new Set<ClientInfo>();
  #runner: GameRunner;
  #prompts: ActPromptEntry[] = [];

  constructor(runner: GameRunner) {
    this.#runner = runner;
  }

  attach(server: Server): void {
    const wss = new WebSocketServer({ server, path: "/ws" });
    wss.on("connection", (socket: WebSocket, _req: IncomingMessage) => {
      const client: ClientInfo = { socket, playerIdx: null };
      this.#clients.add(client);
      this.#runner.clientCount = this.#clients.size;
      socket.on("message", (raw) => this.#onMessage(client, raw.toString()));
      socket.on("close", () => {
        this.#clients.delete(client);
        this.#runner.clientCount = this.#clients.size;
        this.broadcastStatus();
      });
      this.#sendSnapshot(client);
      this.broadcastStatus();
    });
  }

  recordPrompt(entry: ActPromptEntry): void {
    this.#prompts.push(entry);
    if (this.#prompts.length > 200) this.#prompts.shift();
    this.#broadcast({ type: "actPrompt", entry });
  }

  #send(client: ClientInfo, message: ServerMessage): void {
    if (client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(JSON.stringify(message));
    }
  }

  #sendSnapshot(client: ClientInfo): void {
    const { state, handSizes } = redactState(this.#runner.state, client.playerIdx);
    this.#send(client, { type: "state", state, handSizes });
    this.#send(client, { type: "status", status: this.#runner.status() });
    for (const entry of this.#prompts.slice(-50)) {
      this.#send(client, { type: "actPrompt", entry });
    }
  }

  broadcastState(): void {
    for (const client of this.#clients) {
      const { state, handSizes } = redactState(this.#runner.state, client.playerIdx);
      this.#send(client, { type: "state", state, handSizes });
    }
    this.broadcastStatus();
  }

  broadcastStatus(): void {
    this.#broadcast({ type: "status", status: this.#runner.status() });
  }

  #broadcast(message: ServerMessage): void {
    for (const client of this.#clients) this.#send(client, message);
  }

  #onMessage(client: ClientInfo, raw: string): void {
    let message: ClientMessage;
    try {
      message = clientMessageSchema.parse(JSON.parse(raw));
    } catch (err) {
      this.#send(client, { type: "error", message: `bad message: ${String(err)}` });
      return;
    }
    try {
      switch (message.type) {
        case "hello":
          client.playerIdx = message.playerIdx;
          this.#sendSnapshot(client);
          break;
        case "place":
          this.#requireSeat(client, message.playerIdx);
          this.#runner.humanPlace(message.playerIdx, message.placement);
          break;
        case "feed":
          this.#requireSeat(client, message.playerIdx);
          this.#runner.humanFeed(message.playerIdx, message.decision);
          break;
        case "setController":
          this.#runner.setController(message.playerIdx, message.controller);
          break;
        case "pause":
          this.#runner.pause();
          break;
        case "resume":
          this.#runner.resume();
          break;
        case "reset":
          this.#runner.reset(message.seed, message.players);
          break;
      }
    } catch (err) {
      if (err instanceof RuleError) {
        this.#send(client, { type: "error", message: err.message });
      } else {
        this.#send(client, { type: "error", message: `server error: ${String(err)}` });
        throw err;
      }
    }
  }

  #requireSeat(client: ClientInfo, playerIdx: number): void {
    if (client.playerIdx !== playerIdx) {
      throw new RuleError(`you are not seated as player ${playerIdx}`);
    }
  }
}
