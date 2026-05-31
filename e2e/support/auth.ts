import type { Page } from "@playwright/test";
import { authDeviceIdStorageKey, authTokenExpiresAtStorageKey, authTokenStorageKey } from "./env";

export async function injectAuthToken(
  page: Page,
  token: string,
  expiresInSeconds = 3600,
  deviceId?: string,
): Promise<void> {
  const expiresAt = Date.now() + expiresInSeconds * 1000;

  await page.addInitScript(
    ({ authTokenKey, authExpiresKey, authDeviceKey, authToken, authExpiresAt, authDeviceId }) => {
      window.sessionStorage.setItem(authTokenKey, authToken);
      window.sessionStorage.setItem(authExpiresKey, String(authExpiresAt));
      if (authDeviceId) {
        window.localStorage.setItem(authDeviceKey, authDeviceId);
      }
    },
    {
      authTokenKey: authTokenStorageKey,
      authExpiresKey: authTokenExpiresAtStorageKey,
      authDeviceKey: authDeviceIdStorageKey,
      authToken: token,
      authExpiresAt: expiresAt,
      authDeviceId: deviceId ?? null,
    },
  );
}
