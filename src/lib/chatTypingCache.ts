type TypingSnapshot = {
  sessionId: string;
  ownerUserId?: string | null;
  isPeerTyping: boolean;
  savedAt: number;
};

const STORE_KEY_PREFIX = "mindful_chat_typing_";
const TYPING_TTL_MS = 20_000;

const toKey = (sessionId: string) => `${STORE_KEY_PREFIX}${sessionId}`;

export function saveTypingSnapshot(
  sessionId: string,
  isPeerTyping: boolean,
  opts?: { ownerUserId?: string | null }
): void {
  const id = String(sessionId || "").trim();
  if (!id || typeof localStorage === "undefined") return;
  const payload: TypingSnapshot = {
    sessionId: id,
    ownerUserId: String(opts?.ownerUserId || "").trim() || null,
    isPeerTyping: Boolean(isPeerTyping),
    savedAt: Date.now(),
  };
  try {
    localStorage.setItem(toKey(id), JSON.stringify(payload));
  } catch {
    // best effort only
  }
}

export function loadTypingSnapshot(
  sessionId: string,
  opts?: { expectedOwnerUserId?: string | null }
): { isPeerTyping: boolean } | null {
  const id = String(sessionId || "").trim();
  if (!id || typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(toKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TypingSnapshot;
    if (!parsed || typeof parsed !== "object") return null;
    const age = Date.now() - Number(parsed.savedAt || 0);
    if (!Number.isFinite(age) || age > TYPING_TTL_MS) return null;
    const expectedOwnerUserId = String(opts?.expectedOwnerUserId || "").trim() || null;
    const owner = String(parsed.ownerUserId || "").trim() || null;
    if (expectedOwnerUserId && owner && owner !== expectedOwnerUserId) return null;
    return { isPeerTyping: Boolean(parsed.isPeerTyping) };
  } catch {
    return null;
  }
}
