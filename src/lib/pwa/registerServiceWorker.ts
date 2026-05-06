/**
 * Registers the app shell service worker (public/service-worker.js).
 * Requires HTTPS or localhost.
 *
 * Production only: this SW cache-firsts same-origin GETs, which breaks Vite dev
 * (HMR, /@fs/, stale modules). Test the PWA with `npm run build && npm run preview`.
 */
export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  if (!import.meta.env.PROD) {
    return;
  }

  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/service-worker.js", { scope: "/" }).catch(() => {
      // Avoid noise in production; Lighthouse / DevTools still show registration status.
    });
  });
}
