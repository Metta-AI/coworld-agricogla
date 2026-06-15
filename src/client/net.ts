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
  /** Per-round snapshots sent on connect, to seed a full scrubber timeline. */
  history: { round: number; seed: number; state: GameState }[];
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
    history: [],
    lastError: null,
    connected: false,
  };

  constructor(playerIdx: number | null, render: () => void, token?: string) {
    this.#playerIdx = playerIdx;
    this.#token = token;
    this.#render = render;
  }

  connect(): void {
    // Resolve /ws against <base href> so the live spectator/seat sockets follow
    // the same path prefix the page is served under (root locally, .../proxy/
    // behind the Observatory hosted proxy).
    const url = new URL("ws", document.baseURI);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url);
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
        case "history":
          this.feed.history = message.frames;
          break;
        case "seat":
          // Re-seated by the lobby: null = removed (back to /join), else our
          // seat shifted after a removal.
          if (message.playerIdx === null) {
            window.location.href = new URL("join", document.baseURI).href;
            return;
          }
          this.#playerIdx = message.playerIdx;
          history.replaceState(null, "", new URL(`player/${message.playerIdx}`, document.baseURI).pathname);
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

  /** Lobby: add an autopilot (LLM) bot seat. */
  addBot(): void {
    this.#send({ type: "addBot" });
  }

  /** Lobby: remove a seat (bot or human). A removed human is sent to /join. */
  removeSeat(playerIdx: number): void {
    this.#send({ type: "removeSeat", playerIdx });
  }

  /** Post-game "Play again": instant rematch with the current roster. */
  reset(seed?: number, players?: number): void {
    this.#send({ type: "reset", seed, players });
  }

  /** "New game": leave the current game and return to the lobby (roster kept)
   *  to set up a fresh game. */
  newGame(): void {
    this.#send({ type: "newGame" });
  }

  clearError(): void {
    this.feed.lastError = null;
    this.#render();
  }
}
