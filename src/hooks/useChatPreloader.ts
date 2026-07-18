import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { isSessionExpired, markSessionAsExpired } from '@/hooks/useChatSession';
import { resolveMessageAttachment, getAttachmentKind } from "@/lib/chatAttachments";
import { savePreloadedSessionMessages } from "@/lib/chatPreloadCache";
import { saveTypingSnapshot } from "@/lib/chatTypingCache";
import { recordPrefetchAttempt, recordPrefetchResult } from "@/lib/chatPerfMetrics";

const PREFETCH_TTL_MS = 30_000;
const PREFETCH_LIMIT = 40;
const PREFETCH_CONCURRENCY = 2;
const PREFETCH_TARGETS = 8;
const FOLLOWER_PREFETCH_TARGETS = 2;
const HIDDEN_PREFETCH_TARGETS = 1;
const PRELOAD_LEADER_KEY = "mindful:chat-preload-leader";
const PRELOAD_LEADER_HEARTBEAT_MS = 2_000;
const PRELOAD_LEADER_STALE_MS = 8_000;

const lastPrefetchedAtBySession = new Map<string, number>();
const inFlightBySession = new Map<string, Promise<void>>();

type PreloadableChat = {
  id: number | string;
  created_at?: string | null;
  updated_at?: string | null;
  lastActivity?: string | null;
  unread_count?: number | null;
  unreadCount?: number | null;
};

type MinimalMessage = {
  id?: number | string;
  file_url?: string | null;
  attachment?: unknown;
};

type PreloadLeaderState = {
  id: string;
  ts: number;
};

type NetworkInformationLike = {
  effectiveType?: string;
  saveData?: boolean;
};

type NavigatorWithHints = Navigator & {
  connection?: NetworkInformationLike;
  deviceMemory?: number;
};

function readLeaderState(): PreloadLeaderState | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(PRELOAD_LEADER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PreloadLeaderState;
    const id = String(parsed?.id || "").trim();
    const ts = Number(parsed?.ts || 0);
    if (!id || !Number.isFinite(ts) || ts <= 0) return null;
    return { id, ts };
  } catch {
    return null;
  }
}

function writeLeaderState(state: PreloadLeaderState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PRELOAD_LEADER_KEY, JSON.stringify(state));
  } catch {
    // best effort only
  }
}

function clearLeaderStateIfOwned(tabId: string): void {
  if (typeof localStorage === "undefined") return;
  const leader = readLeaderState();
  if (!leader || leader.id !== tabId) return;
  try {
    localStorage.removeItem(PRELOAD_LEADER_KEY);
  } catch {
    // best effort only
  }
}

function getAdaptivePreloadTargets(params: {
  isLeaderTab: boolean;
  isDocumentVisible: boolean;
}): number {
  const { isLeaderTab, isDocumentVisible } = params;
  let target = isDocumentVisible
    ? (isLeaderTab ? PREFETCH_TARGETS : FOLLOWER_PREFETCH_TARGETS)
    : HIDDEN_PREFETCH_TARGETS;

  if (typeof navigator === "undefined") {
    return Math.max(0, target);
  }

  const nav = navigator as NavigatorWithHints;
  const connection = nav.connection;
  const effectiveType = String(connection?.effectiveType || "").toLowerCase();
  const saveData = connection?.saveData === true;
  const memoryGb = Number(nav.deviceMemory || 0);
  const cores = Number(navigator.hardwareConcurrency || 0);

  if (saveData || effectiveType === "slow-2g" || effectiveType === "2g") {
    return isLeaderTab && isDocumentVisible ? 1 : 0;
  }
  if (effectiveType === "3g") {
    target = Math.min(target, isLeaderTab ? 3 : 1);
  }
  if (Number.isFinite(memoryGb) && memoryGb > 0 && memoryGb <= 2) {
    target = Math.min(target, isLeaderTab ? 3 : 1);
  }
  if (Number.isFinite(cores) && cores > 0 && cores <= 2) {
    target = Math.min(target, isLeaderTab ? 3 : 1);
  }

  return Math.max(0, target);
}

function normalizeMessagePayload(payload: unknown): MinimalMessage[] {
  if (Array.isArray(payload)) {
    return payload as MinimalMessage[];
  }
  if (payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)) {
    return (payload as { data: MinimalMessage[] }).data;
  }
  return [];
}

function warmImage(url: string): void {
  const src = String(url || "").trim();
  if (!src) return;
  try {
    const img = new Image();
    img.decoding = "async";
    img.loading = "eager";
    img.referrerPolicy = "no-referrer";
    img.src = src;
  } catch {
    // best effort only
  }
}

async function prefetchOne(sessionId: string, ownerUserId: string | null): Promise<void> {
  if (isSessionExpired(sessionId)) return;
  recordPrefetchAttempt();
  const now = Date.now();
  const last = Number(lastPrefetchedAtBySession.get(sessionId) || 0);
  if (now - last < PREFETCH_TTL_MS) {
    return;
  }
  const existing = inFlightBySession.get(sessionId);
  if (existing) {
    await existing;
    return;
  }

  const run = (async () => {
    try {
      const payload = await api.getMessages(sessionId, {
        limit: PREFETCH_LIMIT,
        mark_read: false,
        timeout_ms: 10000,
      });
      const messages = normalizeMessagePayload(payload);
      await savePreloadedSessionMessages(sessionId, messages, {
        ownerUserId,
      });
      try {
        const status = await api.getTypingState(sessionId, { timeout_ms: 3000 });
        saveTypingSnapshot(sessionId, status?.is_typing === true, {
          ownerUserId,
        });
      } catch {
        // best effort typing warmup
      }
      for (const m of messages) {
        const attachment = resolveMessageAttachment(m as never);
        if (!attachment) continue;
        const kind = getAttachmentKind(attachment, (m as { message_type?: string }).message_type);
        // Only warm image attachments. Voice notes are streamed through the
        // backend proxy and must never be fetched directly from S3 (the storage
        // host may have an untrusted certificate or be unreachable).
        if (kind !== "image") continue;
        const url = (attachment.url || attachment.download_url || m.file_url || "").trim();
        if (url) {
          warmImage(url);
        }
      }
      lastPrefetchedAtBySession.set(sessionId, Date.now());
      recordPrefetchResult(true);
    } catch (err: any) {
      const status = (err as any)?.response?.status ?? (err as any)?.status;
      if (status === 410) {
        markSessionAsExpired(sessionId);
        return;
      }
      recordPrefetchResult(false);
      // silent prefetch only
    } finally {
      inFlightBySession.delete(sessionId);
    }
  })();

  inFlightBySession.set(sessionId, run);
  await run;
}

async function prefetchQueue(sessionIds: string[], ownerUserId: string | null): Promise<void> {
  const queue = [...sessionIds];
  const workers = Array.from({ length: Math.min(PREFETCH_CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      await prefetchOne(next, ownerUserId);
    }
  });
  await Promise.all(workers);
}

export function useChatPreloader(params: {
  sessions: PreloadableChat[];
  activeSessionId: string | null;
  enabled: boolean;
  ownerUserId?: string | null;
}) {
  const { sessions, activeSessionId, enabled, ownerUserId } = params;
  const tabIdRef = useRef(`preload-tab-${Math.random().toString(36).slice(2)}-${Date.now()}`);
  const [isDocumentVisible, setIsDocumentVisible] = useState(() => {
    if (typeof document === "undefined") return true;
    return document.visibilityState === "visible";
  });
  const [isLeaderTab, setIsLeaderTab] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibilityChange = () => {
      setIsDocumentVisible(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const tabId = tabIdRef.current;
    const evaluateLeadership = () => {
      const now = Date.now();
      const leader = readLeaderState();
      const leaderIsStale = !leader || now - leader.ts > PRELOAD_LEADER_STALE_MS;
      if (!enabled || !isDocumentVisible) {
        clearLeaderStateIfOwned(tabId);
        setIsLeaderTab(false);
        return;
      }
      if (leaderIsStale || leader.id === tabId) {
        writeLeaderState({ id: tabId, ts: now });
        setIsLeaderTab(true);
        return;
      }
      setIsLeaderTab(false);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === PRELOAD_LEADER_KEY) {
        evaluateLeadership();
      }
    };
    evaluateLeadership();
    const timer = window.setInterval(evaluateLeadership, PRELOAD_LEADER_HEARTBEAT_MS);
    window.addEventListener("storage", onStorage);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", onStorage);
      clearLeaderStateIfOwned(tabId);
    };
  }, [enabled, isDocumentVisible]);

  useEffect(() => {
    if (!enabled || sessions.length === 0) {
      return;
    }

    const prioritized = [...sessions]
      .filter(session => !isSessionExpired(String(session.id)))
      .sort((a, b) => {
      const aUnread = Number(a.unread_count ?? a.unreadCount ?? 0);
      const bUnread = Number(b.unread_count ?? b.unreadCount ?? 0);
      if (aUnread !== bUnread) {
        return bUnread - aUnread;
      }
      const aTime = new Date(a.updated_at || a.lastActivity || a.created_at || 0).getTime();
      const bTime = new Date(b.updated_at || b.lastActivity || b.created_at || 0).getTime();
      return bTime - aTime;
    });

    const targetCount = getAdaptivePreloadTargets({
      isLeaderTab,
      isDocumentVisible,
    });
    if (targetCount <= 0) {
      return;
    }
    const ordered = [
      ...(activeSessionId
        ? prioritized.filter((s) => String(s.id) === String(activeSessionId))
        : []),
      ...prioritized.filter((s) => String(s.id) !== String(activeSessionId || "")),
    ]
      .slice(0, targetCount)
      .map((s) => String(s.id))
      .filter((id) => id.length > 0);

    if (ordered.length === 0) return;

    const t = window.setTimeout(() => {
      const normalizedOwnerUserId = String(ownerUserId || "").trim() || null;
      void prefetchQueue(ordered, normalizedOwnerUserId);
    }, 120);

    return () => window.clearTimeout(t);
  }, [activeSessionId, enabled, isDocumentVisible, isLeaderTab, ownerUserId, sessions]);
}
