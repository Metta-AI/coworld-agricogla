import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startCoworldGame, startReplayServer } from "./coworld/coworld-server";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const distDir = join(here, "..", "..", "dist");
  const host = process.env.COGAME_HOST ?? "0.0.0.0";
  const port = Number(process.env.COGAME_PORT ?? 8080);

  const loadReplayUri = process.env.COGAME_LOAD_REPLAY_URI;
  if (loadReplayUri) {
    await startReplayServer({ host, port, distDir, loadReplayUri });
    return; // Serve until the runner tears the container down.
  }

  const handle = await startCoworldGame({
    host,
    port,
    distDir,
    configUri: requireEnv("COGAME_CONFIG_URI"),
    resultsUri: requireEnv("COGAME_RESULTS_URI"),
    saveReplayUri: requireEnv("COGAME_SAVE_REPLAY_URI"),
  });
  await handle.finished;
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
