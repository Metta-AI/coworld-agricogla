import { WebSocket } from "ws";
import { Agent, AgentView } from "../../agents/types";
import { applyFeeding, applyPlacement, RuleError } from "../../shared/engine/apply";
import { FeedDecision, Placement } from "../../shared/engine/placements";
import {
  CoworldPlayerMessage,
  coworldPlayerMessageSchema,
  CoworldServerMessage,
} from "../../shared/coworld-protocol";
import { redactState } from "../redact";

const MAX_ATTEMPTS = 3;

interface Waiter {
  decisionId: number;
  resolve: (message: CoworldPlayerMessage) => void;
  reject: (err: Error) => void;
}

/** Drives one player slot from a remote policy over the /player WebSocket.
 *  Each decision is request/response with engine-validated retries; on
 *  timeout, disconnect or persistent illegal replies it throws and the
 *  GameRunner falls back to the scripted decision, so games always end. */
export class RemoteAgent implements Agent {
  readonly id: string;
  readonly kind = "remote";
  readonly slot: number;
  #socket: WebSocket | null = null;
  #waiter: Waiter | null = null;
  #lastObservation: CoworldServerMessage | null = null;
  #decisionId = 0;
  #actTimeoutMs: number;
  onConnect?: () => void;

  constructor(slot: number, actTimeoutMs: number) {
    this.slot = slot;
    this.id = `remote${slot}`;
    this.#actTimeoutMs = actTimeoutMs;
  }

  get connected(): boolean {
    return this.#socket !== null && this.#socket.readyState === WebSocket.OPEN;
  }

  /** Adopt a (re)connected player socket; replaces any previous one. */
  attach(socket: WebSocket, welcome: CoworldServerMessage): void {
    this.#socket?.close(1000, "replaced by a new connection");
    this.#socket = socket;
    socket.on("message", (raw) => this.#onMessage(raw.toString()));
    socket.on("close", () => {
      if (this.#socket === socket) this.#socket = null;
    });
    this.#send(welcome);
    // A reconnect mid-decision gets the pending observation again.
    if (this.#waiter && this.#lastObservation) this.#send(this.#lastObservation);
    this.onConnect?.();
  }

  send(message: CoworldServerMessage): void {
    this.#send(message);
  }

  closeSocket(): void {
    this.#socket?.close(1000, "episode over");
    this.#socket = null;
  }

  #send(message: CoworldServerMessage): void {
    if (this.connected) this.#socket!.send(JSON.stringify(message));
  }

  #onMessage(raw: string): void {
    const waiter = this.#waiter;
    if (!waiter) return;
    let message: CoworldPlayerMessage;
    try {
      message = coworldPlayerMessageSchema.parse(JSON.parse(raw));
    } catch (err) {
      waiter.reject(new RuleError(`unparseable reply: ${String(err)}`));
      return;
    }
    // Stale replies to an earlier decision are dropped, not penalized.
    if (message.decisionId !== undefined && message.decisionId !== waiter.decisionId) return;
    waiter.resolve(message);
  }

  async #request(observation: CoworldServerMessage & { type: "observation" }): Promise<CoworldPlayerMessage> {
    if (!this.connected) throw new Error(`player slot ${this.slot} is not connected`);
    this.#lastObservation = observation;
    this.#send(observation);
    return new Promise<CoworldPlayerMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        finish();
        reject(new Error(`player slot ${this.slot} took longer than ${this.#actTimeoutMs}ms`));
      }, this.#actTimeoutMs);
      const finish = () => {
        clearTimeout(timer);
        if (this.#waiter?.decisionId === observation.decisionId) this.#waiter = null;
      };
      this.#waiter = {
        decisionId: observation.decisionId,
        resolve: (message) => {
          finish();
          resolve(message);
        },
        reject: (err) => {
          finish();
          reject(err);
        },
      };
    });
  }

  async #decide<T>(
    view: AgentView,
    phase: "work" | "feeding",
    extract: (message: CoworldPlayerMessage) => T | null,
    validate: (decision: T) => void,
  ): Promise<T> {
    const decisionId = ++this.#decisionId;
    let error: string | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const { state, handSizes } = redactState(view.state, view.playerIdx, { maskFuture: true });
      let reply: CoworldPlayerMessage;
      try {
        reply = await this.#request({
          type: "observation",
          slot: view.playerIdx,
          decisionId,
          phase,
          attempt,
          error,
          state,
          handSizes,
          options: view.options,
          choices: view.choices,
        });
      } catch (err) {
        // Unparseable replies burn an attempt; timeouts and disconnects
        // (plain Error) abort the decision and trigger the scripted fallback.
        if (!(err instanceof RuleError)) throw err;
        error = err.message;
        continue;
      }
      const decision = extract(reply);
      if (decision === null) {
        error = `expected a "${phase === "work" ? "place" : "feed"}" reply, got "${reply.type}"`;
        continue;
      }
      try {
        validate(decision);
        return decision;
      } catch (err) {
        if (!(err instanceof RuleError)) throw err;
        error = err.message;
      }
    }
    throw new Error(`player slot ${this.slot} sent ${MAX_ATTEMPTS} illegal replies (last: ${error})`);
  }

  async decidePlacement(view: AgentView): Promise<Placement> {
    return this.#decide(
      view,
      "work",
      (reply) => (reply.type === "place" ? reply.placement : null),
      (placement) => {
        applyPlacement(view.state, view.playerIdx, placement);
      },
    );
  }

  async decideFeeding(view: AgentView): Promise<FeedDecision> {
    return this.#decide(
      view,
      "feeding",
      (reply) => (reply.type === "feed" ? reply.decision : null),
      (decision) => {
        applyFeeding(view.state, view.playerIdx, decision);
      },
    );
  }
}
