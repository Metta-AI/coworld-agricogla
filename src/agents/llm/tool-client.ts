import {
  BedrockRuntimeClient,
  ConverseCommand,
  Message,
  SystemContentBlock,
  Tool,
} from "@aws-sdk/client-bedrock-runtime";

/** Structural view of a response content block (SDK-agnostic for test fakes). */
export interface ContentBlockLike {
  text?: string;
  toolUse?: { name?: string; input?: unknown };
}

/** Token accounting, including Bedrock prompt-cache hits/writes. */
export interface ConverseUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheWriteInputTokens: number;
}

export interface ConverseRequest {
  system: string;
  messages: Message[];
  tools: Tool[];
  maxTokens?: number;
  temperature?: number;
  /** Insert Bedrock cache breakpoints after the system prompt and the tool
   *  schema (the constant prefix) so repeated decisions in a game re-read the
   *  cache instead of re-paying for those tokens. */
  cache?: boolean;
}

export interface ConverseResult {
  content: ContentBlockLike[];
  stopReason?: string;
  usage?: ConverseUsage;
}

export interface ToolUseClient {
  converse(req: ConverseRequest): Promise<ConverseResult>;
}

// BEDROCK_MODEL is what `coworld upload-policy --bedrock-model` injects into
// hosted player pods; AGRICOGLA_BEDROCK_MODEL stays the local override.
const DEFAULT_MODEL =
  process.env.AGRICOGLA_BEDROCK_MODEL ??
  process.env.BEDROCK_MODEL ??
  "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const DEFAULT_REGION =
  process.env.AGRICOGLA_BEDROCK_REGION ?? process.env.AWS_REGION ?? "us-west-2";
const DEFAULT_TIMEOUT = Number(process.env.AGRICOGLA_BEDROCK_TIMEOUT_MS ?? 20_000);

export class BedrockToolUseClient implements ToolUseClient {
  #client: BedrockRuntimeClient;
  #model: string;

  constructor(opts: { client?: BedrockRuntimeClient; model?: string; region?: string } = {}) {
    this.#client =
      opts.client ??
      new BedrockRuntimeClient({
        region: opts.region ?? DEFAULT_REGION,
        requestHandler: { requestTimeout: DEFAULT_TIMEOUT },
      });
    this.#model = opts.model ?? DEFAULT_MODEL;
  }

  async converse(req: ConverseRequest): Promise<ConverseResult> {
    const cachePoint = { cachePoint: { type: "default" as const } };
    const system: SystemContentBlock[] = req.cache
      ? [{ text: req.system }, cachePoint]
      : [{ text: req.system }];
    // A cache point after the tools array caches the (constant) system prompt
    // + tool schema; the per-turn user message stays uncached.
    const tools: Tool[] = req.cache ? [...req.tools, cachePoint] : req.tools;
    const command = new ConverseCommand({
      modelId: this.#model,
      system,
      messages: req.messages,
      toolConfig: { tools },
      inferenceConfig: {
        maxTokens: req.maxTokens ?? 1024,
        // Newer Claude models reject `temperature` on Bedrock Converse
        // ("deprecated for this model"); only send it when asked for.
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      },
    });
    const response = await this.#client.send(command);
    const u = response.usage;
    return {
      content: response.output?.message?.content ?? [],
      stopReason: response.stopReason,
      usage: {
        inputTokens: u?.inputTokens ?? 0,
        outputTokens: u?.outputTokens ?? 0,
        cacheReadInputTokens: u?.cacheReadInputTokens ?? 0,
        cacheWriteInputTokens: u?.cacheWriteInputTokens ?? 0,
      },
    };
  }
}
