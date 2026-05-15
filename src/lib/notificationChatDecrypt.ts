import { api } from "@/lib/api";

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
    return "[Message sent with previous encryption - not readable]";
  })().finally(() => {
    inflight.delete(cacheKey);
  });

  inflight.set(cacheKey, promise);
  return promise;
}
