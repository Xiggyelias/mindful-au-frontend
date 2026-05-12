import { useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Mic, Video, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isAnonymousSessionFlag } from "@/lib/anonymousMode";
import { effectiveWebRtcCallMode } from "@/lib/videoCall";
import { formatInDisplayZone } from "@/lib/displayTimezone";

export type IncomingCallOverlayCall = {
  id: number;
  appointment_id: number;
  /** For counselor-side banners, the student name. For student-side, the counselor name. */
  callerName: string;
  is_anonymous: boolean;
  call_type: string;
  scheduled_at: string | null;
};

const AUTO_DISMISS_MS = 30_000;
const TICK_MS = 50;

/** Draws a single SVG arc for the countdown ring. */
function CountdownArc({ progress }: { progress: number }) {
  const r = 44;
  const cx = 50;
  const circumference = 2 * Math.PI * r;
  const dash = circumference * Math.max(0, Math.min(1, progress));

  return (
    <svg
      viewBox="0 0 100 100"
      className="absolute inset-0 h-full w-full -rotate-90"
      aria-hidden
    >
      {/* Background track */}
      <circle
        cx={cx}
        cy={cx}
        r={r}
        fill="none"
        strokeWidth="3"
        className="stroke-white/10"
      />
      {/* Progress arc */}
      <circle
        cx={cx}
        cy={cx}
        r={r}
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference}`}
        className="stroke-emerald-400 transition-none"
      />
    </svg>
  );
}

/** Pulsing avatar ring — three concentric rings that pulse outward. */
function PulsingAvatar({
  isAnonymous,
  isVideo,
  callerInitial,
}: {
  isAnonymous: boolean;
  isVideo: boolean;
  callerInitial: string;
}) {
  return (
    <div className="relative flex h-32 w-32 items-center justify-center">
      {/* Outer rings */}
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn(
            "absolute inset-0 rounded-full opacity-0",
            isAnonymous
              ? "bg-violet-500/25"
              : isVideo
              ? "bg-emerald-500/25"
              : "bg-sky-500/25",
            "animate-ping"
          )}
          style={{
            animationDelay: `${(i - 1) * 0.4}s`,
            animationDuration: "1.8s",
          }}
          aria-hidden
        />
      ))}

      {/* Avatar circle */}
      <div
        className={cn(
          "relative flex h-24 w-24 items-center justify-center rounded-full text-3xl font-bold text-white shadow-2xl ring-4",
          isAnonymous
            ? "bg-gradient-to-br from-violet-600 to-violet-800 ring-violet-400/40"
            : isVideo
            ? "bg-gradient-to-br from-emerald-500 to-teal-700 ring-emerald-400/40"
            : "bg-gradient-to-br from-sky-500 to-blue-700 ring-sky-400/40"
        )}
      >
        {isAnonymous ? (
          <ShieldCheck className="h-10 w-10 text-violet-100" aria-hidden />
        ) : (
          <span>{callerInitial}</span>
        )}
      </div>
    </div>
  );
}

export function IncomingCallOverlay({
  call,
  busy,
  onAccept,
  onDecline,
}: {
  call: IncomingCallOverlayCall;
  busy: boolean;
  onAccept: (call: IncomingCallOverlayCall) => void;
  onDecline: (call: IncomingCallOverlayCall) => void;
}) {
  const isAnonymous = isAnonymousSessionFlag(call.is_anonymous);
  const isVideo = effectiveWebRtcCallMode(call) === "video";

  const scheduleLabel =
    call.scheduled_at && !Number.isNaN(new Date(call.scheduled_at).getTime())
      ? formatInDisplayZone(new Date(call.scheduled_at), "EEE, MMM d · h:mm a")
      : null;

  const callerInitial = (call.callerName?.[0] ?? "?").toUpperCase();
  const callerDisplayName = isAnonymous ? "Anonymous User" : call.callerName;

  // Countdown progress 1 → 0 over AUTO_DISMISS_MS
  const startAtRef = useRef(Date.now());
  const [progress, setProgress] = useState(1);

  useEffect(() => {
    startAtRef.current = Date.now();
    setProgress(1);
    const id = window.setInterval(() => {
      const elapsed = Date.now() - startAtRef.current;
      const next = Math.max(0, 1 - elapsed / AUTO_DISMISS_MS);
      setProgress(next);
      if (next === 0) window.clearInterval(id);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [call.id]);

  // Trap focus inside overlay for accessibility
  const overlayRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const firstFocusable = el.querySelector<HTMLElement>("button");
    firstFocusable?.focus();
  }, []);

  const badgeColor = isAnonymous
    ? "bg-violet-500/20 text-violet-200 border-violet-400/30"
    : isVideo
    ? "bg-emerald-500/20 text-emerald-200 border-emerald-400/30"
    : "bg-sky-500/20 text-sky-200 border-sky-400/30";

  return (
    <div
      ref={overlayRef}
      className={cn(
        "fixed inset-0 z-[200] flex flex-col items-center justify-between overflow-hidden",
        "animate-in fade-in slide-in-from-bottom-4 duration-300 motion-reduce:animate-none",
        // Background
        isAnonymous
          ? "bg-gradient-to-b from-[#0e0714] via-[#1a0d2e] to-[#0e0714]"
          : isVideo
          ? "bg-gradient-to-b from-[#041f14] via-[#072e1b] to-[#041f14]"
          : "bg-gradient-to-b from-[#04121f] via-[#071e2e] to-[#04121f]"
      )}
      role="dialog"
      aria-modal="true"
      aria-label={`Incoming ${isVideo ? "video" : "audio"} call from ${callerDisplayName}`}
    >
      {/* Ambient blur orbs */}
      <div
        className={cn(
          "pointer-events-none absolute -top-32 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full opacity-20 blur-3xl",
          isAnonymous ? "bg-violet-600" : isVideo ? "bg-emerald-500" : "bg-sky-500"
        )}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-32 left-1/4 h-64 w-64 rounded-full bg-white/5 blur-3xl opacity-30"
        aria-hidden
      />

      {/* Top label */}
      <div className="flex flex-col items-center gap-1 pt-16 text-center">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/50">
          Incoming session call
        </p>
        {scheduleLabel && (
          <p className="text-[11px] tabular-nums text-white/35">{scheduleLabel}</p>
        )}
      </div>

      {/* Center — avatar + name + badge */}
      <div className="flex flex-col items-center gap-5 text-center">
        {/* Pulsing avatar with countdown ring around it */}
        <div className="relative flex h-32 w-32 items-center justify-center">
          <CountdownArc progress={progress} />
          <PulsingAvatar
            isAnonymous={isAnonymous}
            isVideo={isVideo}
            callerInitial={callerInitial}
          />
        </div>

        {/* Caller name */}
        <div className="flex flex-col items-center gap-2">
          <h2 className="text-2xl font-semibold tracking-tight text-white drop-shadow-md">
            {callerDisplayName}
          </h2>

          {/* Secure Audio / Secure Video badge */}
          <div
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold backdrop-blur-md",
              badgeColor
            )}
          >
            {isVideo ? (
              <Video className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Mic className="h-3.5 w-3.5" aria-hidden />
            )}
            {isAnonymous
              ? "Secure Audio · Private"
              : isVideo
              ? "Secure Video"
              : "Secure Audio"}
          </div>
        </div>
      </div>

      {/* Bottom — accept / decline */}
      <div className="mb-16 flex items-center gap-10">
        {/* Decline */}
        <div className="flex flex-col items-center gap-2">
          <Button
            type="button"
            size="icon"
            disabled={busy}
            onClick={() => onDecline(call)}
            className={cn(
              "h-16 w-16 rounded-full border-0 shadow-[0_0_30px_rgba(239,68,68,0.4)] transition-transform active:scale-95",
              "bg-red-600 hover:bg-red-500 text-white"
            )}
            aria-label="Decline call"
          >
            <PhoneOff className="h-6 w-6" aria-hidden />
          </Button>
          <span className="text-xs font-medium text-white/50">Decline</span>
        </div>

        {/* Accept */}
        <div className="flex flex-col items-center gap-2">
          <Button
            type="button"
            size="icon"
            disabled={busy}
            onClick={() => onAccept(call)}
            className={cn(
              "h-16 w-16 rounded-full border-0 shadow-[0_0_30px_rgba(34,197,94,0.4)] transition-transform active:scale-95",
              "bg-emerald-500 hover:bg-emerald-400 text-white"
            )}
            aria-label="Accept call"
          >
            <Phone className="h-6 w-6" aria-hidden />
          </Button>
          <span className="text-xs font-medium text-white/50">Accept</span>
        </div>
      </div>
    </div>
  );
}
