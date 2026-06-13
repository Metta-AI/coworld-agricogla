/** Loads and resolves prompt variants from `experiments/variants/*.json`.
 *
 *  A variant is a partial override of the baseline blocks. "baseline" resolves
 *  to the shipped DEFAULT_BLOCKS with no guidance. Any other name loads
 *  `<dir>/<name>.json`, resolves its `parent` (default "baseline"), then layers
 *  its own block overrides and guidance on top. A `system` field, if present,
 *  bypasses block composition entirely. */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_BLOCKS,
  PromptBlocks,
  composeSystemPrompt,
} from "../agents/llm/prompt";
import { PromptVariant, ResolvedVariant, promptVariantSchema } from "./types";

export const VARIANTS_DIR = join(process.cwd(), "experiments", "variants");

export const BASELINE_NAME = "baseline";

function loadVariantFile(name: string, dir: string): PromptVariant {
  const path = join(dir, `${name}.json`);
  if (!existsSync(path)) {
    throw new Error(
      `unknown variant "${name}": no ${path} (and not the baseline). ` +
        `Create the JSON file or use "baseline".`,
    );
  }
  return promptVariantSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** Resolve a variant name to a complete prompt, following `parent` chains.
 *  Guards against cycles. */
export function resolveVariant(
  name: string,
  dir: string = VARIANTS_DIR,
  seen: Set<string> = new Set(),
): ResolvedVariant {
  if (name === BASELINE_NAME) {
    return {
      name: BASELINE_NAME,
      blocks: { ...DEFAULT_BLOCKS },
      system: composeSystemPrompt(DEFAULT_BLOCKS),
      guidance: "",
      capabilities: { memory: false, chat: false },
    };
  }
  if (seen.has(name)) {
    throw new Error(`variant parent cycle through "${name}"`);
  }
  seen.add(name);

  const variant = loadVariantFile(name, dir);
  const parent = resolveVariant(variant.parent ?? BASELINE_NAME, dir, seen);

  const blocks: PromptBlocks = {
    intro: variant.blocks.intro ?? parent.blocks.intro,
    rules: variant.blocks.rules ?? parent.blocks.rules,
    strategy: variant.blocks.strategy ?? parent.blocks.strategy,
    output: variant.blocks.output ?? parent.blocks.output,
  };

  // A variant's own guidance overrides the parent's only when non-empty.
  const guidance = variant.guidance.trim() || parent.guidance;

  // Capabilities: inherit from parent, then apply this variant's explicit flags.
  const capabilities = {
    memory: variant.capabilities.memory ?? parent.capabilities.memory,
    chat: variant.capabilities.chat ?? parent.capabilities.chat,
  };

  return {
    name: variant.name || name,
    blocks,
    system: variant.system ?? composeSystemPrompt(blocks),
    guidance,
    capabilities,
  };
}
