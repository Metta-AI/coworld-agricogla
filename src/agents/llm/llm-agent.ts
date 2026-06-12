import { Tool } from "@aws-sdk/client-bedrock-runtime";
import { Agent, AgentView, ActPromptEntry } from "../types";
import { BedrockToolUseClient, ToolUseClient } from "./tool-client";
import { renderFeedingPrompt, renderPlacementPrompt, SYSTEM_PROMPT } from "./render";
import { fallbackPlacement } from "../scripted";
import { applyFeeding, applyPlacement, computeAutoFeed } from "../../shared/engine/apply";
import {
  FeedDecision,
  Placement,
  feedDecisionSchema,
  placementSchema,
} from "../../shared/engine/placements";

const PLACEMENT_TOOL: Tool = {
  toolSpec: {
    name: "submit_placement",
    description:
      "Place one family member on an open action space. Provide the action id and any arguments that action needs.",
    inputSchema: {
      json: {
        type: "object",
        properties: {
          thoughts: { type: "string", description: "brief reasoning" },
          action: { type: "string", description: "action space id (must be OPEN)" },
          rooms: { type: "array", items: { type: "integer" }, description: "farm_expansion: spaces for new rooms" },
          stables: { type: "array", items: { type: "integer" }, description: "farm_expansion: spaces for new stables" },
          spaces: { type: "array", items: { type: "integer" }, description: "farmland: spaces to plow" },
          plowCard: { type: "string", description: "farmland: plow improvement card id to use" },
          occupation: { type: "string", description: "lessons/lessons_b: occupation card id from hand" },
          improvement: {
            type: "object",
            description: "improvement choice for meeting_place / r_improvement / r_renovate_improve / r_family_growth",
            properties: {
              kind: { type: "string", enum: ["major", "minor"] },
              card: { type: "string" },
              returnFireplace: { type: "string" },
              bake: {
                type: "array",
                items: {
                  type: "object",
                  properties: { card: { type: "string" }, grain: { type: "integer" } },
                  required: ["card", "grain"],
                },
              },
            },
            required: ["kind", "card"],
          },
          edges: { type: "array", items: { type: "string" }, description: "r_fences/r_redevelop: fence edge ids" },
          sow: {
            type: "array",
            items: {
              type: "object",
              properties: {
                space: { type: "integer" },
                crop: { type: "string", enum: ["grain", "vegetable"] },
              },
              required: ["space", "crop"],
            },
            description: "r_sow_bake/r_cultivation: fields to sow",
          },
          bake: {
            type: "array",
            items: {
              type: "object",
              properties: { card: { type: "string" }, grain: { type: "integer" } },
              required: ["card", "grain"],
            },
            description: "r_sow_bake: baking conversions",
          },
          plow: { type: "integer", description: "r_cultivation: space to plow" },
        },
        required: ["action"],
      },
    },
  },
};

const FEEDING_TOOL: Tool = {
  toolSpec: {
    name: "submit_feeding",
    description: "Submit your harvest feeding conversions (possibly an empty list).",
    inputSchema: {
      json: {
        type: "object",
        properties: {
          thoughts: { type: "string" },
          conversions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                via: { type: "string", description: '"raw" or a card id' },
                good: { type: "string" },
                count: { type: "integer" },
              },
              required: ["via", "good", "count"],
            },
          },
        },
        required: ["conversions"],
      },
    },
  },
};

export interface LlmAgentOpts {
  client?: ToolUseClient;
  maxAttempts?: number;
  onActPrompt?: (entry: ActPromptEntry) => void;
}

function extractToolInput(content: { toolUse?: { name?: string; input?: unknown } }[], tool: string): unknown {
  for (const block of content) {
    if (block.toolUse?.name === tool) return block.toolUse.input;
  }
  return null;
}

function extractText(content: { text?: string }[]): string {
  return content
    .map((b) => b.text ?? "")
    .filter(Boolean)
    .join("\n");
}

/** Strip the free-text `thoughts` field before schema validation. */
function withoutThoughts(input: unknown): unknown {
  if (input && typeof input === "object" && "thoughts" in input) {
    const { thoughts: _thoughts, ...rest } = input as Record<string, unknown>;
    return rest;
  }
  return input;
}

export function llmAgent(id: string, opts: LlmAgentOpts = {}): Agent {
  const client = opts.client ?? new BedrockToolUseClient();
  const maxAttempts = opts.maxAttempts ?? 3;

  async function decide<T>(
    view: AgentView,
    phase: "work" | "feeding",
    prompt: string,
    tool: Tool,
    toolName: string,
    parse: (input: unknown) => T,
    validate: (decision: T) => void,
    fallback: () => T,
  ): Promise<T> {
    const transcript: string[] = [prompt];
    let userText = prompt;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let content;
      try {
        const result = await client.converse({
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: [{ text: userText }] }],
          tools: [tool],
        });
        content = result.content;
      } catch (err) {
        transcript.push(`bedrock error: ${String(err)}`);
        continue;
      }
      const text = extractText(content);
      if (text) transcript.push(`model: ${text}`);
      const input = extractToolInput(content, toolName);
      if (input === null) {
        userText = `${prompt}\n\nYou must call ${toolName} exactly once.`;
        transcript.push("no tool call; retrying");
        continue;
      }
      transcript.push(`tool input: ${JSON.stringify(input)}`);
      try {
        const decision = parse(withoutThoughts(input));
        validate(decision);
        opts.onActPrompt?.({
          playerIdx: view.playerIdx,
          round: view.state.round,
          phase,
          content: transcript.join("\n\n"),
        });
        return decision;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        transcript.push(`rejected: ${msg}`);
        userText = `${prompt}\n\nYour previous submission was illegal: ${msg}\nPick a different legal option and call ${toolName} again.`;
      }
    }
    const decision = fallback();
    transcript.push(`fell back to scripted decision: ${JSON.stringify(decision)}`);
    opts.onActPrompt?.({
      playerIdx: view.playerIdx,
      round: view.state.round,
      phase,
      content: transcript.join("\n\n"),
    });
    return decision;
  }

  return {
    id,
    kind: "llm",
    async decidePlacement(view: AgentView): Promise<Placement> {
      return decide(
        view,
        "work",
        renderPlacementPrompt(view),
        PLACEMENT_TOOL,
        "submit_placement",
        (input) => placementSchema.parse(input),
        (placement) => {
          // Dry-run against the engine; throws RuleError when illegal.
          applyPlacement(view.state, view.playerIdx, placement);
        },
        () => fallbackPlacement(view),
      );
    },
    async decideFeeding(view: AgentView): Promise<FeedDecision> {
      return decide(
        view,
        "feeding",
        renderFeedingPrompt(view),
        FEEDING_TOOL,
        "submit_feeding",
        (input) => feedDecisionSchema.parse(input),
        (decision) => {
          applyFeeding(view.state, view.playerIdx, decision);
        },
        () => computeAutoFeed(view.state, view.playerIdx),
      );
    },
  };
}
