import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Phone, PhoneOff, Video, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, getApiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatInDisplayZone } from "@/lib/displayTimezone";
import { AnonymousModeIndicator } from "@/components/privacy/AnonymousModeIndicator";
import { isAnonymousSessionFlag } from "@/lib/anonymousMode";
import { effectiveWebRtcCallMode } from "@/lib/videoCall";
import { toast } from "sonner";
import { IncomingCallOverlay } from "@/components/call/IncomingCallOverlay";
import type { IncomingCallOverlayCall } from "@/components/call/IncomingCallOverlay";
import { useAuth } from "@/hooks/useAuth";
import { useIncomingCalls, useIncomingCallWakeSubscription } from "@/hooks/useIncomingCalls";

export type IncomingCallItem = {
  id: number;
  appointment_id: number;
  student_id: number;
  student_name: string;
  is_anonymous: boolean;
  call_type: string;
  status: string;
  scheduled_at: string | null;
  created_at?: string | null;
};

type DismissReason = "declined" | "timeout";

export function CounselorIncomingCallBanner({
  enabled,
  onActiveChange,
}: {
  enabled: boolean;
  onActiveChange?: (active: boolean) => void;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();

  const fetchCalls = useCallback(async () => {
    const res = await api.getCounselorIncomingCalls();
    const rows = Array.isArray(res?.data) ? (res.data as IncomingCallItem[]) : [];
    return rows.filter((r) => r && typeof r.id === "number");
  }, []);

  const { calls, busyId, setBusyId, removeCallLocal, fetchIncoming } = useIncomingCalls({
    enabled,
    fetchCalls,
    onActiveChange,
    buildNotification: (call) => ({
      title: effectiveWebRtcCallMode(call) === "video" ? "Incoming video call" : "Incoming audio call",
      body: `${call.student_name} is calling you`,
    }),
    onAutoDismissCall: async (call) => {
      try {
        await api.updateCounselorIncomingCall(call.id, "declined");
      } catch {
        /* ignore */
      }
    },
  });

  useIncomingCallWakeSubscription(user?.id, enabled, () => {
    void fetchIncoming({ urgent: true });
  });

  const handleAccept = async (call: IncomingCallItem) => {
    setBusyId(call.id);
    try {
      await api.updateCounselorIncomingCall(call.id, "accepted");
      removeCallLocal(call.id);
      const params = new URLSearchParams({
        appointment_id: String(call.appointment_id),
        autostart: "1",
        mode: effectiveWebRtcCallMode(call),
      });
      navigate(`/counselor/video?${params.toString()}`);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Could not accept call"));
    } finally {
      setBusyId(null);
    }
  };

  const handleDecline = async (call: IncomingCallItem, _reason: DismissReason) => {
    setBusyId(call.id);
    try {
      await api.updateCounselorIncomingCall(call.id, "declined");
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

  if (calls.length === 1) {
    const call = calls[0];
    const overlayCall: IncomingCallOverlayCall = {
      id: call.id,
      appointment_id: call.appointment_id,
      callerName: call.student_name,
      is_anonymous: call.is_anonymous,
      call_type: call.call_type,
      scheduled_at: call.scheduled_at,
    };
    return (
      <IncomingCallOverlay
        call={overlayCall}
        busy={busyId === call.id}
        onAccept={() => void handleAccept(call)}
        onDecline={() => void handleDecline(call, "declined")}
      />
    );
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
          const isVideo = effectiveWebRtcCallMode(call) === "video";
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
                    <p className="truncate text-lg font-semibold leading-tight">{call.student_name}</p>
                    {callAnonymous && <AnonymousModeIndicator variant="badge" audience="counselor" />}
                  </div>
                  <div
                    className={cn(
                      "mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs",
                      callAnonymous ? "text-white/85" : "text-primary-foreground/85"
                    )}
                  >
                    <span>{isVideo ? "Secure Video" : "Secure Audio"}</span>
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
            +{overflow} more incoming — open Video Sessions to manage
          </p>
        )}
      </div>
    </div>
  );
}
