// The interactions webhook must verify Discord's Ed25519 signature against the
// exact request bytes, so the JSON body parser's `verify` hook stashes them on
// the request (see http.ts). Augmenting IncomingMessage covers both the raw
// node request seen by `verify` and the Express request seen by the route.
import "http";

declare module "http" {
  interface IncomingMessage {
    rawBody?: string;
  }
}
