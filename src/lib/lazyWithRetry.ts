import { lazy, ComponentType } from "react";

const LAZY_RETRY_SESSION_KEY = "lazy-retry-occurred";

const isChunkLoadError = (error: unknown): boolean => {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return (
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Loading chunk [\w-]+ failed/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /error loading dynamically imported module/i.test(message)
  );
};

/** Clear the one-time reload guard after a successful boot (e.g. manual refresh). */
export const clearLazyRetryGuard = (): void => {
  try {
    window.sessionStorage.removeItem(LAZY_RETRY_SESSION_KEY);
  } catch {
    /* ignore */
  }
};

/**
 * React.lazy wrapper for Vite code-split routes.
 * On stale chunk errors (common after deploy), reload once then surface the error
 * so Suspense does not hang forever.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  componentImport: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    try {
      const module = await componentImport();
      clearLazyRetryGuard();
      return module;
    } catch (error) {
      if (!isChunkLoadError(error)) {
        throw error;
      }

      console.error("Lazy route chunk failed to load:", error);

      let hasRetried = false;
      try {
        hasRetried = window.sessionStorage.getItem(LAZY_RETRY_SESSION_KEY) === "true";
      } catch {
        hasRetried = false;
      }

      if (!hasRetried) {
        try {
          window.sessionStorage.setItem(LAZY_RETRY_SESSION_KEY, "true");
        } catch {
          /* ignore */
        }
        window.location.reload();
      }

      // Never return a promise that never resolves — that leaves Suspense on "Loading page..." forever.
      throw error;
    }
  });
}
