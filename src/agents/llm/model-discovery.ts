import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { BedrockModel, MODEL_CANDIDATES } from "../../shared/protocol";

const REGION = process.env.AGRICOGLA_BEDROCK_REGION ?? process.env.AWS_REGION ?? "us-west-2";
const PROBE_TIMEOUT_MS = Number(process.env.AGRICOGLA_BEDROCK_TIMEOUT_MS ?? 15_000);
const PROBE_RETRIES = 2;

/** Resolves true iff `modelId` can be invoked in this account/region right now. */
export type ModelProbe = (modelId: string) => Promise<boolean>;

/** Probe each curated Claude model and keep the ones that respond.
 *
 *  A model the account hasn't cleared the Anthropic use-case form for throws
 *  ResourceNotFound/AccessDenied on invoke, and with no credentials every
 *  probe fails — both cases drop the model, so the picker offers only models
 *  that actually work (empty list ⇒ scripted-only UI). The probe's success or
 *  failure IS the availability signal, so a throwing probe is classified as
 *  "unavailable" here rather than aborting discovery. */
export async function discoverAvailableModels(
  opts: { candidates?: BedrockModel[]; probe?: ModelProbe } = {},
): Promise<BedrockModel[]> {
  const candidates = opts.candidates ?? MODEL_CANDIDATES;
  const probe = opts.probe ?? defaultProbe();
  const checks = await Promise.all(
    candidates.map(async (model) => {
      let ok = false;
      try {
        ok = await probe(model.id);
      } catch {
        ok = false; // a failed probe means the model isn't usable, not a bug
      }
      return ok ? model : null;
    }),
  );
  return checks.filter((m): m is BedrockModel => m !== null);
}

function defaultProbe(): ModelProbe {
  const client = new BedrockRuntimeClient({
    region: REGION,
    requestHandler: { requestTimeout: PROBE_TIMEOUT_MS },
  });
  return async (modelId) => {
    for (let attempt = 0; ; attempt++) {
      try {
        await client.send(
          new ConverseCommand({
            modelId,
            messages: [{ role: "user", content: [{ text: "ping" }] }],
            inferenceConfig: { maxTokens: 1 },
          }),
        );
        return true;
      } catch (err) {
        // Throttling / transient blips can falsely fail a probe — retry those.
        // Access / not-found / anything else is a definitive "not available".
        if (attempt < PROBE_RETRIES && isTransient(err)) {
          await sleep(400 * (attempt + 1));
          continue;
        }
        return false;
      }
    }
  };
}

function isTransient(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  const name = e?.name ?? "";
  const status = e?.$metadata?.httpStatusCode;
  return (
    /Throttling|TooManyRequests|ServiceUnavailable|InternalServer|Timeout/i.test(name) ||
    status === 429 ||
    status === 503
  );
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
