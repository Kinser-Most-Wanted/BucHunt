import { expect, test } from "@playwright/test";

test("Google sign-in loads active player-safe Hunts and task status", async ({
  page,
}) => {
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
    let callback:
      | ((response: { credential: string }) => void)
      | undefined;
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
            prompt() {
              callback?.({ credential: `header.${claims}.signature` });
            },
            disableAutoSelect() {},
          },
        },
      },
    });
  });
  await page.route("**/api/player/hunts**", async (route) => {
    expect(route.request().headers().authorization).toMatch(/^Bearer header\./);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "hunt-1",
          name: "Campus Hunt",
          description: "Find the campus landmarks.",
          tasks: [
            {
              id: "task-1",
              displayLabel: "Old Fountain",
              completed: true,
              requiredAnswer: "secret-answer",
            },
            {
              id: "task-2",
              displayLabel: "Library Steps",
              completed: false,
              requiredAnswer: "another-secret",
            },
          ],
        },
      ]),
    });
  });

  await page.goto("/player.html");
  await page.getByRole("button", { name: "Sign in with Google" }).click();

  await expect(page.getByTestId("player-name-form")).toBeVisible();
  await page.getByTestId("player-display-name-input").fill("Baja");
  await page.getByRole("button", { name: "Save name and continue" }).click();

  await expect(page.getByTestId("player-account")).toHaveText("Signed in as Baja");
  await expect(page.getByTestId("player-email")).toHaveText(
    "Google account: player@example.com",
  );
  await expect(page.getByTestId("account-id-value")).toBeHidden();
  await expect(page.getByTestId("account-id-toggle")).toHaveText(
    "Show Google account ID",
  );
  await page.getByTestId("account-id-toggle").click();
  await expect(page.getByTestId("account-id-value")).toHaveText("google-account-123");
  await page.getByTestId("account-id-toggle").click();
  await expect(page.getByTestId("account-id-value")).toBeHidden();
  await expect(page.getByTestId("google-sign-in-host")).toBeHidden();
  await expect(page.getByTestId("google-sign-in-host")).toHaveAttribute("inert", "");
  await expect(page.getByTestId("player-task-status")).toHaveText(
    "1 active Hunt available.",
  );
  await expect(page.getByTestId("player-hunt-list")).toContainText(
    "Campus Hunt",
  );
  await expect(page.getByTestId("player-hunt-list")).toContainText(
    "Old Fountain",
  );
  await expect(page.getByTestId("player-hunt-list")).toContainText("Completed");
  await expect(page.getByTestId("player-hunt-list")).toContainText(
    "Not completed",
  );
  await expect(page.getByTestId("player-hunt-list")).not.toContainText(
    "secret-answer",
  );

  await page.getByTestId("player-sign-out").click();
  await expect(page.getByTestId("player-task-status")).toHaveText(
    "Choose Google to sign in and see your active Hunts.",
  );
  await expect(page.getByTestId("google-sign-in-host")).toBeVisible();
  await expect(page.getByTestId("google-sign-in-host")).not.toHaveAttribute("inert", "");
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await expect(page.getByTestId("player-account")).toHaveText("Signed in as Baja");
});

test("shows why Google sign-in is unavailable until configured", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "BUCHUNT_GOOGLE_CLIENT_ID", { value: "" });
  });
  await page.goto("/player.html");
  await expect(page.getByTestId("google-sign-in")).toBeVisible();
  await expect(page.getByTestId("player-sign-out")).toBeHidden();
  await page.getByTestId("google-sign-in").click();
  await expect(page.getByTestId("player-provider-status")).toHaveText(
    "Google sign-in needs a Google OAuth client ID.",
  );
});

