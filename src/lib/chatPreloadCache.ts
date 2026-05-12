import {
  getMemoryCache,
  setMemoryCache,
  type MemoryCacheEntry,
} from '@/lib/chatMemoryCache';

type PreloadedSessionSnapshot = {
  sessionId: string;
  savedAt: number;
  ownerUserId?: string | null;
  keyScope?: string | null;
  messages: unknown[];
};

const DB_NAME = "mindful-chat-preload";
const STORE = "session_snapshots";
const VERSION = 1;
const SNAPSHOT_TTL_MS = 5 * 60 * 1000;
const MAX_MESSAGES = 80;

const openDb = (): Promise<IDBDatabase | null> =>
  new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "sessionId" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

export async function savePreloadedSessionMessages(
  sessionId: string,
  messages: unknown[],
  opts?: { ownerUserId?: string | null; keyScope?: string | null }
): Promise<void> {
  const id = String(sessionId || "").trim();
  if (!id) return;

  const ownerUserId = String(opts?.ownerUserId || "").trim() || null;
  const keyScope = String(opts?.keyScope || "").trim() || null;
  const sliced = messages.slice(-MAX_MESSAGES);

  // ── L1 write-through ──────────────────────────────────────────────────────
  setMemoryCache(id, sliced);

  // ── L2 IndexedDB write ────────────────────────────────────────────────────
  const db = await openDb();
  if (!db) return;
  const snapshot: PreloadedSessionSnapshot = {
    sessionId: id,
    savedAt: Date.now(),
    ownerUserId,
    keyScope,
    messages: sliced,
  };
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(snapshot);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function loadPreloadedSessionMessages(
  sessionId: string,
  opts?: { expectedOwnerUserId?: string | null; expectedKeyScope?: string | null }
): Promise<unknown[]> {
  console.log('[preload:read] checking cache for sessionId:', sessionId);
  const id = String(sessionId || "").trim();
  if (!id) return [];

  // ── L1 memory cache (fastest path) ───────────────────────────────────────
  const l1 = getMemoryCache(id);
  if (l1) {
    console.log('[preload:read] L1 MEMORY HIT:', sessionId, 'messages:', l1.messages.length);
    return l1.messages;
  }

  // ── L2 IndexedDB ──────────────────────────────────────────────────────────
  const db = await openDb();
  if (!db) return [];
  const expectedOwnerUserId = String(opts?.expectedOwnerUserId || "").trim() || null;
  const expectedKeyScope = String(opts?.expectedKeyScope || "").trim() || null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => {
        const row = req.result as PreloadedSessionSnapshot | undefined;
        if (!row || !Array.isArray(row.messages)) {
          console.log('[preload:read] CACHE MISS:', sessionId);
          resolve([]);
          return;
        }
        const rowOwner = String(row.ownerUserId || "").trim() || null;
        if (expectedOwnerUserId && rowOwner && rowOwner !== expectedOwnerUserId) {
          console.log('[preload:read] CACHE MISS (owner mismatch):', sessionId);
          resolve([]);
          return;
        }
        const rowKeyScope = String(row.keyScope || "").trim() || null;
        if (expectedKeyScope && rowKeyScope && rowKeyScope !== expectedKeyScope) {
          console.log('[preload:read] CACHE MISS (scope mismatch):', sessionId);
          resolve([]);
          return;
        }
        if (Date.now() - Number(row.savedAt || 0) > SNAPSHOT_TTL_MS) {
          console.log('[preload:read] CACHE MISS (expired):', sessionId);
          resolve([]);
          return;
        }
        console.log('[preload:read] CACHE HIT:', sessionId, 'messages:', row.messages.length);
        // ── Prime L1 from IDB hit ────────────────────────────────────────
        setMemoryCache(id, row.messages);
        resolve(row.messages);
      };
      req.onerror = () => {
        console.log('[preload:read] CACHE MISS (error):', sessionId);
        resolve([]);
      };
    } catch {
      resolve([]);
    }
  });
}
