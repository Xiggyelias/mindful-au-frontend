// Encryption has been removed. These functions are pass-throughs.

export const encryptMessage = async (msg: string) => msg;
export const decryptMessage = async (msg: string) => msg;
export const decryptChatPayload = async (msg: string) => msg;
export const getOrCreateDeviceKeyPair = async () => null;
export const importPeerPublicKey = async () => null;
export const encryptSessionKeyForPeer = async () => null;
export const decryptSessionKeyFromPeer = async () => null;
export const generateEncryptionKey = async () => null;
export const exportKey = async () => '';
export const importKey = async () => null;
export const logCryptoDebug = () => {};
export const clearDecryptPlaintextCache = () => {};
export { clearDeviceKeyPair } from './keyStore';

export interface DeviceKeyPair {
  publicKey: string;
  privateKey: string;
}
