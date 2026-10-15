import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  testDir: "./tests",
  use: {
    baseURL: process.env.BASE_URL ?? "http://127.0.0.1:3000",
    ...devices["Desktop Chrome"],
    trace: process.env.BASE_URL ? "off" : "retain-on-failure",
  },
  ...(process.env.BASE_URL
    ? {}
    : {
        webServer: {
          command: "pnpm build && pnpm serve",
          url: "http://127.0.0.1:3000/api/health",
          reuseExistingServer: false,
          env: {
            DATA_DIRECTORY: mkdtempSync(join(tmpdir(), "buchunt-e2e-")),
            ADMIN_TOKEN: process.env.ADMIN_TOKEN ?? "local-development-only",
          },
        },
      }),
});
