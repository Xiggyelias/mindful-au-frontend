/**
 * chatPreloadCache.ts
 *
 * Tab-scoped sessionStorage cache for preloaded chat messages.
 * Used by useEncryptedChat (warm hydration) and useChatPreloader (background prefetch).
 *
 * Keys: `chat:preload:<sessionId>` — value is a JSON-serialised PreloadEntry.
 * The cache is intentionally session-scoped (sessionStorage) so it is never
 * persisted across browser restarts and cannot leak across user sessions.
 */

const KEY_PREFIX = 'chat:preload:';
const MAX_TTL_MS = 5 * 60 * 1_000; // 5 minutes

type PreloadEntry = {
  messages: unknown[];
  savedAt: number;
  ownerUserId: string;
  keyScope: string | null;
};

function storageKey(sessionId: string): string {
  return `${KEY_PREFIX}${sessionId}`;
}

// --------------------------------------------------------------------------
// savePreloadedSessionMessages
// --------------------------------------------------------------------------

type SaveOptions = {
  ownerUserId: string;
  /** Optional encryption key scope — used to invalidate stale cache when the
   *  session key changes (e.g. after a key rotation). Pass `null` to skip. */
  keyScope?: string | null;
};

export async function savePreloadedSessionMessages(
  sessionId: string,
  messages: unknown[],
  options: SaveOptions,
): Promise<void> {
  if (!sessionId || !messages?.length) return;
  try {
    const entry: PreloadEntry = {
      messages,
      savedAt: Date.now(),
      ownerUserId: String(options.ownerUserId ?? ''),
      keyScope: options.keyScope ?? null,
    };
    sessionStorage.setItem(storageKey(sessionId), JSON.stringify(entry));
  } catch {
    // Storage quota exceeded or unavailable — silently ignore.
  }
}

// --------------------------------------------------------------------------
// loadPreloadedSessionMessages
// --------------------------------------------------------------------------

type LoadOptions = {
  expectedOwnerUserId: string;
  /** If provided, the cached entry is only returned when its keyScope matches. */
  expectedKeyScope?: string | null;
};

export async function loadPreloadedSessionMessages(
  sessionId: string,
  options: LoadOptions,
): Promise<unknown[] | null> {
  if (!sessionId) return null;
  try {
    const raw = sessionStorage.getItem(storageKey(sessionId));
    if (!raw) return null;

    const entry = JSON.parse(raw) as PreloadEntry;

    // Validate ownership — never serve another user's cached messages.
    if (entry.ownerUserId !== String(options.expectedOwnerUserId ?? '')) {
      sessionStorage.removeItem(storageKey(sessionId));
      return null;
    }

    // Validate key scope when the caller supplies one.
    if (
      options.expectedKeyScope !== undefined &&
      options.expectedKeyScope !== null &&
      entry.keyScope !== null &&
      entry.keyScope !== options.expectedKeyScope
    ) {
      sessionStorage.removeItem(storageKey(sessionId));
      return null;
    }

    // Evict stale entries.
    if (Date.now() - entry.savedAt > MAX_TTL_MS) {
      sessionStorage.removeItem(storageKey(sessionId));
      return null;
    }

    return Array.isArray(entry.messages) ? entry.messages : null;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------
// clearPreloadedSessionMessages — exported for completeness / future use
// --------------------------------------------------------------------------

export function clearPreloadedSessionMessages(sessionId: string): void {
  try {
    sessionStorage.removeItem(storageKey(sessionId));
  } catch {
    // ignore
  }
}
