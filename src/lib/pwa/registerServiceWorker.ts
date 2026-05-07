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

  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/service-worker.js", { scope: "/" }).catch(() => {
      // Avoid noise in production; Lighthouse / DevTools still show registration status.
    });
  });
}
