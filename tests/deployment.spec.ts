import { expect, test } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

function parseAwsJson(output: string): Record<string, unknown> {
  const trimmed = output.trim();
  return trimmed ? JSON.parse(trimmed) : {};
}

test("AWS JSON parsing accepts empty success responses and rejects malformed output", () => {
  expect(parseAwsJson("")).toEqual({});
  expect(parseAwsJson("  \n")).toEqual({});
  expect(parseAwsJson('{"Item":{"id":{"S":"nonce"}}}')).toHaveProperty("Item");
  expect(() => parseAwsJson("not JSON")).toThrow();
});

// The deployment workflow supplies its HTTPS output as BASE_URL.
test.use({ baseURL: process.env.BASE_URL ?? "http://127.0.0.1:3000" });

test("landing page keeps player navigation behind sign-in", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/BucHunt/);
  await expect(page.getByTestId("google-sign-in")).toBeAttached();
  await expect(page.getByRole("navigation")).toHaveCount(0);
});

test("shared Google sign-in checks the server admin role", async ({ page }) => {
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
      json: { administrator, capabilities: ["administrative.access"] },
    }),
  );

  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await expect(page).toHaveURL(/player\.html$/);
  await expect(page.getByTestId("player-task-status")).toBeVisible();
  await page.getByRole("link", { name: "Administration", exact: true }).click();
  await expect(page.locator("#admin-status")).toHaveText(
    "Administrator access verified.",
  );
  await expect(page.locator("#admin-workspace")).toBeVisible();
  await expect(page.getByTestId("hunt-form")).toBeVisible();
  await page.locator("#sign-out").click();
  await expect(page.locator("#admin-workspace")).toBeHidden();
  await expect(page.locator("#admin-login")).toBeVisible();
  await expect(page.locator("#home-sign-in-link")).toBeVisible();
});

test("admin sign-in prompt stays hidden while session is loading", async ({
  page,
}) => {
  let finishSessionCheck!: () => void;
  const sessionCheck = new Promise<void>((resolve) => {
    finishSessionCheck = resolve;
  });
  const administrator = {
    subject: "google-subject-admin",
    email: "admin@example.com",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    role: "administrator",
  };

  await page.route("**/api/auth/session", async (route) => {
    await sessionCheck;
    await route.fulfill({ json: { user: administrator } });
  });
  await page.route("**/api/admin/capabilities", (route) =>
    route.fulfill({
      json: { administrator, capabilities: ["administrative.access"] },
    }),
  );

  await page.goto("/admin.html");
  await expect(page.locator("#admin-login")).toBeHidden();
  await expect(page.locator("#admin-status")).toHaveText(
    "Checking administrator session...",
  );

  finishSessionCheck();
  await expect(page.locator("#admin-workspace")).toBeVisible();
});

test("non-admin Google accounts cannot view Hunt Studio tools", async ({
  page,
}) => {
  const visitor = {
    subject: "google-subject-visitor",
    email: "visitor@example.com",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    role: "user",
  };
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { user: visitor } }),
  );

  await page.goto("/admin.html");
  await expect(page.locator("#admin-denied")).toBeVisible();
  await expect(page.getByTestId("admin-workspace")).toBeHidden();
  await expect(page.getByTestId("hunt-form")).toBeHidden();
  await expect(page.locator("#sign-out")).toBeVisible();
});

test("player account endpoints require bearer identity and never issue cookies", async ({
  request,
}) => {
  const config = await request.get("/api/player/account/config");
  expect(config.headers()["set-cookie"]).toBeUndefined();
  const payload = await config.json();
  if (process.env.BASE_URL || process.env.GOOGLE_CLIENT_ID) {
    expect(config.status()).toBe(200);
    expect(payload).toEqual({
      ok: true,
      value: { clientId: expect.any(String) },
    });
    expect(payload.value.clientId).not.toBe("");
  } else {
    expect(config.status()).toBe(503);
    expect(payload.ok).toBe(false);
  }
  const response = await request.get("/api/player/account/hunts", {
    headers: { Cookie: "buchunt-player=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
  });
  expect(response.status()).toBe(401);
  expect(response.headers()["set-cookie"]).toBeUndefined();
  expect((await response.json()).code).toBe("unauthorized");
});

test("live authentication routes persist nonces and reject invalid credentials", async ({
  request,
}) => {
  test.skip(
    !process.env.BASE_URL,
    "Requires the deployed HTTPS authentication service.",
  );
  const table = process.env.AUTH_SESSION_TABLE;
  expect(
    table,
    "Deployment must supply its real DynamoDB session table",
  ).toBeTruthy();
  const origin = new URL(process.env.BASE_URL!).origin;
  const config = await request.get("/api/auth/config");
  expect(config.status()).toBe(200);
  expect(config.headers()["cache-control"]).toContain("no-store");
  expect(config.headers()["set-cookie"]).toContain("__Host-buchunt-login=");
  expect(config.headers()["set-cookie"]).toContain("Secure");
  const { clientId, nonce } = await config.json();
  expect(clientId).toBe(process.env.GOOGLE_CLIENT_ID);
  expect(nonce).toMatch(/^[a-f0-9]{64}$/);
  const key = {
    id: { S: `login:${createHash("sha256").update(nonce).digest("hex")}` },
  };
  const readNonce = () => {
    const output = execFileSync(
      "aws",
      [
        "dynamodb",
        "get-item",
        "--table-name",
        table!,
        "--key",
        JSON.stringify(key),
        "--consistent-read",
        "--output",
        "json",
      ],
      { encoding: "utf8" },
    ).trim();
    // A successful GetItem can have no body after the nonce is consumed.
    return parseAwsJson(output);
  };
  try {
    expect(readNonce().Item).toBeTruthy();
    const rejectedOrigin = await request.post("/api/auth/login", {
      headers: { Origin: "https://invalid.example" },
      data: { credential: "invalid" },
    });
    expect(rejectedOrigin.status()).toBe(403);
    expect(readNonce().Item).toBeTruthy();
    const invalid = await request.post("/api/auth/login", {
      headers: { Origin: origin },
      data: { credential: "invalid" },
    });
    expect(invalid.status()).toBe(401);
    expect(readNonce().Item).toBeUndefined();
    const session = await request.get("/api/auth/session");
    expect(session.status()).toBe(401);
  } finally {
    execFileSync("aws", [
      "dynamodb",
      "delete-item",
      "--table-name",
      table!,
      "--key",
      JSON.stringify(key),
    ]);
  }
});

test("live session fixture verifies DynamoDB reads, authorization and logout", async ({
  request,
}) => {
  test.skip(
    !process.env.BASE_URL,
    "Requires the deployed HTTPS authentication service.",
  );
  const table = process.env.AUTH_SESSION_TABLE;
  expect(table).toBeTruthy();
  const token = randomBytes(32).toString("hex");
  const key = {
    id: { S: `session:${createHash("sha256").update(token).digest("hex")}` },
  };
  const identity = {
    kind: "session",
    subject: `ci-smoke-${token}`,
    email: `ci-${token}@invalid.example`,
    expiresAt: Math.floor(Date.now() / 1000) + 120,
  };
  const item = {
    ...key,
    data: { S: JSON.stringify(identity) },
    expiresAt: { N: String(identity.expiresAt) },
  };
  const headers = { Cookie: `__Host-buchunt-session=${token}` };
  try {
    // This fixture tests real application-session plumbing, not Google sign-in.
    execFileSync("aws", [
      "dynamodb",
      "put-item",
      "--table-name",
      table!,
      "--item",
      JSON.stringify(item),
    ]);
    const session = await request.get("/api/auth/session", { headers });
    expect(session.status()).toBe(200);
    expect((await session.json()).user).toEqual({
      subject: identity.subject,
      email: identity.email,
      expiresAt: identity.expiresAt,
      role: "user",
    });
    const admin = await request.get("/api/admin/capabilities", { headers });
    expect(admin.status()).toBe(403);
    const logout = await request.post("/api/auth/logout", {
      headers: { ...headers, Origin: new URL(process.env.BASE_URL!).origin },
      data: {},
    });
    expect(logout.status()).toBe(200);
    const replay = await request.get("/api/auth/session", { headers });
    expect(replay.status()).toBe(401);
  } finally {
    execFileSync("aws", [
      "dynamodb",
      "delete-item",
      "--table-name",
      table!,
      "--key",
      JSON.stringify(key),
    ]);
  }
});
