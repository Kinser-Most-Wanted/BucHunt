import { test, expect } from "@playwright/test";

test("create hunt, save task, reload configuration and persist player completion", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.goto("/admin.html");
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
  await page
    .getByRole("button", { name: "Sprint verification (owner)", exact: true })
    .click();
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

test("only owners and contributors can configure a hunt through the creator workspace", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.goto("/admin.html");
  await expect(page.getByTestId("creator-id")).toHaveText(
    /^browser:[a-f0-9]{64}$/,
  );
  await expect(page.getByLabel("Administrator API token")).toHaveCount(0);
  await page.getByLabel("Hunt name", { exact: true }).fill("Shared hunt");
  await page
    .getByLabel("Description", { exact: true })
    .fill("A collaborative hunt");
  await page.getByLabel("Begins at (local time)").fill("2026-10-15T10:00");
  await page.getByRole("button", { name: "Create hunt", exact: true }).click();
  await expect(page.getByTestId("hunt-status")).toContainText("Hunt saved:");
  const id = await page.locator('#define-task [name="huntId"]').inputValue();
  const contributor = await browser.newContext({ baseURL });
  const stranger = await browser.newContext({ baseURL });
  try {
    const member = await contributor.newPage();
    await member.goto("/admin.html");
    await expect(member.getByTestId("creator-id")).toHaveText(
      /^browser:[a-f0-9]{64}$/,
    );
    await expect(member.getByTestId("my-hunts")).not.toContainText(
      "Shared hunt",
    );
    expect(
      (await contributor.request.get(`/api/admin/hunts/${id}`)).status(),
    ).toBe(403);
    const visitor = await stranger.newPage();
    await visitor.goto("/admin.html");
    await expect(visitor.getByTestId("creator-id")).toHaveText(
      /^browser:[a-f0-9]{64}$/,
    );
    expect(
      (await stranger.request.get(`/api/admin/hunts/${id}`)).status(),
    ).toBe(403);
    const memberId = (await member.getByTestId("creator-id").textContent())!;
    await page.getByLabel("Contributor creator ID").fill(memberId);
    await page
      .getByRole("button", { name: "Add contributor", exact: true })
      .click();
    await expect(page.getByTestId("contributor-status")).toContainText(
      "Contributor added",
    );
    await member.getByTestId("refresh-my-hunts").click();
    await member
      .getByRole("button", { name: "Shared hunt (contributor)", exact: true })
      .click();
    await expect(member.getByTestId("contributors-panel")).toBeHidden();
    await member
      .getByLabel("Display label", { exact: true })
      .fill("Collaborator task");
    await member.getByLabel("Clue and instructions").fill("Look nearby");
    await member.getByLabel("Required answer", { exact: true }).fill("Bucky");
    await member.getByLabel("Latitude", { exact: true }).fill("36");
    await member.getByLabel("Longitude", { exact: true }).fill("-82");
    await member.getByRole("button", { name: "Add task to hunt" }).click();
    await expect(member.getByTestId("task-status")).toContainText(
      "was saved and appears",
    );
    expect(
      (
        await contributor.request.post(`/api/admin/hunts/${id}/contributors`, {
          data: {
            creatorId: await visitor.getByTestId("creator-id").textContent(),
          },
        })
      ).status(),
    ).toBe(403);
    await page
      .getByRole("button", { name: "Remove contributor", exact: true })
      .click();
    await expect(page.getByTestId("contributor-status")).toHaveText(
      "Contributor removed.",
    );
    expect(
      (await contributor.request.get(`/api/admin/hunts/${id}`)).status(),
    ).toBe(403);
    await member.getByTestId("refresh-my-hunts").click();
    await expect(member.getByTestId("my-hunts")).not.toContainText(
      "Shared hunt",
    );
    expect(
      (await stranger.request.get(`/api/admin/hunts/${id}`)).status(),
    ).toBe(403);
  } finally {
    await contributor.close();
    await stranger.close();
  }
});
