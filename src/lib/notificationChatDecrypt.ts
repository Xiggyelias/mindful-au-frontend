import { api } from "@/lib/api";
import type { Session } from "@/hooks/useChatSession";
import { loadPersistedSessionKey } from "@/lib/chatSessionKeys";
import { decryptChatPayload, importKey } from "@/lib/encryption";
import { getChatSessionKeyStorageKeyV2, resolveChatPeerIdForE2E } from "@/lib/chatE2ESessionKey";

const PREVIEW_MAX = 80;

const inflight = new Map<string, Promise<string | null>>();

function normalizeMessageRows(payload: unknown): Array<{
  id: number;
  content: string;
  is_encrypted: boolean;
  message_type: string;
}> {
  const raw = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : [];

  return raw
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const r = row as Record<string, unknown>;
      const id = Number(r.id);
      if (!Number.isFinite(id)) return null;
      return {
        id,
        content: String(r.content ?? ""),
        is_encrypted: Boolean(r.is_encrypted),
        message_type: String(r.message_type ?? "text"),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

function clipPreview(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= PREVIEW_MAX) {
    return t;
  }
  return `${t.slice(0, PREVIEW_MAX - 1)}…`;
}

/**
 * Best-effort: decrypt inbound chat text for notification / digest previews when this device has the session AES key.
 * Never throws. Does not log plaintext.
 */
export function tryDecryptChatNotificationPreview(
  userId: number,
  sessionId: string,
  messageId: number,
  messageType: string
): Promise<string | null> {
  if (!Number.isFinite(userId) || userId <= 0) {
    return Promise.resolve(null);
  }
  if (!Number.isFinite(messageId) || messageId <= 0) {
    return Promise.resolve(null);
  }
  if (messageType === "file" || messageType === "voice") {
    return Promise.resolve(null);
  }

  const cacheKey = `${userId}|${sessionId}|${messageId}`;
  const existing = inflight.get(cacheKey);
  if (existing) {
    return existing;
  }

  const promise = (async (): Promise<string | null> => {
    let session: Session;
    try {
      session = (await api.getSession(sessionId)) as Session;
    } catch {
      return null;
    }

    const peerId = resolveChatPeerIdForE2E(session, userId);
    if (peerId === null || !Number.isFinite(peerId) || peerId <= 0) {
      return null;
    }

    const storageKey = getChatSessionKeyStorageKeyV2(sessionId, userId, peerId);
    const rawKey = await loadPersistedSessionKey(storageKey);
    if (!rawKey) {
      return null;
    }

    let cryptoKey: CryptoKey;
    try {
      cryptoKey = await importKey(rawKey);
    } catch {
      return null;
    }

    const afterId = Math.max(0, messageId - 1);
    let payload: unknown;
    try {
      payload = await api.getMessages(sessionId, { after_id: afterId, limit: 8, mark_read: false });
    } catch (err: any) {
      const status = (err as any)?.response?.status ?? (err as any)?.status;
      if (status === 410) return null; // expired session — stop silently
      return null;
    }

    const rows = normalizeMessageRows(payload);
    const row = rows.find((r) => r.id === messageId);
    if (!row) {
      return null;
    }

    if (!row.is_encrypted) {
      return clipPreview(row.content);
    }

    const result = await decryptChatPayload(row.content, cryptoKey);
    if (!result.ok) {
      return null;
    }

    return clipPreview(result.plaintext);
  })().finally(() => {
    inflight.delete(cacheKey);
  });

  inflight.set(cacheKey, promise);
  return promise;
}
