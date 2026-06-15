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
import { newGame, DEFAULT_NAMES } from "../shared/engine/game";
import { GameState } from "../shared/engine/types";
import { FeedDecision, Placement } from "../shared/engine/placements";
import {
  BedrockModel,
  ChatMessage,
  Controller,
  DEFAULT_BEDROCK_MODEL,
  ServerStatus,
} from "../shared/protocol";
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
   *  all remote players to connect first). A paused boot is also the lobby:
   *  players join / bots are added until start. */
  startPaused?: boolean;
  /** Seat cap (engine max). Defaults to 4. */
  maxPlayers?: number;
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
  /** Null only while an empty lobby (no cogs, nobody joined) is waiting. */
  #state: GameState | null;
  #controllers: Controller[];
  #names: string[];
  #guidance: string[];
  #models: string[];
  #availableModels: BedrockModel[] = [];
  #chat: ChatMessage[] = [];
  #chatSeq = 0;
  #thinking: number | null = null;
  #agents = new Map<string, Agent>();
  #opts: GameRunnerOpts;
  #paused = false;
  /** False while the lobby collects players; true once play has begun. */
  #started = false;
  #ticking = false;
  #generation = 0;
  #maxPlayers: number;
  clientCount = 0;

  constructor(opts: GameRunnerOpts) {
    this.#opts = opts;
    this.#maxPlayers = opts.maxPlayers ?? 4;
    this.#controllers = [...opts.controllers];
    this.#names = opts.controllers.map((_, i) => opts.names?.[i] ?? DEFAULT_NAMES[i] ?? `Player ${i + 1}`);
    this.#guidance = this.#names.map(() => "");
    this.#models = this.#names.map(() => DEFAULT_BEDROCK_MODEL);
    this.#paused = opts.startPaused ?? false;
    // A paused boot is the lobby (not yet started); --start boots into play.
    this.#started = !this.#paused;
    this.#state = this.#names.length >= 1 ? this.#build(opts.seed) : null;
  }

  #build(seed: number): GameState {
    return newGame({ seed, numPlayers: this.#names.length, names: this.#names });
  }

  get state(): GameState | null {
    return this.#state;
  }

  chatLog(): readonly ChatMessage[] {
    return this.#chat;
  }

  status(): ServerStatus {
    const s = this.#state;
    return {
      round: s?.round ?? 0,
      phase: this.#started ? (s?.phase ?? "work") : "lobby",
      currentPlayer: s?.currentPlayer ?? 0,
      toFeed: s?.toFeed ?? [],
      controllers: [...this.#controllers],
      guidance: [...this.#guidance],
      models: [...this.#models],
      availableModels: [...this.#availableModels],
      thinking: this.#thinking,
      paused: this.#paused,
      started: this.#started,
      roster: this.#names.map((name, i) => ({ name, controller: this.#controllers[i]! })),
      maxPlayers: this.#maxPlayers,
      finished: s?.phase === "finished",
      clients: this.clientCount,
      readOnly: false, // SocketHub overrides in tournament mode.
    };
  }

  /** Add a seat to the lobby. Throws if play has started or the table is full. */
  seat(name: string, controller: Controller): number {
    if (this.#started) throw new RuleError("the game has already started");
    if (this.#names.length >= this.#maxPlayers) throw new RuleError("the table is full");
    const idx = this.#names.length;
    this.#names.push(name.trim() || `Player ${idx + 1}`);
    this.#controllers.push(controller);
    this.#guidance.push("");
    this.#models.push(this.#defaultModel());
    // Rebuild the (still-paused) game so its size tracks the roster.
    this.#state = this.#build(this.#opts.seed);
    this.#opts.onUpdate?.();
    return idx;
  }

  /** Add an autopilot (LLM) bot to the lobby. */
  addBot(): number {
    const n = this.#controllers.filter((c) => c !== "human").length + 1;
    return this.seat(`Bot ${n}`, "llm");
  }

  /** Fill every empty seat with an autopilot bot, up to the seat cap. Used when
   *  a Discord table starts: humans keep their claimed seats, bots take the rest
   *  so the game always plays at a full table. No-op once play has started. */
  fillWithBots(): void {
    if (this.#started) return;
    while (this.#names.length < this.#maxPlayers) this.addBot();
  }

  /** Drop every seat back to an empty lobby (no roster, no game). Used to start
   *  a fresh Discord table after a game finishes. Throws if play is underway. */
  clearSeats(): void {
    if (this.#started) throw new RuleError("the game has already started");
    this.#names = [];
    this.#controllers = [];
    this.#guidance = [];
    this.#models = [];
    this.#agents.clear();
    this.#state = null;
    this.#opts.onUpdate?.();
  }

  /** Remove a lobby seat (bot or human). Throws once play has started.
   *  Seats after it shift down by one — the caller re-seats affected clients. */
  removeSeat(idx: number): void {
    if (this.#started) throw new RuleError("the game has already started");
    if (idx < 0 || idx >= this.#names.length) throw new RuleError(`no seat ${idx}`);
    this.#names.splice(idx, 1);
    this.#controllers.splice(idx, 1);
    this.#guidance.splice(idx, 1);
    this.#models.splice(idx, 1);
    this.#agents.clear(); // agent cache is keyed by seat index, now shifted
    this.#state = this.#names.length >= 1 ? this.#build(this.#opts.seed) : null;
    this.#opts.onUpdate?.();
  }

  /** Publish the Bedrock models discovered invokable at startup; broadcasts so
   *  connected clients update their autopilot picker. */
  setAvailableModels(models: BedrockModel[]): void {
    this.#availableModels = [...models];
    this.#reconcileModels();
    this.#opts.onUpdate?.();
  }

  /** A seat's default brain: the configured default if this account can invoke
   *  it, else the first discovered model, else the static default (used only
   *  before discovery has run). */
  #defaultModel(): string {
    if (this.#availableModels.some((m) => m.id === DEFAULT_BEDROCK_MODEL)) {
      return DEFAULT_BEDROCK_MODEL;
    }
    return this.#availableModels[0]?.id ?? DEFAULT_BEDROCK_MODEL;
  }

  /** Snap any seat pointed at a non-invokable model back to an available one,
   *  so toggling autopilot (which uses the seat's stored model, not the picker)
   *  never selects a model that 404s and silently degrades to scripted. No-op
   *  until discovery has found at least one model. */
  #reconcileModels(): void {
    if (this.#availableModels.length === 0) return;
    const usable = new Set(this.#availableModels.map((m) => m.id));
    this.#models = this.#models.map((m) => (usable.has(m) ? m : this.#defaultModel()));
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
    const message: ChatMessage = { seq: this.#chatSeq++, round: this.#state?.round ?? 0, from, to, text };
    this.#chat.push(message);
    if (this.#chat.length > 500) this.#chat.shift();
    this.#opts.onChat?.(message);
    // A human DM to a bot seat earns a templated reply a beat later.
    if (
      to !== null &&
      to !== from &&
      this.#controllers[from] === "human" &&
      this.#controllers[to] !== "human" &&
      this.#state?.phase !== "finished"
    ) {
      const generation = this.#generation;
      setTimeout(() => {
        if (generation === this.#generation && this.#state?.phase !== "finished") {
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
    const s = this.#state;
    if (!s) return null;
    if (s.phase === "work") return s.currentPlayer;
    if (s.phase === "feeding") return s.toFeed[0] ?? null;
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

  /** Resume play. From the lobby this is "Start": locks the roster and begins. */
  resume(): void {
    if (!this.#state) return; // empty lobby — nothing to start yet
    this.#paused = false;
    this.#started = true;
    this.#opts.onUpdate?.();
    void this.tick();
  }

  /** "New game": replay with the current roster (same seats, fresh deal). */
  reset(seed?: number): void {
    this.#generation++;
    this.#reconcileModels();
    this.#chat = [];
    this.#chatSeq = 0;
    this.#thinking = null;
    this.#agents.clear();
    const nextSeed = seed ?? (this.#state ? this.#state.seed + 1 : this.#opts.seed);
    this.#state = this.#names.length >= 1 ? this.#build(nextSeed) : null;
    this.#opts.onUpdate?.();
    void this.tick();
  }

  #applyPlace(playerIdx: number, placement: Placement): void {
    const before = this.#state;
    if (!before) return;
    const after = applyPlacement(before, playerIdx, placement).state;
    this.#state = after;
    this.#opts.onAction?.({ playerIdx, kind: "place", placement });
    if (after.round > before.round && after.phase === "work") this.#maybeChatter();
  }

  /** On a round boundary, a random bot seat may post a public quip. */
  #maybeChatter(): void {
    const s = this.#state;
    if (!s) return;
    if (Math.random() > 0.6) return;
    const bots = this.#controllers
      .map((c, i) => (c !== "human" ? i : -1))
      .filter((i) => i >= 0);
    if (bots.length === 0) return;
    this.postChat(bots[Math.floor(Math.random() * bots.length)]!, null, roundQuip(s));
  }

  #applyFeed(playerIdx: number, decision: FeedDecision): void {
    const before = this.#state;
    if (!before) return;
    this.#state = applyFeeding(before, playerIdx, decision).state;
    this.#opts.onAction?.({ playerIdx, kind: "feed", decision });
  }

  /** Apply a human placement; throws RuleError for the caller to report. */
  humanPlace(playerIdx: number, placement: Placement): void {
    const s = this.#state;
    if (!s) throw new RuleError("the game has not started");
    if (s.phase !== "work" || s.currentPlayer !== playerIdx) {
      throw new RuleError("it is not your turn to place");
    }
    this.#applyPlace(playerIdx, placement);
    this.#opts.onUpdate?.();
    void this.tick();
  }

  /** Apply a human feeding decision; throws RuleError to report. */
  humanFeed(playerIdx: number, decision: FeedDecision): void {
    const s = this.#state;
    if (!s) throw new RuleError("the game has not started");
    if (s.phase !== "feeding" || !s.toFeed.includes(playerIdx)) {
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
        const game = this.#state;
        if (!game) break;
        const agent = this.#agentFor(pending);
        const view = buildView(game, pending);
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
        if (game.phase === "work") {
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
            decision = computeAutoFeed(game, pending);
          }
          if (generation !== this.#generation) break;
          try {
            this.#applyFeed(pending, decision);
          } catch (err) {
            if (!(err instanceof RuleError)) throw err;
            this.#applyFeed(pending, computeAutoFeed(game, pending));
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
