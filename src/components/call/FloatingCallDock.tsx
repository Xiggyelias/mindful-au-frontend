import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Mic, MicOff, Phone, Maximize2, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useActiveCallDock } from "@/hooks/useWebRTC";
import { formatCallDuration } from "@/lib/videoCall";
import { deriveCallStatus } from "@/lib/callState";

const STUDENT_CALL_PATH = "/student/video-call";
const COUNSELOR_CALL_PATH = "/counselor/video";

/**
 * Globally-mounted mini call panel (WhatsApp-Web style).
 *
 * The WebRTC engine is a singleton, so a live call keeps running while the user
 * navigates between pages. This dock re-attaches the call UI on every route EXCEPT
 * the dedicated call page (where the full experience already renders), letting the
 * user keep talking while they browse and tap to jump back into the full call.
 */
export function FloatingCallDock() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, role } = useAuth();

  const {
    localStream,
    remoteStream,
    remoteHasVideo,
    isConnected,
    isConnecting,
    isAudioOnly,
    isDisconnected,
    isMuted,
    isIncomingCall,
    sessionId,
    remoteVideoRef,
    endCall,
    toggleMute,
  } = useActiveCallDock();

  const callPath = role === "student" ? STUDENT_CALL_PATH : COUNSELOR_CALL_PATH;
  const onCallPage =
    location.pathname === STUDENT_CALL_PATH || location.pathname === COUNSELOR_CALL_PATH;

  // Single shared classification (idle/ringing/calling/connected/reconnecting) — see
  // src/lib/callState.ts.
  const callStatus = deriveCallStatus({
    isIncomingCall,
    isConnecting,
    isConnected,
    isDisconnected,
    localStream,
  });

  // A call is "in progress" once we have media or are negotiating — but an
  // unanswered *incoming* call is handled by the full-screen IncomingCallOverlay,
  // so the dock stays out of the way until that call is actually accepted.
  const hasActiveCall = callStatus !== "idle" && callStatus !== "ringing";

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const connectedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isConnected) {
      connectedAtRef.current = null;
      setElapsedSeconds(0);
      return;
    }
    if (connectedAtRef.current === null) {
      connectedAtRef.current = Date.now();
    }
    const tick = () => {
      if (connectedAtRef.current !== null) {
        setElapsedSeconds(Math.floor((Date.now() - connectedAtRef.current) / 1000));
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [isConnected]);

  const statusLabel = useMemo(() => {
    switch (callStatus) {
      case "reconnecting":
        return "Reconnecting…";
      case "connected":
        return formatCallDuration(elapsedSeconds);
      case "calling":
        return "Calling…";
      default:
        return "";
    }
  }, [callStatus, elapsedSeconds]);

  const showRemoteVideo = Boolean(remoteStream && remoteHasVideo && !isAudioOnly);
  const peerInitial = (user?.profile?.full_name?.[0] ?? "•").toUpperCase();

  const goToCall = () => {
    const params = sessionId ? `?appointment_id=${encodeURIComponent(sessionId)}` : "";
    navigate(`${callPath}${params}`);
  };

  if (onCallPage || !hasActiveCall) {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed bottom-4 right-4 z-[120] w-[240px] overflow-hidden rounded-2xl border border-white/10",
        "bg-[#0b141a]/95 text-white shadow-[0_24px_70px_-24px_rgba(0,0,0,0.9)] backdrop-blur-xl",
        "animate-in fade-in slide-in-from-bottom-3 duration-300 motion-reduce:animate-none"
      )}
      role="dialog"
      aria-label="Ongoing call"
    >
      {/* Media / avatar — tap to return to the full call screen */}
      <button
        type="button"
        onClick={goToCall}
        className="group relative block h-32 w-full overflow-hidden bg-black text-left"
        aria-label="Return to call"
      >
        {/* The remote <video> is ALWAYS mounted — it carries the remote audio track,
            so it must stay in the DOM even for audio-only calls or the user stops
            hearing the other person after navigating off the call page. */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className={cn(
            "absolute inset-0 h-full w-full object-cover",
            showRemoteVideo ? "opacity-100" : "opacity-0"
          )}
        />
        {!showRemoteVideo && (
          <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(16,185,129,0.25),transparent_45%),linear-gradient(180deg,#0b141a,#111b21)]">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-white/10 text-2xl font-semibold">
              {peerInitial}
            </div>
          </div>
        )}

        <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-white/90">
            {isAudioOnly || !showRemoteVideo ? (
              <Mic className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Video className="h-3.5 w-3.5" aria-hidden />
            )}
            <span className={cn("tabular-nums", isConnecting && "animate-pulse")}>{statusLabel}</span>
          </span>
          <span className="rounded-full bg-black/40 p-1 text-white/80 opacity-0 transition-opacity group-hover:opacity-100">
            <Maximize2 className="h-3.5 w-3.5" aria-hidden />
          </span>
        </div>
      </button>

      {/* Controls */}
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-9 flex-1 rounded-full bg-white/10 text-xs font-medium text-white hover:bg-white/20"
          onClick={goToCall}
        >
          Return
        </Button>

        <Button
          type="button"
          size="icon"
          variant="ghost"
          className={cn(
            "h-9 w-9 rounded-full text-white",
            isMuted ? "bg-destructive hover:bg-destructive/90" : "bg-white/10 hover:bg-white/20"
          )}
          onClick={toggleMute}
          disabled={!localStream}
          aria-label={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </Button>

        <Button
          type="button"
          size="icon"
          className="h-9 w-9 rounded-full bg-red-600 text-white shadow-[0_0_20px_rgba(239,68,68,0.4)] hover:bg-red-500"
          onClick={endCall}
          aria-label="End call"
        >
          <Phone className="h-4 w-4 rotate-[135deg]" />
        </Button>
      </div>
    </div>
  );
}
