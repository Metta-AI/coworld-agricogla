import { GameState } from "../shared/engine/types";
import { FeedDecision, Placement } from "../shared/engine/placements";
import {
  ActPromptWire,
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
