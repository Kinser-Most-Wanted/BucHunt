import { test, expect } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { PDFDocument } from "pdf-lib";
import { createApplication } from "../src/ts/server/server.js";
import { HuntStore } from "../src/ts/server/huntStore.js";
import { PlayerProgressStore } from "../src/ts/server/playerProgressStore.js";

test("hunt overview downloads PDF and CSV and recovers from a failed export", async ({
  page,
  context,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "buchunt-export-ui-"));
  const app = createApplication({
    dataDirectory: directory,
    staticDirectory: resolve("src"),
  });
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  try {
    // Use a real creator cookie and API; mock only the independent sign-in UI.
    const session = await context.request.get(`${base}/api/admin/session`);
    const creator = (await session.json()).value.id;
    const hunts = new HuntStore(join(directory, "hunts.json"));
    const hunt = await hunts.create(
      {
        name: "Export test hunt",
        description: "Campus results",
        ownerId: creator,
        beginsAt: "2026-11-03T18:00:00Z",
        endsAt: null,
        taskOrderMode: "any",
      },
      creator,
    );
    const task = await hunts.addTask(hunt.id, {
      displayLabel: "Library",
      description: "Find the library",
      requiredAnswer: "Bucky",
      location: { latitude: 36, longitude: -82 },
      order: 1,
      answerCaseSensitive: false,
      hint: null,
      points: 0,
    });
    await new PlayerProgressStore(
      join(directory, "player-progress.json"),
    ).complete("legacy-player", hunt.id, task.id);
    const user = {
      subject: "test-user",
      email: "creator@example.com",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      role: "administrator",
    };
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({ json: { user } }),
    );
    await page.route("**/api/admin/capabilities", (route) =>
      route.fulfill({
        json: { administrator: user, capabilities: ["administrative.access"] },
      }),
    );
    await page.route("https://unpkg.com/**", (route) => route.abort());
    await page.goto(`${base}/admin.html`);
    await page.getByTestId("open-manage-hunts").click();
    await page
      .getByTestId("my-hunts")
      .getByRole("button", { name: "Export test hunt" })
      .click();
    const pdfButton = page.getByTestId("export-hunt-pdf");
    const csvButton = page.getByTestId("export-hunt-csv");
    await expect(pdfButton).toBeEnabled();
    await expect(csvButton).toBeEnabled();
    for (const format of ["pdf", "csv"] as const) {
      const downloadEvent = page.waitForEvent("download");
      await page.getByTestId(`export-hunt-${format}`).click();
      const download = await downloadEvent;
      expect(download.suggestedFilename()).toBe(
        `hunt-${hunt.id}-results.${format}`,
      );
      const content = await readFile((await download.path())!);
      if (format === "pdf")
        expect(
          (await PDFDocument.load(content)).getPageCount(),
        ).toBeGreaterThan(0);
      else {
        expect(content.toString()).toContain(
          '"legacy-player","","1 / 1","0","Completed"',
        );
        expect(content.toString()).toContain(`Library (${task.id})`);
      }
      await expect(page.getByTestId("hunt-export-status")).toHaveText(
        `${format.toUpperCase()} export downloaded.`,
      );
    }
    await page.route("**/results/csv", (route) =>
      route.fulfill({
        status: 403,
        json: { ok: false, message: "Access to this hunt was removed." },
      }),
    );
    await csvButton.click();
    await expect(page.getByTestId("hunt-export-status")).toHaveText(
      "Access to this hunt was removed.",
    );
    await expect(csvButton).toBeEnabled();
    await expect(pdfButton).toBeEnabled();
  } finally {
    await page.goto("about:blank");
    await new Promise<void>((resolve, reject) =>
      app.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  }
});
