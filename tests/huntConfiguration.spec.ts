import { test, expect } from "@playwright/test";
const token = process.env.ADMIN_TOKEN ?? "local-development-only";

test("create hunt, save task, reload configuration and persist player completion", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.goto("/admin.html");
  await page.getByLabel("Administrator API token").fill(token);
  await page
    .getByLabel("Hunt name", { exact: true })
    .fill("Sprint verification");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Integration test hunt");
  await page.getByLabel("Begins at (local time)").fill("2026-10-15T10:00");
  await page.getByRole("button", { name: "Create hunt", exact: true }).click();
  await expect(page.getByTestId("hunt-status")).toContainText("Hunt saved:");
  const id = await page.locator('#define-task [name="huntId"]').inputValue();
  expect(id).toMatch(/^[a-f0-9-]{36}$/);
  await page
    .getByLabel("Display label", { exact: true })
    .fill("Find the fountain");
  await page.getByLabel("Clue and instructions").fill("Read the plaque");
  await page.getByLabel("Required answer", { exact: true }).fill("Bucky");
  await page.getByLabel("Latitude", { exact: true }).fill("36.302");
  await page.getByLabel("Longitude", { exact: true }).fill("-82.369");
  await page.getByRole("button", { name: "Add task to hunt" }).click();
  await expect(page.getByTestId("task-status")).toContainText(
    "was saved and appears",
  );
  await page.reload();
  await page.getByLabel("Administrator API token").fill(token);
  await page.locator('#define-task [name="huntId"]').fill(id);
  await page.getByTestId("load-admin-hunt").click();
  await expect(page.getByTestId("defined-task-list")).toContainText(
    "Find the fountain",
  );
  await page.goto(`/player.html?huntId=${id}`);
  await expect(page.getByTestId("player-task")).toContainText("Incomplete");
  await page.getByLabel("Answer for Find the fountain").fill("wrong");
  await page.getByRole("button", { name: "Submit answer" }).click();
  await expect(page.getByTestId("player-task")).toContainText(
    "That answer did not match",
  );
  await page.getByLabel("Answer for Find the fountain").fill(" bucky ");
  await page.getByRole("button", { name: "Submit answer" }).click();
  await expect(page.getByTestId("player-task")).toContainText("Completed");
  await page.reload();
  await expect(page.getByTestId("player-task")).toContainText("Completed");
  const other = await browser.newContext({ baseURL });
  try {
    const otherPage = await other.newPage();
    await otherPage.goto(`/player.html?huntId=${id}`);
    await expect(otherPage.getByTestId("player-task")).toContainText(
      "Incomplete",
    );
  } finally {
    await other.close();
  }
});

test("invalid token never reports successful hunt creation", async ({
  page,
}) => {
  await page.goto("/admin.html");
  await page.getByLabel("Administrator API token").fill("wrong-token");
  await page.getByLabel("Hunt name", { exact: true }).fill("Rejected");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Must not be stored");
  await page.getByLabel("Begins at (local time)").fill("2026-10-15T10:00");
  await page.getByRole("button", { name: "Create hunt", exact: true }).click();
  await expect(page.getByTestId("hunt-status")).toContainText(
    "valid administrator API token",
  );
  await expect(page.getByTestId("hunt-player-link")).toBeHidden();
});
