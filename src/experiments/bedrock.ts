/** A ToolUseClient wrapper for experiments: bounds process-wide Bedrock
 *  concurrency and retries throttling/transient errors with exponential
 *  backoff. Without this, a ThrottlingException bubbles into the agent's
 *  decide() loop and silently degrades the seat to the scripted fallback —
 *  which would quietly contaminate the A/B signal. We retry the network call
 *  first, and only let a non-transient error (or exhausted retries) propagate.
 *
 *  This is experiment-only; the shipped client (tool-client.ts) is unchanged.
 *  Date.now()/Math.random() are fine here (this is not engine code). */
import {
  BedrockToolUseClient,
  ConverseRequest,
  ConverseResult,
  ToolUseClient,
} from "../agents/llm/tool-client";

const MAX_CONCURRENCY = Number(process.env.AGRICOGLA_BEDROCK_CONCURRENCY ?? 8);
const MAX_RETRIES = Number(process.env.AGRICOGLA_BEDROCK_MAX_RETRIES ?? 6);
const BASE_DELAY_MS = Number(process.env.AGRICOGLA_BEDROCK_BACKOFF_MS ?? 800);

/** Process-wide gate so many concurrent games don't exceed Bedrock TPM/RPM. */
class Semaphore {
  #permits: number;
  #queue: Array<() => void> = [];
  constructor(permits: number) {
    this.#permits = permits;
  }
  async acquire(): Promise<void> {
    if (this.#permits > 0) {
      this.#permits--;
      return;
    }
    await new Promise<void>((resolve) => this.#queue.push(resolve));
  }
  release(): void {
    this.#permits++;
    const next = this.#queue.shift();
    if (next) {
      this.#permits--;
      next();
    }
  }
}

const gate = new Semaphore(MAX_CONCURRENCY);

function isTransient(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  const name = e?.name ?? "";
  const status = e?.$metadata?.httpStatusCode;
  return (
    // Throttling / server blips.
    /Throttling|TooManyRequests|ServiceUnavailable|ModelTimeout|InternalServer/i.test(name) ||
    // Credential refresh hiccups: an SSO role-cred refresh can momentarily fail
    // and recover on the next attempt. Retrying these (instead of letting them
    // become a silent scripted fallback) keeps the A/B signal clean; a truly
    // expired session is caught by the preflight check instead.
    /Credentials|ExpiredToken|UnrecognizedClient/i.test(name) ||
    status === 429 ||
    status === 503 ||
    status === 500
  );
}

/** One cheap Bedrock call to fail fast (with a clear message) when credentials
 *  are missing/expired, instead of silently degrading every game to the scripted
 *  fallback and contaminating the whole A/B run. */
export async function preflightBedrock(model: string): Promise<void> {
  try {
    await new RetryingToolUseClient({ model }).converse({
      system: "preflight",
      messages: [{ role: "user", content: [{ text: "ok" }] }],
      tools: [
        {
          toolSpec: {
            name: "ok",
            description: "ok",
            inputSchema: { json: { type: "object", properties: {} } },
          },
        },
      ],
    });
  } catch (err) {
    const name = (err as { name?: string })?.name ?? String(err);
    throw new Error(
      `Bedrock preflight failed (${name}). Refresh credentials before running ` +
        "(e.g. `aws sso login --profile softmax`) — aborting so games are not " +
        "silently scored on the scripted fallback.",
    );
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class RetryingToolUseClient implements ToolUseClient {
  #inner: ToolUseClient;
  constructor(opts: { model?: string; region?: string; inner?: ToolUseClient } = {}) {
    this.#inner =
      opts.inner ?? new BedrockToolUseClient({ model: opts.model, region: opts.region });
  }

  async converse(req: ConverseRequest): Promise<ConverseResult> {
    await gate.acquire();
    try {
      let lastErr: unknown;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          return await this.#inner.converse(req);
        } catch (err) {
          lastErr = err;
          if (!isTransient(err) || attempt === MAX_RETRIES) throw err;
          const backoff =
            BASE_DELAY_MS * 2 ** attempt + Math.floor(Math.random() * BASE_DELAY_MS);
          await sleep(backoff);
        }
      }
      throw lastErr;
    } finally {
      gate.release();
    }
  }
}
