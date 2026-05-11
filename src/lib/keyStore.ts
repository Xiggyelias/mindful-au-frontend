/**
 * IndexedDB-based storage for RSA device key pairs.
 * Replaces localStorage for cryptographic key persistence to support CryptoKey objects
 * and avoid localStorage size/quota limitations.
 */

const DB_NAME = "e2ee-keystore";
const DB_VERSION = 1;
const STORE_NAME = "device-keys";
const KEYPAIR_ID = "device-keypair";

export interface StoredKeyPair {
  id: string;
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
  createdAt: number;
}

/**
 * Opens the IndexedDB database for E2EE key storage.
 * Creates the object store if it doesn't exist.
 */
export function openDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      
      request.onerror = () => {
        if (import.meta.env.DEV) {
          console.error("[keyStore] Failed to open IndexedDB:", request.error);
        }
        resolve(null);
      };
      
      request.onsuccess = () => {
        resolve(request.result);
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("[keyStore] Exception opening IndexedDB:", error);
      }
      resolve(null);
    }
  });
}

/**
 * Saves RSA device key pair to IndexedDB.
 * Exports both keys as JWK and stores them under id 'device-keypair'.
 */
export async function saveDeviceKeys(
  publicKey: CryptoKey,
  privateKey: CryptoKey
): Promise<boolean> {
  const db = await openDB();
  if (!db) {
    if (import.meta.env.DEV) {
      console.warn("[keyStore] Cannot save keys - IndexedDB unavailable");
    }
    return false;
  }
  
  try {
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", publicKey);
    const privateKeyJwk = await crypto.subtle.exportKey("jwk", privateKey);
    
    const record: StoredKeyPair = {
      id: KEYPAIR_ID,
      publicKeyJwk,
      privateKeyJwk,
      createdAt: Date.now(),
    };
    
    return new Promise((resolve) => {
      try {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(record);
        
        request.onsuccess = () => {
          if (import.meta.env.DEV) {
            console.debug("[keyStore] Device keys saved successfully");
          }
          resolve(true);
        };
        
        request.onerror = () => {
          if (import.meta.env.DEV) {
            console.error("[keyStore] Failed to save keys:", request.error);
          }
          resolve(false);
        };
      } catch (error) {
        if (import.meta.env.DEV) {
          console.error("[keyStore] Exception saving keys:", error);
        }
        resolve(false);
      }
    });
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error("[keyStore] Failed to export keys:", error);
    }
    return false;
  }
}

/**
 * Loads RSA device key pair from IndexedDB.
 * Re-imports JWK keys as CryptoKey objects with RSA-OAEP algorithm.
 * Returns null if no keys are stored or on error.
 */
export async function loadDeviceKeys(): Promise<{
  publicKey: CryptoKey;
  privateKey: CryptoKey;
} | null> {
  const db = await openDB();
  if (!db) {
    return null;
  }
  
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(KEYPAIR_ID);
      
      request.onsuccess = async () => {
        const record = request.result as StoredKeyPair | undefined;
        if (!record || !record.publicKeyJwk || !record.privateKeyJwk) {
          resolve(null);
          return;
        }
        
        try {
          const publicKey = await crypto.subtle.importKey(
            "jwk",
            record.publicKeyJwk,
            {
              name: "RSA-OAEP",
              hash: "SHA-256",
            },
            true,
            ["encrypt", "wrapKey"]
          );
          
          const privateKey = await crypto.subtle.importKey(
            "jwk",
            record.privateKeyJwk,
            {
              name: "RSA-OAEP",
              hash: "SHA-256",
            },
            true,
            ["decrypt", "unwrapKey"]
          );
          
          if (import.meta.env.DEV) {
            console.debug("[keyStore] Device keys loaded successfully");
          }
          
          resolve({ publicKey, privateKey });
        } catch (importError) {
          if (import.meta.env.DEV) {
            console.error("[keyStore] Failed to import keys:", importError);
          }
          resolve(null);
        }
      };
      
      request.onerror = () => {
        if (import.meta.env.DEV) {
          console.error("[keyStore] Failed to load keys:", request.error);
        }
        resolve(null);
      };
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("[keyStore] Exception loading keys:", error);
      }
      resolve(null);
    }
  });
}

/**
 * Deletes the device key pair from IndexedDB.
 * Call this on logout to clear E2EE keys.
 */
export async function clearDeviceKeys(): Promise<boolean> {
  const db = await openDB();
  if (!db) {
    return true; // Nothing to clear
  }
  
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(KEYPAIR_ID);
      
      request.onsuccess = () => {
        if (import.meta.env.DEV) {
          console.debug("[keyStore] Device keys cleared");
        }
        resolve(true);
      };
      
      request.onerror = () => {
        if (import.meta.env.DEV) {
          console.error("[keyStore] Failed to clear keys:", request.error);
        }
        resolve(false);
      };
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("[keyStore] Exception clearing keys:", error);
      }
      resolve(false);
    }
  });
}

/**
 * Deletes the entire e2ee-keystore database.
 * Use for complete cleanup (e.g., account deletion).
 */
export async function deleteKeyStoreDatabase(): Promise<boolean> {
  if (typeof indexedDB === "undefined") {
    return true;
  }
  
  return new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(DB_NAME);
      
      request.onsuccess = () => {
        if (import.meta.env.DEV) {
          console.debug("[keyStore] Database deleted");
        }
        resolve(true);
      };
      
      request.onerror = () => {
        resolve(false);
      };
      
      request.onblocked = () => {
        // Database is in use, but deletion is queued
        resolve(true);
      };
    } catch {
      resolve(false);
    }
  });
}
