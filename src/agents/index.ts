import { Agent, ActPromptEntry } from "./types";
import { randomAgent, scriptedAgent } from "./scripted";
import { llmAgent } from "./llm/llm-agent";
import { Capabilities } from "./llm/prompt";

export type AgentSpec = "scripted" | "random" | "llm";

export interface BuildAgentOpts {
  seed: number;
  /** Bedrock model id for llm agents. */
  model?: string;
  /** Diary/chat capabilities for llm agents (default: none). */
  capabilities?: Capabilities;
  /** Post a table-talk message from this seat (chat capability). */
  onChat?: (to: number | null, text: string, round: number) => void;
  onActPrompt?: (entry: ActPromptEntry) => void;
}

export function buildAgent(spec: string, id: string, opts: BuildAgentOpts): Agent {
  switch (spec) {
    case "scripted":
      return scriptedAgent(id);
    case "random":
      return randomAgent(id, opts.seed);
    case "llm":
      return llmAgent(id, {
        onActPrompt: opts.onActPrompt,
        model: opts.model,
        capabilities: opts.capabilities,
        onChat: opts.onChat,
      });
    default:
      throw new Error(`unknown agent spec: ${spec} (use scripted|random|llm)`);
  }
}

export { scriptedAgent, randomAgent, llmAgent };
export type { Agent, ActPromptEntry } from "./types";
