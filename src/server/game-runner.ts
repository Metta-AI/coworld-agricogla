import { buildAgent } from "../agents";
import { Agent, ActPromptEntry } from "../agents/types";
import { buildView } from "../agents/run";
import { fallbackPlacement } from "../agents/scripted";
import {
  applyFeeding,
  applyPlacement,
  computeAutoFeed,
  RuleError,
} from "../shared/engine/apply";
import { newGame } from "../shared/engine/game";
import { GameState } from "../shared/engine/types";
import { FeedDecision, Placement } from "../shared/engine/placements";
import { ChatMessage, Controller, DEFAULT_BEDROCK_MODEL, ServerStatus } from "../shared/protocol";
import { dmReply, roundQuip } from "./chatter";

export interface GameRunnerOpts {
  seed: number;
  numPlayers: number;
  controllers: Controller[];
  /** Minimum ms between automated decisions, so spectators can follow. */
  paceMs: number;
  /** Player display names (defaults to the engine's built-in names). */
  names?: string[];
  /** Pre-built agents for "remote" controllers, indexed by player. */
  agents?: Agent[];
  /** Created paused; call resume() to start play (coworld mode waits for
   *  all remote players to connect first). */
  startPaused?: boolean;
  onUpdate?: () => void;
  onActPrompt?: (entry: ActPromptEntry) => void;
  onError?: (err: unknown) => void;
  /** Called after every applied decision, in order; feeds the replay log. */
  onAction?: (action: AppliedAction) => void;
  /** Called for every table-talk message (human or bot) for fan-out. */
  onChat?: (message: ChatMessage) => void;
}

export type AppliedAction =
  | { playerIdx: number; kind: "place"; placement: Placement }
  | { playerIdx: number; kind: "feed"; decision: FeedDecision };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class GameRunner {
  #state: GameState;
  #controllers: Controller[];
  #guidance: string[];
  #models: string[];
  #chat: ChatMessage[] = [];
  #chatSeq = 0;
  #thinking: number | null = null;
  #agents = new Map<string, Agent>();
  #opts: GameRunnerOpts;
  #paused = false;
  #ticking = false;
  #generation = 0;
  clientCount = 0;

  constructor(opts: GameRunnerOpts) {
    this.#opts = opts;
    this.#controllers = [...opts.controllers];
    this.#guidance = Array.from({ length: opts.numPlayers }, () => "");
    this.#models = Array.from({ length: opts.numPlayers }, () => DEFAULT_BEDROCK_MODEL);
    this.#paused = opts.startPaused ?? false;
    this.#state = newGame({ seed: opts.seed, numPlayers: opts.numPlayers, names: opts.names });
    if (this.#controllers.length !== opts.numPlayers) {
      throw new Error(`need ${opts.numPlayers} controllers`);
    }
  }

  get state(): GameState {
    return this.#state;
  }

  chatLog(): readonly ChatMessage[] {
    return this.#chat;
  }

  status(): ServerStatus {
    return {
      round: this.#state.round,
      phase: this.#state.phase,
      currentPlayer: this.#state.currentPlayer,
      toFeed: this.#state.toFeed,
      controllers: [...this.#controllers],
      guidance: [...this.#guidance],
      models: [...this.#models],
      thinking: this.#thinking,
      paused: this.#paused,
      finished: this.#state.phase === "finished",
      clients: this.clientCount,
      readOnly: false, // SocketHub overrides in tournament mode.
    };
  }

  setGuidance(playerIdx: number, text: string): void {
    if (playerIdx < 0 || playerIdx >= this.#guidance.length) {
      throw new Error(`no player ${playerIdx}`);
    }
    this.#guidance[playerIdx] = text;
    this.#opts.onUpdate?.();
  }

  setModel(playerIdx: number, model: string): void {
    if (playerIdx < 0 || playerIdx >= this.#models.length) {
      throw new Error(`no player ${playerIdx}`);
    }
    this.#models[playerIdx] = model;
    // Drop the cached llm agent so it rebuilds against the new model.
    this.#agents.delete(`${playerIdx}:llm`);
    this.#opts.onUpdate?.();
    void this.tick();
  }

  /** Record + fan out a table-talk message. Bots auto-reply to DMs they get. */
  postChat(from: number, to: number | null, text: string): ChatMessage {
    const message: ChatMessage = { seq: this.#chatSeq++, round: this.#state.round, from, to, text };
    this.#chat.push(message);
    if (this.#chat.length > 500) this.#chat.shift();
    this.#opts.onChat?.(message);
    // A human DM to a bot seat earns a templated reply a beat later.
    if (
      to !== null &&
      to !== from &&
      this.#controllers[from] === "human" &&
      this.#controllers[to] !== "human" &&
      this.#state.phase !== "finished"
    ) {
      const generation = this.#generation;
      setTimeout(() => {
        if (generation === this.#generation && this.#state.phase !== "finished") {
          this.postChat(to, from, dmReply());
        }
      }, 900 + Math.random() * 800);
    }
    return message;
  }

  #agentFor(playerIdx: number): Agent {
    const controller = this.#controllers[playerIdx]!;
    if (controller === "remote") {
      const agent = this.#opts.agents?.[playerIdx];
      if (!agent) throw new Error(`no remote agent for player ${playerIdx}`);
      return agent;
    }
    const key = `${playerIdx}:${controller}`;
    let agent = this.#agents.get(key);
    if (!agent) {
      agent = buildAgent(controller === "human" ? "scripted" : controller, `player${playerIdx}`, {
        seed: this.#opts.seed * 1000 + playerIdx,
        model: this.#models[playerIdx],
        // Local llm seats keep a diary and can table-talk; their messages flow
        // into the same chat feed humans use.
        capabilities: { memory: true, chat: true },
        onChat: (to, text) => this.postChat(playerIdx, to, text),
        onActPrompt: this.#opts.onActPrompt,
      });
      this.#agents.set(key, agent);
    }
    return agent;
  }

  /** Whose decision the game is waiting on, or null when finished. */
  pendingPlayer(): number | null {
    if (this.#state.phase === "work") return this.#state.currentPlayer;
    if (this.#state.phase === "feeding") return this.#state.toFeed[0] ?? null;
    return null;
  }

  setController(playerIdx: number, controller: Controller): void {
    if (playerIdx < 0 || playerIdx >= this.#controllers.length) {
      throw new Error(`no player ${playerIdx}`);
    }
    this.#controllers[playerIdx] = controller;
    this.#opts.onUpdate?.();
    void this.tick();
  }

  pause(): void {
    this.#paused = true;
    this.#opts.onUpdate?.();
  }

  resume(): void {
    this.#paused = false;
    this.#opts.onUpdate?.();
    void this.tick();
  }

  reset(seed?: number, numPlayers?: number): void {
    this.#generation++;
    const players = numPlayers ?? this.#state.numPlayers;
    if (players !== this.#controllers.length) {
      this.#controllers = Array.from({ length: players }, (_, i) =>
        this.#controllers[i] ?? "scripted",
      );
    }
    this.#guidance = Array.from({ length: players }, (_, i) => this.#guidance[i] ?? "");
    this.#models = Array.from({ length: players }, (_, i) => this.#models[i] ?? DEFAULT_BEDROCK_MODEL);
    this.#chat = [];
    this.#chatSeq = 0;
    this.#thinking = null;
    this.#agents.clear();
    this.#state = newGame({
      seed: seed ?? this.#state.seed + 1,
      numPlayers: players,
      names: this.#opts.names,
    });
    this.#opts.onUpdate?.();
    void this.tick();
  }

  #applyPlace(playerIdx: number, placement: Placement): void {
    const beforeRound = this.#state.round;
    this.#state = applyPlacement(this.#state, playerIdx, placement).state;
    this.#opts.onAction?.({ playerIdx, kind: "place", placement });
    if (this.#state.round > beforeRound && this.#state.phase === "work") this.#maybeChatter();
  }

  /** On a round boundary, a random bot seat may post a public quip. */
  #maybeChatter(): void {
    if (Math.random() > 0.6) return;
    const bots = this.#controllers
      .map((c, i) => (c !== "human" ? i : -1))
      .filter((i) => i >= 0);
    if (bots.length === 0) return;
    this.postChat(bots[Math.floor(Math.random() * bots.length)]!, null, roundQuip(this.#state));
  }

  #applyFeed(playerIdx: number, decision: FeedDecision): void {
    this.#state = applyFeeding(this.#state, playerIdx, decision).state;
    this.#opts.onAction?.({ playerIdx, kind: "feed", decision });
  }

  /** Apply a human placement; throws RuleError for the caller to report. */
  humanPlace(playerIdx: number, placement: Placement): void {
    if (this.#state.phase !== "work" || this.#state.currentPlayer !== playerIdx) {
      throw new RuleError("it is not your turn to place");
    }
    this.#applyPlace(playerIdx, placement);
    this.#opts.onUpdate?.();
    void this.tick();
  }

  /** Apply a human feeding decision; throws RuleError to report. */
  humanFeed(playerIdx: number, decision: FeedDecision): void {
    if (this.#state.phase !== "feeding" || !this.#state.toFeed.includes(playerIdx)) {
      throw new RuleError("you are not feeding right now");
    }
    this.#applyFeed(playerIdx, decision);
    this.#opts.onUpdate?.();
    void this.tick();
  }

  /** Drive automated decisions until a human is up or the game ends. */
  async tick(): Promise<void> {
    if (this.#ticking) return;
    this.#ticking = true;
    const generation = this.#generation;
    try {
      while (!this.#paused && generation === this.#generation) {
        const pending = this.pendingPlayer();
        if (pending === null) break;
        if (this.#controllers[pending] === "human") break;
        const agent = this.#agentFor(pending);
        const view = buildView(this.#state, pending);
        view.guidance = this.#guidance[pending] || undefined;
        // Show llm seats the table-talk they can see (public + DMs to them).
        if (this.#controllers[pending] === "llm") {
          view.messages = this.#chat.filter(
            (m) => m.from !== pending && (m.to === null || m.to === pending),
          );
        }
        // Signal "thinking" only for the slow controllers the UI cares about.
        const slow = this.#controllers[pending] === "llm" || this.#controllers[pending] === "remote";
        if (slow && this.#thinking !== pending) {
          this.#thinking = pending;
          this.#opts.onUpdate?.();
        }
        if (this.#state.phase === "work") {
          let placement: Placement;
          try {
            placement = await agent.decidePlacement(view);
          } catch (err) {
            this.#opts.onError?.(err);
            placement = fallbackPlacement(view);
          }
          if (generation !== this.#generation) break;
          try {
            this.#applyPlace(pending, placement);
          } catch (err) {
            if (!(err instanceof RuleError)) throw err;
            this.#applyPlace(pending, fallbackPlacement(view));
          }
        } else {
          let decision: FeedDecision;
          try {
            decision = await agent.decideFeeding(view);
          } catch (err) {
            this.#opts.onError?.(err);
            decision = computeAutoFeed(this.#state, pending);
          }
          if (generation !== this.#generation) break;
          try {
            this.#applyFeed(pending, decision);
          } catch (err) {
            if (!(err instanceof RuleError)) throw err;
            this.#applyFeed(pending, computeAutoFeed(this.#state, pending));
          }
        }
        this.#opts.onUpdate?.();
        if (this.#opts.paceMs > 0) await sleep(this.#opts.paceMs);
      }
    } finally {
      this.#ticking = false;
      if (this.#thinking !== null) {
        this.#thinking = null;
        this.#opts.onUpdate?.();
      }
    }
    // A controller change, resume or reset may have queued more work while the
    // loop was draining (their tick() calls no-op when #ticking is set).
    const pending = this.pendingPlayer();
    if (pending !== null && !this.#paused && this.#controllers[pending] !== "human") {
      setTimeout(() => void this.tick(), 0);
    }
  }
}
