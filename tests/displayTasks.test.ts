import { expect, test } from "@playwright/test";

test("players can leave and rejoin a hunt from the saved overview or admin link", async ({
  page,
}) => {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "buchunt.player-session",
      JSON.stringify({
        provider: "google",
        email: "player@example.com",
        accountId: "google-account-leave",
        idToken: "verified-test-token",
      }),
    );
    localStorage.setItem("buchunt.player-profile.google-account-leave", "Baja");
  });
  await page.route("**/api/admin/capabilities", (route) =>
    route.fulfill({
      status: 403,
      json: { error: "Administrator access required." },
    }),
  );
  const hunt = {
    id: "hunt-leave",
    name: "Optional Hunt",
    description: "A hunt the player can leave.",
    beginsAt: "2020-01-01T00:00:00.000Z",
    endsAt: null,
    status: "published",
    accessCode: "ABCD1234",
    tasks: [],
  };
  let joined = true;
  await page.route("**/api/player/account/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/profile")) {
      await route.fulfill({
        json: { ok: true, value: { displayName: "Baja" } },
      });
    } else if (path.endsWith("/join")) {
      joined = true;
      await route.fulfill({
        json: { ok: true, value: { huntId: hunt.id } },
      });
    } else if (path.endsWith("/hunts") && route.request().method() === "GET") {
      await route.fulfill({ json: { ok: true, value: joined ? [hunt] : [] } });
    } else if (
      path.endsWith("/hunt-leave") &&
      route.request().method() === "DELETE"
    ) {
      joined = false;
      await route.fulfill({ json: { ok: true, value: { left: true } } });
    } else {
      await route.fulfill({ json: { ok: true, value: hunt } });
    }
  });
  await page.goto("/player.html");
  const leaveCard = page.getByTestId("leave-hunt-card");
  await expect(leaveCard).toBeVisible();
  await leaveCard.click();
  await expect(page.getByTestId("leave-hunt-dialog")).toBeVisible();
  await expect(page.getByTestId("leave-hunt-name")).toHaveText("Optional Hunt");
  await expect(page.getByTestId("confirm-leave-hunt")).toBeVisible();
  await page.getByTestId("cancel-leave-hunt").click();
  await page.getByTestId("player-hunt-list").getByText("Optional Hunt").click();
  await expect(page.getByTestId("leave-hunt")).toBeVisible();
  expect(
    await page
      .getByTestId("leave-hunt")
      .evaluate(
        (button) =>
          button.parentElement?.matches("dialog.player-hunt-details") &&
          button === button.parentElement.lastElementChild,
      ),
  ).toBe(true);
  await page.getByTestId("leave-hunt").click();
  await expect(page.getByTestId("leave-hunt-dialog")).toBeVisible();
  await page.getByTestId("confirm-leave-hunt").click();
  await expect(page.getByTestId("player-hunt-list")).not.toContainText(
    "Optional Hunt",
  );
  await expect(page.getByTestId("player-task-status")).toContainText(
    "You left Optional Hunt.",
  );
  await page.goto("/player.html?accessCode=ABCD1234&autoJoin=1");
  await expect(page.getByTestId("player-hunt-list")).toContainText(
    "Optional Hunt",
  );
  await expect(page.getByTestId("player-hunt-details")).toBeHidden();
});

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

test("admin join links do not fill the access-code form", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "buchunt.player-session",
      JSON.stringify({
        provider: "google",
        email: "player@example.com",
        accountId: "google-account-auto-join",
        idToken: "verified-test-token",
      }),
    );
    localStorage.setItem(
      "buchunt.player-profile.google-account-auto-join",
      "Baja",
    );
  });
  await page.route("**/api/admin/capabilities", (route) =>
    route.fulfill({
      status: 403,
      json: { error: "Administrator access required." },
    }),
  );
  const hunt = {
    id: "hunt-1",
    name: "Shared link hunt",
    description: "A hunt joined from an admin link.",
    beginsAt: "2020-01-01T00:00:00.000Z",
    endsAt: null,
    status: "published",
    tasks: [],
  };
  let joined = false;
  let joins = 0;
  await page.route("**/api/player/account/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/profile")) {
      await route.fulfill({
        json: { ok: true, value: { displayName: "Baja" } },
      });
    } else if (path.endsWith("/join")) {
      joins += 1;
      expect(route.request().postDataJSON()).toEqual({
        accessCode: "ABCD1234",
      });
      joined = true;
      await route.fulfill({ json: { ok: true, value: { huntId: "hunt-1" } } });
    } else if (path.endsWith("/hunts")) {
      await route.fulfill({ json: { ok: true, value: joined ? [hunt] : [] } });
    } else {
      await route.fulfill({ json: { ok: true, value: hunt } });
    }
  });

  await page.goto("/player.html?accessCode=ABCD1234&autoJoin=1");
  await expect(page.locator('[name="accessCode"]')).toHaveValue("");
  await expect.poll(() => joins).toBe(1);
  await expect(page.getByTestId("player-hunt-list")).toContainText(
    "Shared link hunt",
  );
  await expect(page.getByTestId("player-hunt-details")).toBeHidden();
});

test("manual access-code joins remain in the hunt list after closing details", async ({
  page,
}) => {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "buchunt.player-session",
      JSON.stringify({
        provider: "google",
        email: "admin@example.com",
        accountId: "google-account-manual-join",
        idToken: "verified-test-token",
      }),
    );
    localStorage.setItem(
      "buchunt.player-profile.google-account-manual-join",
      "Baja",
    );
  });
  await page.route("**/api/admin/capabilities", (route) =>
    route.fulfill({
      status: 403,
      json: { error: "Administrator access required." },
    }),
  );
  const hunt = {
    id: "hunt-manual-join",
    name: "Manual code hunt",
    description: "A hunt joined using its access code.",
    beginsAt: "2020-01-01T00:00:00.000Z",
    endsAt: null,
    status: "published",
    tasks: [],
  };
  let joined = false;
  await page.route("**/api/player/account/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/profile")) {
      await route.fulfill({
        json: { ok: true, value: { displayName: "Baja" } },
      });
    } else if (path.endsWith("/join")) {
      joined = true;
      await route.fulfill({
        json: { ok: true, value: { huntId: hunt.id } },
      });
    } else if (path.endsWith("/hunts")) {
      await route.fulfill({ json: { ok: true, value: joined ? [hunt] : [] } });
    } else {
      await route.fulfill({ json: { ok: true, value: hunt } });
    }
  });

  await page.goto("/player.html");
  await expect(page.getByTestId("player-hunt-list")).not.toContainText(
    hunt.name,
  );
  await page.getByLabel("Access code").fill("ABCD1234");
  await page.getByRole("button", { name: "Join Hunt", exact: true }).click();
  await expect(page.getByTestId("player-hunt-details")).toBeVisible();
  await expect(page.getByTestId("player-hunt-name")).toHaveText(hunt.name);
  await page.getByTestId("close-player-hunt-details").click();
  await expect(page.getByTestId("player-hunt-list")).toContainText(hunt.name);
  await page.reload();
  await expect(page.getByTestId("player-hunt-list")).toContainText(hunt.name);
});

test("manual access-code errors are visible outside the closed hunt details", async ({
  page,
}) => {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "buchunt.player-session",
      JSON.stringify({
        provider: "google",
        email: "player@example.com",
        accountId: "google-account-invalid-code",
        idToken: "verified-test-token",
      }),
    );
    localStorage.setItem(
      "buchunt.player-profile.google-account-invalid-code",
      "Baja",
    );
  });
  await page.route("**/api/admin/capabilities", (route) =>
    route.fulfill({
      status: 403,
      json: { error: "Administrator access required." },
    }),
  );
  await page.route("**/api/player/account/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/profile")) {
      await route.fulfill({
        json: { ok: true, value: { displayName: "Baja" } },
      });
    } else if (path.endsWith("/join")) {
      await route.fulfill({
        status: 400,
        json: {
          ok: false,
          code: "validation",
          message: "Invalid access code. The hunt may be unavailable.",
        },
      });
    } else if (path.endsWith("/hunts")) {
      await route.fulfill({ json: { ok: true, value: [] } });
    } else {
      await route.fulfill({ json: { ok: true, value: {} } });
    }
  });

  await page.goto("/player.html");
  await page.getByLabel("Hunt access code").fill("BADCODE1");
  await page.getByRole("button", { name: "Join Hunt", exact: true }).click();
  await expect(page.getByTestId("player-hunt-join-status")).toHaveText(
    "Invalid access code. The hunt may be unavailable.",
  );
  await expect(page.getByTestId("player-hunt-details")).toBeHidden();
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
        hint: "Check the north side.",
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
  const savedHunts = [hunt, endingSoonHunt, futureHunt, pastHunt, tasklessHunt];
  let huntListRequests = 0;
  let profileDisplayName = "";
  await page.route("**/api/player/account/**", async (route) => {
    expect(route.request().headers().authorization).toBe(
      "Bearer verified-test-token",
    );
    expect(route.request().headers().cookie).toBeUndefined();
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/profile")) {
      if (route.request().method() === "PUT") {
        profileDisplayName = route.request().postDataJSON().displayName;
      }
      await route.fulfill({
        json: { ok: true, value: { displayName: profileDisplayName } },
      });
      return;
    }
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
    if (path.endsWith("/answer")) {
      await route.fulfill({
        status: 400,
        json: {
          ok: false,
          code: "incorrect_answer",
          message: "Incorrect answer. Try again.",
        },
      });
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
  await expect(page.getByTestId("player-google-email")).toHaveCount(0);
  await expect(page.getByTestId("player-google-account-id")).toHaveCount(0);
  await expect(page.getByTestId("player-account-name-form")).toBeHidden();
  await page.getByTestId("player-change-display-name").click();
  await expect(page.getByTestId("player-account-name-form")).toBeVisible();
  await page.getByTestId("player-account-name-input").fill("Baja Two");
  await page.getByRole("button", { name: "Save display name" }).click();
  await expect(page.getByTestId("player-display-name")).toHaveText(
    "Baja Two (Player)",
  );
  expect(profileDisplayName).toBe("Baja Two");
  await expect(page.getByTestId("google-sign-in-host")).toBeHidden();
  await expect(page.getByTestId("google-sign-in-host")).toHaveAttribute(
    "inert",
    "",
  );
  await expect(page.getByLabel("Access code")).toHaveValue("");
  await expect(page.getByTestId("player-hunt-list")).toContainText("test");
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
  await expect(page.getByTestId("player-task-status")).toBeHidden();
  await expect(page.getByTestId("player-heading")).toBeHidden();
  await expect(page.getByTestId("active-hunt-count")).toHaveText("(3)");
  await expect(page.getByTestId("future-hunt-count")).toHaveText("(1)");
  await expect(page.getByTestId("past-hunt-count")).toHaveText("(1)");
  await expect(page.getByTestId("player-hunt-list")).toContainText("test");
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
  expect(await detailsDialog.evaluate((dialog) => dialog.scrollTop)).toBe(0);
  const answerTask = page
    .getByTestId("player-task")
    .filter({ hasText: "Library Steps" });
  await expect(answerTask).toBeVisible();
  await expect(answerTask.locator(".hunt-detail-task-heading")).toContainText(
    "Library Steps",
  );
  await expect(answerTask).toContainText("Look for the carved stone marker.");
  await expect(answerTask.locator(".task-hint")).toContainText(
    "Hint: Check the north side.",
  );
  const playerIntro = page.locator(".player-hunt-intro");
  const introBounds = await playerIntro.evaluate((intro) => ({
    panelTop: intro.getBoundingClientRect().top,
    dialogTop: intro.closest("dialog")!.getBoundingClientRect().top,
  }));
  expect(introBounds.panelTop).toBeGreaterThanOrEqual(introBounds.dialogTop);
  await expect(playerIntro.getByTestId("player-hunt-name")).toHaveText("test");
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
  const submitAnswer = answerTask.getByRole("button", {
    name: "Submit answer",
  });
  await expect(submitAnswer).toBeVisible();
  const buttonPositionBeforeFeedback = await submitAnswer.evaluate((button) => {
    const bounds = button.getBoundingClientRect();
    const actions = button.parentElement!.getBoundingClientRect();
    return {
      left: bounds.left - actions.left,
      top: bounds.top - actions.top,
      right: actions.right - bounds.right,
    };
  });
  await answerTask.getByLabel("Answer for Library Steps").fill("wrong");
  await submitAnswer.click();
  await expect(answerTask.getByRole("status")).toContainText(
    "Incorrect answer. Try again.",
  );
  const buttonPositionAfterFeedback = await submitAnswer.evaluate((button) => {
    const bounds = button.getBoundingClientRect();
    const actions = button.parentElement!.getBoundingClientRect();
    return {
      left: bounds.left - actions.left,
      top: bounds.top - actions.top,
      right: actions.right - bounds.right,
    };
  });
  expect(buttonPositionAfterFeedback).toEqual(buttonPositionBeforeFeedback);
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
  let profileDisplayName = "Baja";
  await page.route("**/api/player/account/profile", async (route) => {
    expect(route.request().headers().authorization).toBe(
      "Bearer verified-test-token",
    );
    if (route.request().method() === "PUT") {
      profileDisplayName = route.request().postDataJSON().displayName;
    }
    await route.fulfill({
      json: { ok: true, value: { displayName: profileDisplayName } },
    });
  });
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
  await page.getByTestId("admin-account").click();
  await expect(page.getByTestId("admin-google-email")).toHaveCount(0);
  await expect(page.getByTestId("admin-google-account-id")).toHaveCount(0);
  await page.getByTestId("admin-change-display-name").click();
  await page.getByTestId("admin-account-name-input").fill("Baja Revamped");
  await page.getByRole("button", { name: "Save display name" }).click();
  await expect(page.getByTestId("admin-display-name")).toHaveText(
    "Baja Revamped (Player)",
  );
  expect(profileDisplayName).toBe("Baja Revamped");
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
  await expect(page.getByTestId("player-account")).toContainText(
    "Baja Revamped",
  );
  await expect(page.getByTestId("player-task-status")).toContainText(
    "Your dashboard is ready",
  );
  await expect(page).toHaveURL(/\/player\.html$/);
});

test("multiple-choice selections submit immediately, retain rejected options, and recover from network errors", async ({
  page,
}) => {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "buchunt.player-session",
      JSON.stringify({
        provider: "google",
        email: "a@example.com",
        accountId: "player-a",
        idToken: "test-token",
      }),
    );
    localStorage.setItem("buchunt.player-profile.player-a", "Player A");
  });
  const task = {
    id: "task-choice",
    huntId: "hunt-choice",
    displayLabel: "Sign shape",
    description: "What shape is the sign?",
    taskType: "multiple-choice",
    choices: ["Circle", "Octagon", "Square", "Triangle"],
    incorrectChoices: [] as string[],
    completed: false,
  };
  const hunt = {
    id: "hunt-choice",
    name: "Shape hunt",
    description: "Find a sign",
    beginsAt: "2026-10-15T10:00:00.000Z",
    endsAt: null,
    status: "published",
    tasks: [task],
  };
  let fail = true;
  const answers: string[] = [];
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { user: { role: "user" } } }),
  );
  await page.route("**/api/player/account/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/answer")) {
      const answer = route.request().postDataJSON().answer;
      answers.push(answer);
      if (fail) {
        fail = false;
        await route.abort();
        return;
      }
      if (answer === "Square") task.completed = true;
      else task.incorrectChoices.push(answer);
      await route.fulfill({
        json: { ok: true, value: { completed: task.completed } },
      });
    } else
      await route.fulfill({
        json: { ok: true, value: path.endsWith("/hunts") ? [hunt] : hunt },
      });
  });
  await page.goto("/player.html?huntId=hunt-choice");
  const item = page.getByTestId("player-task");
  await expect(item.getByRole("button")).toHaveCount(4);
  await item.getByRole("button", { name: "Circle", exact: true }).click();
  await expect(item.getByRole("status")).toContainText("Try again.");
  await expect(
    item.getByRole("button", { name: "Circle", exact: true }),
  ).toBeEnabled();
  await item.getByRole("button", { name: "Circle", exact: true }).click();
  await expect(
    item.getByRole("button", { name: "Circle — Incorrect", exact: true }),
  ).toBeDisabled();
  await expect(item.getByRole("status")).toContainText("Incorrect answer");
  await page.reload();
  await expect(
    item.getByRole("button", { name: "Circle — Incorrect", exact: true }),
  ).toBeDisabled();
  await item.getByRole("button", { name: "Square", exact: true }).click();
  await expect(item).toContainText("Completed");
  await expect(item.getByRole("button")).toHaveCount(0);
  await expect(page.locator(".player-hunt .hunt-state-badge")).toHaveText(
    "Hunt complete",
  );
  await expect(page.getByTestId("player-hunt-lookup-status")).toContainText(
    "Hunt complete",
  );
  expect(answers).toEqual(["Circle", "Circle", "Square"]);
});
