import { api } from "@/lib/api";

const LS_DISMISS_KEY = "cms_push_prompt_dismissed_v1";

function logWebPushDebug(stage: string, detail?: unknown): void {
  if (import.meta.env.VITE_DEBUG_WEB_PUSH !== "true") {
    return;
  }
  console.info("[cms:web-push]", stage, detail ?? "");
}

/** User-visible hints keyed by `registerPushSubscriptionWithServer` failure `reason`. */
export const WEB_PUSH_FAILURE_HINTS: Record<string, string> = {
  unsupported: "This browser does not support Web Push or notifications.",
  no_service_worker:
    "Service worker did not register. Use an HTTPS production build, or set VITE_ENABLE_SERVICE_WORKER=true for local testing.",
  vapid_fetch_failed: "Could not load push settings from the server (network or auth).",
  server_disabled: "Push is not enabled on the server (configure VAPID keys).",
  permission_denied: "Notification permission was denied.",
  subscribe_failed: "Browser refused the push subscription (try again or check site settings).",
  invalid_subscription: "Push subscription payload was invalid.",
  server_save_failed: "Server could not save the subscription (check API and database).",
};

export function isPushPromptDismissed(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(LS_DISMISS_KEY) === "1";
}

export function dismissPushPrompt(): void {
  window.localStorage.setItem(LS_DISMISS_KEY, "1");
}

export function clearPushPromptDismissed(): void {
  window.localStorage.removeItem(LS_DISMISS_KEY);
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Subscribes this browser to web push and registers the subscription with the API.
 * Caller should ensure user is authenticated (`api` sends Bearer token).
 */
export async function registerPushSubscriptionWithServer(): Promise<{ ok: boolean; reason?: string }> {
  if (typeof window === "undefined" || !("Notification" in window) || !("PushManager" in window)) {
    logWebPushDebug("abort", "unsupported");
    return { ok: false, reason: "unsupported" };
  }

  let registration = await navigator.serviceWorker.getRegistration();
  if (!registration) {
    try {
      registration = await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
      logWebPushDebug("service-worker registered", !!registration);
    } catch (err) {
      logWebPushDebug("service-worker register failed", err);
      return { ok: false, reason: "no_service_worker" };
    }
  }

  await navigator.serviceWorker.ready;

  if (!registration.pushManager) {
    logWebPushDebug("abort", "no pushManager on registration");
    return { ok: false, reason: "no_service_worker" };
  }

  let vapid: { enabled: boolean; publicKey: string | null };
  try {
    vapid = await api.getPushVapidPublicKey();
    logWebPushDebug("vapid response", { enabled: vapid.enabled, hasKey: Boolean(vapid.publicKey) });
  } catch (err) {
    logWebPushDebug("vapid fetch failed", err);
    return { ok: false, reason: "vapid_fetch_failed" };
  }

  if (!vapid.enabled || !vapid.publicKey) {
    logWebPushDebug("abort", "server disabled or missing public key");
    return { ok: false, reason: "server_disabled" };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    logWebPushDebug("permission", permission);
    return { ok: false, reason: "permission_denied" };
  }

  let subscription: PushSubscription;
  try {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid.publicKey),
    });
    logWebPushDebug("subscribed", subscription.endpoint?.slice(0, 48) + "…");
  } catch (err) {
    logWebPushDebug("pushManager.subscribe failed", err);
    return { ok: false, reason: "subscribe_failed" };
  }

  const raw = subscription.toJSON();
  if (!raw.endpoint || !raw.keys?.p256dh || !raw.keys?.auth) {
    logWebPushDebug("abort", "invalid subscription JSON");
    return { ok: false, reason: "invalid_subscription" };
  }

  try {
    await api.subscribeWebPush({
      endpoint: raw.endpoint,
      keys: { p256dh: raw.keys.p256dh, auth: raw.keys.auth },
      contentEncoding: "aesgcm",
    });
  } catch (err) {
    logWebPushDebug("POST /push/subscribe failed", {
      message: err instanceof Error ? err.message : String(err),
      status: (err as { response?: { status?: number } })?.response?.status,
      data: (err as { response?: { data?: unknown } })?.response?.data,
    });
    return { ok: false, reason: "server_save_failed" };
  }

  logWebPushDebug("complete", "subscription saved");
  return { ok: true };
}
