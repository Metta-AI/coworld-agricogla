import type { IncomingMessage } from "node:http";
import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { GameRunner } from "./game-runner";
import { redactState } from "./redact";
import { ActPromptEntry } from "../agents/types";
import { RuleError } from "../shared/engine/apply";
import { ChatMessage, ClientMessage, clientMessageSchema, HandSizes, ServerMessage } from "../shared/protocol";

/** A seat sees its own DMs; the global observer (null) sees every DM. */
function chatVisibleTo(message: ChatMessage, playerIdx: number | null): boolean {
  return (
    message.to === null ||
    playerIdx === null ||
    playerIdx === message.from ||
    playerIdx === message.to
  );
}

interface ClientInfo {
  socket: WebSocket;
  playerIdx: number | null;
}

export interface SocketHubOpts {
  /** Tournament (coworld) mode: reject every state-changing command. */
  readOnly?: boolean;
  /** When set, hello must present the matching token to claim a seat (and
   *  see that seat's hand); otherwise the client spectates. */
  seatTokens?: string[];
}

export class SocketHub {
  #clients = new Set<ClientInfo>();
  #runner: GameRunner;
  #prompts: ActPromptEntry[] = [];
  #opts: SocketHubOpts;
  #wss = new WebSocketServer({ noServer: true });

  constructor(runner: GameRunner, opts: SocketHubOpts = {}) {
    this.#runner = runner;
    this.#opts = opts;
    this.#wss.on("connection", (socket: WebSocket) => {
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

  /** Standalone-server mode: own the /ws upgrade path. */
  attach(server: Server): void {
    server.on("upgrade", (req, socket, head) => {
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
      if (pathname === "/ws" || pathname === "/global") {
        this.upgrade(req, socket, head);
      } else {
        socket.destroy();
      }
    });
  }

  /** Adopt an HTTP upgrade routed here by an external upgrade router. */
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.#wss.handleUpgrade(req, socket, head, (ws) => {
      this.#wss.emit("connection", ws, req);
    });
  }

  recordPrompt(entry: ActPromptEntry): void {
    this.#prompts.push(entry);
    if (this.#prompts.length > 200) this.#prompts.shift();
    this.#broadcast({ type: "actPrompt", entry });
  }

  #status() {
    return { ...this.#runner.status(), readOnly: this.#opts.readOnly ?? false };
  }

  #send(client: ClientInfo, message: ServerMessage): void {
    if (client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(JSON.stringify(message));
    }
  }

  #redact(playerIdx: number | null) {
    const state = this.#runner.state;
    if (!state) return { state: null, handSizes: [] as HandSizes[] };
    return redactState(state, playerIdx, { maskFuture: this.#opts.readOnly });
  }

  #sendSnapshot(client: ClientInfo): void {
    const { state, handSizes } = this.#redact(client.playerIdx);
    this.#send(client, { type: "state", state, handSizes });
    this.#send(client, { type: "status", status: this.#status() });
    for (const entry of this.#prompts.slice(-50)) {
      this.#send(client, { type: "actPrompt", entry });
    }
    for (const message of this.#runner.chatLog()) {
      if (chatVisibleTo(message, client.playerIdx)) {
        this.#send(client, { type: "chat", message });
      }
    }
  }

  /** Fan out a table-talk message, hiding DMs from non-participant seats. */
  broadcastChat(message: ChatMessage): void {
    for (const client of this.#clients) {
      if (chatVisibleTo(message, client.playerIdx)) {
        this.#send(client, { type: "chat", message });
      }
    }
  }

  broadcastState(): void {
    for (const client of this.#clients) {
      const { state, handSizes } = this.#redact(client.playerIdx);
      this.#send(client, { type: "state", state, handSizes });
    }
    this.broadcastStatus();
  }

  broadcastStatus(): void {
    this.#broadcast({ type: "status", status: this.#status() });
  }

  closeAll(): void {
    for (const client of this.#clients) client.socket.close(1000, "episode over");
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
    if (this.#opts.readOnly && message.type !== "hello") {
      this.#send(client, {
        type: "error",
        message: "this table is read-only: seats are played by tournament policies",
      });
      return;
    }
    try {
      switch (message.type) {
        case "hello": {
          const tokens = this.#opts.seatTokens;
          if (
            message.playerIdx !== null &&
            tokens &&
            tokens[message.playerIdx] !== message.token
          ) {
            client.playerIdx = null;
            this.#sendSnapshot(client);
            this.#send(client, {
              type: "error",
              message: "invalid seat token: spectating instead",
            });
            break;
          }
          client.playerIdx = message.playerIdx;
          this.#sendSnapshot(client);
          break;
        }
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
        case "setGuidance":
          this.#requireSeat(client, message.playerIdx);
          this.#runner.setGuidance(message.playerIdx, message.text);
          break;
        case "setModel":
          this.#requireSeat(client, message.playerIdx);
          this.#runner.setModel(message.playerIdx, message.model);
          break;
        case "chat":
          this.#requireSeat(client, message.from);
          this.#runner.postChat(message.from, message.to, message.text);
          break;
        case "pause":
          this.#runner.pause();
          break;
        case "resume":
          this.#runner.resume();
          break;
        case "addBot":
          this.#runner.addBot();
          break;
        case "reset":
          this.#runner.reset(message.seed);
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
