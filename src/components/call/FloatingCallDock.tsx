import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Mic,
  MicOff,
  Phone,
  Maximize2,
  Video,
  ArrowLeftRight,
  GripHorizontal,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useActiveCallDock } from "@/hooks/useWebRTC";
import { formatCallDuration } from "@/lib/videoCall";
import { deriveCallStatus } from "@/lib/callState";

const STUDENT_CALL_PATH = "/student/video-call";
const COUNSELOR_CALL_PATH = "/counselor/video";
const STORAGE_KEY = "mindful:floating-dock-pos";
const DOCK_WIDTH = 240;
const DOCK_HEIGHT = 188;

interface DockPosition {
  x: number;
  y: number;
}

const getClampedPosition = (
  x: number,
  y: number,
  width = DOCK_WIDTH,
  height = DOCK_HEIGHT
): DockPosition => {
  if (typeof window === "undefined") return { x, y };
  const padding = 12;
  const maxX = Math.max(padding, window.innerWidth - width - padding);
  const maxY = Math.max(padding, window.innerHeight - height - padding);
  return {
    x: Math.min(Math.max(padding, x), maxX),
    y: Math.min(Math.max(padding, y), maxY),
  };
};

const getDefaultPosition = (): DockPosition => {
  if (typeof window === "undefined") return { x: 20, y: 20 };
  return getClampedPosition(
    window.innerWidth - DOCK_WIDTH - 16,
    window.innerHeight - DOCK_HEIGHT - 16
  );
};

const readSavedPosition = (): DockPosition | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) {
        return getClampedPosition(Number(parsed.x), Number(parsed.y));
      }
    }
  } catch {
    /* fallback to default */
  }
  return null;
};

const savePosition = (pos: DockPosition) => {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
  } catch {
    /* best effort */
  }
};

/**
 * Globally-mounted movable mini call panel (WhatsApp-Web style).
 *
 * The call engine is a singleton, so a live call keeps running while the user
 * navigates between pages. This dock re-attaches the call UI on every route EXCEPT
 * the dedicated call page (where the full experience already renders).
 *
 * Users can freely drag the dock anywhere on screen, switch sides with one tap, or
 * collapse it so it never gets stuck or blocks content when switching pages.
 */
export function FloatingCallDock() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, role } = useAuth();
  const activeDock = useActiveCallDock();

  const {
    localStream,
    remoteStream,
    remoteHasVideo,
    isLocalVideoEnabled,
    isConnected,
    isConnecting,
    isAudioOnly,
    isDisconnected,
    isMuted,
    isIncomingCall,
    sessionId,
    localVideoRef,
    remoteVideoRef,
    remotePeerName,
    endCall,
    toggleMute,
  } = activeDock;

  const callPath = role === "student" ? STUDENT_CALL_PATH : COUNSELOR_CALL_PATH;
  const onCallPage =
    location.pathname === STUDENT_CALL_PATH || location.pathname === COUNSELOR_CALL_PATH;

  const callStatus = deriveCallStatus({
    isIncomingCall,
    isConnecting,
    isConnected,
    isDisconnected,
    localStream,
  });

  const hasActiveCall = callStatus !== "idle" && callStatus !== "ringing";

  const [position, setPosition] = useState<DockPosition>(
    () => readSavedPosition() ?? getDefaultPosition()
  );
  const [isDragging, setIsDragging] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const hasDraggedRef = useRef(false);
  const suppressClickRef = useRef(false);
  const dragOriginRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

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

  // Keep dock inside viewport when window is resized
  useEffect(() => {
    const onResize = () => {
      setPosition((prev) => {
        const currentHeight = isMinimized ? 56 : DOCK_HEIGHT;
        const clamped = getClampedPosition(prev.x, prev.y, DOCK_WIDTH, currentHeight);
        savePosition(clamped);
        return clamped;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isMinimized]);

  const onPointerDown = (e: React.PointerEvent) => {
    // Let button clicks proceed without triggering drag
    if ((e.target as HTMLElement).closest("button") && !(e.target as HTMLElement).closest("[data-drag-handle]")) {
      return;
    }
    dragOriginRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: position.x,
      originY: position.y,
    };
    hasDraggedRef.current = false;
    setIsDragging(true);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragOriginRef.current) return;
    const dx = e.clientX - dragOriginRef.current.startX;
    const dy = e.clientY - dragOriginRef.current.startY;
    if (Math.hypot(dx, dy) > 4) {
      hasDraggedRef.current = true;
    }
    const currentHeight = isMinimized ? 56 : DOCK_HEIGHT;
    const next = getClampedPosition(
      dragOriginRef.current.originX + dx,
      dragOriginRef.current.originY + dy,
      DOCK_WIDTH,
      currentHeight
    );
    setPosition(next);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragOriginRef.current) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    dragOriginRef.current = null;
    setIsDragging(false);
    savePosition(position);

    if (hasDraggedRef.current) {
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 150);
    }
  };

  const handleSwitchSide = (e: React.MouseEvent) => {
    e.stopPropagation();
    const isRightHalf = position.x > window.innerWidth / 2 - DOCK_WIDTH / 2;
    const targetX = isRightHalf ? 16 : window.innerWidth - DOCK_WIDTH - 16;
    const currentHeight = isMinimized ? 56 : DOCK_HEIGHT;
    const next = getClampedPosition(targetX, position.y, DOCK_WIDTH, currentHeight);
    setPosition(next);
    savePosition(next);
  };

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
  const showLocalVideo = Boolean(localStream && isLocalVideoEnabled && !isAudioOnly);
  const displayPeerName = remotePeerName || (role === "student" ? "Counselor" : "Student");
  const peerInitial = (displayPeerName?.[0] ?? "•").toUpperCase();

  const goToCall = () => {
    if (suppressClickRef.current || hasDraggedRef.current) return;
    const params = sessionId ? `?appointment_id=${encodeURIComponent(sessionId)}` : "";
    navigate(`${callPath}${params}`);
  };

  if (onCallPage || !hasActiveCall) {
    return null;
  }

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
      className={cn(
        "fixed z-[120] w-[240px] select-none overflow-hidden rounded-2xl border border-white/10",
        "bg-[#0b141a]/95 text-white shadow-[0_24px_70px_-24px_rgba(0,0,0,0.9)] backdrop-blur-xl",
        "touch-none cursor-grab active:cursor-grabbing",
        !isDragging && "transition-[left,top] duration-200 ease-out"
      )}
      role="dialog"
      aria-label="Ongoing call dock (draggable)"
    >
      {/* Drag & Quick Actions Bar */}
      <div
        data-drag-handle
        className="flex items-center justify-between border-b border-white/10 bg-black/50 px-2 py-1 text-white/70"
      >
        <div className="flex items-center gap-1">
          <GripHorizontal className="h-3.5 w-3.5 text-white/50" aria-hidden />
          <span className="text-[10px] font-medium tracking-wide text-white/60">CALL DOCK</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleSwitchSide}
            className="rounded p-1 text-white/60 hover:bg-white/10 hover:text-white"
            title="Switch side"
            aria-label="Switch side"
          >
            <ArrowLeftRight className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsMinimized(!isMinimized);
            }}
            className="rounded p-1 text-white/60 hover:bg-white/10 hover:text-white"
            title={isMinimized ? "Expand video" : "Minimize dock"}
            aria-label={isMinimized ? "Expand video" : "Minimize dock"}
          >
            {isMinimized ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {/* Expanded: Video/Avatar Area */}
      {!isMinimized && (
        <button
          type="button"
          onClick={goToCall}
          className="group relative block h-32 w-full overflow-hidden bg-black text-left cursor-pointer"
          aria-label="Return to call"
        >
          {showRemoteVideo ? (
            <>
              {/* Remote video element */}
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="absolute inset-0 h-full w-full object-cover pointer-events-none"
              />
              {/* Local video PiP in corner */}
              {showLocalVideo && (
                <div className="absolute bottom-2 right-2 h-10 w-14 overflow-hidden rounded-md border border-white/25 bg-black/60 shadow-md">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="h-full w-full object-cover"
                    style={{ transform: "scaleX(-1)" }}
                  />
                </div>
              )}
            </>
          ) : showLocalVideo ? (
            <>
              {/* Local video full when remote hasn't arrived yet */}
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 h-full w-full object-cover pointer-events-none"
                style={{ transform: "scaleX(-1)" }}
              />
              <div className="absolute bottom-2 inset-x-2 rounded bg-black/65 px-2 py-0.5 text-center text-[10px] text-white/90 backdrop-blur-sm">
                {isConnected ? "Waiting for peer video…" : "Connecting…"}
              </div>
            </>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-[radial-gradient(circle_at_30%_20%,rgba(16,185,129,0.25),transparent_45%),linear-gradient(180deg,#0b141a,#111b21)]">
              <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-white/10 text-xl font-semibold">
                {peerInitial}
              </div>
              <span className="text-[11px] font-medium text-white/70">
                {displayPeerName}
              </span>
            </div>
          )}

          <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent px-3 py-2 z-10">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-white/90">
              {isAudioOnly ? (
                <Mic className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
              ) : (
                <Video className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
              )}
              <span className={cn("tabular-nums", isConnecting && "animate-pulse")}>
                {statusLabel}
              </span>
            </span>
            <span className="rounded-full bg-black/40 p-1 text-white/80 opacity-0 transition-opacity group-hover:opacity-100">
              <Maximize2 className="h-3.5 w-3.5" aria-hidden />
            </span>
          </div>
        </button>
      )}

      {/* Minimized Header / Status Bar */}
      {isMinimized && (
        <div
          onClick={goToCall}
          className="flex items-center justify-between gap-2 px-3 py-1.5 cursor-pointer bg-white/5 hover:bg-white/10 transition-colors"
        >
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-semibold">
              {peerInitial}
            </div>
            <span className="text-[11px] font-medium tabular-nums text-white/90">
              {displayPeerName} · {statusLabel}
            </span>
          </div>
          <span className="text-[11px] text-white/60 hover:text-white flex items-center gap-1">
            <Maximize2 className="h-3 w-3" />
            Return
          </span>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 flex-1 rounded-full bg-white/10 text-xs font-medium text-white hover:bg-white/20"
          onClick={goToCall}
        >
          Return
        </Button>

        <Button
          type="button"
          size="icon"
          variant="ghost"
          className={cn(
            "h-8 w-8 rounded-full text-white",
            isMuted ? "bg-destructive hover:bg-destructive/90" : "bg-white/10 hover:bg-white/20"
          )}
          onClick={toggleMute}
          disabled={!localStream}
          aria-label={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
        </Button>

        <Button
          type="button"
          size="icon"
          className="h-8 w-8 rounded-full bg-red-600 text-white shadow-[0_0_20px_rgba(239,68,68,0.4)] hover:bg-red-500"
          onClick={endCall}
          aria-label="End call"
        >
          <Phone className="h-3.5 w-3.5 rotate-[135deg]" />
        </Button>
      </div>
    </div>
  );
}
