import { expect, test } from "@playwright/test";

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
  await page.route("**/api/auth/logout", (route) =>
    route.fulfill({ json: { signedOut: true } }),
  );
  const hunt = {
    id: "hunt-1",
    name: "Campus Hunt",
    description: "Find the campus landmarks.",
    tasks: [
      {
        id: "task-1",
        displayLabel: "Old Fountain",
        completed: true,
        location: { latitude: 36.304, longitude: -82.368 },
      },
      { id: "task-2", displayLabel: "Library Steps", completed: false },
    ],
  };
  await page.route("**/api/player/account/**", async (route) => {
    expect(route.request().headers().authorization).toBe(
      "Bearer verified-test-token",
    );
    expect(route.request().headers().cookie).toBeUndefined();
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/hunts")) {
      await route.fulfill({ json: { ok: true, value: [hunt] } });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        value: {
          id: "hunt-1",
          name: "Campus Hunt",
          description: "Find the campus landmarks.",
          tasks: [
            {
              id: "task-1",
              displayLabel: "Old Fountain",
              completed: true,
              location: { latitude: 36.304, longitude: -82.368 },
            },
            { id: "task-2", displayLabel: "Library Steps", completed: false },
          ],
        },
      }),
    });
  });

  await page.goto("/player.html");
  await expect(page.getByTestId("player-hunt-lookup")).toBeHidden();
  await expect(page.getByTestId("player-name-form")).toBeVisible();
  await page.getByTestId("player-display-name-input").fill("Baja");
  await page.getByRole("button", { name: "Save name and continue" }).click();

  await expect(page.getByTestId("player-account")).toHaveText(
    "Signed in as Baja",
  );
  await expect(page.getByTestId("player-heading")).toHaveText("Your Hunts");
  await expect(page.getByTestId("player-hunt-lookup")).toBeVisible();
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
  await page.getByLabel("Hunt ID").fill("hunt-1");
  await page.getByRole("button", { name: "Join Hunt" }).click();
  await expect(page.getByTestId("player-hunt-name")).toHaveText("Campus Hunt");
  await expect(page.getByTestId("player-task-status")).toContainText(
    "1 saved Hunt",
  );
  await expect(page.getByTestId("player-hunt-list")).toContainText(
    "Campus Hunt",
  );
  await expect(page.getByTestId("player-hunt-list")).toContainText(
    "Old Fountain",
  );
  await expect(page.getByTestId("player-hunt-list")).toContainText(
    "Location: 36.304000, -82.368000",
  );
  await expect(
    page
      .getByTestId("player-hunt-list")
      .getByRole("link", { name: "Open map" }),
  ).toHaveAttribute(
    "href",
    "https://www.openstreetmap.org/?mlat=36.304000&mlon=-82.368000#map=18/36.304000/-82.368000",
  );
  await expect(page.getByTestId("player-hunt-list")).toContainText("Completed");
  await expect(page.getByTestId("player-hunt-list")).toContainText(
    "Not completed",
  );
  await expect(page.getByTestId("player-hunt-list")).not.toContainText(
    "secret-answer",
  );

  await page.getByTestId("player-sign-out").click();
  await expect(page).toHaveURL(/\/index\.html$/);
});

test("player sign-in config is requested without cookies", async ({ page }) => {
  await page
    .context()
    .addCookies([
      { name: "legacy", value: "existing", url: "http://127.0.0.1:3000" },
    ]);
  await page.route("**/api/player/account/config", async (route) => {
    expect(route.request().headers().cookie).toBeUndefined();
    await route.fulfill({
      status: 503,
      json: { ok: false, message: "Player sign-in is not configured." },
    });
  });
  await page.goto("/player.html");
  await page
    .getByRole("button", { name: "Sign in with Google for saved progress" })
    .click();
  await expect(page.getByTestId("player-provider-status")).toContainText(
    "not configured",
  );
});

test("expired bearer sessions can reauthenticate on the player page without cookies", async ({
  page,
}) => {
  const token = `header.${Buffer.from(JSON.stringify({ sub: "google-player", email: "player@example.com" })).toString("base64url")}.signature`;
  await page
    .context()
    .addCookies([
      { name: "legacy", value: "unchanged", url: "http://127.0.0.1:3000" },
    ]);
  await page.addInitScript(
    ({ token }) => {
      sessionStorage.setItem(
        "buchunt.player-session",
        JSON.stringify({
          provider: "google",
          accountId: "google-player",
          email: "player@example.com",
          idToken: "verified-server-session",
        }),
      );
      localStorage.setItem("buchunt.player-profile.google-player", "Baja");
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
                button.textContent = "Verify Google account";
                button.onclick = () => callback?.({ credential: token });
                parent.replaceChildren(button);
              },
              disableAutoSelect() {},
            },
          },
        },
      });
    },
    { token },
  );
  await page.route("**/api/player/account/**", async (route) => {
    expect(route.request().headers().cookie).toBeUndefined();
    if (route.request().url().endsWith("/config")) {
      await route.fulfill({
        json: { ok: true, value: { clientId: "test-client" } },
      });
    } else if (route.request().headers().authorization === `Bearer ${token}`) {
      await route.fulfill({ json: { ok: true, value: [] } });
    } else {
      await route.fulfill({
        status: 401,
        json: {
          ok: false,
          code: "unauthorized",
          message: "Sign in with Google again.",
        },
      });
    }
  });
  await page.goto("/player.html");
  await page.getByRole("button", { name: "Verify Google account" }).click();
  await expect(page.getByTestId("player-task-status")).toContainText(
    "no saved hunts",
  );
  expect(
    await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem("buchunt.player-session")!).idToken,
    ),
  ).toBe(token);
  expect(await page.context().cookies()).toContainEqual(
    expect.objectContaining({ name: "legacy", value: "unchanged" }),
  );
});
