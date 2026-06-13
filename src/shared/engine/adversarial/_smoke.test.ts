import { describe, expect, it } from "vitest";
import { mkGame, playToEnd, playToFeeding, fillRound, advanceTo, ensureSpace, place } from "./harness";

describe("harness smoke", () => {
  it("plays a 2p game to completion", () => {
    const s = playToEnd(mkGame(2, 1));
    expect(s.phase).toBe("finished");
    expect(s.scores).toHaveLength(2);
  });
  it("reaches feeding at round 4", () => {
    const s = playToFeeding(mkGame(3, 2));
    expect(s.phase).toBe("feeding");
    expect(s.round).toBe(4);
  });
  it("fillRound advances the round", () => {
    const s = fillRound(mkGame(4, 3));
    expect(s.round).toBe(2);
  });
  it("advanceTo returns control to a player", () => {
    let s = mkGame(2, 4);
    const idx = s.currentPlayer;
    s = place(s, { action: "forest" });
    s = advanceTo(s, idx);
    expect(s.currentPlayer).toBe(idx);
  });
  it("ensureSpace adds a round card", () => {
    const s = mkGame(2, 5);
    ensureSpace(s, "r_improvement");
    expect(s.actionSpaces.some((a) => a.id === "r_improvement")).toBe(true);
  });
});
