import { test, expect } from "@playwright/test";

/**
 * Smoke tests for production preview — no API, no auth.
 * Run: npm run test:e2e
 */
test.describe("landing", () => {
  test("shows counseling hero and crisis helpline", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /Counseling/i })).toBeVisible();

    await expect(page.getByText(/Youth Advocates Helpline/i)).toBeVisible();

    const call = page.getByRole("link", { name: /Call 393/i });
    await expect(call).toBeVisible();
    await expect(call).toHaveAttribute("href", "tel:393");
  });
});
