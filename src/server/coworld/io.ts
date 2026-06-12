import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, inflateSync } from "node:zlib";

const HTTP_USER_AGENT = "cogame-agricola/0.1";

function localPath(uri: string): string | null {
  if (uri.startsWith("file://")) return fileURLToPath(uri);
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(uri)) return uri;
  return null;
}

export async function readData(uri: string): Promise<Buffer> {
  const path = localPath(uri);
  if (path !== null) return readFileSync(path);
  if (/^https?:\/\//.test(uri)) {
    const response = await fetch(uri, { headers: { "User-Agent": HTTP_USER_AGENT } });
    if (!response.ok) throw new Error(`GET ${uri} failed: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  throw new Error(`unsupported URI for readData: ${uri}`);
}

export function artifactMethod(envVar: string): "PUT" | "POST" {
  const method = (process.env[envVar] ?? "PUT").toUpperCase();
  if (method !== "PUT" && method !== "POST") {
    throw new Error(`${envVar} must be PUT or POST, got ${method}`);
  }
  return method;
}

export async function writeData(
  uri: string,
  data: Buffer | string,
  opts: { contentType: string; method: "PUT" | "POST" },
): Promise<void> {
  const bytes = typeof data === "string" ? Buffer.from(data) : data;
  const path = localPath(uri);
  if (path !== null) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    return;
  }
  if (/^https?:\/\//.test(uri)) {
    const response = await fetch(uri, {
      method: opts.method,
      headers: { "Content-Type": opts.contentType, "User-Agent": HTTP_USER_AGENT },
      body: new Uint8Array(bytes),
    });
    if (!response.ok) throw new Error(`${opts.method} ${uri} failed: HTTP ${response.status}`);
    return;
  }
  throw new Error(`unsupported URI for writeData: ${uri}`);
}

/** Replay bytes may arrive raw, zlib-deflated (hosted `replay.json.z`) or
 *  gzipped; sniff rather than trusting the suffix. */
export function decodeReplayBytes(bytes: Buffer): unknown {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return JSON.parse(gunzipSync(bytes).toString());
  }
  if (bytes.length >= 1 && bytes[0] === 0x78) {
    return JSON.parse(inflateSync(bytes).toString());
  }
  return JSON.parse(bytes.toString());
}
