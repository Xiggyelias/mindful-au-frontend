import { injectAuthToken } from "../support/auth";
import { test, expect } from "../fixtures/cmsTest";
import { LoginPage } from "../pages/LoginPage";

test.describe("auth and role routing", () => {
  test("protected admin routes redirect anonymous users to admin login", async ({ page }) => {
    await page.goto("/admin/dashboard");

    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test("admin can sign in through the UI and reach the dashboard", async ({ page, cmsApi }) => {
    const apiLogin = await cmsApi.login("admin");
    if (!apiLogin.ok) {
      test.skip(true, apiLogin.message);
      return;
    }

    const loginPage = new LoginPage(page);
    await loginPage.login("admin");
    await loginPage.expectDashboard("admin");
  });

  test("student tokens cannot open admin-only pages", async ({ page, cmsApi }) => {
    const student = await cmsApi.login("student");
    if (!student.ok) {
      test.skip(true, student.message);
      return;
    }

    await injectAuthToken(page, student.token, student.expiresIn, student.deviceId);
    await page.goto("/admin/dashboard");

    await expect(page).not.toHaveURL(/\/admin\/dashboard/);
    await expect(page).toHaveURL(/\/student\/(dashboard|diagnostic-assessment)|\/student\/login/);
  });

  test("peer counselors are routed away from counselor-only tools", async ({ page, cmsApi }) => {
    const peer = await cmsApi.login("peer_counselor");
    if (!peer.ok) {
      test.skip(true, peer.message);
      return;
    }

    await injectAuthToken(page, peer.token, peer.expiresIn, peer.deviceId);
    await page.goto("/counselor/students");

    await expect(page).not.toHaveURL(/\/counselor\/students/);
    await expect(page).toHaveURL(/\/peer\/dashboard|\/peer\/login/);
  });
});
