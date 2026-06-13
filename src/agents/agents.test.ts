import { describe, expect, it } from "vitest";
import { newGame } from "../shared/engine/game";
import { runToCompletion } from "./run";
import { randomAgent, scriptedAgent } from "./scripted";
import { llmAgent } from "./llm/llm-agent";
import { ConverseRequest, ToolUseClient } from "./llm/tool-client";
import { buildView } from "./run";
import { ChatMessage } from "../shared/protocol";

describe("scripted agent", () => {
  it("completes full games at every player count", async () => {
    for (const numPlayers of [1, 2, 3, 4]) {
      const agents = Array.from({ length: numPlayers }, (_, i) => scriptedAgent(`p${i}`));
      const final = await runToCompletion(newGame({ seed: 21 + numPlayers, numPlayers }), agents);
      expect(final.phase).toBe("finished");
      expect(final.scores).toHaveLength(numPlayers);
    }
  });

  it("keeps begging in check on average", async () => {
    let begging = 0;
    for (const seed of [3, 9, 17]) {
      const agents = [0, 1, 2, 3].map((i) => scriptedAgent(`p${i}`));
      const final = await runToCompletion(newGame({ seed, numPlayers: 4 }), agents);
      begging += final.players.reduce((s, p) => s + p.beggingCards, 0);
    }
    // 12 player-games; a sane bot averages well under 2 begging cards each.
    expect(begging).toBeLessThan(24);
  });
});

describe("random agent", () => {
  it("survives fuzzing across seeds", async () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const agents = [0, 1, 2].map((i) => randomAgent(`p${i}`, seed * 100 + i));
      const final = await runToCompletion(newGame({ seed, numPlayers: 3 }), agents);
      expect(final.phase).toBe("finished");
    }
  });
});

describe("llm agent", () => {
  it("uses the tool result when valid, falls back when the model misbehaves", async () => {
    const state = newGame({ seed: 7, numPlayers: 2 });
    const view = buildView(state, state.currentPlayer);

    const goodClient: ToolUseClient = {
      async converse() {
        return {
          content: [
            { toolUse: { name: "submit_placement", input: { action: "forest", thoughts: "wood" } } },
          ],
        };
      },
    };
    const good = llmAgent("llm0", { client: goodClient });
    const placement = await good.decidePlacement(view);
    expect(placement.action).toBe("forest");

    let calls = 0;
    const badClient: ToolUseClient = {
      async converse() {
        calls++;
        return {
          content: [
            { toolUse: { name: "submit_placement", input: { action: "not_a_space" } } },
          ],
        };
      },
    };
    const bad = llmAgent("llm1", { client: badClient, maxAttempts: 2 });
    const fallback = await bad.decidePlacement(view);
    expect(calls).toBe(2);
    // Fallback is the scripted agent's best candidate — a real action.
    expect(state.actionSpaces.some((s) => s.id === fallback.action)).toBe(true);
  });

  it("records the prompt transcript via onActPrompt", async () => {
    const state = newGame({ seed: 7, numPlayers: 2 });
    const view = buildView(state, state.currentPlayer);
    const prompts: string[] = [];
    const client: ToolUseClient = {
      async converse() {
        return {
          content: [{ toolUse: { name: "submit_placement", input: { action: "fishing" } } }],
        };
      },
    };
    const agent = llmAgent("llm0", {
      client,
      onActPrompt: (entry) => prompts.push(entry.content),
    });
    await agent.decidePlacement(view);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Round 1");
    expect(prompts[0]).toContain("submit_placement");
  });

  it("baseline seat sends no diary/say fields and still caches", async () => {
    const state = newGame({ seed: 7, numPlayers: 2 });
    const view = buildView(state, state.currentPlayer);
    let req: ConverseRequest | undefined;
    const client: ToolUseClient = {
      async converse(r) {
        req = r;
        return { content: [{ toolUse: { name: "submit_placement", input: { action: "forest" } } }] };
      },
    };
    await llmAgent("llm0", { client }).decidePlacement(view);
    const props = (req!.tools[0]!.toolSpec!.inputSchema as { json: { properties: Record<string, unknown> } })
      .json.properties;
    expect(props.diary).toBeUndefined();
    expect(props.say).toBeUndefined();
    // Bedrock prompt caching is always requested to save tokens.
    expect(req!.cache).toBe(true);
  });

  it("memory capability: diary is saved and shown back on the next turn", async () => {
    const state = newGame({ seed: 7, numPlayers: 2 });
    const view = buildView(state, state.currentPlayer);
    const prompts: string[] = [];
    let req: ConverseRequest | undefined;
    const client: ToolUseClient = {
      async converse(r) {
        req = r;
        return {
          content: [
            {
              toolUse: {
                name: "submit_placement",
                input: { action: "forest", diary: "save wood for a room", say: "grabbing forest" },
              },
            },
          ],
        };
      },
    };
    const sent: { to: number | null; text: string }[] = [];
    const agent = llmAgent("llm0", {
      client,
      capabilities: { memory: true, chat: true },
      onChat: (to, text) => sent.push({ to, text }),
      onActPrompt: (e) => prompts.push(e.content),
    });
    // Tool schema exposes the capability fields.
    await agent.decidePlacement(view);
    const props = (req!.tools[0]!.toolSpec!.inputSchema as { json: { properties: Record<string, unknown> } })
      .json.properties;
    expect(props.diary).toBeDefined();
    expect(props.say).toBeDefined();
    // The system prompt explains the capabilities.
    expect(req!.system).toContain("DIARY");
    expect(req!.system).toContain("MESSAGES");
    // The message was posted publicly.
    expect(sent).toEqual([{ to: null, text: "grabbing forest" }]);
    // Second turn: the diary note is rendered back into the prompt.
    await agent.decidePlacement(view);
    expect(prompts[1]).toContain("YOUR DIARY");
    expect(prompts[1]).toContain("save wood for a room");
  });

  it("chat capability: messages from other cogs appear in the prompt", async () => {
    const state = newGame({ seed: 7, numPlayers: 2 });
    const view = buildView(state, 0);
    const incoming: ChatMessage[] = [
      { seq: 0, round: 1, from: 1, to: null, text: "leave me the forest" },
    ];
    view.messages = incoming;
    const prompts: string[] = [];
    const client: ToolUseClient = {
      async converse() {
        return { content: [{ toolUse: { name: "submit_placement", input: { action: "forest" } } }] };
      },
    };
    const agent = llmAgent("llm0", {
      client,
      capabilities: { memory: false, chat: true },
      onActPrompt: (e) => prompts.push(e.content),
    });
    await agent.decidePlacement(view);
    expect(prompts[0]).toContain("MESSAGES FROM OTHER COGS");
    expect(prompts[0]).toContain("leave me the forest");
  });

  it("feeding decision validates and falls back to auto-feed", async () => {
    const state = newGame({ seed: 7, numPlayers: 2 });
    state.phase = "feeding";
    state.toFeed = [0, 1];
    const view = buildView(state, 0);
    const client: ToolUseClient = {
      async converse() {
        return {
          content: [
            {
              toolUse: {
                name: "submit_feeding",
                input: { conversions: [{ via: "joinery", good: "wood", count: 9 }] },
              },
            },
          ],
        };
      },
    };
    const agent = llmAgent("llm0", { client, maxAttempts: 1 });
    const decision = await agent.decideFeeding(view);
    // Invalid conversion (no joinery owned) -> auto-feed fallback (no crash).
    expect(Array.isArray(decision.conversions)).toBe(true);
  });
});
