import { describe, expect, it } from "vitest";
import { newGame } from "../../shared/engine/game";
import { buildView } from "../run";
import { renderFeedingPrompt, renderPlacementPrompt } from "./render";

describe("autopilot guidance in prompts", () => {
  it("prepends the operator directive to the placement prompt", () => {
    const state = newGame({ seed: 3, numPlayers: 3 });
    const view = buildView(state, 0);
    view.guidance = "hoard wood and fence pastures early";
    const prompt = renderPlacementPrompt(view);
    expect(prompt.startsWith("GUIDANCE FROM YOUR OPERATOR")).toBe(true);
    expect(prompt).toContain("hoard wood and fence pastures early");
  });

  it("prepends the directive to the feeding prompt too", () => {
    const state = newGame({ seed: 3, numPlayers: 3 });
    const view = buildView(state, 0);
    view.guidance = "never let a breeding pair die";
    expect(renderFeedingPrompt(view)).toContain("never let a breeding pair die");
  });

  it("omits the guidance block when no directive is set", () => {
    const state = newGame({ seed: 3, numPlayers: 3 });
    const prompt = renderPlacementPrompt(buildView(state, 0));
    expect(prompt).not.toContain("GUIDANCE FROM YOUR OPERATOR");
  });
});
