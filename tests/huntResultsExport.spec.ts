import { test, expect } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { PDFDocument } from "pdf-lib";
import { createApplication } from "../src/ts/server/server.js";
import { HuntStore } from "../src/ts/server/huntStore.js";
import { PlayerProgressStore } from "../src/ts/server/playerProgressStore.js";

test("hunt overview refreshes participant progress, shows empty hunts, and exports results", async ({
  page,
  context,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "buchunt-export-ui-"));
  const app = createApplication({
    dataDirectory: directory,
    staticDirectory: resolve("src"),
    verifyPlayerToken: async (token) => {
      if (token !== "participant-token") throw new Error("Invalid token");
      return "participant-account";
    },
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
    const resultsUrl = `${base}/api/admin/hunts/${hunt.id}/results/json`;
    const emptyResults = await context.request.get(resultsUrl);
    expect((await emptyResults.json()).value.players).toEqual([]);
    const outsider = await fetch(resultsUrl);
    expect(outsider.status).toBe(401);
    const outsiderSession = await fetch(`${base}/api/admin/session`);
    const forbidden = await fetch(resultsUrl, {
      headers: {
        Cookie: outsiderSession.headers.get("set-cookie")!.split(";")[0],
      },
    });
    expect(forbidden.status).toBe(403);
    const playerHeaders = { Authorization: "Bearer participant-token" };
    const invalidJoin = await context.request.post(
      `${base}/api/player/account/join`,
      {
        headers: playerHeaders,
        data: { accessCode: "INVALID" },
      },
    );
    expect(invalidJoin.ok()).toBe(false);
    expect(
      (await (await context.request.get(resultsUrl)).json()).value.players,
    ).toEqual([]);
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
    const participantList = page.getByTestId("hunt-participants");
    await expect(participantList).toContainText("legacy-player");
    const joined = await context.request.post(
      `${base}/api/player/account/join`,
      {
        headers: playerHeaders,
        data: { accessCode: hunt.accessCode },
      },
    );
    expect(joined.ok()).toBe(true);
    const otherHunt = await hunts.create(
      {
        name: "Other hunt",
        description: hunt.description,
        beginsAt: hunt.beginsAt,
        endsAt: null,
        taskOrderMode: "any",
      },
      creator,
    );
    await new PlayerProgressStore(
      join(directory, "account-player-progress.json"),
    ).join("unrelated-player", otherHunt.id);
    await page.getByTestId("refresh-hunt-participants").click();
    await expect(participantList.locator(":scope > li")).toHaveCount(2);
    await expect(participantList).not.toContainText("unrelated-player");
    const account = participantList
      .locator(":scope > li")
      .filter({ hasText: "0 / 1 tasks completed" });
    await expect(account).toContainText("Library: Incomplete");
    const answered = await context.request.post(
      `${base}/api/player/account/hunts/${hunt.id}/tasks/${task.id}/answer`,
      {
        headers: playerHeaders,
        data: { answer: "Bucky" },
      },
    );
    expect(answered.ok()).toBe(true);
    await page.getByTestId("refresh-hunt-participants").click();
    await expect(
      participantList.getByText("Library: Completed", { exact: true }),
    ).toHaveCount(2);
    await expect(participantList).not.toContainText("Incomplete");
    await new PlayerProgressStore(
      join(directory, "account-player-progress.json"),
    ).leave("unrelated-player", otherHunt.id);
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
    await hunts.addTask(hunt.id, {
      displayLabel: "Museum",
      description: "Find the museum",
      requiredAnswer: "History",
      location: { latitude: 36, longitude: -82 },
      order: 2,
      answerCaseSensitive: false,
      hint: null,
      points: 0,
    });
    await page.getByTestId("refresh-hunt-participants").click();
    await expect(
      participantList.getByText("1 / 2 tasks completed", { exact: true }),
    ).toHaveCount(2);
    await expect(
      participantList.getByText("Library: Completed", { exact: true }),
    ).toHaveCount(2);
    await expect(
      participantList.getByText("Museum: Incomplete", { exact: true }),
    ).toHaveCount(2);
    await page.getByTestId("back-to-manage-hunts").click();
    await page.getByTestId("refresh-my-hunts").click();
    await page
      .getByTestId("my-hunts")
      .getByRole("button", { name: "Other hunt" })
      .click();
    await expect(page.getByTestId("hunt-participants-status")).toHaveText(
      "No participants have joined this hunt yet.",
    );
    await expect(participantList.locator(":scope > li")).toHaveCount(0);
  } finally {
    await page.goto("about:blank");
    await new Promise<void>((resolve, reject) =>
      app.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  }
});
