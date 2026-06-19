/// <reference lib="webworker" />

type Inbound = {
  type: "decrypt";
  id: number;
  cipherTrimmed: string;
  /** Raw 32-byte AES key as base64 */
  keyRawB64: string;
};

type OutboundOk = { id: number; ok: true; plaintext: string };
type OutboundErr = { id: number; ok: false; reason: string };

const ALGO = "AES-GCM";

/** Cache imported keys to avoid redundant importKey calls */
const keyCache = new Map<string, CryptoKey>();

function decodeBase64(b64: string): Uint8Array | null {
  try {
    const binary = atob(b64.trim());
    const len = binary.length;
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

self.onmessage = async (e: MessageEvent<Inbound>) => {
  const data = e.data;
  if (data?.type !== "decrypt") {
    return;
  }
  const { id, cipherTrimmed, keyRawB64 } = data;
  const combined = decodeBase64(cipherTrimmed);
  if (!combined || combined.length < 12 + 16) {
    const res: OutboundErr = { id, ok: false, reason: "invalid_payload" };
    self.postMessage(res);
    return;
  }

  try {
    let key = keyCache.get(keyRawB64);
    if (!key) {
      const keyBytes = decodeBase64(keyRawB64);
      if (!keyBytes || keyBytes.length !== 32) {
        const res: OutboundErr = { id, ok: false, reason: "bad_key" };
        self.postMessage(res);
        return;
      }
      key = await crypto.subtle.importKey(
        "raw",
        keyBytes as any,
        { name: ALGO, length: 256 },
        false,
        ["decrypt"]
      );
      // Limit cache size to prevent memory leaks if many keys are used
      if (keyCache.size > 50) {
        const firstKey = keyCache.keys().next().value;
        if (firstKey !== undefined) keyCache.delete(firstKey);
      }
      keyCache.set(keyRawB64, key);
    }

    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt({ name: ALGO, iv } as any, key, ciphertext);
    const plaintext = new TextDecoder().decode(decrypted);
    const res: OutboundOk = { id, ok: true, plaintext };
    self.postMessage(res);
  } catch {
    const res: OutboundErr = { id, ok: false, reason: "decrypt_failed" };
    self.postMessage(res);
  }
};

export {};
