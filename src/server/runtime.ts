import { createServer, Server } from "node:http";
import { GameRunner, GameRunnerOpts } from "./game-runner";
import { createApp } from "./http";
import { SocketHub } from "./websocket";
import { loadDiscordConfig } from "./discord/config";
import { DiscordSeats } from "./discord/seats";
import { mountDiscord } from "./discord/routes";
import { realIdentity, shimIdentity } from "./discord/identity";

export interface ServerHandle {
  server: Server;
  runner: GameRunner;
  hub: SocketHub;
  port: number;
  close(): Promise<void>;
}

export interface StartServerOpts extends Omit<GameRunnerOpts, "onUpdate" | "onActPrompt"> {
  port: number;
  distDir: string;
}

export async function startServer(opts: StartServerOpts): Promise<ServerHandle> {
  const runner = new GameRunner({
    ...opts,
    onUpdate: () => hub.broadcastState(),
    onActPrompt: (entry) => hub.recordPrompt(entry),
    onChat: (message) => hub.broadcastChat(message),
    onError: (err) => console.error("[agent]", err),
  });
  // Discord Activity mode boots when the env is configured (else standalone).
  const discordConfig = loadDiscordConfig();
  const seats = discordConfig ? new DiscordSeats(runner) : null;
  const hub = new SocketHub(
    runner,
    seats ? { validateSeat: (idx, token) => seats.validate(idx, token) } : {},
  );
  const app = createApp(runner, opts.distDir, { discordEnabled: !!discordConfig });
  if (seats && discordConfig) {
    // DISCORD_DEV_SHIM swaps the real OAuth round-trip for a self-declared
    // identity so the Activity can be driven in a plain browser. Dev only.
    const identity = process.env.DISCORD_DEV_SHIM ? shimIdentity() : realIdentity(discordConfig);
    mountDiscord(app, seats, discordConfig, identity);
  }
  const server = createServer(app);
  hub.attach(server);

  await new Promise<void>((resolve) => server.listen(opts.port, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : opts.port;
  void runner.tick();

  return {
    server,
    runner,
    hub,
    port,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
