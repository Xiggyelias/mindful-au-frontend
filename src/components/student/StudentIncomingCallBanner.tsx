import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Phone, PhoneOff, Video, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, getApiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatInDisplayZone } from "@/lib/displayTimezone";
import { AnonymousModeIndicator } from "@/components/privacy/AnonymousModeIndicator";
import { isAnonymousSessionFlag } from "@/lib/anonymousMode";
import { toast } from "sonner";
import { startCallRingtone, stopCallRingtone } from "@/lib/sounds/notificationSoundManager";

const POLL_MS = 4000;
const AUTO_DISMISS_MS = 30_000;
const TAB_FLASH_MS = 1000;

export type StudentIncomingCallItem = {
  id: number;
  appointment_id: number;
  counselor_id: number;
  counselor_name: string;
  is_anonymous: boolean;
  call_type: string;
  status: string;
  scheduled_at: string | null;
  created_at?: string | null;
};

type DismissReason = "declined" | "timeout";

export function StudentIncomingCallBanner({
  enabled,
  onActiveChange,
}: {
  enabled: boolean;
  onActiveChange?: (active: boolean) => void;
}) {
  const navigate = useNavigate();
  const [calls, setCalls] = useState<StudentIncomingCallItem[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const seenIdsRef = useRef<Set<number>>(new Set());
  const baseTitleRef = useRef<string | null>(null);
  const flashIntervalRef = useRef<number | null>(null);
  const autoDismissTimersRef = useRef<Map<number, number>>(new Map());

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
    const wantsVideo = calls.some((c) => c.call_type !== "audio");
    startCallRingtone(wantsVideo ? "video" : "audio");
  }, [enabled, calls]);

  useEffect(() => {
    return () => {
      stopCallRingtone();
    };
  }, []);

  const fetchIncoming = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await api.getStudentIncomingCalls();
      const rows = Array.isArray(res?.data) ? (res.data as StudentIncomingCallItem[]) : [];
      const normalized = rows.filter((r) => r && typeof r.id === "number");
      setCalls(normalized);

      for (const c of normalized) {
        if (!seenIdsRef.current.has(c.id)) {
          seenIdsRef.current.add(c.id);
          try {
            if (typeof navigator !== "undefined" && navigator.vibrate) {
              navigator.vibrate([300, 100, 300]);
            }
          } catch {
            /* ignore */
          }
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
    }
  }, [enabled, clearAutoDismiss]);

  useEffect(() => {
    if (!enabled) {
      setCalls([]);
      seenIdsRef.current.clear();
      autoDismissTimersRef.current.forEach((t) => window.clearTimeout(t));
      autoDismissTimersRef.current.clear();
      return;
    }
    void fetchIncoming();
    const id = window.setInterval(() => {
      void fetchIncoming();
    }, POLL_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [enabled, fetchIncoming]);

  useEffect(() => {
    for (const c of calls) {
      if (!autoDismissTimersRef.current.has(c.id)) {
        const timer = window.setTimeout(() => {
          autoDismissTimersRef.current.delete(c.id);
          void (async () => {
            try {
              await api.updateStudentIncomingCall(c.id, "declined");
            } catch {
              /* ignore */
            }
            removeCallLocal(c.id);
          })();
        }, AUTO_DISMISS_MS);
        autoDismissTimersRef.current.set(c.id, timer);
      }
    }
  }, [calls, removeCallLocal]);

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

  const handleAccept = async (call: StudentIncomingCallItem) => {
    setBusyId(call.id);
    try {
      await api.updateStudentIncomingCall(call.id, "accepted");
      removeCallLocal(call.id);
      const params = new URLSearchParams({
        appointment_id: String(call.appointment_id),
        autostart: "1",
        mode: call.call_type === "audio" ? "audio" : "video",
      });
      if (call.counselor_id) {
        params.set("counselor_id", String(call.counselor_id));
      }
      navigate(`/student/video-call?${params.toString()}`);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Could not accept call"));
    } finally {
      setBusyId(null);
    }
  };

  const handleDecline = async (call: StudentIncomingCallItem, _reason: DismissReason) => {
    setBusyId(call.id);
    try {
      await api.updateStudentIncomingCall(call.id, "declined");
      removeCallLocal(call.id);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Could not decline call"));
      removeCallLocal(call.id);
    } finally {
      setBusyId(null);
    }
  };

  if (!enabled || calls.length === 0) {
    return null;
  }

  const visible = calls.slice(0, 4);
  const overflow = Math.max(0, calls.length - visible.length);

  return (
    <div
      className={cn(
        "fixed inset-x-0 top-0 z-[110] flex flex-col gap-2 border-b border-primary/25 bg-gradient-to-b from-primary via-primary/95 to-primary/90 p-3 shadow-[0_12px_40px_-8px_rgba(0,0,0,0.45)]",
        "animate-in slide-in-from-top-2 fade-in duration-300 motion-reduce:animate-none"
      )}
      role="region"
      aria-label="Incoming session calls"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
        {visible.map((call) => {
          const scheduleLabel =
            call.scheduled_at && !Number.isNaN(new Date(call.scheduled_at).getTime())
              ? formatInDisplayZone(new Date(call.scheduled_at), "EEE, MMM d · h:mm a")
              : null;
          const isVideo = call.call_type !== "audio";
          const callAnonymous = isAnonymousSessionFlag(call.is_anonymous);
          return (
            <div
              key={call.id}
              className={cn(
                "flex flex-col gap-3 rounded-2xl border px-4 py-3 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between",
                callAnonymous
                  ? "border-red-600/90 bg-black text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
                  : "border-white/15 bg-black/20 text-primary-foreground"
              )}
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <div
                  className={cn(
                    "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ring-2 animate-pulse",
                    callAnonymous ? "bg-red-600/30 ring-red-500/50" : "bg-white/15 ring-white/25"
                  )}
                >
                  {isVideo ? <Video className="h-6 w-6" aria-hidden /> : <Mic className="h-6 w-6" aria-hidden />}
                </div>
                <div className="min-w-0">
                  <p
                    className={cn(
                      "text-[11px] font-bold uppercase tracking-widest",
                      callAnonymous ? "text-red-400" : "text-primary-foreground/80"
                    )}
                  >
                    Incoming session call
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <p className="truncate text-lg font-semibold leading-tight">{call.counselor_name}</p>
                    {callAnonymous && <AnonymousModeIndicator variant="badge" audience="student" />}
                  </div>
                  <div
                    className={cn(
                      "mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs",
                      callAnonymous ? "text-white/85" : "text-primary-foreground/85"
                    )}
                  >
                    <span>{isVideo ? "Video call" : "Audio call"}</span>
                    {scheduleLabel && <span className="tabular-nums">{scheduleLabel}</span>}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                <Button
                  type="button"
                  size="sm"
                  className="gap-1.5 rounded-full bg-emerald-500 font-semibold text-white hover:bg-emerald-600"
                  disabled={busyId === call.id}
                  onClick={() => void handleAccept(call)}
                >
                  <Phone className="h-4 w-4" aria-hidden />
                  Accept
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="gap-1.5 rounded-full font-semibold"
                  disabled={busyId === call.id}
                  onClick={() => void handleDecline(call, "declined")}
                >
                  <PhoneOff className="h-4 w-4" aria-hidden />
                  Decline
                </Button>
              </div>
            </div>
          );
        })}
        {overflow > 0 && (
          <p className="text-center text-xs font-medium text-primary-foreground/90">
            +{overflow} more incoming — open Video Call to manage
          </p>
        )}
      </div>
    </div>
  );
}
