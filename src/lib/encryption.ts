// E2E Encryption utilities using Web Crypto API (AES-GCM-256 + RSA-OAEP session wrap)

const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const DEVICE_KEY_ALGORITHM = "RSA-OAEP";
const DEVICE_KEY_MODULUS_LENGTH = 2048;
const DEVICE_KEY_HASH = "SHA-256";
const DEVICE_PUBLIC_KEY_STORAGE = "e2e_device_public_key_v1";
const DEVICE_PRIVATE_KEY_STORAGE = "e2e_device_private_key_v1";

/** Chunk size for binary → base64 without call stack / arg limits (WhatsApp-scale messages). */
const B64_CHUNK = 0x8000;

export const uint8ToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    const chunk = bytes.subarray(i, i + B64_CHUNK);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
};

export const base64ToUint8 = (base64: string): Uint8Array | null => {
  try {
    const binary = atob(base64.trim());
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
};

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => uint8ToBase64(new Uint8Array(buffer));

const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
  const u8 = base64ToUint8(base64);
  if (!u8) {
    return new ArrayBuffer(0);
  }
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  return copy.buffer;
};

export type DecryptChatPayloadResult =
  | { ok: true; plaintext: string }
  | { ok: false; reason: "invalid_base64" | "payload_too_short" | "decrypt_failed" };

export function logCryptoDebug(message: string, detail?: Record<string, unknown>): void {
  if (!import.meta.env.DEV) {
    return;
  }
  try {
    if (detail) {
      console.debug(`[cms-crypto] ${message}`, detail);
    } else {
      console.debug(`[cms-crypto] ${message}`);
    }
  } catch {
    /* ignore */
  }
}

export const generateEncryptionKey = async (): Promise<CryptoKey> => {
  return await crypto.subtle.generateKey(
    { name: ALGORITHM, length: KEY_LENGTH },
    true,
    ["encrypt", "decrypt"]
  );
};

export const exportKey = async (key: CryptoKey): Promise<string> => {
  const exported = await crypto.subtle.exportKey("raw", key);
  return arrayBufferToBase64(exported);
};

export const importKey = async (keyString: string): Promise<CryptoKey> => {
  const keyData = base64ToUint8(keyString);
  if (!keyData || keyData.length !== 32) {
    throw new Error("Invalid raw AES key material");
  }
  return await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: ALGORITHM, length: KEY_LENGTH },
    true,
    ["encrypt", "decrypt"]
  );
};

export const encryptMessage = async (message: string, key: CryptoKey): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, data);

  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);

  return uint8ToBase64(combined);
};

export const decryptChatPayload = async (
  encryptedData: string,
  key: CryptoKey
): Promise<DecryptChatPayloadResult> => {
  const trimmed = encryptedData.trim();
  const combined = base64ToUint8(trimmed);
  if (!combined || combined.length < 12 + 16) {
    logCryptoDebug("decrypt: reject payload", { reason: "invalid_or_short", len: combined?.length ?? 0 });
    return { ok: false, reason: combined ? "payload_too_short" : "invalid_base64" };
  }
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  try {
    const decrypted = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, ciphertext);
    const plaintext = new TextDecoder().decode(decrypted);
    logCryptoDebug("decrypt: ok", { cipherBytes: ciphertext.length });
    return { ok: true, plaintext };
  } catch {
    logCryptoDebug("decrypt: subtle.decrypt failed");
    return { ok: false, reason: "decrypt_failed" };
  }
};

/** @deprecated Prefer decryptChatPayload for structured errors */
export const decryptMessage = async (encryptedData: string, key: CryptoKey): Promise<string> => {
  const r = await decryptChatPayload(encryptedData, key);
  if (r.ok) {
    return r.plaintext;
  }
  return "[Unable to decrypt message]";
};

export const generateKeyPair = async () => {
  return await crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true,
    ["deriveKey"]
  );
};

export const deriveSharedKey = async (
  privateKey: CryptoKey,
  publicKey: CryptoKey
): Promise<CryptoKey> => {
  return await crypto.subtle.deriveKey(
    { name: "ECDH", public: publicKey },
    privateKey,
    { name: ALGORITHM, length: KEY_LENGTH },
    true,
    ["encrypt", "decrypt"]
  );
};

export interface DeviceKeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyBase64: string;
}

const generateDeviceKeyPair = async (): Promise<CryptoKeyPair> => {
  return crypto.subtle.generateKey(
    {
      name: DEVICE_KEY_ALGORITHM,
      modulusLength: DEVICE_KEY_MODULUS_LENGTH,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: DEVICE_KEY_HASH,
    },
    true,
    ["encrypt", "decrypt"]
  );
};

const exportDevicePublicKey = async (publicKey: CryptoKey): Promise<string> => {
  const exported = await crypto.subtle.exportKey("spki", publicKey);
  return arrayBufferToBase64(exported);
};

const exportDevicePrivateKey = async (privateKey: CryptoKey): Promise<string> => {
  const exported = await crypto.subtle.exportKey("pkcs8", privateKey);
  return arrayBufferToBase64(exported);
};

const importDevicePublicKey = async (publicKeyBase64: string): Promise<CryptoKey> => {
  return crypto.subtle.importKey(
    "spki",
    base64ToArrayBuffer(publicKeyBase64),
    {
      name: DEVICE_KEY_ALGORITHM,
      hash: DEVICE_KEY_HASH,
    },
    true,
    ["encrypt"]
  );
};

const importDevicePrivateKey = async (privateKeyBase64: string): Promise<CryptoKey> => {
  return crypto.subtle.importKey(
    "pkcs8",
    base64ToArrayBuffer(privateKeyBase64),
    {
      name: DEVICE_KEY_ALGORITHM,
      hash: DEVICE_KEY_HASH,
    },
    true,
    ["decrypt"]
  );
};

export const getOrCreateDeviceKeyPair = async (): Promise<DeviceKeyPair> => {
  const storedPublicKey = localStorage.getItem(DEVICE_PUBLIC_KEY_STORAGE);
  const storedPrivateKey = localStorage.getItem(DEVICE_PRIVATE_KEY_STORAGE);

  if (storedPublicKey && storedPrivateKey) {
    return {
      publicKey: await importDevicePublicKey(storedPublicKey),
      privateKey: await importDevicePrivateKey(storedPrivateKey),
      publicKeyBase64: storedPublicKey,
    };
  }

  const keyPair = await generateDeviceKeyPair();
  const publicKeyBase64 = await exportDevicePublicKey(keyPair.publicKey);
  const privateKeyBase64 = await exportDevicePrivateKey(keyPair.privateKey);

  localStorage.setItem(DEVICE_PUBLIC_KEY_STORAGE, publicKeyBase64);
  localStorage.setItem(DEVICE_PRIVATE_KEY_STORAGE, privateKeyBase64);

  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    publicKeyBase64,
  };
};

export const importPeerPublicKey = async (publicKeyBase64: string): Promise<CryptoKey> => {
  return importDevicePublicKey(publicKeyBase64);
};

export const encryptSessionKeyForPeer = async (
  sessionKeyBase64: string,
  peerPublicKey: CryptoKey
): Promise<string> => {
  const plaintext = new TextEncoder().encode(sessionKeyBase64);
  const encrypted = await crypto.subtle.encrypt(
    { name: DEVICE_KEY_ALGORITHM },
    peerPublicKey,
    plaintext
  );
  return arrayBufferToBase64(encrypted);
};

export const decryptSessionKeyFromPeer = async (
  encryptedKeyBase64: string,
  privateKey: CryptoKey
): Promise<string> => {
  const decrypted = await crypto.subtle.decrypt(
    { name: DEVICE_KEY_ALGORITHM },
    privateKey,
    base64ToArrayBuffer(encryptedKeyBase64)
  );
  return new TextDecoder().decode(decrypted);
};
