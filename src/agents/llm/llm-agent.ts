import { Tool } from "@aws-sdk/client-bedrock-runtime";
import { Agent, AgentView, ActPromptEntry } from "../types";
import { BedrockToolUseClient, ConverseUsage, ToolUseClient } from "./tool-client";
import { renderFeedingPrompt, renderPlacementPrompt, SYSTEM_PROMPT } from "./render";
import { Capabilities, NO_CAPABILITIES, capabilitySuffix } from "./prompt";
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

/** Add the optional `diary`/`say` fields to a tool's input schema when the
 *  matching capability is enabled, so the model can write memory / talk in the
 *  same tool call as its move. */
function withCapabilityFields(tool: Tool, cap: Capabilities): Tool {
  if (!cap.memory && !cap.chat) return tool;
  const spec = tool.toolSpec!;
  // inputSchema.json is an open document type; clone its properties shallowly.
  const json = (spec.inputSchema as unknown as { json: { properties: Record<string, unknown> } })
    .json;
  const properties = { ...json.properties };
  if (cap.memory) {
    properties.diary = {
      type: "string",
      description: "optional: a short note to save in your private diary for future turns",
    };
  }
  if (cap.chat) {
    properties.say = {
      type: "string",
      description: "optional: a short public message to the other players",
    };
  }
  return {
    toolSpec: {
      ...spec,
      inputSchema: { json: { ...json, properties } } as unknown as typeof spec.inputSchema,
    },
  };
}

export interface LlmAgentOpts {
  client?: ToolUseClient;
  maxAttempts?: number;
  /** Bedrock model id; overrides the env/default in BedrockToolUseClient. */
  model?: string;
  /** System prompt override; defaults to the shipped SYSTEM_PROMPT. Lets the
   *  experiment harness seat each player with a different policy prompt. */
  system?: string;
  /** Optional diary/chat capabilities for this seat (default: none). */
  capabilities?: Capabilities;
  /** Post a table-talk message from this seat (chat capability). */
  onChat?: (to: number | null, text: string, round: number) => void;
  /** Per-decision token usage (incl. cache hits) for cost accounting. */
  onUsage?: (usage: ConverseUsage) => void;
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

/** Strip the free-text meta fields (thoughts/diary/say) before schema
 *  validation; they are routed separately, not part of the move. */
function withoutMeta(input: unknown): unknown {
  if (input && typeof input === "object") {
    const { thoughts: _t, diary: _d, say: _s, ...rest } = input as Record<string, unknown>;
    return rest;
  }
  return input;
}

/** Keep the diary bounded so the per-turn prompt does not grow without limit. */
const MEMORY_CAP = 16;

export function llmAgent(id: string, opts: LlmAgentOpts = {}): Agent {
  const client = opts.client ?? new BedrockToolUseClient({ model: opts.model });
  const maxAttempts = opts.maxAttempts ?? 3;
  const capabilities = opts.capabilities ?? NO_CAPABILITIES;
  const system = (opts.system ?? SYSTEM_PROMPT) + capabilitySuffix(capabilities);
  const placementTool = withCapabilityFields(PLACEMENT_TOOL, capabilities);
  const feedingTool = withCapabilityFields(FEEDING_TOOL, capabilities);
  /** This seat's diary, persisted across the game (memory capability). */
  const memory: string[] = [];

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
          system,
          messages: [{ role: "user", content: [{ text: userText }] }],
          tools: [tool],
          cache: true,
        });
        content = result.content;
        if (result.usage) opts.onUsage?.(result.usage);
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
        const decision = parse(withoutMeta(input));
        validate(decision);
        // The move is legal: commit any diary note and outgoing message.
        const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
        if (capabilities.memory && typeof raw.diary === "string" && raw.diary.trim()) {
          memory.push(`r${view.state.round}: ${raw.diary.trim()}`);
          if (memory.length > MEMORY_CAP) memory.splice(0, memory.length - MEMORY_CAP);
        }
        if (capabilities.chat && typeof raw.say === "string" && raw.say.trim()) {
          opts.onChat?.(null, raw.say.trim(), view.state.round);
        }
        opts.onActPrompt?.({
          playerIdx: view.playerIdx,
          round: view.state.round,
          phase,
          content: transcript.join("\n\n"),
          fellBack: false,
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
      fellBack: true,
    });
    return decision;
  }

  return {
    id,
    kind: "llm",
    async decidePlacement(view: AgentView): Promise<Placement> {
      view.memory = capabilities.memory ? memory : undefined;
      return decide(
        view,
        "work",
        renderPlacementPrompt(view),
        placementTool,
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
      view.memory = capabilities.memory ? memory : undefined;
      return decide(
        view,
        "feeding",
        renderFeedingPrompt(view),
        feedingTool,
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
