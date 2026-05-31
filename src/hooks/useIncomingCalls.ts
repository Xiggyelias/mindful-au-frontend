import { useCallback, useEffect, useRef, useState } from "react";
import { effectiveWebRtcCallMode } from "@/lib/videoCall";
import {
  startCallRingtone,
  stopCallRingtone,
  warmCallRingtone,
} from "@/lib/sounds/notificationSoundManager";
import { subscribeIncomingCallWake } from "@/lib/incomingCallRealtime";

const POLL_ACTIVE_MS = 8_000;
const POLL_HIDDEN_MS = 20_000;
const POLL_BACKOFF_INITIAL_MS = 45_000;
const POLL_BACKOFF_MAX_MS = 5 * 60_000;
const AUTO_DISMISS_MS = 30_000;
const TAB_FLASH_MS = 1_000;
const CALLS_LEADER_KEY = "mindful:incoming-calls-leader";
const CALLS_LEADER_HEARTBEAT_MS = 4_000;
const CALLS_LEADER_STALE_MS = 12_000;

type IncomingCallBase = {
  id: number;
  appointment_id: number;
  call_type: string;
  scheduled_at: string | null;
  created_at?: string | null;
};

type CallsLeaderState = { id: string; ts: number };

function readCallsLeader(): CallsLeaderState | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(CALLS_LEADER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CallsLeaderState;
    const id = String(parsed?.id || "").trim();
    const ts = Number(parsed?.ts || 0);
    if (!id || !Number.isFinite(ts) || ts <= 0) return null;
    return { id, ts };
  } catch {
    return null;
  }
}

function writeCallsLeader(state: CallsLeaderState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(CALLS_LEADER_KEY, JSON.stringify(state));
  } catch {
    /* best effort */
  }
}

function clearCallsLeaderIfOwned(tabId: string): void {
  const leader = readCallsLeader();
  if (!leader || leader.id !== tabId) return;
  try {
    localStorage.removeItem(CALLS_LEADER_KEY);
  } catch {
    /* best effort */
  }
}

function isIncomingCallsRateLimited(error: unknown): boolean {
  const status =
    (error as { response?: { status?: number } })?.response?.status ??
    (error as { status?: number })?.status;
  return status === 429;
}

function retryAfterMs(error: unknown): number | null {
  const header =
    (error as { response?: { headers?: Record<string, string> } })?.response?.headers?.[
      "retry-after"
    ] ??
    (error as { response?: { headers?: Record<string, string> } })?.response?.headers?.[
      "Retry-After"
    ];
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : null;
  }
  return null;
}

function showBrowserCallNotification(title: string, body: string, tag: string) {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return;
  }
  if (Notification.permission !== "granted") {
    return;
  }
  try {
    new Notification(title, {
      body,
      tag,
      requireInteraction: true,
      silent: false,
    });
  } catch {
    /* ignore */
  }
}

export function useIncomingCalls<T extends IncomingCallBase>({
  enabled,
  fetchCalls,
  buildNotification,
  onAutoDismissCall,
  onActiveChange,
}: {
  enabled: boolean;
  fetchCalls: () => Promise<T[]>;
  buildNotification: (call: T) => { title: string; body: string };
  /** Called when the overlay times out (e.g. mark declined on server). */
  onAutoDismissCall?: (call: T) => void | Promise<void>;
  onActiveChange?: (active: boolean) => void;
}) {
  const [calls, setCalls] = useState<T[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const seenIdsRef = useRef<Set<number>>(new Set());
  const baseTitleRef = useRef<string | null>(null);
  const flashIntervalRef = useRef<number | null>(null);
  const autoDismissTimersRef = useRef<Map<number, number>>(new Map());
  const fetchInFlightRef = useRef(false);
  const pollTimerRef = useRef<number | null>(null);
  const backoffUntilRef = useRef(0);
  const backoffMsRef = useRef(POLL_BACKOFF_INITIAL_MS);
  const tabIdRef = useRef(`calls-tab-${Math.random().toString(36).slice(2)}-${Date.now()}`);
  const isLeaderTabRef = useRef(false);

  const clearAutoDismiss = useCallback((callId: number) => {
    const t = autoDismissTimersRef.current.get(callId);
    if (t !== undefined) {
      window.clearTimeout(t);
      autoDismissTimersRef.current.delete(callId);
    }
  }, []);

  const removeCallLocal = useCallback(
    (callId: number) => {
      clearAutoDismiss(callId);
      setCalls((prev) => prev.filter((c) => c.id !== callId));
    },
    [clearAutoDismiss]
  );

  const announceNewCall = useCallback(
    (call: T) => {
      const mode = effectiveWebRtcCallMode(call);
      startCallRingtone(mode === "video" ? "video" : "audio");
      try {
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          navigator.vibrate([300, 100, 300, 100, 300]);
        }
      } catch {
        /* ignore */
      }
      const { title, body } = buildNotification(call);
      showBrowserCallNotification(title, body, `cms-incoming-call-${call.id}`);
    },
    [buildNotification]
  );

  const evaluateCallsLeadership = useCallback(() => {
    const now = Date.now();
    const leader = readCallsLeader();
    const leaderIsStale = !leader || now - leader.ts > CALLS_LEADER_STALE_MS;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      clearCallsLeaderIfOwned(tabIdRef.current);
      isLeaderTabRef.current = false;
      return;
    }
    if (leaderIsStale || leader?.id === tabIdRef.current) {
      writeCallsLeader({ id: tabIdRef.current, ts: now });
      isLeaderTabRef.current = true;
      return;
    }
    isLeaderTabRef.current = false;
  }, []);

  const applyRateLimitBackoff = useCallback((error: unknown) => {
    const retryAfter = retryAfterMs(error);
    const nextBackoff = Math.min(
      POLL_BACKOFF_MAX_MS,
      Math.max(POLL_BACKOFF_INITIAL_MS, retryAfter ?? backoffMsRef.current * 2)
    );
    backoffMsRef.current = nextBackoff;
    backoffUntilRef.current = Date.now() + nextBackoff;
  }, []);

  const fetchIncoming = useCallback(
    async (options?: { urgent?: boolean }) => {
      if (!enabled) return;
      if (options?.urgent) {
        evaluateCallsLeadership();
        const leader = readCallsLeader();
        const leaderIsStale = !leader || Date.now() - leader.ts > CALLS_LEADER_STALE_MS;
        if (!isLeaderTabRef.current && !leaderIsStale) return;
        if (Date.now() < backoffUntilRef.current) return;
      } else {
        if (!isLeaderTabRef.current) return;
        if (Date.now() < backoffUntilRef.current) return;
      }
      if (fetchInFlightRef.current) {
        return;
      }

      fetchInFlightRef.current = true;
      try {
        const normalized = await fetchCalls();
        backoffMsRef.current = POLL_BACKOFF_INITIAL_MS;
        backoffUntilRef.current = 0;
        setCalls(normalized);

        for (const c of normalized) {
          if (!seenIdsRef.current.has(c.id)) {
            seenIdsRef.current.add(c.id);
            announceNewCall(c);
          }
        }

        const activeIds = new Set(normalized.map((c) => c.id));
        autoDismissTimersRef.current.forEach((timer, callId) => {
          if (!activeIds.has(callId)) {
            window.clearTimeout(timer);
            autoDismissTimersRef.current.delete(callId);
          }
        });
        seenIdsRef.current.forEach((id) => {
          if (!activeIds.has(id)) {
            seenIdsRef.current.delete(id);
            clearAutoDismiss(id);
          }
        });
      } catch (error) {
        if (isIncomingCallsRateLimited(error)) {
          applyRateLimitBackoff(error);
        }
      } finally {
        fetchInFlightRef.current = false;
      }
    },
    [announceNewCall, applyRateLimitBackoff, clearAutoDismiss, enabled, evaluateCallsLeadership, fetchCalls]
  );

  const schedulePoll = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (!enabled) {
      return;
    }
    const hidden =
      typeof document !== "undefined" && document.visibilityState === "hidden";
    const baseDelay = hidden ? POLL_HIDDEN_MS : POLL_ACTIVE_MS;
    const backoffRemaining = Math.max(0, backoffUntilRef.current - Date.now());
    const delay = Math.max(baseDelay, backoffRemaining);
    pollTimerRef.current = window.setTimeout(() => {
      pollTimerRef.current = null;
      void fetchIncoming().finally(() => schedulePoll());
    }, delay);
  }, [enabled, fetchIncoming]);

  useEffect(() => {
    if (!enabled) {
      onActiveChange?.(false);
      return;
    }
    onActiveChange?.(calls.length > 0);
  }, [enabled, calls.length, onActiveChange]);

  useEffect(() => {
    if (!enabled || calls.length === 0) {
      stopCallRingtone();
      return;
    }
    const wantsVideo = calls.some((c) => effectiveWebRtcCallMode(c) === "video");
    startCallRingtone(wantsVideo ? "video" : "audio");
  }, [enabled, calls]);

  useEffect(() => {
    return () => {
      stopCallRingtone();
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setCalls([]);
      seenIdsRef.current.clear();
      autoDismissTimersRef.current.forEach((t) => window.clearTimeout(t));
      autoDismissTimersRef.current.clear();
      backoffUntilRef.current = 0;
      backoffMsRef.current = POLL_BACKOFF_INITIAL_MS;
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      clearCallsLeaderIfOwned(tabIdRef.current);
      return;
    }

    warmCallRingtone();
    evaluateCallsLeadership();
    void fetchIncoming({ urgent: true });
    schedulePoll();

    const leaderTimer = window.setInterval(evaluateCallsLeadership, CALLS_LEADER_HEARTBEAT_MS);

    const onVisible = () => {
      evaluateCallsLeadership();
      if (document.visibilityState === "visible") {
        if (Date.now() >= backoffUntilRef.current) {
          void fetchIncoming({ urgent: true });
        }
        schedulePoll();
      } else {
        schedulePoll();
      }
    };
    const onFocus = () => {
      evaluateCallsLeadership();
      if (Date.now() >= backoffUntilRef.current) {
        void fetchIncoming({ urgent: true });
      }
    };
    const onOnline = () => {
      evaluateCallsLeadership();
      if (Date.now() >= backoffUntilRef.current) {
        void fetchIncoming({ urgent: true });
      }
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.clearInterval(leaderTimer);
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      clearCallsLeaderIfOwned(tabIdRef.current);
    };
  }, [enabled, evaluateCallsLeadership, fetchIncoming, schedulePoll]);

  useEffect(() => {
    for (const c of calls) {
      if (!autoDismissTimersRef.current.has(c.id)) {
        const timer = window.setTimeout(() => {
          autoDismissTimersRef.current.delete(c.id);
          void Promise.resolve(onAutoDismissCall?.(c)).finally(() => removeCallLocal(c.id));
        }, AUTO_DISMISS_MS);
        autoDismissTimersRef.current.set(c.id, timer);
      }
    }
  }, [calls, onAutoDismissCall, removeCallLocal]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    if (calls.length === 0) {
      if (flashIntervalRef.current !== null) {
        window.clearInterval(flashIntervalRef.current);
        flashIntervalRef.current = null;
      }
      if (baseTitleRef.current !== null) {
        document.title = baseTitleRef.current;
        baseTitleRef.current = null;
      }
      return;
    }

    if (baseTitleRef.current === null) {
      baseTitleRef.current = document.title;
    }
    let flash = false;
    if (flashIntervalRef.current !== null) {
      window.clearInterval(flashIntervalRef.current);
    }
    flashIntervalRef.current = window.setInterval(() => {
      flash = !flash;
      const n = calls.length;
      document.title = flash
        ? `(${n}) Incoming session call — ${baseTitleRef.current ?? ""}`
        : `${baseTitleRef.current ?? ""}`;
    }, TAB_FLASH_MS);

    return () => {
      if (flashIntervalRef.current !== null) {
        window.clearInterval(flashIntervalRef.current);
        flashIntervalRef.current = null;
      }
      if (baseTitleRef.current !== null) {
        document.title = baseTitleRef.current;
        baseTitleRef.current = null;
      }
    };
  }, [calls]);

  return {
    calls,
    busyId,
    setBusyId,
    removeCallLocal,
    fetchIncoming,
    AUTO_DISMISS_MS,
  };
}

export function useIncomingCallWakeSubscription(
  userId: number | undefined,
  enabled: boolean,
  onWake: () => void
) {
  useEffect(() => {
    if (!enabled || !userId) {
      return;
    }
    return subscribeIncomingCallWake(userId, () => {
      onWake();
    });
  }, [enabled, onWake, userId]);
}
