
import { expect, test } from "@playwright/test";

test("shared foundation links to independent PBI workspaces", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/BucHunt/);

  await expect(
    page.getByRole("heading", { level: 1 })
  ).toHaveText("BucHunt");

  await page.getByRole("link", {
    name: "Open administration",
  }).click();

  await expect(
    page.locator("#admin-login")
  ).toBeVisible();

  await expect(
    page.locator("#google-sign-in")
  ).toBeAttached();

  // Signed-out users should not access administrative forms.
  await expect(
    page.getByTestId("hunt-form")
  ).not.toBeVisible();

  await expect(
    page.getByTestId("task-form")
  ).not.toBeVisible();

  await page.getByRole("link", {
    name: "Player tasks",
    exact: true,
  }).click();

  await expect(
    page.getByTestId("player-task-status")
  ).toHaveText("No tasks loaded.");
});
