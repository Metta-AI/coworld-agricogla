import {
  BedrockRuntimeClient,
  ConverseCommand,
  Message,
  Tool,
} from "@aws-sdk/client-bedrock-runtime";

/** Structural view of a response content block (SDK-agnostic for test fakes). */
export interface ContentBlockLike {
  text?: string;
  toolUse?: { name?: string; input?: unknown };
}

export interface ConverseRequest {
  system: string;
  messages: Message[];
  tools: Tool[];
  maxTokens?: number;
  temperature?: number;
}

export interface ConverseResult {
  content: ContentBlockLike[];
  stopReason?: string;
}

export interface ToolUseClient {
  converse(req: ConverseRequest): Promise<ConverseResult>;
}

const DEFAULT_MODEL =
  process.env.AGRICOGLA_BEDROCK_MODEL ?? "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const DEFAULT_REGION =
  process.env.AGRICOGLA_BEDROCK_REGION ?? process.env.AWS_REGION ?? "us-west-2";
const DEFAULT_TIMEOUT = Number(process.env.AGRICOGLA_BEDROCK_TIMEOUT_MS ?? 30_000);

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
    const command = new ConverseCommand({
      modelId: this.#model,
      system: [{ text: req.system }],
      messages: req.messages,
      toolConfig: { tools: req.tools },
      inferenceConfig: {
        maxTokens: req.maxTokens ?? 1024,
        temperature: req.temperature ?? 0.6,
      },
    });
    const response = await this.#client.send(command);
    return {
      content: response.output?.message?.content ?? [],
      stopReason: response.stopReason,
    };
  }
}
