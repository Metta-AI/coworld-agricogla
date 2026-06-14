import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, composeSystemPrompt, DEFAULT_BLOCKS } from "../agents/llm/prompt";
import { resolveVariant } from "./variants";
import { arrangements, signTestP } from "./ab-test";
import { runGame } from "./run-game";

describe("prompt blocks", () => {
  it("composes the default blocks into the shipped system prompt", () => {
    expect(composeSystemPrompt(DEFAULT_BLOCKS)).toBe(SYSTEM_PROMPT);
  });
  it("drops an ablated (empty) block", () => {
    const out = composeSystemPrompt({ ...DEFAULT_BLOCKS, strategy: "" });
    expect(out).not.toContain("Strategy basics");
    expect(out).toContain("Key rules");
  });
});

describe("resolveVariant", () => {
  it("resolves baseline to the shipped prompt with no guidance", () => {
    const r = resolveVariant("baseline");
    expect(r.system).toBe(SYSTEM_PROMPT);
    expect(r.guidance).toBe("");
  });

  it("layers a variant's block override and guidance over the parent", () => {
    const dir = mkdtempSync(join(tmpdir(), "variants-"));
    writeFileSync(
      join(dir, "cand-x.json"),
      JSON.stringify({
        name: "cand-x",
        parent: "baseline",
        blocks: { strategy: "Grow family every single round." },
        guidance: "fence pastures early",
      }),
    );
    const r = resolveVariant("cand-x", dir);
    expect(r.system).toContain("Grow family every single round.");
    expect(r.system).toContain("Key rules"); // inherited from baseline
    expect(r.system).not.toContain("Strategy basics: feed the family first");
    expect(r.guidance).toBe("fence pastures early");
  });

  it("throws on an unknown variant", () => {
    const dir = mkdtempSync(join(tmpdir(), "variants-"));
    expect(() => resolveVariant("nope", dir)).toThrow(/unknown variant/);
  });

  it("baseline has no capabilities; a variant can enable them", () => {
    expect(resolveVariant("baseline").capabilities).toEqual({ memory: false, chat: false });
    const dir = mkdtempSync(join(tmpdir(), "variants-"));
    writeFileSync(
      join(dir, "cand-cap.json"),
      JSON.stringify({ name: "cand-cap", capabilities: { memory: true, chat: true } }),
    );
    expect(resolveVariant("cand-cap", dir).capabilities).toEqual({ memory: true, chat: true });
  });

  it("inherits a parent's capabilities, overriding only what it sets", () => {
    const dir = mkdtempSync(join(tmpdir(), "variants-"));
    writeFileSync(
      join(dir, "p.json"),
      JSON.stringify({ name: "p", capabilities: { memory: true, chat: true } }),
    );
    writeFileSync(
      join(dir, "c.json"),
      JSON.stringify({ name: "c", parent: "p", capabilities: { chat: false } }),
    );
    expect(resolveVariant("c", dir).capabilities).toEqual({ memory: true, chat: false });
  });
});

describe("A/B statistics & seat rotation", () => {
  it("rotates the candidate through every board position over two arrangements", () => {
    const [arrA, arrB] = arrangements("cand", "base");
    const candPositions = new Set<number>();
    arrA!.forEach((s, i) => s.label === "candidate" && candPositions.add(i));
    arrB!.forEach((s, i) => s.label === "candidate" && candPositions.add(i));
    expect([...candPositions].sort()).toEqual([0, 1, 2, 3]);
    // Each arrangement is a balanced 2 vs 2 split.
    expect(arrA!.filter((s) => s.label === "candidate")).toHaveLength(2);
    expect(arrB!.filter((s) => s.label === "candidate")).toHaveLength(2);
  });

  it("sign test: a clean sweep is significant, an even split is not", () => {
    expect(signTestP(8, 0)).toBeLessThan(0.01);
    expect(signTestP(4, 4)).toBe(1);
    expect(signTestP(0, 0)).toBe(1);
  });
});

describe("runGame (free, scripted/random seats)", () => {
  it("plays a full game and reports a coherent result", async () => {
    const { result } = await runGame({
      seed: 5,
      seats: [
        { kind: "scripted", label: "scripted" },
        { kind: "scripted", label: "scripted" },
        { kind: "random", label: "random" },
        { kind: "random", label: "random" },
      ],
      model: "n/a",
      gameId: "test",
    });
    expect(result.seats).toHaveLength(4);
    expect(result.ranking).toHaveLength(4);
    // Winner is the top of the ranking and has the max score.
    const maxTotal = Math.max(...result.seats.map((s) => s.total));
    expect(result.seats[result.winner]!.total).toBe(maxTotal);
    expect(result.ranking[0]).toBe(result.winner);
    // No LLM seats, so no LLM decisions or fallbacks.
    expect(result.totalLlmDecisions).toBe(0);
    expect(result.fallbackRate).toBe(0);
    // Scripted should beat random.
    const scriptedTotals = result.seats.filter((s) => s.kind === "scripted").map((s) => s.total);
    const randomTotals = result.seats.filter((s) => s.kind === "random").map((s) => s.total);
    expect(Math.max(...scriptedTotals)).toBeGreaterThan(Math.max(...randomTotals));
  });
});
