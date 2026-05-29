/** Best-effort helpers when session/local storage is full or stale. */

export function isStorageQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = String((error as { name?: string }).name || "");
  const message = String((error as { message?: string }).message || "");
  return (
    name === "QuotaExceededError" ||
    /quota/i.test(message) ||
    /kQuotaBytes/i.test(message)
  );
}

export function trimSessionStorageByPrefix(prefix: string, maxEntries: number): void {
  if (typeof sessionStorage === "undefined" || maxEntries < 1) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    if (keys.length <= maxEntries) return;

    const ranked = keys
      .map((key) => {
        try {
          const raw = sessionStorage.getItem(key);
          const parsed = raw ? (JSON.parse(raw) as { savedAt?: number }) : null;
          return { key, savedAt: Number(parsed?.savedAt || 0) };
        } catch {
          return { key, savedAt: 0 };
        }
      })
      .sort((a, b) => a.savedAt - b.savedAt);

    for (const row of ranked.slice(0, ranked.length - maxEntries)) {
      sessionStorage.removeItem(row.key);
    }
  } catch {
    // ignore
  }
}

export function trimLocalStorageByPrefix(prefix: string, maxEntries: number): void {
  if (typeof localStorage === "undefined" || maxEntries < 1) return;
  try {
    const keys = Object.keys(localStorage).filter((key) => key.startsWith(prefix));
    if (keys.length <= maxEntries) return;

    const ranked = keys
      .map((key) => {
        try {
          const raw = localStorage.getItem(key);
          const parsed = raw ? (JSON.parse(raw) as { saved_at?: number }) : null;
          return { key, savedAt: Number(parsed?.saved_at || 0) };
        } catch {
          return { key, savedAt: 0 };
        }
      })
      .sort((a, b) => a.savedAt - b.savedAt);

    for (const row of ranked.slice(0, ranked.length - maxEntries)) {
      localStorage.removeItem(row.key);
    }
  } catch {
    // ignore
  }
}
