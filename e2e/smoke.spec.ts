import { test, expect } from "@playwright/test";

test("smoke test - has title", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/AU Counseling/i);
});

test("smoke test - login buttons visible", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /student/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /counselor/i })).toBeVisible();
});
