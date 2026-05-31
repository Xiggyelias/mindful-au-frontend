import { expect, type Page } from "@playwright/test";
import { e2eUsers, type CmsRole } from "../support/env";

const loginPaths: Partial<Record<CmsRole, string>> = {
  admin: "/admin/login",
  counselor: "/counselor/login",
  peer_counselor: "/peer/login",
};

const expectedHome: Partial<Record<CmsRole, RegExp>> = {
  admin: /\/admin\/dashboard/,
  counselor: /\/counselor\/dashboard/,
  peer_counselor: /\/peer\/dashboard/,
};

export class LoginPage {
  constructor(private readonly page: Page) {}

  async goto(role: Exclude<CmsRole, "student">): Promise<void> {
    await this.page.goto(loginPaths[role] ?? "/");
  }

  async login(role: Exclude<CmsRole, "student">): Promise<void> {
    const credentials = e2eUsers[role];

    await this.goto(role);
    await this.page.getByLabel(/email/i).fill(credentials.email);
    await this.page.getByLabel(/password/i).fill(credentials.password);
    await this.page.getByRole("button", { name: /sign in/i }).click();
  }

  async expectDashboard(role: Exclude<CmsRole, "student">): Promise<void> {
    await expect(this.page).toHaveURL(expectedHome[role] ?? /\/$/);
  }
}
