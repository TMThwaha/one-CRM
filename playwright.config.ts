import { defineConfig } from "@playwright/test";
import fs from "node:fs";

const PORT = 3100;
// Fresh embedded database per run (never touches dev data in .data/pglite). Old run dirs are cleaned first.
// The config is re-evaluated in every worker process, so cleanup + naming happens once and is
// inherited through the environment (deleting it again would wipe the live database).
if (!process.env.E2E_DB_DIR) {
  fs.rmSync(".data/e2e", { recursive: true, force: true });
  process.env.E2E_DB_DIR = `.data/e2e/run-${Date.now()}`;
}
const dbDir = process.env.E2E_DB_DIR;
const chromePaths = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean) as string[];
const executablePath = chromePaths.find((p) => fs.existsSync(p));

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  webServer: {
    // Production build: deterministic and what actually ships (no HMR, no on-demand compilation).
    command: `npm run build && node node_modules/next/dist/bin/next start -p ${PORT}`,
    env: { ALLOW_EMBEDDED_DB: "true", PGLITE_DIR: dbDir, APP_URL: `http://localhost:${PORT}` },
    url: `http://localhost:${PORT}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
  outputDir: "test-results",
});
