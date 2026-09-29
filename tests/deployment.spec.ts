import { expect, test } from '@playwright/test';

test('deployment page contains the expected content', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('title')).toContainText('BucHunt');
  await expect(page.locator('body h1')).toContainText('BucHunt is deployed!');
  await expect(page.locator('body p')).toContainText(
    'AWS S3 + CloudFront deployment is working.',
  );
});
