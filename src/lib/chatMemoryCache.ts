const MAX_ENTRIES = 500;
const cache = new Map<number, string>();

export function getCachedPlaintext(messageId: number): string | undefined {
  return cache.get(messageId);
}

export function setCachedPlaintext(messageId: number, plaintext: string): void {
  if (cache.size >= MAX_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(messageId, plaintext);
}

export function clearPlaintextCache(): void {
  cache.clear();
}
