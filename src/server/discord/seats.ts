import { randomBytes } from "node:crypto";
import { GameRunner } from "../game-runner";
import { DiscordUser, displayName } from "./oauth";

interface SeatGrant {
  playerIdx: number;
  token: string;
  userId: string;
}

/** Binds Discord users to lobby seats for the single shared game, and mints the
 *  per-seat token that gates that seat's private hand over `/ws`. The runner owns
 *  game state; this only tracks which Discord identity holds which seat. */
export class DiscordSeats {
  #runner: GameRunner;
  /** seat index → grant. */
  #bySeat = new Map<number, SeatGrant>();
  /** Discord user id → seat index, so a reconnecting user reclaims their seat. */
  #byUser = new Map<string, number>();

  constructor(runner: GameRunner) {
    this.#runner = runner;
  }

  /** Claim (or re-claim) a seat for a user. Throws RuleError from the runner if
   *  the table is full or the game has already started. */
  claim(user: DiscordUser): SeatGrant {
    const existing = this.#byUser.get(user.id);
    if (existing !== undefined) {
      const grant = this.#bySeat.get(existing);
      if (grant) return grant;
    }
    const playerIdx = this.#runner.seat(displayName(user), "human");
    const grant: SeatGrant = { playerIdx, token: randomBytes(24).toString("hex"), userId: user.id };
    this.#bySeat.set(playerIdx, grant);
    this.#byUser.set(user.id, playerIdx);
    return grant;
  }

  /** True if `token` is the live grant for `playerIdx`. Used by the socket hub
   *  to authorize a seated client (and, by absence, to spectate everyone else). */
  validate(playerIdx: number, token: string | undefined): boolean {
    if (token === undefined) return false;
    return this.#bySeat.get(playerIdx)?.token === token;
  }

  /** Fill any empty seats with `llm` bots and begin play. */
  startWithBots(): void {
    this.#runner.fillWithBots();
    this.#runner.resume();
  }

  /** Drop every grant and return the table to an empty lobby for a new game. */
  reset(): void {
    this.#bySeat.clear();
    this.#byUser.clear();
    this.#runner.clearSeats();
  }
}
