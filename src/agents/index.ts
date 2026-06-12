import { Agent, ActPromptEntry } from "./types";
import { randomAgent, scriptedAgent } from "./scripted";
import { llmAgent } from "./llm/llm-agent";

export type AgentSpec = "scripted" | "random" | "llm";

export interface BuildAgentOpts {
  seed: number;
  onActPrompt?: (entry: ActPromptEntry) => void;
}

export function buildAgent(spec: string, id: string, opts: BuildAgentOpts): Agent {
  switch (spec) {
    case "scripted":
      return scriptedAgent(id);
    case "random":
      return randomAgent(id, opts.seed);
    case "llm":
      return llmAgent(id, { onActPrompt: opts.onActPrompt });
    default:
      throw new Error(`unknown agent spec: ${spec} (use scripted|random|llm)`);
  }
}

export { scriptedAgent, randomAgent, llmAgent };
export type { Agent, ActPromptEntry } from "./types";
