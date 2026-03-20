// E2E Encryption utilities using Web Crypto API

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const DEVICE_KEY_ALGORITHM = 'RSA-OAEP';
const DEVICE_KEY_MODULUS_LENGTH = 2048;
const DEVICE_KEY_HASH = 'SHA-256';
const DEVICE_PUBLIC_KEY_STORAGE = 'e2e_device_public_key_v1';
const DEVICE_PRIVATE_KEY_STORAGE = 'e2e_device_private_key_v1';

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  return btoa(String.fromCharCode(...bytes));
};

const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return bytes.buffer;
};

// Generate a new encryption key for a session
export const generateEncryptionKey = async (): Promise<CryptoKey> => {
  return await crypto.subtle.generateKey(
    { name: ALGORITHM, length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  );
};

// Export key to base64 string for storage/sharing
export const exportKey = async (key: CryptoKey): Promise<string> => {
  const exported = await crypto.subtle.exportKey('raw', key);
  return arrayBufferToBase64(exported);
};

// Import key from base64 string
export const importKey = async (keyString: string): Promise<CryptoKey> => {
  const keyData = Uint8Array.from(atob(keyString), c => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: ALGORITHM, length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  );
};

// Encrypt a message
export const encryptMessage = async (message: string, key: CryptoKey): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  const encrypted = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    data
  );
  
  // Combine IV and encrypted data
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  
  return btoa(String.fromCharCode(...combined));
};

// Decrypt a message
export const decryptMessage = async (encryptedData: string, key: CryptoKey): Promise<string> => {
  try {
    const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    
    const decrypted = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv },
      key,
      data
    );
    
    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch {
    return '[Unable to decrypt message]';
  }
};

// Generate a session key pair for key exchange (for future P2P key exchange)
export const generateKeyPair = async () => {
  return await crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true,
    ['deriveKey']
  );
};

// Derive shared secret from key exchange
export const deriveSharedKey = async (
  privateKey: CryptoKey,
  publicKey: CryptoKey
): Promise<CryptoKey> => {
  return await crypto.subtle.deriveKey(
    { name: 'ECDH', public: publicKey },
    privateKey,
    { name: ALGORITHM, length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
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
    ['encrypt', 'decrypt']
  );
};

const exportDevicePublicKey = async (publicKey: CryptoKey): Promise<string> => {
  const exported = await crypto.subtle.exportKey('spki', publicKey);
  return arrayBufferToBase64(exported);
};

const exportDevicePrivateKey = async (privateKey: CryptoKey): Promise<string> => {
  const exported = await crypto.subtle.exportKey('pkcs8', privateKey);
  return arrayBufferToBase64(exported);
};

const importDevicePublicKey = async (publicKeyBase64: string): Promise<CryptoKey> => {
  return crypto.subtle.importKey(
    'spki',
    base64ToArrayBuffer(publicKeyBase64),
    {
      name: DEVICE_KEY_ALGORITHM,
      hash: DEVICE_KEY_HASH,
    },
    true,
    ['encrypt']
  );
};

const importDevicePrivateKey = async (privateKeyBase64: string): Promise<CryptoKey> => {
  return crypto.subtle.importKey(
    'pkcs8',
    base64ToArrayBuffer(privateKeyBase64),
    {
      name: DEVICE_KEY_ALGORITHM,
      hash: DEVICE_KEY_HASH,
    },
    true,
    ['decrypt']
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
