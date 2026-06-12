import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/smoke",
  workers: 1,
  timeout: 60_000,
  use: { baseURL: "http://localhost:4173" },
  webServer: {
    command: "npm run build:web && npm run serve -- --port 4173 --pace 300",
    url: "http://localhost:4173/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
