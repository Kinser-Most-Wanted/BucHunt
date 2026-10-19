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

  await expect(page.getByTestId("player-account")).toHaveText(
    "Signed in as player@example.com with Google. Account ID: google-account-123.",
  );
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
    "Choose a provider to sign in and see your active Hunts.",
  );
});

test("shows why Google sign-in is unavailable until configured", async ({
  page,
}) => {
  await page.goto("/player.html");
  await expect(page.getByTestId("google-sign-in")).toBeVisible();
  await expect(page.getByTestId("microsoft-sign-in")).toBeVisible();
  await expect(page.getByTestId("player-sign-out")).toBeHidden();
  await page.getByTestId("google-sign-in").click();
  await expect(page.getByTestId("player-provider-status")).toHaveText(
    "Google sign-in needs a Google OAuth client ID. Microsoft sign-in is available below when configured.",
  );
  await page.getByTestId("microsoft-sign-in").click();
  await expect(page.getByTestId("player-provider-status")).toHaveText(
    "Microsoft sign-in needs a Microsoft Entra application client ID.",
  );
});

test("Microsoft popup returns the account ID and keeps both sign-in options visible", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "BUCHUNT_MICROSOFT_CLIENT_ID", {
      value: "microsoft-client-id",
    });
    Object.defineProperty(window, "open", {
      configurable: true,
      value: () => {
        const location = {};
        Object.defineProperty(location, "href", {
          set(url: string) {
            sessionStorage.setItem("test-microsoft-url", url);
          },
        });
        return { location };
      },
    });
  });
  await page.route("**/api/player/hunts**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([]),
    }),
  );

  await page.goto("/player.html");
  await page.getByTestId("microsoft-sign-in").click();
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem("test-microsoft-url")))
    .not.toBeNull();
  const authorizeUrl = await page.evaluate(
    () => sessionStorage.getItem("test-microsoft-url") ?? "",
  );
  const flow = await page.evaluate((url) => {
    const authorize = new URL(url);
    return {
      state: authorize.searchParams.get("state"),
      nonce: authorize.searchParams.get("nonce"),
      challengeMethod: authorize.searchParams.get("code_challenge_method"),
      responseType: authorize.searchParams.get("response_type"),
    };
  }, authorizeUrl);
  expect(flow.challengeMethod).toBe("S256");
  expect(flow.responseType).toBe("code");
  const credential = await page.evaluate((nonce) => {
    const claims = btoa(
      JSON.stringify({
        aud: "microsoft-client-id",
        nonce,
        email: "microsoft@example.com",
        oid: "microsoft-object-id",
        tid: "microsoft-tenant-id",
      }),
    )
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    return `header.${claims}.signature`;
  }, flow.nonce);
  await page.route(
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    async (route) => {
      expect(route.request().postData()).toContain("grant_type=authorization_code");
      expect(route.request().postData()).toContain("code_verifier=");
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ id_token: credential }),
      });
    },
  );
  await page.evaluate(
    ({ state, credential }) => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          data: {
            type: "buchunt-microsoft-login",
            state,
            authorizationCode: "test-authorization-code",
          },
        }),
      );
    },
    { state: flow.state, credential },
  );

  await expect(page.getByTestId("player-account")).toHaveText(
    "Signed in as microsoft@example.com with Microsoft. Account ID: microsoft-tenant-id:microsoft-object-id.",
  );
  await expect(page.getByTestId("google-sign-in")).toBeVisible();
  await expect(page.getByTestId("microsoft-sign-in")).toBeVisible();
  await expect(page.getByTestId("player-sign-out")).toBeVisible();
});

