import { expect, test } from "@playwright/test";

test("application navigation exposes working configuration and player workspaces", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/BucHunt/);
  await page.getByRole("link", { name: "Open administration" }).click();
  await expect(page.getByTestId("hunt-form")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create hunt", exact: true }),
  ).toBeEnabled();
  await expect(page.getByTestId("task-form")).toBeVisible();
  await page.getByRole("link", { name: "Player tasks", exact: true }).click();
  await expect(page.getByTestId("player-task-status")).toHaveText(
    "No tasks loaded.",
  );
});
