import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/admin.html");
});

test("rejects incorrect admin credentials and keeps controls locked", async ({
  page,
}) => {
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByTestId("auth-status")).toHaveText(
    "Username or password is incorrect.",
  );
  await expect(page.getByTestId("admin-controls")).toHaveJSProperty(
    "inert",
    true,
  );
});

test("opens admin controls with the demo credentials and signs out", async ({
  page,
}) => {
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByTestId("admin-controls")).toHaveJSProperty(
    "inert",
    false,
  );
  await expect(page.getByTestId("auth-status")).toContainText(
    "browser-only prototype",
  );
  await page.reload();
  await expect(page.getByTestId("admin-controls")).toHaveJSProperty(
    "inert",
    false,
  );

  await page.getByTestId("admin-sign-out").click();
  await expect(page.getByTestId("admin-controls")).toHaveJSProperty(
    "inert",
    true,
  );
});

