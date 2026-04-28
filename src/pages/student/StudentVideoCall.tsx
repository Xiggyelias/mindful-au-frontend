import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Bot,
  Calendar,
  Clock,
  Heart,
  History,
  LayoutDashboard,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  Phone,
  PhoneIncoming,
  Video,
  VideoOff,
  WifiOff,
} from "lucide-react";
import { format } from "date-fns";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useWebRTC } from "@/hooks/useWebRTC";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  formatCallDuration,
  getVideoCallWindowStatus,
  isVideoEnabledAppointment,
  normalizeVideoCallDuration,
} from "@/lib/videoCall";
import { toast } from "sonner";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/student/dashboard" },
  { label: "Chat", icon: MessageSquare, path: "/student/chat" },
  { label: "Appointments", icon: Calendar, path: "/student/appointments" },
  { label: "AI Support", icon: Bot, path: "/student/ai-support" },
  { label: "Video Call", icon: Video, path: "/student/video-call" },
  { label: "Past Sessions", icon: History, path: "/student/history" },
  { label: "Wellness", icon: Heart, path: "/student/wellness" },
];

type CallMode = "video" | "audio";

const getParticipantName = (participant: any, fallback: string) =>
  participant?.profile?.full_name ||
  participant?.full_name ||
  participant?.email?.split("@")[0] ||
  fallback;

const getInitials = (value: string) =>
  value
    .split(" ")
    .map((item) => item[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

const formatScheduleLabel = (scheduledAt?: string | null) =>
  scheduledAt ? format(new Date(scheduledAt), "MMM d, yyyy h:mm a") : "TBD";

const StudentVideoCall = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const autoStartedRef = useRef(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [upcomingAppointments, setUpcomingAppointments] = useState<any[]>([]);
  const [activeAppointmentId, setActiveAppointmentId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [authorizedDurationMinutes, setAuthorizedDurationMinutes] = useState<number | null>(null);
  const [isStartingMode, setIsStartingMode] = useState<CallMode | null>(null);
  const [isUpdatingAnonymousMode, setIsUpdatingAnonymousMode] = useState(false);
  const [isOnline, setIsOnline] = useState(
    () => (typeof navigator === "undefined" ? true : navigator.onLine)
  );
  const { user, refreshUser } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || "Student";
  const isAnonymousMode = Boolean(user?.profile?.anonymous_mode);

  const requestedAppointmentId = useMemo(() => {
    const parsed = Number(searchParams.get("appointment_id"));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [searchParams]);

  const requestedCounselorId = useMemo(() => {
    const parsed = Number(searchParams.get("counselor_id"));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [searchParams]);

  const requestedMode: CallMode =
    searchParams.get("mode") === "audio" ? "audio" : "video";
  const shouldAutostart = searchParams.get("autostart") === "1";
  const sessionId = activeAppointmentId || "";

  const {
    localStream,
    remoteStream,
    remoteHasVideo,
    isConnected,
    isConnecting,
    isSignalingReady,
    isAudioOnly,
    isLocalVideoEnabled,
    error,
    isRelayError,
    notice,
    isIncomingCall,
    incomingAudioOnly,
    localSpeaking,
    remoteSpeaking,
    callQuality,
    localVideoRef,
    remoteVideoRef,
    startCall,
    startAudioCall,
    endCall,
    toggleMute,
    toggleVideo,
    acceptIncomingCall,
    rejectIncomingCall,
  } = useWebRTC(sessionId, user?.id?.toString() || "");

  useEffect(() => {
    const syncNetworkStatus = () => {
      setIsOnline(navigator.onLine);
    };

    window.addEventListener("online", syncNetworkStatus);
    window.addEventListener("offline", syncNetworkStatus);

    return () => {
      window.removeEventListener("online", syncNetworkStatus);
      window.removeEventListener("offline", syncNetworkStatus);
    };
  }, []);

  useEffect(() => {
    const loadAppointments = async () => {
      try {
        setIsLoading(true);
        const appointments = await api.getAppointments();
        const availableNow = appointments
          .filter((appointment: any) => {
            if (!appointment.scheduled_at) return false;
            if (!isVideoEnabledAppointment(appointment.notes)) return false;
            if (!(appointment.status === "scheduled" || appointment.status === "confirmed")) {
              return false;
            }

            const callWindow = getVideoCallWindowStatus(
              appointment.scheduled_at,
              appointment.duration_minutes
            );

            return !callWindow.isExpired;
          })
          .sort(
            (left: any, right: any) =>
              new Date(left.scheduled_at).getTime() - new Date(right.scheduled_at).getTime()
          )
          .slice(0, 5);

        setUpcomingAppointments(availableNow);
        if (availableNow.length === 0) {
          setActiveAppointmentId(null);
          return;
        }

        const matchingRequestedAppointment =
          requestedAppointmentId !== null
            ? availableNow.find((appointment: any) => Number(appointment.id) === requestedAppointmentId)
            : null;
        const matchingRequestedCounselor =
          requestedCounselorId !== null
            ? availableNow.find((appointment: any) => Number(appointment.counselor_id) === requestedCounselorId)
            : null;

        setActiveAppointmentId((previous) => {
          if (previous && availableNow.some((appointment: any) => String(appointment.id) === previous)) {
            return previous;
          }
          if (matchingRequestedAppointment) {
            return String(matchingRequestedAppointment.id);
          }
          if (matchingRequestedCounselor) {
            return String(matchingRequestedCounselor.id);
          }
          return String(availableNow[0].id);
        });
      } catch (loadError) {
        console.error("Failed to load appointments:", loadError);
        toast.error("Failed to load upcoming appointments");
      } finally {
        setIsLoading(false);
      }
    };

    if (user) {
      void loadAppointments();
    }
  }, [requestedAppointmentId, requestedCounselorId, user]);

  const activeAppointment = useMemo(
    () => upcomingAppointments.find((appointment) => String(appointment.id) === activeAppointmentId),
    [activeAppointmentId, upcomingAppointments]
  );

  useEffect(() => {
    if (upcomingAppointments.length === 0) {
      if (activeAppointmentId !== null) {
        setActiveAppointmentId(null);
      }
      return;
    }

    if (
      !activeAppointmentId ||
      !upcomingAppointments.some((appointment) => String(appointment.id) === activeAppointmentId)
    ) {
      setActiveAppointmentId(String(upcomingAppointments[0].id));
    }
  }, [activeAppointmentId, upcomingAppointments]);

  const activeWindowStatus = useMemo(() => {
    if (!activeAppointment) {
      return null;
    }

    return getVideoCallWindowStatus(
      activeAppointment.scheduled_at,
      activeAppointment.duration_minutes
    );
  }, [activeAppointment]);

  const remoteParticipantName = useMemo(() => {
    if (activeAppointment?.is_anonymous) {
      return "Counselor (Private Session)";
    }
    return getParticipantName(activeAppointment?.counselor, "Counselor");
  }, [activeAppointment]);
  const isVideoOff = Boolean(localStream && !isAudioOnly && !isLocalVideoEnabled);
  const showRemoteVideo = Boolean(remoteStream && remoteHasVideo);

  const statusMessage = useMemo(() => {
    if (!activeAppointment) {
      return "Select an upcoming online session to prepare your call.";
    }
    if (!isOnline) {
      return "You are offline. Reconnect to continue the call.";
    }
    if (isIncomingCall) {
      return `Incoming ${incomingAudioOnly ? "audio" : "video"} call. Accept or reject to continue.`;
    }
    if (notice) {
      return notice;
    }
    if (error) {
      return error;
    }
    if (isStartingMode) {
      return isStartingMode === "audio"
        ? "Preparing an audio-only connection..."
        : "Preparing camera, microphone, and secure call channel...";
    }
    if (isConnecting) {
      return localStream
        ? "Waiting for your counselor to answer..."
        : "Connecting to the call...";
    }
    if (isConnected) {
      return remoteStream
        ? !remoteHasVideo
          ? `${remoteParticipantName} joined without video. Audio is still live.`
          : isAudioOnly
          ? "Connected. Video is unavailable, but audio is live."
          : "Connected. You and your counselor are live."
        : "Connected. Waiting for the counselor video feed to appear.";
    }
    if (localStream) {
      return "Your preview is ready. Waiting for your counselor to join.";
    }
    if (activeWindowStatus?.canStart) {
      return "Your call window is open. Start when you are ready.";
    }
    return activeWindowStatus?.message || "This session is not available yet.";
  }, [
    activeAppointment,
    activeWindowStatus?.canStart,
    activeWindowStatus?.message,
    isConnected,
    isConnecting,
    isIncomingCall,
    incomingAudioOnly,
    error,
    isOnline,
    isStartingMode,
    isAudioOnly,
    remoteHasVideo,
    localStream,
    notice,
    remoteParticipantName,
    remoteStream,
  ]);

  const remoteVideoStatusMessage =
    remoteStream && !remoteHasVideo
      ? `${remoteParticipantName} is connected in audio mode or has camera sharing turned off. Audio is still live.`
      : statusMessage;
  const callStateLabel = isConnected
    ? "Live"
    : isStartingMode
    ? "Starting"
    : isConnecting
    ? "Calling"
    : activeWindowStatus?.canStart
    ? "Ready"
    : "Scheduled";
  const connectionPillLabel = isConnected
    ? "Encrypted call active"
    : notice
    ? "Reconnecting"
    : isConnecting || isStartingMode
    ? "Connecting securely"
    : isSignalingReady
    ? "Room ready"
    : "Preparing room";
  const connectionPillClassName = cn(
    "rounded-full border px-3 py-1.5 text-[11px] font-medium backdrop-blur-md",
    isConnected
      ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-50"
      : notice || isConnecting || isStartingMode
      ? "border-amber-300/20 bg-amber-500/12 text-amber-50"
      : "border-white/10 bg-white/10 text-white/80"
  );
  const localPreviewLabel = localStream
    ? isAudioOnly
      ? "Audio only"
      : isVideoOff
      ? "Camera off"
      : "Preview live"
    : isStartingMode
    ? "Opening camera"
    : "Preview appears here";
  const emptyStageMessage = activeAppointment
    ? remoteVideoStatusMessage
    : "Choose an upcoming online session to open a proper call room.";

  const handleToggleMute = () => {
    toggleMute();
    setIsMuted((previous) => !previous);
  };

  const handleToggleVideo = () => {
    void toggleVideo();
  };

  const handleToggleAnonymousMode = async () => {
    if (isUpdatingAnonymousMode) {
      return;
    }
    const nextMode = !isAnonymousMode;
    setIsUpdatingAnonymousMode(true);
    try {
      await api.updateProfile({ anonymous_mode: nextMode });
      await refreshUser();
      toast.success(nextMode ? "Anonymous mode enabled." : "Identified mode enabled.");
    } catch {
      toast.error("Could not update anonymous mode.");
    } finally {
      setIsUpdatingAnonymousMode(false);
    }
  };

  const handleAcceptIncomingCall = () => {
    void acceptIncomingCall();
  };

  const handleRejectIncomingCall = () => {
    void rejectIncomingCall();
  };

  const removeAppointmentFromQueue = useCallback((appointmentIdToRemove: string) => {
    setUpcomingAppointments((previous) =>
      previous.filter((appointment) => String(appointment.id) !== appointmentIdToRemove)
    );
  }, []);

  const finalizeEndedAppointment = useCallback(
    async (appointmentIdToEnd: string) => {
      try {
        const result = await api.endVideoCall(appointmentIdToEnd);
        if (result?.appointment_status === "completed") {
          removeAppointmentFromQueue(appointmentIdToEnd);
        }
      } catch {
        // Best-effort cleanup for the server-side session.
      }
    },
    [removeAppointmentFromQueue]
  );

  const beginCall = useCallback(
    async (mode: CallMode) => {
      if (!activeAppointmentId) {
        toast.error("Select an appointment to start a call.");
        return;
      }

      if (!activeAppointment) {
        toast.error("Selected appointment not found.");
        return;
      }

      const callWindow = getVideoCallWindowStatus(
        activeAppointment.scheduled_at,
        activeAppointment.duration_minutes
      );

      if (!callWindow.canStart) {
        toast.error(callWindow.message);
        return;
      }

      if (!isOnline) {
        toast.error("Reconnect to the internet before starting the call.");
        return;
      }

      if (!isSignalingReady) {
        toast.error("Preparing the secure call channel. Try again in a moment.");
        return;
      }

      setIsStartingMode(mode);
      try {
        const authorization = await api.authorizeVideoCall(activeAppointmentId);
        const serverDuration = Number(authorization?.max_duration_minutes);
        setAuthorizedDurationMinutes(
          Number.isFinite(serverDuration) ? serverDuration : null
        );

        const started =
          mode === "audio" ? await startAudioCall() : await startCall();

        if (started) {
          toast.success(
            mode === "audio"
              ? "Audio call started. Waiting for your counselor."
              : "Video call started. Waiting for your counselor."
          );
        }
      } catch (startError: any) {
        toast.error(startError?.response?.data?.message || "Failed to start the call");
      } finally {
        setIsStartingMode(null);
      }
    },
    [
      activeAppointment,
      activeAppointmentId,
      isOnline,
      isSignalingReady,
      startAudioCall,
      startCall,
    ]
  );

  const handleStartCall = useCallback(async () => {
    await beginCall("video");
  }, [beginCall]);

  const handleStartAudioCall = useCallback(async () => {
    await beginCall("audio");
  }, [beginCall]);

  const handleEndCall = async () => {
    const appointmentIdToEnd = activeAppointmentId;

    endCall();
    setIsMuted(false);
    setIsStartingMode(null);
    setAuthorizedDurationMinutes(null);

    if (appointmentIdToEnd) {
      await finalizeEndedAppointment(appointmentIdToEnd);
    }

    toast.info("Call ended");
  };

  useEffect(() => {
    setAuthorizedDurationMinutes(null);
    setIsStartingMode(null);
  }, [activeAppointmentId]);

  useEffect(() => {
    if (!shouldAutostart) {
      autoStartedRef.current = false;
      return;
    }

    if (autoStartedRef.current) return;
    if (!activeAppointment || !activeAppointmentId) return;
    if (localStream || isConnecting || isStartingMode) return;
    if (!isSignalingReady || !isOnline) return;

    const callWindow = getVideoCallWindowStatus(
      activeAppointment.scheduled_at,
      activeAppointment.duration_minutes
    );

    if (!callWindow.canStart) {
      return;
    }

    autoStartedRef.current = true;
    if (requestedMode === "audio") {
      void handleStartAudioCall();
    } else {
      void handleStartCall();
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("autostart");
    setSearchParams(nextParams, { replace: true });
  }, [
    activeAppointment,
    activeAppointmentId,
    handleStartAudioCall,
    handleStartCall,
    isConnecting,
    isOnline,
    isSignalingReady,
    isStartingMode,
    localStream,
    requestedMode,
    searchParams,
    setSearchParams,
    shouldAutostart,
  ]);

  useEffect(() => {
    if (!isConnected || !localStream || !activeAppointment) {
      setRemainingSeconds(null);
      return;
    }

    const durationMinutes = normalizeVideoCallDuration(
      authorizedDurationMinutes ?? activeAppointment.duration_minutes
    );
    const endsAt = Date.now() + durationMinutes * 60 * 1000;
    const appointmentIdToEnd = String(activeAppointment.id);

    const updateTimer = () => {
      const secondsLeft = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setRemainingSeconds(secondsLeft);

      if (secondsLeft === 0) {
        endCall();
        setIsMuted(false);
        setAuthorizedDurationMinutes(null);
        setIsStartingMode(null);

        if (appointmentIdToEnd) {
          void finalizeEndedAppointment(appointmentIdToEnd);
        }

        toast.warning(
          `Call ended after ${durationMinutes} minutes (session limit reached).`
        );
        return true;
      }

      return false;
    };

    updateTimer();
    const timer = window.setInterval(() => {
      if (updateTimer()) {
        window.clearInterval(timer);
      }
    }, 1_000);

    return () => window.clearInterval(timer);
  }, [activeAppointment, authorizedDurationMinutes, endCall, finalizeEndedAppointment, isConnected, localStream]);

  const canStartSelectedCall = Boolean(
    activeAppointmentId &&
      activeWindowStatus?.canStart &&
      isSignalingReady &&
      isOnline &&
      !isStartingMode
  );

  const isBusyWithOtherAppointment = (appointmentId: string) =>
    Boolean(localStream && activeAppointmentId && activeAppointmentId !== appointmentId);

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar
        items={navItems}
        userType="student"
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-72">
        <DashboardHeader
          title="Video Call"
          onMenuClick={() => setSidebarOpen(true)}
        />

        <main className={cn(
          "transition-all duration-500",
          isConnected ? "p-0 h-[calc(100vh-80px)]" : "p-4 lg:p-6 max-w-full mx-auto"
        )}>
          <div className={cn(
            "grid gap-6 transition-all duration-500 h-full",
            isConnected 
              ? "grid-cols-1" 
              : localStream 
                ? "xl:grid-cols-[minmax(0,1fr)_320px]" 
                : "xl:grid-cols-[minmax(0,2fr)_360px]"
          )}>
            <Card
              variant="glass"
              className={cn(
                "overflow-hidden transition-all duration-500 border-none",
                isConnected ? "h-full rounded-none sm:rounded-3xl shadow-2xl" : "min-h-[72vh] xl:h-[calc(100vh-160px)]"
              )}
            >
              <CardContent className={cn(
                "flex h-full flex-col transition-all duration-500",
                isConnected ? "p-0" : "gap-4 p-4"
              )}>
                {!isOnline && (
                  <Alert variant="destructive" className="border-destructive/60 bg-destructive/5">
                    <WifiOff className="h-4 w-4" />
                    <AlertTitle>You are offline</AlertTitle>
                    <AlertDescription>
                      Presence, notifications, and video signaling are paused until your device reconnects.
                    </AlertDescription>
                  </Alert>
                )}

                {isIncomingCall && (
                  <Alert className="border-emerald-500/40 bg-emerald-500/5 text-foreground">
                    <PhoneIncoming className="h-4 w-4 text-emerald-500" />
                    <AlertTitle>Incoming {incomingAudioOnly ? "audio" : "video"} call</AlertTitle>
                    <AlertDescription className="mt-2 flex flex-wrap items-center gap-2">
                      <Button size="sm" onClick={handleAcceptIncomingCall}>
                        Accept
                      </Button>
                      <Button size="sm" variant="outline" onClick={handleRejectIncomingCall}>
                        Reject
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}

                {error && isOnline && (
                  <Alert className={cn(
                    isRelayError 
                      ? "border-destructive/50 bg-destructive/5 text-destructive-foreground" 
                      : "border-amber-500/40 bg-amber-500/5 text-foreground"
                  )}>
                    <AlertTriangle className={cn("h-4 w-4", isRelayError && "text-destructive")} />
                    <AlertTitle className="font-bold">
                      {isRelayError ? "Call attention needed" : "Call issue"}
                    </AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <div className={cn(
                  "relative flex-1 overflow-hidden transition-all duration-500 shadow-[0_28px_90px_-48px_rgba(0,0,0,0.8)]",
                  isConnected 
                    ? "rounded-none sm:rounded-[32px] border-none bg-black" 
                    : "min-h-[72vh] rounded-[32px] border border-border/50 bg-[#071014]"
                )}>
                  {isLoading ? (
                    <div className="flex h-full flex-col gap-4">
                      <div className="flex items-center justify-between gap-3">
                        <Skeleton className="h-7 w-32 rounded-full" />
                        <Skeleton className="h-7 w-24 rounded-full" />
                      </div>
                      <Skeleton className="min-h-[320px] flex-1 rounded-[24px]" />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Skeleton className="h-28 rounded-[20px]" />
                        <Skeleton className="h-28 rounded-[20px]" />
                      </div>
                    </div>
                  ) : (
                    <div className="relative flex h-full min-h-[inherit] flex-col">
                      <div
                        className={cn(
                          "relative flex-1 overflow-hidden",
                          showRemoteVideo ? "bg-black" : "bg-[#0b141a]"
                        )}
                      >
                        {remoteStream ? (
                          <video
                            ref={remoteVideoRef}
                            autoPlay
                            playsInline
                            className={cn(
                              "absolute inset-0 h-full w-full object-cover",
                              showRemoteVideo
                                ? "opacity-100"
                                : "h-1 w-1 opacity-0 pointer-events-none"
                            )}
                          />
                        ) : null}

                        <div
                          className={cn(
                            "absolute inset-0",
                            showRemoteVideo
                              ? "bg-gradient-to-b from-black/55 via-black/10 to-black/75"
                              : "bg-[radial-gradient(circle_at_18%_18%,rgba(16,185,129,0.22),transparent_22%),radial-gradient(circle_at_82%_18%,rgba(34,197,94,0.14),transparent_18%),radial-gradient(circle_at_50%_82%,rgba(59,130,246,0.16),transparent_26%),linear-gradient(180deg,rgba(11,20,26,0.97),rgba(17,27,33,0.98))]"
                          )}
                        />
                        <div className="absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-black/45 via-black/15 to-transparent" />
                        <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />

                        <div className="absolute left-4 right-4 top-4 z-20 flex items-start justify-between gap-4">
                          <div className="max-w-[60%] space-y-2">
                            <div className="w-fit rounded-full border border-white/10 bg-black/30 px-4 py-2 text-sm font-semibold text-white backdrop-blur-xl shadow-lg">
                              {remoteParticipantName}
                              {remoteSpeaking ? " • speaking" : ""}
                            </div>
                            {activeAppointment?.scheduled_at && (
                              <div className="inline-flex w-fit items-center rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[11px] font-medium text-white/75 backdrop-blur-md">
                                {formatScheduleLabel(activeAppointment.scheduled_at)}
                              </div>
                            )}
                          </div>

                          <div className="flex flex-col items-end gap-2">
                            <div className="rounded-full border border-white/10 bg-black/25 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/90 backdrop-blur-md">
                              {callStateLabel}
                            </div>
                            <div className={connectionPillClassName}>{connectionPillLabel}</div>
                            {isConnected && (
                              <div className="rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-[11px] font-medium text-white/90 backdrop-blur-md">
                                {`Latency ${callQuality.latencyMs ?? "--"}ms • Jitter ${callQuality.jitterMs ?? "--"}ms • Loss ${callQuality.packetLossPercent ?? "--"}%`}
                              </div>
                            )}
                            {isConnected && remainingSeconds !== null && (
                              <div className="rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-[11px] font-medium text-white backdrop-blur-md">
                                <Clock className="mr-1.5 inline h-3.5 w-3.5" />
                                {formatCallDuration(remainingSeconds)}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="absolute right-4 top-24 z-20 w-32 overflow-hidden rounded-[24px] border border-white/10 bg-black/35 p-1.5 shadow-[0_24px_70px_-24px_rgba(0,0,0,0.95)] backdrop-blur-xl sm:w-44">
                          <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/85">
                            {isAnonymousMode ? "You (Anonymous)" : "You"}
                            {localSpeaking ? " • speaking" : ""}
                          </div>

                          <div className="aspect-[3/4] overflow-hidden rounded-[20px] bg-[#111b21] sm:aspect-video">
                            {localStream && !isVideoOff && !isAudioOnly ? (
                              <video
                                ref={localVideoRef}
                                autoPlay
                                playsInline
                                muted
                                className="h-full w-full object-cover"
                                style={{ transform: "scaleX(-1)" }}
                              />
                            ) : (
                              <div className="flex h-full flex-col items-center justify-center gap-3 px-3 text-center text-white/75">
                                {isVideoOff ? (
                                  <VideoOff className="h-6 w-6" />
                                ) : isAudioOnly ? (
                                  <Mic className="h-6 w-6" />
                                ) : (
                                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white">
                                    {getInitials(userName)}
                                  </div>
                                )}
                                <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/70">
                                  {localPreviewLabel}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        {!showRemoteVideo && (
                          <div className="relative z-10 flex h-full min-h-[520px] flex-col items-center justify-center px-6 pb-32 pt-28 text-center">
                            <div className="relative mb-8">
                              {(isConnecting || isStartingMode || notice) && (
                                <div className="absolute inset-[-18px] rounded-full border border-emerald-400/30 animate-ping" />
                              )}
                              <div className="absolute inset-[-26px] rounded-full bg-emerald-500/18 blur-3xl" />
                              <div className="relative flex h-28 w-28 items-center justify-center rounded-full border border-white/10 bg-white/10 text-4xl font-semibold tracking-tight text-white shadow-[0_24px_80px_-30px_rgba(16,185,129,0.45)]">
                                {activeAppointment ? getInitials(remoteParticipantName) : "--"}
                              </div>
                            </div>

                            <div className="max-w-xl space-y-3">
                              <p className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                                {activeAppointment ? remoteParticipantName : "No session selected"}
                              </p>
                              <p className="text-sm leading-6 text-white/70 sm:text-base">
                                {emptyStageMessage}
                              </p>

                              {isConnecting || isStartingMode ? (
                                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-white/85 backdrop-blur-md">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  Connecting
                                </div>
                              ) : activeWindowStatus?.canStart && !localStream ? (
                                <p className="text-xs font-medium uppercase tracking-[0.24em] text-emerald-200/80">
                                  Tap start video below when you are ready
                                </p>
                              ) : null}
                            </div>
                          </div>
                        )}

                        <div className="absolute inset-x-0 bottom-0 z-30 p-4 sm:p-6">
                          <div className="mx-auto flex w-full max-w-xl flex-wrap items-center justify-center gap-3 rounded-[30px] border border-white/10 bg-black/45 px-4 py-3 backdrop-blur-2xl shadow-[0_24px_70px_-24px_rgba(0,0,0,0.9)]">
                            {localStream ? (
                              <>
                                <Button
                                  variant={isMuted ? "destructive" : "ghost"}
                                  size="icon"
                                  className={cn(
                                    "h-14 w-14 rounded-full text-white",
                                    isMuted
                                      ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                      : "bg-white/10 hover:bg-white/20"
                                  )}
                                  onClick={handleToggleMute}
                                >
                                  {isMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
                                </Button>

                                <Button
                                  variant={isVideoOff ? "destructive" : "ghost"}
                                  size="icon"
                                  className={cn(
                                    "h-14 w-14 rounded-full text-white",
                                    isVideoOff
                                      ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                      : "bg-white/10 hover:bg-white/20"
                                  )}
                                  onClick={handleToggleVideo}
                                >
                                  {isVideoOff ? <VideoOff className="h-6 w-6" /> : <Video className="h-6 w-6" />}
                                </Button>

                                <Button
                                  variant="destructive"
                                  size="icon"
                                  className="h-16 w-16 rounded-full shadow-[0_0_30px_rgba(239,68,68,0.4)] hover:scale-105 active:scale-95"
                                  onClick={handleEndCall}
                                >
                                  <Phone className="h-7 w-7 rotate-[135deg]" />
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button
                                  variant="default"
                                  size="lg"
                                  className="h-14 rounded-full bg-emerald-500 px-6 text-white shadow-[0_18px_45px_-18px_rgba(16,185,129,0.75)] hover:bg-emerald-400"
                                  onClick={handleStartCall}
                                  disabled={!canStartSelectedCall || isConnecting}
                                >
                                  {isStartingMode === "video" ? (
                                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                  ) : (
                                    <Video className="mr-2 h-5 w-5" />
                                  )}
                                  {isStartingMode === "video" ? "Starting..." : "Start Video"}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="lg"
                                  className="h-14 rounded-full border border-white/10 bg-white/10 px-6 text-white hover:bg-white/20"
                                  onClick={handleStartAudioCall}
                                  disabled={!canStartSelectedCall || isConnecting}
                                >
                                  {isStartingMode === "audio" ? (
                                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                  ) : (
                                    <Mic className="mr-2 h-5 w-5" />
                                  )}
                                  {isStartingMode === "audio" ? "Starting..." : "Audio only"}
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

              </CardContent>
            </Card>

            {!isConnected && (
              <Card variant="glass" className="overflow-hidden h-fit">
                <CardHeader className="space-y-2 p-4">
                  <CardTitle className="text-lg flex items-center justify-between gap-2">
                    <span>Call Queue</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleToggleAnonymousMode}
                      disabled={isUpdatingAnonymousMode}
                    >
                      {isUpdatingAnonymousMode
                        ? "Updating..."
                        : isAnonymousMode
                        ? "Anonymous Mode"
                        : "Identified Mode"}
                    </Button>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    Pick the session you want to open. The main panel updates like a live call room.
                  </p>
                </CardHeader>
                <CardContent className="space-y-3 p-4 pt-0">
                  {isLoading ? (
                    Array.from({ length: 3 }).map((_, index) => (
                      <div key={index} className="rounded-[22px] border border-border/60 bg-background/70 p-4">
                        <Skeleton className="h-5 w-36" />
                        <Skeleton className="mt-3 h-4 w-40" />
                        <Skeleton className="mt-3 h-10 w-full rounded-xl" />
                      </div>
                    ))
                  ) : upcomingAppointments.length === 0 ? (
                    <div className="rounded-[22px] border border-dashed border-border/70 bg-background/60 p-6 text-center">
                      <p className="text-base font-medium text-foreground">No active online sessions</p>
                      <p className="mt-2 text-sm text-muted-foreground text-xs">
                        Online calls appear here up to 15 minutes before the appointment time.
                      </p>
                    </div>
                  ) : (
                    upcomingAppointments.map((appointment) => {
                      const appointmentId = String(appointment.id);
                      const isActive = activeAppointmentId === appointmentId;
                      const callWindow = getVideoCallWindowStatus(
                        appointment.scheduled_at,
                        appointment.duration_minutes
                      );
                      const isBusy = isBusyWithOtherAppointment(appointmentId);

                      return (
                        <div
                          key={appointmentId}
                          className={cn(
                            "rounded-[22px] border p-4 transition-all cursor-pointer hover:border-primary/30 hover:-translate-y-0.5",
                            isActive
                              ? "border-primary/45 bg-primary/8 shadow-[0_18px_45px_-32px_hsl(var(--primary)/0.75)]"
                              : "border-border/60 bg-background/70"
                          )}
                          onClick={() => !isBusy && setActiveAppointmentId(appointmentId)}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-foreground truncate">
                                {getParticipantName(appointment.counselor, "Counselor")}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground whitespace-nowrap">
                                {formatScheduleLabel(appointment.scheduled_at)}
                              </p>
                            </div>
                            <Badge
                              variant={callWindow.canStart ? "secondary" : "outline"}
                              className="rounded-full px-2 py-0 text-[10px]"
                            >
                              {callWindow.canStart ? "Ready" : "Scheduled"}
                            </Badge>
                          </div>
                      
                          <p className="mt-2 text-xs text-muted-foreground line-clamp-1">
                            {callWindow.message}
                          </p>
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default StudentVideoCall;
