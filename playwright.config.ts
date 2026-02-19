import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 8082);

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  reporter: [
    ["html", { outputFolder: "playwright-artifacts/report", open: "never" }],
    ["list"],
  ],
  outputDir: "playwright-artifacts/test-results",
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    env: {
      ...process.env,
      VITE_E2E_BYPASS_AUTH: "true",
    },
  },
});
