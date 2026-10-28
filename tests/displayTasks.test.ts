import { expect, test } from "@playwright/test";

test("empty player dashboard points players to the join card above", async ({
  page,
}) => {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "buchunt.player-session",
      JSON.stringify({
        provider: "google",
        email: "player@example.com",
        accountId: "google-account-empty",
        idToken: "verified-test-token",
      }),
    );
    localStorage.setItem("buchunt.player-profile.google-account-empty", "Baja");
  });
  await page.route("**/api/admin/capabilities", (route) =>
    route.fulfill({
      status: 403,
      json: { error: "Administrator access required." },
    }),
  );
  await page.route("**/api/player/account/**", (route) =>
    route.fulfill({ json: { ok: true, value: [] } }),
  );
  await page.goto("/player.html");
  await expect(page.getByTestId("player-heading")).toHaveText("Your Hunts");
  await expect(page.getByTestId("player-hunt-lookup")).toBeVisible();
  await expect(page.getByTestId("player-task-status")).toHaveText(
    "Your dashboard is ready. Join a hunt above to get started.",
  );
});

test("Google sign-in lets a player open and revisit saved progress", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) =>
          sessionStorage.setItem("test-copied-value", value),
      },
    });
    sessionStorage.setItem(
      "buchunt.player-session",
      JSON.stringify({
        provider: "google",
        email: "player@example.com",
        accountId: "google-account-123",
        idToken: "verified-test-token",
      }),
    );
  });
  await page.route("**/api/admin/capabilities", (route) =>
    route.fulfill({
      status: 403,
      json: { error: "Administrator access required." },
    }),
  );
  await page.route("**/api/auth/logout", (route) =>
    route.fulfill({ json: { signedOut: true } }),
  );
  const hunt = {
    id: "hunt-1",
    name: "test",
    description: "test",
    beginsAt: "2020-01-01T00:00:00.000Z",
    endsAt: "2099-01-01T00:00:00.000Z",
    status: "published",
    tasks: [
      {
        id: "task-1",
        displayLabel: "Old Fountain",
        completed: true,
        location: { latitude: 36.304, longitude: -82.368 },
      },
      {
        id: "task-2",
        displayLabel: "Library Steps",
        description: "Look for the carved stone marker.",
        completed: false,
        location: { latitude: 36.305, longitude: -82.367 },
      },
    ],
  };
  const futureHunt = {
    id: "hunt-future",
    name: "Future Hunt",
    description: "Coming soon.",
    beginsAt: "2099-01-01T00:00:00.000Z",
    endsAt: null,
    status: "published",
    tasks: [],
  };
  const pastHunt = {
    id: "hunt-past",
    name: "Past Hunt",
    description: "A finished adventure.",
    beginsAt: "2020-01-01T00:00:00.000Z",
    endsAt: "2021-01-01T00:00:00.000Z",
    status: "published",
    tasks: [],
  };
  const tasklessHunt = {
    id: "hunt-empty",
    name: "Taskless Hunt",
    description: "Join before tasks are ready.",
    beginsAt: "2020-01-01T00:00:00.000Z",
    endsAt: null,
    status: "published",
    tasks: [],
  };
  const endingSoonHunt = {
    ...hunt,
    id: "hunt-ending-soon",
    name: "Ending Soon Hunt",
    endsAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
  };
  const savedHunts = [
    hunt,
    endingSoonHunt,
    futureHunt,
    pastHunt,
    tasklessHunt,
  ];
  let huntListRequests = 0;
  await page.route("**/api/player/account/**", async (route) => {
    expect(route.request().headers().authorization).toBe(
      "Bearer verified-test-token",
    );
    expect(route.request().headers().cookie).toBeUndefined();
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/join")) {
      expect(route.request().method()).toBe("POST");
      expect(route.request().postDataJSON()).toEqual({
        accessCode: "ABCD1234",
      });
      await route.fulfill({ json: { ok: true, value: { huntId: hunt.id } } });
      return;
    }
    if (path.endsWith("/hunts")) {
      huntListRequests += 1;
      await route.fulfill({ json: { ok: true, value: savedHunts } });
      return;
    }
    const huntId = path.split("/").at(-1);
    const detail = savedHunts.find((item) => item.id === huntId) ?? hunt;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, value: detail }),
    });
  });

  await page.goto("/player.html?accessCode=ABCD1234");
  await expect(page.getByTestId("player-hunt-lookup")).toBeHidden();
  await expect(page.getByTestId("player-name-form")).toBeVisible();
  await page.getByTestId("player-display-name-input").fill("Baja");
  await page.getByRole("button", { name: "Save name and continue" }).click();

  await expect(page.getByTestId("player-account")).toHaveText(
    "Signed in as Baja (Player)",
  );
  await expect(page.getByTestId("player-heading")).toHaveText("Your Hunts");
  await expect(page.locator('body[data-page="player"] > header')).toHaveCSS(
    "position",
    "sticky",
  );
  await expect(page.getByTestId("player-hunt-lookup")).toBeVisible();
  await page.getByTestId("player-account").click();
  await expect(page.getByTestId("player-google-email")).toBeVisible();
  await expect(page.getByTestId("player-email")).toBeHidden();
  await expect(page.getByTestId("copy-email")).toBeHidden();
  await page.getByTestId("email-toggle").click();
  await expect(page.getByTestId("player-email")).toHaveText(
    "player@example.com",
  );
  await expect(page.getByTestId("copy-email")).toBeVisible();
  await page.getByTestId("copy-email").click();
  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem("test-copied-value")),
    )
    .toBe("player@example.com");
  await expect(page.getByTestId("account-id-value")).toBeHidden();
  await expect(page.getByTestId("account-id-toggle")).toHaveText(
    "Show Google account ID",
  );
  await page.getByTestId("account-id-toggle").click();
  await expect(page.getByTestId("account-id-value")).toHaveText(
    "google-account-123",
  );
  await expect(page.getByTestId("copy-account-id")).toBeVisible();
  await page.getByTestId("copy-account-id").click();
  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem("test-copied-value")),
    )
    .toBe("google-account-123");
  await page.getByTestId("account-id-toggle").click();
  await expect(page.getByTestId("account-id-value")).toBeHidden();
  await expect(page.getByTestId("google-sign-in-host")).toBeHidden();
  await expect(page.getByTestId("google-sign-in-host")).toHaveAttribute(
    "inert",
    "",
  );
  await expect(page.getByLabel("Access code")).toHaveValue("ABCD1234");
  await expect(page.getByTestId("player-hunt-list")).toContainText(
    "test",
  );
  await expect(page.getByTestId("player-hunt-list")).toContainText(
    "Time remaining",
  );
  await expect(page.getByTestId("player-future-hunt-list")).toContainText(
    "Future Hunt",
  );
  await expect(page.getByTestId("player-past-hunt-list")).toContainText(
    "Hunt Ended",
  );
  const activeCard = page
    .getByTestId("player-hunt-list")
    .locator('[data-hunt-id="hunt-1"]');
  await expect(activeCard).toHaveAttribute("data-hunt-status", "active");
  await expect(activeCard.locator(".hunt-state-badge")).toHaveText("Active");
  await expect(activeCard.locator(".hunt-state-badge")).toHaveAttribute(
    "data-status",
    "active",
  );
  const endingSoonCard = page
    .getByTestId("player-hunt-list")
    .locator('[data-hunt-id="hunt-ending-soon"]');
  await expect(endingSoonCard.locator(".hunt-state-badge")).toHaveText(
    "Ending soon",
  );
  await expect(endingSoonCard.locator(".hunt-state-badge")).toHaveAttribute(
    "data-status",
    "soon",
  );
  const futureCard = page
    .getByTestId("player-future-hunt-list")
    .locator('[data-hunt-id="hunt-future"]');
  await expect(futureCard.locator(".hunt-state-badge")).toHaveAttribute(
    "data-status",
    "upcoming",
  );
  await expect(futureCard.locator(".hunt-state-badge")).toHaveCSS(
    "color",
    "rgb(139, 188, 255)",
  );
  const pastCard = page
    .getByTestId("player-past-hunt-list")
    .locator('[data-hunt-id="hunt-past"]');
  await expect(pastCard.locator(".hunt-state-badge")).toHaveAttribute(
    "data-status",
    "ended",
  );
  const tasklessCard = page
    .getByTestId("player-hunt-list")
    .locator('[data-hunt-id="hunt-empty"]');
  await expect(tasklessCard.locator(".hunt-state-badge")).toHaveText(
    "Needs tasks",
  );
  await expect(tasklessCard.locator(".hunt-state-badge")).toHaveAttribute(
    "data-status",
    "needs-tasks",
  );
  await expect(tasklessCard.locator(".hunt-state-badge")).toHaveCSS(
    "color",
    "rgb(139, 188, 255)",
  );
  await expect(page.getByTestId("player-future-hunt-list")).toContainText(
    "Starts in",
  );
  await page
    .getByTestId("player-hunt-list")
    .locator('[data-hunt-id="hunt-empty"]')
    .click();
  await expect(page.getByTestId("player-hunt-name")).toHaveText(
    "Taskless Hunt",
  );
  await expect(page.getByTestId("player-hunt-details")).toBeVisible();
  await expect(page.getByTestId("back-to-hunts")).toHaveCount(0);
  await expect(page.getByTestId("player-hunt-no-tasks")).toBeVisible();
  expect(huntListRequests).toBe(1);
  await page.getByTestId("close-player-hunt-details").click();
  await page
    .getByTestId("player-future-hunt-list")
    .locator('[data-hunt-id="hunt-future"]')
    .click();
  await expect(page.getByTestId("player-hunt-name")).toHaveText("Future Hunt");
  await expect(page.getByTestId("player-task-list")).toBeEmpty();
  await page.getByTestId("close-player-hunt-details").click();
  await page
    .getByTestId("player-past-hunt-list")
    .locator('[data-hunt-id="hunt-past"]')
    .click();
  await expect(page.getByTestId("player-hunt-lookup-status")).toContainText(
    "Hunt Ended",
  );
  await page.getByTestId("close-player-hunt-details").click();
  await page.getByLabel("Access code").fill("abcd1234");
  await expect(page.getByLabel("Access code")).toHaveValue("ABCD1234");
  await page.getByRole("button", { name: "Join Hunt" }).click();
  await expect(page.getByTestId("player-hunt-details")).toBeVisible();
  await expect(page.getByTestId("player-hunt-name")).toHaveText("test");
  await expect(page.getByTestId("player-task-status")).toContainText(
    "5 saved Hunts",
  );
  await expect(page.getByTestId("player-hunt-list")).toContainText(
    "test",
  );
  await expect(page.getByTestId("player-task-list")).toContainText(
    "Old Fountain",
  );
  await expect(page.getByTestId("player-task-list")).not.toContainText(
    "36.304000, -82.368000",
  );
  const detailsDialog = page.getByTestId("player-hunt-details");
  await detailsDialog.evaluate((dialog) => {
    dialog.scrollTop = dialog.scrollHeight;
  });
  expect(
    await detailsDialog.evaluate((dialog) => dialog.scrollTop),
  ).toBeGreaterThan(0);
  await page.getByTestId("close-player-hunt-details").click();
  await expect(detailsDialog).not.toBeVisible();
  await page
    .getByTestId("player-hunt-list")
    .locator('[data-hunt-id="hunt-1"]')
    .click();
  await expect(detailsDialog).toBeVisible();
  expect(
    await detailsDialog.evaluate((dialog) => dialog.scrollTop),
  ).toBe(0);
  const answerTask = page
    .getByTestId("player-task")
    .filter({ hasText: "Library Steps" });
  await expect(answerTask).toBeVisible();
  await expect(answerTask.locator(".hunt-detail-task-heading")).toContainText(
    "Library Steps",
  );
  await expect(answerTask).toContainText("Look for the carved stone marker.");
  const playerIntro = page.locator(".player-hunt-intro");
  const introBounds = await playerIntro.evaluate((intro) => ({
    panelTop: intro.getBoundingClientRect().top,
    dialogTop: intro.closest("dialog")!.getBoundingClientRect().top,
  }));
  expect(introBounds.panelTop).toBeGreaterThanOrEqual(introBounds.dialogTop);
  await expect(playerIntro.getByTestId("player-hunt-name")).toHaveText(
    "test",
  );
  await expect(playerIntro.getByTestId("player-hunt-description")).toHaveText(
    "test",
  );
  const taskLayout = await answerTask.evaluate((task) => {
    const location = task.querySelector(".task-location")!;
    const answer = task.querySelector(".task-answer-form")!;
    return (
      Array.from(task.children).indexOf(location) <
      Array.from(task.children).indexOf(answer)
    );
  });
  expect(taskLayout).toBe(true);
  await expect(answerTask.getByLabel("Answer for Library Steps")).toHaveCSS(
    "min-height",
    "60px",
  );
  const answerBarWidth = await answerTask
    .getByLabel("Answer for Library Steps")
    .evaluate((input) => input.getBoundingClientRect().width);
  expect(answerBarWidth).toBeGreaterThan(300);
  const taskHeading = answerTask.locator(".hunt-detail-task-heading");
  const locationPanel = taskHeading.locator(".task-location");
  await expect(taskHeading).toHaveCSS("display", "grid");
  await expect(locationPanel).toHaveCSS("grid-column-start", "2");
  await expect(locationPanel).toHaveCSS("grid-row-start", "1");
  await expect(
    answerTask.getByRole("button", { name: "Show Task Location" }),
  ).toBeVisible();
  const sectionOrder = await page
    .getByTestId("player-hunt-details")
    .evaluate((dialog) =>
      Array.from(dialog.querySelectorAll(":scope > section")).map((section) =>
        section.classList.contains("details-tasks")
          ? "tasks"
          : section.classList.contains("details-overview")
            ? "overview"
            : "other",
      ),
    );
  expect(sectionOrder.indexOf("tasks")).toBeLessThan(
    sectionOrder.indexOf("overview"),
  );
  await expect(
    answerTask.getByRole("button", { name: "Submit answer" }),
  ).toBeVisible();
  const mapToggle = answerTask.getByRole("button", {
    name: "Show Task Location",
  });
  await mapToggle.click();
  const taskMap = answerTask.locator('iframe[title="Task location map"]');
  await expect(taskMap).toBeVisible();
  const closeButton = page.getByTestId("close-player-hunt-details");
  const huntStatus = page.getByTestId("player-hunt-lookup-status");
  await expect(detailsDialog.locator(".hunt-details-dialog-heading")).toHaveCSS(
    "position",
    "sticky",
  );
  await expect(closeButton).toHaveCSS("position", "relative");
  expect(
    await closeButton.evaluate((button) =>
      Boolean(button.closest(".player-hunt-intro")),
    ),
  ).toBe(false);
  await expect(huntStatus).toHaveCSS("position", "absolute");
  await expect(huntStatus).toHaveAttribute("data-status", "active");
  expect(
    await huntStatus.evaluate((status) =>
      Boolean(status.closest(".player-hunt-intro")),
    ),
  ).toBe(true);
  await expect(detailsDialog).toHaveCSS("overscroll-behavior", "contain");
  await expect(detailsDialog).toHaveCSS("scrollbar-width", "none");
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await detailsDialog.evaluate((dialog) => {
    dialog.scrollTop = dialog.scrollHeight;
  });
  expect(
    await detailsDialog.evaluate((dialog) => dialog.scrollTop),
  ).toBeGreaterThan(0);
  const closeButtonBounds = await closeButton.evaluate((button) => {
    const buttonRect = button.getBoundingClientRect();
    const dialogRect = button.closest("dialog")!.getBoundingClientRect();
    return {
      insideLeft: buttonRect.left >= dialogRect.left,
      insideRight: buttonRect.right <= dialogRect.right,
      insideTop: buttonRect.top >= dialogRect.top,
      insideBottom: buttonRect.bottom <= dialogRect.bottom,
    };
  });
  expect(closeButtonBounds).toEqual({
    insideLeft: true,
    insideRight: true,
    insideTop: true,
    insideBottom: true,
  });
  await expect(closeButton).toBeInViewport();
  const mapSource = await taskMap.getAttribute("src");
  expect(mapSource).not.toBeNull();
  const marker = new URL(mapSource!).searchParams.get("marker");
  expect(marker?.split(",").map(Number)).toEqual([36.305, -82.367]);
  await page.getByRole("button", { name: "Hide Task Location" }).click();
  await expect(taskMap).toBeHidden();
  await expect(page.getByTestId("player-task-list")).toContainText("Completed");
  await expect(page.getByTestId("player-task-list")).toContainText(
    "Incomplete",
  );
  await expect(page.getByTestId("player-task-list")).not.toContainText(
    "secret-answer",
  );

  await page.getByTestId("close-player-hunt-details").click();
  await page.getByTestId("player-sign-out").click();
  await expect(page).toHaveURL(/\/index\.html$/);
});

test("player sign-in uses the shared BucHunt home page", async ({ page }) => {
  await page.route("**/api/auth/logout", async (route) => {
    expect(route.request().method()).toBe("POST");
    await route.fulfill({ json: { signedOut: true } });
  });
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ status: 401, json: { error: "Sign in required." } }),
  );
  await page.route("**/api/auth/config", (route) =>
    route.fulfill({ json: { clientId: "test-client", nonce: "test-nonce" } }),
  );
  await page.addInitScript(() => {
    Object.defineProperty(window, "google", {
      value: {
        accounts: {
          id: {
            initialize() {},
            renderButton(parent: HTMLElement) {
              const button = document.createElement("button");
              button.dataset.testid = "google-sign-in";
              button.textContent = "Sign in with Google";
              parent.append(button);
            },
            disableAutoSelect() {},
          },
        },
      },
    });
  });
  await page.goto("/player.html");
  await page.getByRole("button", { name: "Sign in from BucHunt home" }).click();
  await expect(page).toHaveURL(/\/index\.html$/);
  await expect(page.locator("#welcome-heading")).toContainText(
    "Find your next",
  );
  await expect(
    page.getByRole("button", { name: "Sign in with Google" }),
  ).toBeVisible();
});

test("expired progress tokens return to the shared home sign-in", async ({
  page,
}) => {
  await page
    .context()
    .addCookies([
      { name: "legacy", value: "unchanged", url: "http://127.0.0.1:3000" },
    ]);
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "buchunt.player-session",
      JSON.stringify({
        provider: "google",
        accountId: "google-player",
        email: "player@example.com",
        idToken: "expired-token",
      }),
    );
    localStorage.setItem("buchunt.player-profile.google-player", "Baja");
    Object.defineProperty(window, "google", {
      value: {
        accounts: {
          id: {
            initialize() {},
            renderButton(parent: HTMLElement) {
              const button = document.createElement("button");
              button.dataset.testid = "google-sign-in";
              button.textContent = "Sign in with Google";
              parent.append(button);
            },
            disableAutoSelect() {},
          },
        },
      },
    });
  });
  await page.route("**/api/player/account/**", async (route) => {
    expect(route.request().headers().cookie).toBeUndefined();
    await route.fulfill({
      status: 401,
      json: {
        ok: false,
        code: "unauthorized",
        message: "Sign in with Google again.",
      },
    });
  });
  await page.route("**/api/auth/logout", async (route) => {
    expect(route.request().method()).toBe("POST");
    await route.fulfill({ json: { signedOut: true } });
  });
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ status: 401, json: { error: "Sign in required." } }),
  );
  await page.route("**/api/auth/config", (route) =>
    route.fulfill({ json: { clientId: "test-client", nonce: "test-nonce" } }),
  );
  await page.goto("/player.html");
  await expect(page).toHaveURL(/\/index\.html$/);
  await expect(
    page.getByRole("button", { name: "Sign in with Google" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem("buchunt.player-session")),
  ).toBeNull();
  expect(await page.context().cookies()).toContainEqual(
    expect.objectContaining({ name: "legacy", value: "unchanged" }),
  );
});

test("player sign-in survives visiting Hunt Studio and returning", async ({
  page,
}) => {
  const identity = {
    provider: "google",
    email: "player@example.com",
    accountId: "google-account-123",
    idToken: "verified-test-token",
  };
  await page.addInitScript((savedIdentity) => {
    sessionStorage.setItem(
      "buchunt.player-session",
      JSON.stringify(savedIdentity),
    );
    localStorage.setItem("buchunt.player-profile.google-account-123", "Baja");
  }, identity);
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        user: {
          subject: identity.accountId,
          email: identity.email,
          role: "user",
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
      },
    }),
  );
  await page.route("**/api/admin/capabilities", (route) =>
    route.fulfill({
      status: 403,
      json: { error: "Administrator access required." },
    }),
  );
  await page.route("**/api/admin/session", (route) =>
    route.fulfill({
      json: {
        ok: true,
        value: {
          id: "browser:test",
          identityType: "temporary-browser",
        },
      },
    }),
  );
  await page.route("**/api/player/account/hunts", async (route) => {
    expect(route.request().headers().authorization).toBe(
      "Bearer verified-test-token",
    );
    await route.fulfill({ json: { ok: true, value: [] } });
  });

  await page.goto("/admin.html");
  await expect(page.getByTestId("admin-account-menu")).toBeVisible();
  await expect(page.getByTestId("admin-display-name")).toHaveText(
    "Baja (Player)",
  );
  await expect(page.locator("#admin-denied")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const value = sessionStorage.getItem("buchunt.player-session");
        return value ? JSON.parse(value).idToken : null;
      }),
    )
    .toBe("verified-test-token");

  await page.goto("/player.html");
  await expect(page.getByTestId("player-heading")).toHaveText("Your Hunts");
  await expect(page.getByTestId("player-account")).toContainText("Baja");
  await expect(page.getByTestId("player-task-status")).toContainText(
    "Your dashboard is ready",
  );
  await expect(page).toHaveURL(/\/player\.html$/);
});
