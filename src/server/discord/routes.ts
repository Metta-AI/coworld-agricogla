import { Express, Request } from "express";
import { RuleError } from "../../shared/engine/apply";
import { DiscordConfig } from "./config";
import { exchangeCode, fetchUser } from "./oauth";
import { handleInteraction } from "./interactions";
import { DiscordSeats } from "./seats";
import { verifyInteractionSignature } from "./verify";

const tokenBody = (req: Request): string | undefined =>
  typeof req.body?.access_token === "string" ? req.body.access_token : undefined;

/** Mount the Discord Activity endpoints onto the existing Express app. Only
 *  called when Discord is configured; standalone servers never expose these. */
export function mountDiscord(app: Express, seats: DiscordSeats, config: DiscordConfig): void {
  // The browser needs the client id to boot the Embedded App SDK; the secret
  // and public key stay server-side.
  app.get("/api/discord/config", (_req, res) => {
    res.json({ clientId: config.clientId });
  });

  // Signed interaction webhook (Discord's PING handshake + the /agricola
  // command). Verified against the raw bytes before any handling.
  app.post("/api/discord/interactions", (req, res) => {
    const ok = verifyInteractionSignature(
      config.publicKey,
      req.header("X-Signature-Ed25519"),
      req.header("X-Signature-Timestamp"),
      req.rawBody ?? "",
    );
    if (!ok) {
      res.status(401).send("invalid request signature");
      return;
    }
    res.json(handleInteraction(req.body));
  });

  // Exchange the Embedded-App OAuth code for an access token (secret stays here).
  app.post("/api/discord/token", async (req, res) => {
    const code = typeof req.body?.code === "string" ? req.body.code : "";
    if (!code) {
      res.status(400).json({ error: "code required" });
      return;
    }
    const accessToken = await exchangeCode(config, code);
    res.json({ access_token: accessToken });
  });

  // Claim a seat. The identity is re-fetched from Discord with the token, so a
  // client cannot forge who it is; the seat is bound to that Discord user id.
  app.post("/api/discord/seat", async (req, res) => {
    const token = tokenBody(req);
    if (!token) {
      res.status(400).json({ error: "access_token required" });
      return;
    }
    const user = await fetchUser(token);
    try {
      const grant = seats.claim(user);
      res.json({ playerIdx: grant.playerIdx, token: grant.token });
    } catch (err) {
      // Table full or already started: caller falls back to spectating.
      res.status(409).json({ error: err instanceof RuleError ? err.message : "could not claim seat" });
    }
  });

  // Start the game: fill empty seats with bots and begin. Gated on a valid
  // Discord identity so a random HTTP caller cannot start the table.
  app.post("/api/discord/start", async (req, res) => {
    const token = tokenBody(req);
    if (!token) {
      res.status(400).json({ error: "access_token required" });
      return;
    }
    await fetchUser(token);
    seats.startWithBots();
    res.json({ ok: true });
  });

  // New game: clear seats back to an empty lobby. Same identity gate.
  app.post("/api/discord/new-game", async (req, res) => {
    const token = tokenBody(req);
    if (!token) {
      res.status(400).json({ error: "access_token required" });
      return;
    }
    await fetchUser(token);
    try {
      seats.reset();
      res.json({ ok: true });
    } catch (err) {
      res.status(409).json({ error: err instanceof RuleError ? err.message : "could not reset" });
    }
  });
}
