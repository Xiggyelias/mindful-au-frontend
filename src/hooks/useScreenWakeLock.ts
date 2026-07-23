import { useEffect, useRef } from "react";

/**
 * Keeps the screen awake while `active` is true (Chrome/Edge/Android Chrome, and Safari
 * 16.4+ on iOS/macOS). No-ops silently on browsers without the Wake Lock API.
 *
 * Matters specifically for calls: on a phone, once the screen times out the browser
 * suspends the tab — on iOS Safari this stops camera frames outright (the remote/local
 * video freezes until the screen wakes again) and throttles the reconnect/heartbeat
 * timers everywhere else. A held wake lock is auto-released by the browser when the tab
 * is backgrounded, so this re-acquires on `visibilitychange` if the call is still active.
 */
export function useScreenWakeLock(active: boolean): void {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      return;
    }

    let cancelled = false;

    const acquire = async () => {
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void sentinel.release();
          return;
        }
        sentinelRef.current = sentinel;
      } catch {
        // Permission denied, unsupported, or the tab isn't visible yet — safe to ignore,
        // the visibilitychange handler below retries once the tab is visible again.
      }
    };

    void acquire();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && !sentinelRef.current) {
        void acquire();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      if (sentinel) {
        void sentinel.release().catch(() => {});
      }
    };
  }, [active]);
}
