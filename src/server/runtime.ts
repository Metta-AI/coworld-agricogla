import { createServer, Server } from "node:http";
import { GameRunner, GameRunnerOpts } from "./game-runner";
import { createApp } from "./http";
import { SocketHub } from "./websocket";

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
  const hub = new SocketHub(runner);
  const app = createApp(runner, opts.distDir);
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
