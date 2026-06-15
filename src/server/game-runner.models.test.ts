import { describe, expect, it } from "vitest";
import { GameRunner } from "./game-runner";
import { BedrockModel, DEFAULT_BEDROCK_MODEL } from "../shared/protocol";

const HAIKU = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const OPUS46 = "us.anthropic.claude-opus-4-6-v1";

function runner(numPlayers = 2): GameRunner {
  return new GameRunner({
    seed: 1,
    numPlayers,
    controllers: Array(numPlayers).fill("scripted"),
    paceMs: 0,
    startPaused: true,
  });
}

describe("GameRunner autopilot models", () => {
  it("starts with no discovered models and the static default per seat", () => {
    const s = runner(2).status();
    expect(s.availableModels).toEqual([]);
    expect(s.models).toEqual([DEFAULT_BEDROCK_MODEL, DEFAULT_BEDROCK_MODEL]);
  });

  it("publishes discovered models and snaps unavailable seat models to an available one", () => {
    const r = runner(2);
    const models: BedrockModel[] = [
      { id: OPUS46, label: "Opus 4.6" },
      { id: HAIKU, label: "Haiku 4.5" },
    ];
    r.setAvailableModels(models); // the default opus-4-8 is not in this set
    const s = r.status();
    expect(s.availableModels).toEqual(models);
    expect(s.models).toEqual([OPUS46, OPUS46]); // both snapped to the first available
  });

  it("keeps a seat's model when it is still available", () => {
    const r = runner(2);
    r.setAvailableModels([
      { id: DEFAULT_BEDROCK_MODEL, label: "default" },
      { id: HAIKU, label: "Haiku 4.5" },
    ]);
    expect(r.status().models).toEqual([DEFAULT_BEDROCK_MODEL, DEFAULT_BEDROCK_MODEL]);
  });

  it("leaves seat models untouched when discovery finds nothing", () => {
    const r = runner(2);
    r.setAvailableModels([]);
    expect(r.status().models).toEqual([DEFAULT_BEDROCK_MODEL, DEFAULT_BEDROCK_MODEL]);
  });
});

describe("GameRunner scrubber history", () => {
  it("has no round frames until play begins", () => {
    expect(runner(2).roundFrames()).toHaveLength(0);
  });

  it("seeds a round-1 frame when play starts (full scrubber for late joiners)", () => {
    const r = runner(2);
    r.resume();
    r.pause(); // halt the background scripted game so the count is stable
    const frames = r.roundFrames();
    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect(frames[0]).toMatchObject({ round: 1, seed: 1 });
  });

  it("restarts the timeline on a new game", () => {
    const r = runner(2);
    r.resume();
    r.pause();
    r.toLobby(); // "New game" → back to the lobby clears the finished timeline
    expect(r.roundFrames()).toHaveLength(0);
    r.resume(); // Start a fresh game
    r.pause();
    const frames = r.roundFrames();
    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect(frames[0]!.round).toBe(1);
  });
});
