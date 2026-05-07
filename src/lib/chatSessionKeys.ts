/**
 * Session AES key persistence: localStorage (fast) + IndexedDB (durable across storage eviction, PWA).
 * Device RSA keys stay in localStorage (separate); this module only mirrors AES session secrets.
 */

const DB_NAME = "cms_e2e_session_keys_v1";
const DB_VERSION = 1;
const STORE = "aes_raw";

const SESSION_LS_PREFIXES = ["chat_key_v2_", "chat_key_", "chat_peer_pub_"];

function openKeyDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => resolve(null);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = (ev) => {
        const db = (ev.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
    } catch {
      resolve(null);
    }
  });
}

export async function idbSessionKeyGet(storageKey: string): Promise<string | null> {
  const db = await openKeyDb();
  if (!db) {
    return null;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(storageKey);
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- IDB result */
      req.onsuccess = () => resolve(typeof (req as any).result === "string" ? (req as any).result : null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function idbSessionKeySet(storageKey: string, rawKeyBase64: string): Promise<void> {
  const db = await openKeyDb();
  if (!db) {
    return;
  }
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).put(rawKeyBase64, storageKey);
    } catch {
      resolve();
    }
  });
}

export async function idbSessionKeyDelete(storageKey: string): Promise<void> {
  const db = await openKeyDb();
  if (!db) {
    return;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.objectStore(STORE).delete(storageKey);
    } catch {
      resolve();
    }
  });
}

/**
 * Restore AES session key: memory-style first step is caller's job; this is storage only.
 */
export async function loadPersistedSessionKey(storageKey: string): Promise<string | null> {
  try {
    const fromLs = localStorage.getItem(storageKey);
    if (fromLs && fromLs.length > 10) {
      return fromLs;
    }
  } catch {
    /* ignore */
  }
  const fromIdb = await idbSessionKeyGet(storageKey);
  if (fromIdb && fromIdb.length > 10) {
    try {
      localStorage.setItem(storageKey, fromIdb);
    } catch {
      /* quota */
    }
    return fromIdb;
  }
  return null;
}

export async function persistSessionKey(storageKey: string, rawKeyBase64: string): Promise<void> {
  try {
    localStorage.setItem(storageKey, rawKeyBase64);
  } catch {
    /* quota — IDB may still work */
  }
  await idbSessionKeySet(storageKey, rawKeyBase64);
}

export async function deletePersistedSessionKey(storageKey: string): Promise<void> {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    /* ignore */
  }
  await idbSessionKeyDelete(storageKey);
}

/**
 * Clears rotating chat secrets on logout. Does not remove device RSA keys so the same browser
 * can re-handshake without breaking other local apps; re-run full clear via "Re-sync" if needed.
 */
export function clearChatSessionKeysFromLocalStorage(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (SESSION_LS_PREFIXES.some((p) => k.startsWith(p))) {
        keys.push(k);
      }
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

export async function clearAllSessionKeysIndexedDb(): Promise<void> {
  if (typeof indexedDB === "undefined") {
    return;
  }
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function clearAllChatSessionSecrets(): Promise<void> {
  clearChatSessionKeysFromLocalStorage();
  await clearAllSessionKeysIndexedDb();
}
