/**
 * L1 in-memory cache for chat message snapshots.
 *
 * Layered caching strategy:
 *   L1 (this file) — module-scope Map, TTL 2min, max 10 sessions (LRU)
 *   L2             — IndexedDB via chatPreloadCache.ts, TTL 5min
 *   L3             — Network (API)
 *
 * Repeat opens of the same session within the TTL window return instantly
 * without touching IndexedDB or the network.
 */

export type MemoryCacheEntry = {
  /** Raw (possibly encrypted) messages as returned by the API / IDB */
  messages: unknown[];
  /** Optional map of messageId → decrypted plaintext (populated by pre-decrypt) */
  decryptedMap: Map<string, string>;
  savedAt: number;
};

const MEMORY_TTL_MS = 2 * 60 * 1000; // 2 minutes
const MAX_ENTRIES = 10;

/** Insertion-ordered Map — oldest entry is the first key (LRU via natural Map ordering) */
const store = new Map<string, MemoryCacheEntry>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function evictExpired(): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.savedAt > MEMORY_TTL_MS) {
      store.delete(key);
    }
  }
}

function evictLRU(): void {
  // Map iteration is insertion-ordered; first key is the oldest
  const first = store.keys().next().value;
  if (first !== undefined) {
    store.delete(first);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Write a snapshot into the L1 cache.
 * Evicts expired entries first; if still at capacity, evicts the LRU entry.
 */
export function setMemoryCache(
  sessionId: string,
  messages: unknown[],
  decryptedMap?: Map<string, string>
): void {
  const id = String(sessionId || '').trim();
  if (!id) return;

  evictExpired();

  if (store.size >= MAX_ENTRIES && !store.has(id)) {
    evictLRU();
  }

  // Re-insert to update LRU order (delete + set moves it to the end)
  store.delete(id);
  store.set(id, {
    messages,
    decryptedMap: decryptedMap ?? new Map(),
    savedAt: Date.now(),
  });
}

/**
 * Read a snapshot from the L1 cache.
 * Returns `null` if the entry is missing or expired.
 */
export function getMemoryCache(sessionId: string): MemoryCacheEntry | null {
  const id = String(sessionId || '').trim();
  if (!id) return null;

  const entry = store.get(id);
  if (!entry) return null;

  if (Date.now() - entry.savedAt > MEMORY_TTL_MS) {
    store.delete(id);
    return null;
  }

  // Promote to most-recently-used
  store.delete(id);
  store.set(id, entry);
  return entry;
}

/**
 * Merge additional decrypted plaintexts into an existing L1 entry
 * without invalidating the cached message list.
 */
export function mergeDecryptedIntoMemoryCache(
  sessionId: string,
  decryptedMap: Map<string, string>
): void {
  const id = String(sessionId || '').trim();
  const entry = store.get(id);
  if (!entry) return;
  for (const [msgId, plain] of decryptedMap.entries()) {
    entry.decryptedMap.set(msgId, plain);
  }
}

/**
 * Invalidate a single session's L1 entry (e.g. after sending a new message).
 */
export function invalidateMemoryCache(sessionId: string): void {
  store.delete(String(sessionId || '').trim());
}

/**
 * Wipe all L1 entries — call on logout.
 */
export function clearMemoryCache(): void {
  store.clear();
}

/** Diagnostic — number of currently live (non-expired) entries. */
export function getMemoryCacheSize(): number {
  evictExpired();
  return store.size;
}
