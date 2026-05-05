import { test, expect } from "@playwright/test";

/**
 * Smoke tests for production preview — no API, no auth.
 * Run: npm run test:e2e
 */
test.describe("landing", () => {
  test("shows counseling hero and crisis helpline", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: /Counseling/i }),
    ).toBeVisible();

    const helpline = page.getByRole("link", {
      name: /Youth Advocates Helpline: Call 393/i,
    });
    await expect(helpline).toBeVisible();
    await expect(helpline).toHaveAttribute("href", "tel:393");
  });
});
