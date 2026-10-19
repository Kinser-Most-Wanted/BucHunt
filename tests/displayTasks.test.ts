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
            renderButton(element: HTMLElement) {
              const button = document.createElement("button");
              button.type = "button";
              button.textContent = "Sign in with Google";
              button.addEventListener("click", () => {
                callback?.({ credential: `header.${claims}.signature` });
              });
              element.append(button);
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

  await expect(page.getByTestId("player-account")).toHaveText(
    "Signed in as player@example.com with Google.",
  );
  await expect(page.getByTestId("player-provider-status")).toHaveText(
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
    "Sign in with Google to see your active Hunts.",
  );
});

test("shows why Google sign-in is unavailable until configured", async ({
  page,
}) => {
  await page.goto("/player.html");
  await expect(page.getByTestId("player-task-status")).toHaveText(
    "Google Sign-In needs an OAuth client ID before players can sign in.",
  );
});

