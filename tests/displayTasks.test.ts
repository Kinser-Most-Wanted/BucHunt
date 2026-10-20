import { expect, test } from "@playwright/test";

test("Google sign-in lets a player join and revisit saved Hunts", async ({
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
    sessionStorage.setItem("buchunt.player-session", JSON.stringify({
      provider: "google",
      email: "player@example.com",
      accountId: "google-account-123",
      idToken: "verified-server-session",
    }));
  });
  await page.route("**/api/auth/logout", route =>
    route.fulfill({ json: { signedOut: true } }),
  );
  await page.route("**/api/player/hunts/hunt-1", async (route) => {
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

test("player sign-in link opens the shared home sign-in", async ({ page }) => {
  await page.goto("/player.html");
  await page.getByRole("button", { name: "Sign in from BucHunt home" }).click();
  await expect(page).toHaveURL(/\/index\.html$/);
});
