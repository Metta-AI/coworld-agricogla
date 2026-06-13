import { GameState } from "../shared/engine/types";
import { FeedDecision, Placement } from "../shared/engine/placements";
import {
  ActPromptWire,
  ChatMessage,
  Controller,
  HandSizes,
  ServerMessage,
  ServerStatus,
} from "../shared/protocol";

export interface FeedState {
  state: GameState | null;
  handSizes: HandSizes[];
  status: ServerStatus | null;
  prompts: ActPromptWire[];
  chat: ChatMessage[];
  lastError: string | null;
  connected: boolean;
}

export class GameSocket {
  #ws: WebSocket | null = null;
  #playerIdx: number | null;
  #token: string | undefined;
  #render: () => void;
  feed: FeedState = {
    state: null,
    handSizes: [],
    status: null,
    prompts: [],
    chat: [],
    lastError: null,
    connected: false,
  };

  constructor(playerIdx: number | null, render: () => void, token?: string) {
    this.#playerIdx = playerIdx;
    this.#token = token;
    this.#render = render;
  }

  connect(): void {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.#ws = ws;
    ws.onopen = () => {
      this.feed.connected = true;
      ws.send(JSON.stringify({ type: "hello", playerIdx: this.#playerIdx, token: this.#token }));
      this.#render();
    };
    ws.onclose = () => {
      this.feed.connected = false;
      this.#render();
      setTimeout(() => this.connect(), 1500);
    };
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage;
      switch (message.type) {
        case "state":
          this.feed.state = message.state;
          this.feed.handSizes = message.handSizes;
          this.feed.lastError = null;
          break;
        case "status":
          this.feed.status = message.status;
          break;
        case "actPrompt":
          this.feed.prompts.push(message.entry);
          if (this.feed.prompts.length > 100) this.feed.prompts.shift();
          break;
        case "chat":
          // Backlog is re-sent on reconnect; dedupe by sequence number.
          if (!this.feed.chat.some((m) => m.seq === message.message.seq)) {
            this.feed.chat.push(message.message);
            this.feed.chat.sort((a, b) => a.seq - b.seq);
            if (this.feed.chat.length > 300) this.feed.chat.shift();
          }
          break;
        case "error":
          this.feed.lastError = message.message;
          break;
      }
      this.#render();
    };
  }

  #send(message: unknown): void {
    if (this.#ws?.readyState === WebSocket.OPEN) {
      this.#ws.send(JSON.stringify(message));
    }
  }

  place(placement: Placement): void {
    this.#send({ type: "place", playerIdx: this.#playerIdx, placement });
  }

  feedDecision(decision: FeedDecision): void {
    this.#send({ type: "feed", playerIdx: this.#playerIdx, decision });
  }

  setController(playerIdx: number, controller: Controller): void {
    this.#send({ type: "setController", playerIdx, controller });
  }

  /** The seat this client is playing, or null when spectating the table. */
  get seat(): number | null {
    return this.#playerIdx;
  }

  /** Re-claim a seat (or null to spectate) live, without reloading the page. */
  claimSeat(playerIdx: number | null): void {
    this.#playerIdx = playerIdx;
    this.#send({ type: "hello", playerIdx, token: this.#token });
  }

  setGuidance(playerIdx: number, text: string): void {
    this.#send({ type: "setGuidance", playerIdx, text });
  }

  setModel(playerIdx: number, model: string): void {
    this.#send({ type: "setModel", playerIdx, model });
  }

  sendChat(to: number | null, text: string): void {
    if (this.#playerIdx === null) return; // spectators watch, they don't talk
    const trimmed = text.trim();
    if (!trimmed) return;
    this.#send({ type: "chat", from: this.#playerIdx, to, text: trimmed });
  }

  pause(): void {
    this.#send({ type: "pause" });
  }

  resume(): void {
    this.#send({ type: "resume" });
  }

  reset(seed?: number, players?: number): void {
    this.#send({ type: "reset", seed, players });
  }

  clearError(): void {
    this.feed.lastError = null;
    this.#render();
  }
}
