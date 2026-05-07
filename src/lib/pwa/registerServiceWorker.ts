/**
 * Registers the app shell + web push service worker (public/service-worker.js).
 * Requires HTTPS or localhost.
 *
 * Default: production only (SW cache-first breaks Vite HMR). Set
 * VITE_ENABLE_SERVICE_WORKER=true to register in dev (e.g. push testing).
 */
export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  const enableInDev = import.meta.env.VITE_ENABLE_SERVICE_WORKER === "true";
  if (!import.meta.env.PROD && !enableInDev) {
    return;
  }

  const register = () => {
    void navigator.serviceWorker.register("/service-worker.js", { scope: "/" }).catch(() => {
      // Avoid noise in production; Lighthouse / DevTools still show registration status.
    });
  };

  // Register as soon as the document is parsed so push subscribe() is less likely to race a late "load" event.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", register, { once: true });
  } else {
    register();
  }
}
