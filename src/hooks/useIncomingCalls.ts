import { useCallback, useEffect, useRef, useState } from "react";
import { effectiveWebRtcCallMode } from "@/lib/videoCall";
import {
  startCallRingtone,
  stopCallRingtone,
  warmCallRingtone,
} from "@/lib/sounds/notificationSoundManager";
import { subscribeIncomingCallWake } from "@/lib/incomingCallRealtime";

const POLL_ACTIVE_MS = 400;
const POLL_HIDDEN_MS = 1_500;
const AUTO_DISMISS_MS = 30_000;
const TAB_FLASH_MS = 1_000;

type IncomingCallBase = {
  id: number;
  appointment_id: number;
  call_type: string;
  scheduled_at: string | null;
  created_at?: string | null;
};

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

  const fetchIncoming = useCallback(
    async (options?: { urgent?: boolean }) => {
      if (!enabled) return;
      if (fetchInFlightRef.current && !options?.urgent) {
        return;
      }

      fetchInFlightRef.current = true;
      try {
        const normalized = await fetchCalls();
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
      } catch {
        /* silent poll */
      } finally {
        fetchInFlightRef.current = false;
      }
    },
    [announceNewCall, clearAutoDismiss, enabled, fetchCalls]
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
    const delay = hidden ? POLL_HIDDEN_MS : POLL_ACTIVE_MS;
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
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    warmCallRingtone();
    void fetchIncoming({ urgent: true });
    schedulePoll();

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void fetchIncoming({ urgent: true });
        schedulePoll();
      } else {
        schedulePoll();
      }
    };
    const onFocus = () => void fetchIncoming({ urgent: true });
    const onOnline = () => void fetchIncoming({ urgent: true });

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [enabled, fetchIncoming, schedulePoll]);

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
