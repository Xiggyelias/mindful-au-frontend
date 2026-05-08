import { useEffect, useRef, useState } from "react";
import {
  CHAT_INCOMING_DIGEST_EVENT,
  type ChatIncomingDigestDetail,
} from "@/lib/chatRealtimeEvents";

type PreloadableChat = {
  id: number | string;
  created_at?: string | null;
  updated_at?: string | null;
  lastActivity?: string | null;
  unread_count?: number | null;
  unreadCount?: number | null;
};

type RealtimeChannel = {
  subscribe(callback?: (status: string) => void): RealtimeChannel;
  unsubscribe?: () => void;
};

type RealtimeClient = {
  channel(topic: string): RealtimeChannel;
};

const FOREGROUND_ROOM_TARGETS = 1;
const BACKGROUND_ROOM_TARGETS = 5;
const PREJOIN_SETUP_DELAY_MS = 100;
const BOOST_TTL_MS = 30_000;
const PREJOIN_LEADER_KEY = "mindful:chat-prejoin-leader";
const PREJOIN_LEADER_HEARTBEAT_MS = 2_000;
const PREJOIN_LEADER_STALE_MS = 8_000;

type NetworkInformationLike = {
  effectiveType?: string;
  saveData?: boolean;
};

type NavigatorWithHints = Navigator & {
  connection?: NetworkInformationLike;
  deviceMemory?: number;
};

type PrejoinLeaderState = {
  id: string;
  ts: number;
};

function readLeaderState(): PrejoinLeaderState | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(PREJOIN_LEADER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PrejoinLeaderState;
    if (!parsed || typeof parsed !== "object") return null;
    const id = String(parsed.id || "").trim();
    const ts = Number(parsed.ts || 0);
    if (!id || !Number.isFinite(ts) || ts <= 0) return null;
    return { id, ts };
  } catch {
    return null;
  }
}

function writeLeaderState(state: PrejoinLeaderState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PREJOIN_LEADER_KEY, JSON.stringify(state));
  } catch {
    // best effort only
  }
}

function clearLeaderStateIfOwned(tabId: string): void {
  if (typeof localStorage === "undefined") return;
  const leader = readLeaderState();
  if (!leader || leader.id !== tabId) return;
  try {
    localStorage.removeItem(PREJOIN_LEADER_KEY);
  } catch {
    // best effort only
  }
}

function getAdaptiveBackgroundTarget(defaultTarget: number): number {
  if (typeof navigator === "undefined") {
    return defaultTarget;
  }

  const nav = navigator as NavigatorWithHints;
  const connection = nav.connection;
  const effectiveType = String(connection?.effectiveType || "").toLowerCase();
  const saveData = connection?.saveData === true;
  const deviceMemory = Number(nav.deviceMemory || 0);
  const cpuCores = Number(navigator.hardwareConcurrency || 0);

  let target = defaultTarget;

  if (saveData || effectiveType === "slow-2g" || effectiveType === "2g") {
    target = 1;
  } else if (effectiveType === "3g") {
    target = Math.min(target, 2);
  }

  if (Number.isFinite(deviceMemory) && deviceMemory > 0 && deviceMemory <= 2) {
    target = Math.min(target, 2);
  }

  if (Number.isFinite(cpuCores) && cpuCores > 0 && cpuCores <= 2) {
    target = Math.min(target, 2);
  }

  return Math.max(1, target);
}

function prioritizeSessions(
  sessions: PreloadableChat[],
  boostedAtBySession: Map<string, number>
): PreloadableChat[] {
  const now = Date.now();
  return [...sessions].sort((a, b) => {
    const aBoostAge = now - Number(boostedAtBySession.get(String(a.id)) || 0);
    const bBoostAge = now - Number(boostedAtBySession.get(String(b.id)) || 0);
    const aBoosted = Number.isFinite(aBoostAge) && aBoostAge >= 0 && aBoostAge <= BOOST_TTL_MS;
    const bBoosted = Number.isFinite(bBoostAge) && bBoostAge >= 0 && bBoostAge <= BOOST_TTL_MS;
    if (aBoosted !== bBoosted) {
      return aBoosted ? -1 : 1;
    }
    const aUnread = Number(a.unread_count ?? a.unreadCount ?? 0);
    const bUnread = Number(b.unread_count ?? b.unreadCount ?? 0);
    if (aUnread !== bUnread) {
      return bUnread - aUnread;
    }
    const aTime = new Date(a.updated_at || a.lastActivity || a.created_at || 0).getTime();
    const bTime = new Date(b.updated_at || b.lastActivity || b.created_at || 0).getTime();
    return bTime - aTime;
  });
}

export function useChatRoomPrejoin(params: {
  sessions: PreloadableChat[];
  activeSessionId: string | null;
  enabled: boolean;
}) {
  const { sessions, activeSessionId, enabled } = params;
  const channelsRef = useRef<Map<string, RealtimeChannel>>(new Map());
  const tabIdRef = useRef(`tab-${Math.random().toString(36).slice(2)}-${Date.now()}`);
  const [boostedAtBySession, setBoostedAtBySession] = useState<Map<string, number>>(() => new Map());
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
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const tabId = tabIdRef.current;

    const evaluateLeadership = () => {
      const now = Date.now();
      const leader = readLeaderState();
      const leaderIsStale = !leader || now - leader.ts > PREJOIN_LEADER_STALE_MS;
      const selfId = tabId;

      if (!enabled || !isDocumentVisible) {
        clearLeaderStateIfOwned(selfId);
        setIsLeaderTab(false);
        return;
      }

      if (leaderIsStale || leader?.id === selfId) {
        writeLeaderState({ id: selfId, ts: now });
        setIsLeaderTab(true);
        return;
      }

      setIsLeaderTab(false);
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === PREJOIN_LEADER_KEY) {
        evaluateLeadership();
      }
    };

    evaluateLeadership();
    const timer = window.setInterval(evaluateLeadership, PREJOIN_LEADER_HEARTBEAT_MS);
    window.addEventListener("storage", onStorage);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", onStorage);
      clearLeaderStateIfOwned(tabId);
    };
  }, [enabled, isDocumentVisible]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onDigest = (event: Event) => {
      const detail = (event as CustomEvent<ChatIncomingDigestDetail>).detail;
      const ids = Array.isArray(detail?.session_ids) ? detail.session_ids : [];
      if (ids.length === 0) return;
      const now = Date.now();
      setBoostedAtBySession((previous) => {
        const next = new Map(previous);
        for (const id of ids) {
          const sessionId = String(id || "").trim();
          if (!sessionId) continue;
          next.set(sessionId, now);
        }
        return next;
      });
    };
    window.addEventListener(CHAT_INCOMING_DIGEST_EVENT, onDigest as EventListener);
    return () => {
      window.removeEventListener(CHAT_INCOMING_DIGEST_EVENT, onDigest as EventListener);
    };
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => {
      const now = Date.now();
      setBoostedAtBySession((previous) => {
        if (previous.size === 0) return previous;
        const next = new Map<string, number>();
        for (const [sessionId, boostedAt] of previous.entries()) {
          if (now - boostedAt <= BOOST_TTL_MS) {
            next.set(sessionId, boostedAt);
          }
        }
        return next.size === previous.size ? previous : next;
      });
    }, 10_000);
    return () => {
      window.clearInterval(t);
    };
  }, []);

  useEffect(() => {
    let isDisposed = false;

    const clearAll = () => {
      for (const channel of channelsRef.current.values()) {
        try {
          channel.unsubscribe?.();
        } catch {
          // best effort cleanup
        }
      }
      channelsRef.current.clear();
    };

    if (!enabled || sessions.length === 0) {
      clearAll();
      return;
    }

    const hasRealtimeConfig = Boolean(
      import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
    );
    if (!hasRealtimeConfig) {
      clearAll();
      return;
    }

    const prioritized = prioritizeSessions(sessions, boostedAtBySession);
    const normalizedActiveId = String(activeSessionId || "").trim();
    const foregroundTarget = isDocumentVisible && isLeaderTab ? FOREGROUND_ROOM_TARGETS : 0;
    const foreground = normalizedActiveId ? [normalizedActiveId] : [];
    const adaptiveBackgroundTarget = getAdaptiveBackgroundTarget(BACKGROUND_ROOM_TARGETS);
    const backgroundTarget = isDocumentVisible
      ? (isLeaderTab ? adaptiveBackgroundTarget : 1)
      : 1;
    const background = prioritized
      .filter((session) => String(session.id) !== normalizedActiveId)
      .slice(0, backgroundTarget)
      .map((session) => String(session.id))
      .filter(Boolean);

    const targetIds = [...foreground.slice(0, foregroundTarget), ...background];
    const targetSet = new Set(targetIds);

    const setup = async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      if (isDisposed) return;
      const client = supabase as unknown as RealtimeClient;

      for (const [sessionId, channel] of channelsRef.current.entries()) {
        if (targetSet.has(sessionId)) continue;
        try {
          channel.unsubscribe?.();
        } catch {
          // best effort cleanup
        }
        channelsRef.current.delete(sessionId);
      }

      for (const sessionId of targetIds) {
        if (channelsRef.current.has(sessionId)) continue;
        const channel = client.channel(`chat-sync:${sessionId}`);
        channel.subscribe();
        channelsRef.current.set(sessionId, channel);
      }
    };

    const timeout = window.setTimeout(() => {
      void setup();
    }, PREJOIN_SETUP_DELAY_MS);

    return () => {
      isDisposed = true;
      window.clearTimeout(timeout);
      clearAll();
    };
  }, [activeSessionId, boostedAtBySession, enabled, isDocumentVisible, isLeaderTab, sessions]);
}
