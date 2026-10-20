import { expect, test } from "@playwright/test";

test("application navigation exposes working configuration and player workspaces", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/BucHunt/);
  await page.getByRole("link", { name: "Open administration" }).click();
  await expect(page.getByTestId("hunt-form")).toBeVisible();
  await expect(page.locator("#google-sign-in")).toBeAttached();
  await expect(
    page.getByRole("button", { name: "Create hunt", exact: true }),
  ).toBeEnabled();
  await expect(page.getByTestId("task-form")).toBeVisible();
  await page.getByRole("link", { name: "Player tasks", exact: true }).click();
  await expect(page.getByTestId("player-task-status")).toHaveText(
    "No tasks loaded.",
  );
});

test("Google sign-in creates one verified session shared by administration and player pages", async ({
  page,
}) => {
  let authenticated = false;
  const administrator = {
    subject: "google-subject-123",
    email: "admin@example.com",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    role: "administrator",
  };

  await page.addInitScript(() => {
    type Callback = (response: { credential: string }) => void;
    const testWindow = window as typeof window & {
      google?: {
        accounts: {
          id: {
            initialize(options: { callback: Callback }): void;
            renderButton(parent: HTMLElement): void;
            disableAutoSelect(): void;
          };
        };
      };
      googleCallback?: Callback;
    };
    testWindow.google = {
      accounts: {
        id: {
          initialize(options) {
            testWindow.googleCallback = options.callback;
          },
          renderButton(parent) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = "Sign in with Google";
            button.addEventListener("click", () => {
              testWindow.googleCallback?.({
                credential: "verified-test-token",
              });
            });
            parent.replaceChildren(button);
          },
          disableAutoSelect() {},
        },
      },
    };
  });

  await page.route("**/api/auth/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/config") {
      await route.fulfill({
        json: { clientId: "test-client-id", nonce: "single-use-test-nonce" },
      });
      return;
    }
    if (path === "/api/auth/session") {
      await route.fulfill({
        status: authenticated ? 200 : 401,
        json: authenticated
          ? { user: administrator }
          : { error: "Sign-in required." },
      });
      return;
    }
    if (path === "/api/auth/login") {
      authenticated = true;
      await route.fulfill({ json: { user: administrator } });
      return;
    }
    if (path === "/api/auth/logout") {
      authenticated = false;
      await route.fulfill({ json: { signedOut: true } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: "Not found." } });
  });
  await page.route("**/api/admin/capabilities", (route) =>
    route.fulfill({
      json: {
        administrator,
        capabilities: ["administrative.access"],
      },
    }),
  );

  await page.goto("/admin.html");
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await expect(page.getByTestId("admin-status")).toHaveText(
    "Signed in with administrator access.",
  );
  await expect(page.locator("#admin-panel")).toBeVisible();

  await page.goto("/player.html");
  await expect(page.getByTestId("player-name-form")).toBeVisible();
  await page.getByTestId("player-display-name-input").fill("Baja");
  await page.getByRole("button", { name: "Save name and continue" }).click();
  await expect(page.getByTestId("player-display-name")).toHaveText("Baja");
  await page.getByTestId("player-sign-out").click();
  await expect(page.getByTestId("player-heading")).toHaveText(
    "Sign in to see active Hunts",
  );
});
