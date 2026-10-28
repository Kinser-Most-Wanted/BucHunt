import { test, expect } from "@playwright/test";

// The deployment workflow supplies its HTTPS output as BASE_URL.
test.use({ baseURL: process.env.BASE_URL ?? "http://127.0.0.1:3000" });
import type { BrowserContext, Page } from "@playwright/test";

async function installMapMock(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    let clickListener:
      ((event: { latlng: { lat: number; lng: number } }) => void) | undefined;
    class MockMap {
      addLayer() {
        return this;
      }
      invalidateSize() {}
      on(_event: string, listener: typeof clickListener) {
        clickListener = listener;
        return this;
      }
      removeLayer() {
        return this;
      }
      setView() {
        return this;
      }
    }
    class MockMarker {
      private point: { lat: number; lng: number };
      private dragListener: (() => void) | undefined;
      constructor(point: [number, number]) {
        this.point = { lat: point[0], lng: point[1] };
      }
      addTo() {
        return this;
      }
      getLatLng() {
        return this.point;
      }
      on(_event: string, listener: () => void) {
        this.dragListener = listener;
        return this;
      }
      setLatLng(point: { lat: number; lng: number }) {
        this.point = point;
        return this;
      }
    }
    Object.defineProperty(window, "L", {
      configurable: true,
      value: {
        map: () => new MockMap(),
        marker: (point: [number, number]) => new MockMarker(point),
        tileLayer: () => ({ addTo() {} }),
      },
    });
    Object.defineProperty(window, "__testMapClick", {
      configurable: true,
      value: (lat: number, lng: number) =>
        clickListener?.({ latlng: { lat, lng } }),
    });
  });
  await context.route(
    "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
    (route) =>
      route.fulfill({ contentType: "application/javascript", body: "" }),
  );
  await context.route(
    "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
    (route) => route.fulfill({ contentType: "text/css", body: "" }),
  );
  await context.route("https://nominatim.openstreetmap.org/search**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          lat: "36.304",
          lon: "-82.368",
          display_name: "Student Center, Johnson City",
        },
      ]),
    }),
  );
}

async function installAdminSession(page: Page): Promise<void> {
  const administrator = {
    subject: "google-admin-123",
    email: "admin@example.com",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    role: "administrator",
  };
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { user: administrator } }),
  );
  await page.route("**/api/admin/capabilities", (route) =>
    route.fulfill({
      json: { administrator, capabilities: ["administrative.access"] },
    }),
  );
}

async function clickMap(page: Page, lat: number, lng: number): Promise<void> {
  await page.evaluate(
    ({ latitude, longitude }) =>
      (
        window as unknown as { __testMapClick(lat: number, lng: number): void }
      ).__testMapClick(latitude, longitude),
    { latitude: lat, longitude: lng },
  );
}

test("create hunt, save task and reload configuration", async ({ page }) => {
  await installMapMock(page.context());
  await page.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({ contentType: "application/javascript", body: "" }),
  );
  await page.addInitScript(() => {
    Object.defineProperty(window, "BUCHUNT_GOOGLE_CLIENT_ID", {
      value: "test-client-id",
    });
    const claims = btoa(
      JSON.stringify({
        email: "player@example.com",
        email_verified: true,
        sub: "google-account-123",
        aud: "test-client-id",
      }),
    )
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    let callback: ((response: { credential: string }) => void) | undefined;
    Object.defineProperty(window, "google", {
      value: {
        accounts: {
          id: {
            initialize(options: {
              callback(response: { credential: string }): void;
            }) {
              callback = options.callback;
            },
            renderButton(parent: HTMLElement) {
              const button = document.createElement("button");
              button.dataset.testid = "google-sign-in";
              button.textContent = "Sign in with Google";
              button.addEventListener("click", () =>
                callback?.({ credential: `header.${claims}.signature` }),
              );
              parent.append(button);
            },
            prompt() {},
            disableAutoSelect() {},
          },
        },
      },
    });
  });
  const playerSession = {
    subject: "google-account-123",
    email: "player@example.com",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    role: "user",
  };
  const adminSession = {
    subject: "google-admin-123",
    email: "admin@example.com",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    role: "administrator",
  };
  let currentSession = adminSession;
  let authenticated = true;
  await page.route("**/api/auth/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/config") {
      await route.fulfill({
        json: { clientId: "test-client-id", nonce: "test-nonce" },
      });
    } else if (path === "/api/auth/session") {
      await route.fulfill({
        status: authenticated ? 200 : 401,
        json: authenticated
          ? { user: currentSession }
          : { error: "Sign in required." },
      });
    } else if (path === "/api/auth/login") {
      currentSession = playerSession;
      authenticated = true;
      await route.fulfill({ json: { user: playerSession } });
    } else if (path === "/api/auth/logout") {
      authenticated = false;
      await route.fulfill({ json: { signedOut: true } });
    } else {
      await route.fulfill({
        status: 404,
        json: { error: "Not found." },
      });
    }
  });
  await page.route("**/api/admin/capabilities", (route) =>
    route.fulfill({
      json: {
        administrator: adminSession,
        capabilities: ["administrative.access"],
      },
    }),
  );
  await page.goto("/admin.html");
  await expect(page.getByTestId("admin-workspace")).toBeVisible();
  await expect(page.getByTestId("load-admin-hunt")).toHaveCount(0);
  await expect(page.getByTestId("open-create-hunt")).toBeVisible();
  await expect(page.getByTestId("open-manage-hunts")).toBeVisible();
  await expect(page.getByTestId("my-hunts")).toBeHidden();
  await page.getByTestId("open-create-hunt").click();
  await expect(page.getByTestId("create-hunt-dialog")).toBeVisible();
  await page
    .getByLabel("Hunt name", { exact: true })
    .fill("Sprint verification");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Integration test hunt");
  await page.getByLabel("Begins at (local time)").fill("2026-10-15T10:00");
  await page.getByRole("button", { name: "Create hunt", exact: true }).click();
  await expect(page.getByTestId("hunt-status")).toContainText("Hunt saved:");
  await expect(page.getByTestId("create-hunt-dialog")).toBeHidden();
  await expect(page.getByTestId("hunt-details-dialog")).toBeVisible();
  await expect(page.getByTestId("manage-hunts-view")).toBeVisible();
  await page
    .getByRole("button", {
      name: "Sprint verification (owner)",
      exact: true,
    })
    .click();
  await expect(page.getByTestId("hunt-details-overview")).toBeVisible();
  const popupOrder = await page.evaluate(() => {
    const overview = document.querySelector(
      '[data-testid="hunt-details-overview"]',
    )!;
    return [
      overview.querySelector(".details-actions"),
      overview.querySelector(".details-tasks"),
      overview.querySelector(".details-overview"),
      overview.querySelector('[data-testid="contributors-panel"]'),
    ].map((element) => Array.from(overview.children).indexOf(element!));
  });
  expect(popupOrder[0]).toBeLessThan(popupOrder[1]);
  expect(popupOrder[1]).toBeLessThan(popupOrder[2]);
  expect(popupOrder[2]).toBeLessThan(popupOrder[3]);
  await expect(page.getByTestId("hunt-owner")).toContainText("Owner ·");
  await expect(page.getByTestId("hunt-access-code")).not.toBeEmpty();
  await expect(page.getByTestId("contributors-panel")).toBeVisible();
  await expect(page.getByTestId("contributors-panel")).toHaveJSProperty(
    "open",
    false,
  );
  await page.getByRole("button", { name: "Edit hunt tasks" }).click();
  await expect(page.getByTestId("hunt-details-editor")).toBeVisible();
  await expect(page.getByTestId("hunt-edit-title")).toHaveText(
    "Editing Sprint verification",
  );
  await expect(page.getByTestId("edit-hunt-selector")).toHaveValue(
    /^[a-f0-9-]{36}$/,
  );
  const id = await page.locator('#define-task [name="huntId"]').inputValue();
  expect(id).toMatch(/^[a-f0-9-]{36}$/);
  await page
    .getByLabel("Display label", { exact: true })
    .fill("Find the fountain");
  await page
    .getByLabel("Task type", { exact: true })
    .selectOption("single-word-trivia");
  await page.getByLabel("Clue and instructions").fill("Read the plaque");
  await page.getByLabel("Required answer", { exact: true }).fill("Bucky");
  await page.getByTestId("task-location-query").fill("Student Center");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByTestId("task-location-coordinates")).toContainText(
    "36.304000, -82.368000",
  );
  await clickMap(page, 36.302, -82.369);
  await expect(page.locator('[name="latitude"]')).toHaveValue("36.302");
  await expect(page.locator('[name="longitude"]')).toHaveValue("-82.369");
  await page.getByRole("button", { name: "Add task to hunt" }).click();
  await expect(page.getByTestId("task-status")).toContainText(
    "was saved and appears",
  );
  await page.reload();
  await page.getByTestId("open-manage-hunts").click();
  await page
    .getByRole("button", { name: "Sprint verification (owner)", exact: true })
    .click();
  await expect(page.getByTestId("hunt-details-dialog")).toBeVisible();
  await expect(page.getByTestId("hunt-detail-name")).toHaveText(
    "Sprint verification",
  );
  const overviewTopOrder = await page
    .getByTestId("hunt-details-overview")
    .evaluate((overview) => {
      const children = Array.from(overview.children);
      return [
        children.indexOf(overview.querySelector(".hunt-overview-lead")!),
        children.indexOf(overview.querySelector(".details-status")!),
      ];
    });
  expect(overviewTopOrder[0]).toBeLessThan(overviewTopOrder[1]);
  await expect(page.getByTestId("hunt-detail-id")).toBeHidden();
  const idControl = page.locator(".hunt-id-control");
  await expect(
    page
      .getByTestId("hunt-id-toggle")
      .locator("xpath=following-sibling::output"),
  ).toBeHidden();
  await page.getByTestId("hunt-id-toggle").click();
  await expect(idControl.getByTestId("hunt-detail-id")).toHaveText(id);
  await expect(page.getByTestId("hunt-access-code")).not.toBeEmpty();
  await expect(page.getByTestId("player-hunt-link")).toHaveAttribute(
    "href",
    /accessCode=[A-F0-9]{8}$/,
  );
  await expect(page.getByTestId("hunt-detail-tasks")).toContainText(
    "Find the fountain",
  );
  await page.getByRole("button", { name: "Edit hunt tasks" }).click();
  await expect(page.getByTestId("hunt-details-dialog")).toBeVisible();
  await expect(page.getByTestId("hunt-details-overview")).toBeHidden();
  await expect(page.getByTestId("hunt-details-editor")).toBeVisible();
  await expect(page.getByTestId("defined-task-list")).toContainText(
    "Find the fountain",
  );

  await page.getByTestId("edit-task").click();
  await expect(page.getByLabel("Display label", { exact: true })).toHaveValue(
    "Find the fountain",
  );
  await expect(page.locator('[name="latitude"]')).toHaveValue("36.302");
  await expect(page.locator('[name="longitude"]')).toHaveValue("-82.369");
  await page
    .getByLabel("Display label", { exact: true })
    .fill("The Blue Fountain");
  await page.getByLabel("Clue and instructions").fill("Read the new plaque");
  await page.getByLabel("Required answer", { exact: true }).fill("Campus bell");
  await page.getByRole("button", { name: "Save task changes" }).click();
  await expect(page.getByTestId("task-status")).toContainText(
    "was updated and appears",
  );
  await expect(page.getByTestId("defined-task-list")).toContainText(
    "The Blue Fountain",
  );

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("delete-task").click();
  await expect(page.getByTestId("task-status")).toContainText(
    "was deleted from this hunt",
  );
  await expect(page.getByTestId("defined-task-list")).not.toContainText(
    "The Blue Fountain",
  );
  await page.getByTestId("back-to-hunt-details").click();
  await expect(page.getByTestId("hunt-details-overview")).toBeVisible();
  await expect(page.getByTestId("hunt-details-editor")).toBeHidden();
});

test("only owners and contributors can configure a hunt through the creator workspace", async ({
  page,
  browser,
  baseURL,
}) => {
  await installMapMock(page.context());
  await installAdminSession(page);
  await page.goto("/admin.html");
  await expect(page.getByTestId("creator-id")).toHaveText(
    /^browser:[a-f0-9]{64}$/,
  );
  await expect(page.getByLabel("Administrator API token")).toHaveCount(0);
  await page.getByTestId("open-create-hunt").click();
  await page.getByLabel("Hunt name", { exact: true }).fill("Shared hunt");
  await page
    .getByLabel("Description", { exact: true })
    .fill("A collaborative hunt");
  await page.getByLabel("Begins at (local time)").fill("2026-10-15T10:00");
  await page.getByRole("button", { name: "Create hunt", exact: true }).click();
  await expect(page.getByTestId("hunt-status")).toContainText("Hunt saved:");
  await expect(page.getByTestId("manage-hunts-view")).toBeVisible();
  await page
    .getByRole("button", { name: "Shared hunt (owner)", exact: true })
    .click();
  await expect(page.getByTestId("hunt-details-overview")).toBeVisible();
  const id = await page.locator('#define-task [name="huntId"]').inputValue();
  const contributor = await browser.newContext({ baseURL });
  const stranger = await browser.newContext({ baseURL });
  try {
    const member = await contributor.newPage();
    await installMapMock(contributor);
    await installAdminSession(member);
    await member.goto("/admin.html");
    await expect(member.getByTestId("creator-id")).toHaveText(
      /^browser:[a-f0-9]{64}$/,
    );
    await member.getByTestId("open-manage-hunts").click();
    await expect(member.getByTestId("my-hunts")).not.toContainText(
      "Shared hunt",
    );
    expect(
      (await contributor.request.get(`/api/admin/hunts/${id}`)).status(),
    ).toBe(403);
    const visitor = await stranger.newPage();
    await installAdminSession(visitor);
    await visitor.goto("/admin.html");
    await expect(visitor.getByTestId("creator-id")).toHaveText(
      /^browser:[a-f0-9]{64}$/,
    );
    expect(
      (await stranger.request.get(`/api/admin/hunts/${id}`)).status(),
    ).toBe(403);
    const memberId = (await member.getByTestId("creator-id").textContent())!;
    await page.getByTestId("contributors-panel").locator("summary").click();
    await page.getByLabel("Contributor creator ID").fill(memberId);
    await page
      .getByRole("button", { name: "Add contributor", exact: true })
      .click();
    await expect(page.getByTestId("contributor-status")).toContainText(
      "Contributor added",
    );
    await member.getByTestId("refresh-my-hunts").click();
    await member
      .getByRole("button", { name: "Shared hunt (contributor)", exact: true })
      .click();
    await expect(member.getByTestId("hunt-details-dialog")).toBeVisible();
    await expect(member.getByTestId("hunt-detail-name")).toHaveText(
      "Shared hunt",
    );
    await expect(member.getByTestId("hunt-detail-id")).toBeHidden();
    await member.getByTestId("hunt-id-toggle").click();
    await expect(member.getByTestId("hunt-detail-id")).toHaveText(id);
    await expect(member.getByTestId("hunt-owner")).toContainText("Owner ·");
    await expect(member.getByTestId("hunt-creators")).not.toContainText(
      "Owner",
    );
    await member.getByRole("button", { name: "Edit hunt tasks" }).click();
    await expect(member.getByTestId("hunt-details-dialog")).toBeVisible();
    await expect(member.getByTestId("hunt-details-overview")).toBeHidden();
    await expect(member.getByTestId("hunt-details-editor")).toBeVisible();
    await expect(member).toHaveURL(/admin\.html$/);
    await expect(member.getByTestId("contributors-panel")).toBeHidden();
    await member
      .getByLabel("Display label", { exact: true })
      .fill("Collaborator task");
    await member
      .getByLabel("Task type", { exact: true })
      .selectOption("single-word-trivia");
    await member.getByLabel("Clue and instructions").fill("Look nearby");
    await member.getByLabel("Required answer", { exact: true }).fill("Bucky");
    await clickMap(member, 36, -82);
    await expect(member.locator('[name="latitude"]')).toHaveValue("36");
    await expect(member.locator('[name="longitude"]')).toHaveValue("-82");
    await member.getByRole("button", { name: "Add task to hunt" }).click();
    await expect(member.getByTestId("task-status")).toContainText(
      "was saved and appears",
    );
    expect(
      (
        await contributor.request.post(`/api/admin/hunts/${id}/contributors`, {
          data: {
            creatorId: await visitor.getByTestId("creator-id").textContent(),
          },
        })
      ).status(),
    ).toBe(403);
    await page
      .getByRole("button", { name: "Remove contributor", exact: true })
      .click();
    await expect(page.getByTestId("contributor-status")).toHaveText(
      "Contributor removed.",
    );
    expect(
      (
        await contributor.request.get(`/api/admin/hunts/${id}`, {
          timeout: 5000,
        })
      ).status(),
    ).toBe(403);
    await member.getByTestId("back-to-hunt-details").click();
    await expect(member.getByTestId("hunt-details-overview")).toBeVisible();
    await member.getByTestId("back-to-manage-hunts").click();
    await expect(member.getByTestId("manage-hunts-view")).toBeVisible();
    await member.getByTestId("refresh-my-hunts").click();
    await expect(member.getByTestId("my-hunts")).not.toContainText(
      "Shared hunt",
    );
    expect(
      (
        await stranger.request.get(`/api/admin/hunts/${id}`, {
          timeout: 5000,
        })
      ).status(),
    ).toBe(403);
  } finally {
    await contributor.close();
    await stranger.close();
  }
});

test("task type selection creates multiple-choice configuration and resets after saving", async ({
  page,
}) => {
  await installMapMock(page.context());
  await installAdminSession(page);
  await page.goto("/admin.html");
  await page.getByTestId("open-create-hunt").click();
  await page
    .getByLabel("Hunt name", { exact: true })
    .fill("Multiple choice hunt");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Shapes around campus");
  await page.getByLabel("Begins at (local time)").fill("2026-10-15T10:00");
  await page.getByRole("button", { name: "Create hunt", exact: true }).click();
  await expect(page.getByTestId("hunt-status")).toContainText("Hunt saved:");
  await expect(page.getByTestId("hunt-details-dialog")).toBeVisible();
  await page
    .getByRole("button", { name: "Multiple choice hunt (owner)", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit hunt tasks" }).click();
  const type = page.getByLabel("Task type", { exact: true });
  await expect(type).toHaveValue("");
  await expect(type.locator('option[value=""]')).toBeDisabled();
  await type.selectOption("single-word-trivia");
  await expect(
    page.getByLabel("Required answer", { exact: true }),
  ).toBeVisible();
  await type.selectOption("multiple-choice");
  await expect(
    page.getByLabel("Required answer", { exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Display label", { exact: true }).fill("Street sign");
  const question = page.getByLabel("What is the question being asked?");
  await expect(question).toHaveAttribute(
    "placeholder",
    "What shape is the sign on xyz street at abc building?",
  );
  await question.fill("What shape is this sign?");
  await page.getByLabel("Correct Answer", { exact: true }).fill("Square");
  for (const [index, choice] of ["Circle", "Triangle", "Octagon"].entries())
    await page
      .getByLabel(`Incorrect Answer ${index + 1}`, { exact: true })
      .fill(choice);
  await clickMap(page, 36, -82);
  const request = page.waitForRequest(
    (request) =>
      request.url().endsWith("/tasks") && request.method() === "POST",
  );
  await page.getByRole("button", { name: "Add task to hunt" }).click();
  expect((await request).postDataJSON()).toMatchObject({
    taskType: "multiple-choice",
    description: "What shape is this sign?",
    requiredAnswer: "Square",
    choices: ["Square", "Circle", "Triangle", "Octagon"],
  });
  await expect(page.getByTestId("task-status")).toContainText(
    "was saved and appears",
  );
  await expect(type).toHaveValue("");
  await expect(question).toBeDisabled();
  await page.getByTestId("edit-task").click();
  await expect(type).toHaveValue("multiple-choice");
  await expect(question).toHaveValue("What shape is this sign?");
  await expect(page.getByLabel("Correct Answer", { exact: true })).toHaveValue(
    "Square",
  );
  await expect(
    page.getByLabel("Incorrect Answer 1", { exact: true }),
  ).toHaveValue("Circle");
});
