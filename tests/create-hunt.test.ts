import { expect, test } from "@playwright/test";

test.describe("PBI 1: Create a Hunt", () => {
  test("validates required hunt information and submits", async ({
    page,
  }) => {
    await page.goto("/admin.html");
    await expect(page.getByTestId("hunt-form")).toBeVisible();

    const submitBtn = page.locator('[data-testid="hunt-form"] button[type="submit"]');

    // Attempt submission with empty fields to test validation
    await submitBtn.click();
    await expect(page.getByTestId("hunt-status")).toContainText(
      "Hunt creation failed: validation error.",
    );
    await expect(page.getByTestId("validation-errors")).toContainText("name");
    await expect(
      page.getByTestId("validation-errors"),
    ).toContainText("description");

    // Fill valid hunt information
    await page.fill("#hunt-name", "Golden Pirate Expedition");
    await page.fill(
      "#hunt-description",
      "An exciting hunt across the island for buried treasure.",
    );
    await submitBtn.click();

    // Verifies repository integration result (not-implemented until #34)
    await expect(page.getByTestId("hunt-status")).toContainText(
      "Server-side JSON file persistence is not implemented",
    );
  });
});
