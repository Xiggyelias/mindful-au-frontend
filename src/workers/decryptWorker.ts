/**
 * Web Worker — AES-GCM batch decryption.
 *
 * Runs entirely off the main thread so React rendering is never blocked
 * by crypto operations.
 *
 * Message in:
 *   { type: 'decrypt', sessionKeyBase64: string, messages: RawWorkerMessage[] }
 *
 * Message out:
 *   { type: 'result', results: DecryptResult[] }
 *   { type: 'error',  error: string }
 */

export type RawWorkerMessage = {
  id: number | string;
  content: string;
  is_encrypted?: boolean;
};

export type DecryptResult = {
  id: number | string;
  plain: string;
  ok: boolean;
};

type IncomingPayload = {
  type: 'decrypt';
  sessionKeyBase64: string;
  messages: RawWorkerMessage[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function importAesKey(base64Key: string): Promise<CryptoKey> {
  const keyBytes = base64ToBytes(base64Key);
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
}

/**
 * Decrypt a single AES-GCM ciphertext.
 * Expected format: base64(iv[12] + ciphertext)
 */
async function decryptOne(key: CryptoKey, ciphertextB64: string): Promise<string> {
  const combined = base64ToBytes(ciphertextB64);
  if (combined.length < 12) throw new Error('Payload too short');
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plainBytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plainBytes);
}

function looksEncrypted(content: string): boolean {
  if (!content || content.length < 40) return false;
  return /^[A-Za-z0-9+/=]+$/.test(content);
}

// ─── Worker message handler ──────────────────────────────────────────────────

self.addEventListener('message', async (event: MessageEvent<IncomingPayload>) => {
  const { type, sessionKeyBase64, messages } = event.data ?? {};
  if (type !== 'decrypt') return;

  if (!sessionKeyBase64 || !Array.isArray(messages)) {
    self.postMessage({ type: 'error', error: 'Invalid payload' });
    return;
  }

  let key: CryptoKey;
  try {
    key = await importAesKey(sessionKeyBase64);
  } catch {
    self.postMessage({ type: 'error', error: 'Failed to import session key' });
    return;
  }

  const results: DecryptResult[] = [];

  for (const msg of messages) {
    const { id, content, is_encrypted } = msg;
    if (!is_encrypted || !looksEncrypted(content)) {
      results.push({ id, plain: content, ok: true });
      continue;
    }
    try {
      const plain = await decryptOne(key, content);
      results.push({ id, plain, ok: true });
    } catch {
      results.push({ id, plain: '', ok: false });
    }
  }

  self.postMessage({ type: 'result', results });
});
