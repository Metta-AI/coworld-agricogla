import { createPublicKey, verify as cryptoVerify, KeyObject } from "node:crypto";

/** DER SPKI prefix for an Ed25519 public key; raw 32-byte key is appended. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** Wrap a raw 32-byte hex Ed25519 public key as a Node KeyObject. */
export function ed25519PublicKey(hex: string): KeyObject {
  const raw = Buffer.from(hex, "hex");
  if (raw.length !== 32) throw new Error("ed25519 public key must be 32 bytes");
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
}

/** Verify a Discord interaction webhook signature. Discord signs the bytes
 *  `timestamp + rawBody` with Ed25519; the signature and timestamp arrive in the
 *  `X-Signature-Ed25519` / `X-Signature-Timestamp` headers. Returns false on any
 *  malformed input rather than throwing, so a bad request is a clean 401. */
export function verifyInteractionSignature(
  publicKeyHex: string,
  signatureHex: string | undefined,
  timestamp: string | undefined,
  rawBody: string,
): boolean {
  if (!signatureHex || !timestamp) return false;
  let signature: Buffer;
  let key: KeyObject;
  try {
    signature = Buffer.from(signatureHex, "hex");
    if (signature.length !== 64) return false;
    key = ed25519PublicKey(publicKeyHex);
  } catch {
    return false;
  }
  return cryptoVerify(null, Buffer.from(timestamp + rawBody, "utf8"), key, signature);
}
