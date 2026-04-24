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
  const [isOnline, setIsOnline] = useState(
    () => (typeof navigator === "undefined" ? true : navigator.onLine)
  );
  const { user } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || "Student";

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
    localVideoRef,
    remoteVideoRef,
    startCall,
    startAudioCall,
    endCall,
    toggleMute,
    toggleVideo,
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

  const activeWindowStatus = useMemo(() => {
    if (!activeAppointment) {
      return null;
    }

    return getVideoCallWindowStatus(
      activeAppointment.scheduled_at,
      activeAppointment.duration_minutes
    );
  }, [activeAppointment]);

  const remoteParticipantName = useMemo(
    () => getParticipantName(activeAppointment?.counselor, "Counselor"),
    [activeAppointment]
  );
  const isVideoOff = Boolean(localStream && !isAudioOnly && !isLocalVideoEnabled);
  const showRemoteVideo = Boolean(remoteStream && remoteHasVideo);

  const statusMessage = useMemo(() => {
    if (!activeAppointment) {
      return "Select an upcoming online session to prepare your call.";
    }
    if (!isOnline) {
      return "You are offline. Reconnect to continue the call.";
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
      ? `${remoteParticipantName} joined without video. Ask them to allow camera access or tap the camera button.`
      : statusMessage;

  const handleToggleMute = () => {
    toggleMute();
    setIsMuted((previous) => !previous);
  };

  const handleToggleVideo = () => {
    void toggleVideo();
  };

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

  const handleEndCall = () => {
    const appointmentIdToEnd = activeAppointmentId;

    endCall();
    setIsMuted(false);
    setIsStartingMode(null);
    setAuthorizedDurationMinutes(null);

    if (appointmentIdToEnd) {
      void api.endVideoCall(appointmentIdToEnd).catch(() => {
        // Best-effort cleanup for the server-side session.
      });
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
          void api.endVideoCall(appointmentIdToEnd).catch(() => {
            // Best-effort cleanup for the server-side session.
          });
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
  }, [activeAppointment, authorizedDurationMinutes, endCall, isConnected, localStream]);

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
                  "relative flex-1 overflow-hidden transition-all duration-500",
                  isConnected 
                    ? "rounded-none sm:rounded-[28px] border-none bg-black" 
                    : "rounded-[28px] border border-border/60 bg-[radial-gradient(circle_at_top,_hsl(var(--primary)/0.18),_transparent_42%),linear-gradient(160deg,_hsl(var(--background)),_hsl(var(--secondary)/0.55))] p-3 sm:p-4"
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
                    <div className="flex h-full flex-col gap-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={isConnected ? "default" : activeWindowStatus?.canStart ? "secondary" : "outline"}
                            className="rounded-full px-3 py-1 text-xs uppercase tracking-[0.18em]"
                          >
                            {isConnected
                              ? "Live call"
                              : isStartingMode
                              ? "Preparing"
                              : activeWindowStatus?.canStart
                              ? "Ready"
                              : "Scheduled"}
                          </Badge>
                          {isAudioOnly && (
                            <Badge variant="outline" className="rounded-full px-3 py-1">
                              Audio only
                            </Badge>
                          )}
                          {activeAppointment?.scheduled_at && (
                            <Badge variant="outline" className="rounded-full px-3 py-1">
                              {formatScheduleLabel(activeAppointment.scheduled_at)}
                            </Badge>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant="outline"
                            className={cn(
                              "rounded-full px-3 py-1",
                              isConnected
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
                                : isConnecting || isStartingMode
                                ? "border-amber-500/30 bg-amber-500/10 text-amber-700"
                                : "border-border/70 bg-background/70 text-muted-foreground"
                            )}
                          >
                            {isConnected
                              ? "Connected"
                              : notice
                              ? "Reconnecting"
                              : isConnecting || isStartingMode
                              ? "Connecting"
                              : isSignalingReady
                              ? "Channel ready"
                              : "Preparing channel"}
                          </Badge>
                          {isConnected && remainingSeconds !== null && (
                            <Badge variant="outline" className="rounded-full px-3 py-1">
                              <Clock className="mr-1 h-3.5 w-3.5" />
                              {formatCallDuration(remainingSeconds)} left
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="relative flex-1 overflow-hidden rounded-[24px] border border-border/50 bg-background/90 shadow-[0_30px_80px_-50px_hsl(var(--foreground)/0.55)]">
                        {showRemoteVideo ? (
                          <video
                            ref={remoteVideoRef}
                            autoPlay
                            playsInline
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-6 text-center">
                            <div className="mb-5 flex h-24 w-24 items-center justify-center rounded-full bg-primary/12 text-3xl font-semibold text-primary shadow-inner">
                              {activeAppointment ? getInitials(remoteParticipantName) : "--"}
                            </div>
                            <p className="text-2xl font-semibold text-foreground">
                              {activeAppointment ? remoteParticipantName : "No session selected"}
                            </p>
                            <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                              {remoteVideoStatusMessage}
                            </p>
                            {isConnecting || isStartingMode ? (
                              <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/80 px-4 py-2 text-sm text-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Connecting securely
                              </div>
                            ) : null}
                          </div>
                        )}

                        <div className="pointer-events-none absolute left-4 top-4 z-20 flex flex-col gap-2">
                          <Badge className="w-fit rounded-full bg-black/40 backdrop-blur-md px-3 py-1.5 text-sm font-semibold text-white border-white/10 shadow-lg">
                            {remoteParticipantName}
                          </Badge>
                          {isConnected && remainingSeconds !== null && (
                            <Badge variant="outline" className="w-fit rounded-full bg-black/30 backdrop-blur-sm px-3 py-1 text-xs text-white border-white/5">
                              <Clock className="mr-1.5 h-3.5 w-3.5" />
                              {formatCallDuration(remainingSeconds)}
                            </Badge>
                          )}
                        </div>

                        {isConnected && (
                          <div className="absolute inset-x-0 bottom-8 z-30 flex items-center justify-center pointer-events-none px-4">
                            <div className="pointer-events-auto flex items-center gap-4 p-2 rounded-full bg-black/30 backdrop-blur-xl border border-white/10 shadow-2xl">
                              <Button
                                variant={isMuted ? "destructive" : "ghost"}
                                size="icon"
                                className={cn(
                                  "h-14 w-14 rounded-full transition-all duration-300",
                                  !isMuted && "hover:bg-white/20 text-white"
                                )}
                                onClick={handleToggleMute}
                              >
                                {isMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
                              </Button>

                              <Button
                                variant={isVideoOff ? "destructive" : "ghost"}
                                size="icon"
                                className={cn(
                                  "h-14 w-14 rounded-full transition-all duration-300",
                                  !isVideoOff && "hover:bg-white/20 text-white"
                                )}
                                onClick={handleToggleVideo}
                              >
                                {isVideoOff ? <VideoOff className="h-6 w-6" /> : <Video className="h-6 w-6" />}
                              </Button>

                              <Button
                                variant="destructive"
                                size="icon"
                                className="h-16 w-16 rounded-full shadow-[0_0_30px_rgba(239,68,68,0.4)] hover:scale-105 active:scale-95 transition-all duration-200"
                                onClick={handleEndCall}
                              >
                                <Phone className="h-7 w-7 rotate-[135deg]" />
                              </Button>
                            </div>
                          </div>
                        )}

                        <div className={cn(
                          "absolute z-20 overflow-hidden transition-all duration-500",
                          isConnected 
                            ? "top-4 right-4 w-32 sm:w-44 lg:w-56 rounded-2xl border-white/20 bg-slate-900/40 shadow-2xl backdrop-blur-sm" 
                            : "bottom-3 right-3 w-28 sm:w-40 md:w-52 rounded-[20px] border border-white/25 bg-slate-950/80 shadow-2xl shadow-slate-950/40"
                        )}>
                          <div className="pointer-events-none absolute left-2 top-2 z-10">
                            <Badge
                              variant="secondary"
                              className="rounded-full bg-black/55 px-2.5 py-0.5 text-[11px] text-white"
                            >
                              You
                            </Badge>
                          </div>

                          <div className="aspect-[3/4] w-full sm:aspect-video">
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
                              <div className="flex h-full flex-col items-center justify-center gap-2 bg-slate-950/80 px-3 text-center text-white/75">
                                {isVideoOff ? (
                                  <VideoOff className="h-6 w-6" />
                                ) : isAudioOnly ? (
                                  <Mic className="h-6 w-6" />
                                ) : (
                                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-sm font-semibold">
                                    {getInitials(userName)}
                                  </div>
                                )}
                                <span className="text-[11px] font-medium sm:text-xs">
                                  {isAudioOnly ? "Audio only" : isVideoOff ? "Camera off" : "Waiting for camera"}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {!isConnected && (
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="rounded-[22px] border border-border/60 bg-background/70 p-4 shadow-sm">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                              Session
                            </p>
                            <p className="mt-2 text-lg font-semibold text-foreground">
                              {activeAppointment ? remoteParticipantName : "Choose a session"}
                            </p>
                            <p className="mt-1 text-sm text-muted-foreground text-xs">
                              {activeAppointment
                                ? `Scheduled ${formatScheduleLabel(activeAppointment.scheduled_at)}`
                                : "Only online appointments inside their call window appear here."}
                            </p>
                          </div>

                          <div className="rounded-[22px] border border-border/60 bg-background/70 p-4 shadow-sm">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                              Call status
                            </p>
                            <p className="mt-2 text-base font-medium text-foreground text-xs sm:text-sm">
                              {statusMessage}
                            </p>
                            <p className="mt-1 text-[10px] text-muted-foreground leading-tight">
                              Your local preview stays visible so you can confirm camera, framing, and mute state before the other person joins.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {!isConnected && (
                  <div className="flex flex-wrap items-center justify-center gap-4 mt-auto py-2">
                    <Button
                      variant={isMuted ? "destructive" : "outline"}
                      size="lg"
                      className="h-14 w-14 rounded-full shadow-lg"
                      onClick={handleToggleMute}
                      disabled={!localStream}
                    >
                      {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                    </Button>

                    <Button
                      variant={isVideoOff ? "destructive" : "outline"}
                      size="lg"
                      className="h-14 w-14 rounded-full shadow-lg"
                      onClick={handleToggleVideo}
                      disabled={!localStream}
                    >
                      {isVideoOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
                    </Button>

                    {!localStream ? (
                      <>
                        <Button
                          variant="hero"
                          size="lg"
                          className="h-14 rounded-full px-8 shadow-xl hover:scale-105 transition-all"
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
                          variant="outline"
                          size="lg"
                          className="h-14 rounded-full px-8 shadow-lg"
                          onClick={handleStartAudioCall}
                          disabled={!canStartSelectedCall || isConnecting}
                        >
                          {isStartingMode === "audio" ? (
                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                          ) : (
                            <Mic className="mr-2 h-5 w-5" />
                          )}
                          {isStartingMode === "audio" ? "Starting..." : "Start Audio"}
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="destructive"
                        size="lg"
                        className="h-14 rounded-full px-8 shadow-xl"
                        onClick={handleEndCall}
                      >
                        <Phone className="mr-2 h-5 w-5 rotate-[135deg]" />
                        End Call
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {!isConnected && (
              <Card variant="glass" className="overflow-hidden h-fit">
                <CardHeader className="space-y-2 p-4">
                  <CardTitle className="text-lg">Upcoming Online Sessions</CardTitle>
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    Pick the active appointment you want to join. Your preview updates immediately.
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
                            "rounded-[22px] border p-4 transition-all cursor-pointer hover:border-primary/30",
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
