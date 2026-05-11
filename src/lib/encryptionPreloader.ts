/**
 * Preload and cache cryptographic keys to speed up E2EE initialization.
 * Generates session keys in background to reduce "Securing this message" delay.
 */

import { generateEncryptionKey, exportKey } from "./encryption";

interface PreloadedKey {
  keyString: string;
  createdAt: number;
  expiresAt: number;
}

const PRELOAD_CACHE = new Map<string, PreloadedKey>();
const PRELOAD_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_PRELOAD_KEYS = 10;

/**
 * Generate a preloaded session key for a potential chat session.
 * Call this before opening a chat (e.g., when user clicks on a counselor).
 */
export async function preloadSessionKey(sessionId: string, userId: number, peerId: number): Promise<void> {
  const cacheKey = `${sessionId}:${Math.min(userId, peerId)}:${Math.max(userId, peerId)}`;
  
  // Skip if already cached and not expired
  const existing = PRELOAD_CACHE.get(cacheKey);
  if (existing && existing.expiresAt > Date.now()) {
    return;
  }
  
  // Cleanup old keys if cache is full
  if (PRELOAD_CACHE.size >= MAX_PRELOAD_KEYS) {
    const now = Date.now();
    for (const [key, value] of PRELOAD_CACHE.entries()) {
      if (value.expiresAt <= now) {
        PRELOAD_CACHE.delete(key);
      }
    }
    
    // If still full, remove oldest
    if (PRELOAD_CACHE.size >= MAX_PRELOAD_KEYS) {
      const oldestKey = PRELOAD_CACHE.keys().next().value;
      if (oldestKey) {
        PRELOAD_CACHE.delete(oldestKey);
      }
    }
  }
  
  try {
    // Generate key in background
    const key = await generateEncryptionKey();
    const keyString = await exportKey(key);
    
    PRELOAD_CACHE.set(cacheKey, {
      keyString,
      createdAt: Date.now(),
      expiresAt: Date.now() + PRELOAD_TTL_MS,
    });
  } catch (error) {
    // Silently fail - preloading is optional
    if (import.meta.env.DEV) {
      console.warn('[encryptionPreloader] Failed to preload key:', error);
    }
  }
}

/**
 * Retrieve a preloaded session key if available.
 * Returns null if no preloaded key exists or it's expired.
 */
export function getPreloadedSessionKey(sessionId: string, userId: number, peerId: number): string | null {
  const cacheKey = `${sessionId}:${Math.min(userId, peerId)}:${Math.max(userId, peerId)}`;
  const preloaded = PRELOAD_CACHE.get(cacheKey);
  
  if (!preloaded || preloaded.expiresAt <= Date.now()) {
    PRELOAD_CACHE.delete(cacheKey);
    return null;
  }
  
  // Remove from cache after retrieval (one-time use)
  PRELOAD_CACHE.delete(cacheKey);
  return preloaded.keyString;
}

/**
 * Clear all preloaded keys (call on logout).
 */
export function clearPreloadedKeys(): void {
  PRELOAD_CACHE.clear();
}

/**
 * Preload keys for multiple potential sessions (e.g., counselor list).
 */
export async function preloadMultipleSessionKeys(
  sessions: Array<{ sessionId: string; userId: number; peerId: number }>
): Promise<void> {
  // Preload in parallel with concurrency limit
  const BATCH_SIZE = 3;
  for (let i = 0; i < sessions.length; i += BATCH_SIZE) {
    const batch = sessions.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(
      batch.map(({ sessionId, userId, peerId }) => 
        preloadSessionKey(sessionId, userId, peerId)
      )
    );
  }
}

/**
 * Get statistics about preloaded keys (for debugging).
 */
export function getPreloadStats(): { total: number; expired: number } {
  const now = Date.now();
  let expired = 0;
  
  for (const value of PRELOAD_CACHE.values()) {
    if (value.expiresAt <= now) {
      expired++;
    }
  }
  
  return {
    total: PRELOAD_CACHE.size,
    expired,
  };
}
