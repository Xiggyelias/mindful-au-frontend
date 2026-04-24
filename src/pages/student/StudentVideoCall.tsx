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
  const [isVideoOff, setIsVideoOff] = useState(false);
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
    isConnected,
    isConnecting,
    isSignalingReady,
    isAudioOnly,
    error,
    localVideoRef,
    remoteVideoRef,
    startCall,
    startAudioCall,
    endCall,
    toggleMute,
    toggleVideo,
  } = useWebRTC(sessionId, user?.id?.toString() || "");

  useEffect(() => {
    if (error) {
      toast.error(error);
    }
  }, [error]);

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

  const statusMessage = useMemo(() => {
    if (!activeAppointment) {
      return "Select an upcoming online session to prepare your call.";
    }
    if (!isOnline) {
      return "You are offline. Reconnect to continue the call.";
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
        ? isAudioOnly
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
    isOnline,
    isStartingMode,
    isAudioOnly,
    localStream,
    remoteStream,
  ]);

  const handleToggleMute = () => {
    toggleMute();
    setIsMuted((previous) => !previous);
  };

  const handleToggleVideo = () => {
    toggleVideo();
    setIsVideoOff((previous) => !previous);
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
    setIsVideoOff(false);
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
        setIsVideoOff(false);
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

        <main className="p-4 lg:p-6">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_360px]">
            <Card
              variant="glass"
              className="min-h-[68vh] overflow-hidden xl:h-[calc(100vh-200px)]"
            >
              <CardContent className="flex h-full flex-col gap-4 p-4">
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
                  <Alert className="border-amber-500/40 bg-amber-500/5 text-foreground [&>svg]:text-amber-600">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Call attention needed</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <div className="relative flex-1 overflow-hidden rounded-[28px] border border-border/60 bg-[radial-gradient(circle_at_top,_hsl(var(--primary)/0.18),_transparent_42%),linear-gradient(160deg,_hsl(var(--background)),_hsl(var(--secondary)/0.55))] p-3 sm:p-4">
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
                        {remoteStream ? (
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
                              {statusMessage}
                            </p>
                            {isConnecting || isStartingMode ? (
                              <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/80 px-4 py-2 text-sm text-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Connecting securely
                              </div>
                            ) : null}
                          </div>
                        )}

                        <div className="pointer-events-none absolute left-3 top-3">
                          <Badge className="rounded-full bg-background/85 px-3 py-1 text-foreground shadow-sm">
                            {remoteParticipantName}
                          </Badge>
                        </div>

                        <div className="absolute bottom-3 right-3 w-28 overflow-hidden rounded-[20px] border border-white/25 bg-slate-950/80 shadow-2xl shadow-slate-950/40 sm:w-40 md:w-52">
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

                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-[22px] border border-border/60 bg-background/70 p-4 shadow-sm">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                            Session
                          </p>
                          <p className="mt-2 text-lg font-semibold text-foreground">
                            {activeAppointment ? remoteParticipantName : "Choose a session"}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {activeAppointment
                              ? `Scheduled ${formatScheduleLabel(activeAppointment.scheduled_at)}`
                              : "Only online appointments inside their call window appear here."}
                          </p>
                        </div>

                        <div className="rounded-[22px] border border-border/60 bg-background/70 p-4 shadow-sm">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                            Call status
                          </p>
                          <p className="mt-2 text-base font-medium text-foreground">
                            {statusMessage}
                          </p>
                          <p className="mt-2 text-sm text-muted-foreground">
                            Your local preview stays visible so you can confirm camera, framing, and mute state before the other person joins.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-center gap-3">
                  <Button
                    variant={isMuted ? "destructive" : "outline"}
                    size="lg"
                    className="h-14 w-14 rounded-full"
                    onClick={handleToggleMute}
                    disabled={!localStream}
                  >
                    {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                  </Button>

                  <Button
                    variant={isVideoOff ? "destructive" : "outline"}
                    size="lg"
                    className="h-14 w-14 rounded-full"
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
                        className="h-14 rounded-full px-6"
                        onClick={handleStartCall}
                        disabled={!canStartSelectedCall || isConnecting}
                      >
                        {isStartingMode === "video" ? (
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        ) : (
                          <Video className="mr-2 h-5 w-5" />
                        )}
                        {isStartingMode === "video" ? "Starting video..." : "Start video"}
                      </Button>
                      <Button
                        variant="outline"
                        size="lg"
                        className="h-14 rounded-full px-6"
                        onClick={handleStartAudioCall}
                        disabled={!canStartSelectedCall || isConnecting}
                      >
                        {isStartingMode === "audio" ? (
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        ) : (
                          <Mic className="mr-2 h-5 w-5" />
                        )}
                        {isStartingMode === "audio" ? "Starting audio..." : "Start audio"}
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="destructive"
                      size="lg"
                      className="h-14 rounded-full px-6"
                      onClick={handleEndCall}
                    >
                      <Phone className="mr-2 h-5 w-5 rotate-[135deg]" />
                      End call
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card variant="glass" className="overflow-hidden">
              <CardHeader className="space-y-2">
                <CardTitle className="text-lg">Upcoming Online Sessions</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Pick the active appointment you want to join. Once selected, your preview and controls update immediately.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
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
                    <p className="mt-2 text-sm text-muted-foreground">
                      Online calls appear here up to 15 minutes before the appointment time and disappear after the window closes.
                    </p>
                  </div>
                ) : (
                  upcomingAppointments.map((appointment) => {
                    const appointmentId = String(appointment.id);
                    const isActive = appointmentId === activeAppointmentId;
                    const callWindow = getVideoCallWindowStatus(
                      appointment.scheduled_at,
                      appointment.duration_minutes
                    );

                    return (
                      <div
                        key={appointment.id}
                        className={cn(
                          "rounded-[22px] border p-4 transition-all",
                          isActive
                            ? "border-primary/45 bg-primary/8 shadow-[0_18px_45px_-32px_hsl(var(--primary)/0.75)]"
                            : "border-border/60 bg-background/70"
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-base font-semibold text-foreground">
                              {getParticipantName(appointment.counselor, "Counselor")}
                            </p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {formatScheduleLabel(appointment.scheduled_at)}
                            </p>
                          </div>
                          <Badge
                            variant={callWindow.canStart ? "secondary" : "outline"}
                            className="rounded-full px-3 py-1"
                          >
                            {callWindow.canStart ? "Ready" : "Scheduled"}
                          </Badge>
                        </div>

                        <p className="mt-3 text-sm text-muted-foreground">
                          {callWindow.message}
                        </p>

                        <Button
                          size="sm"
                          variant={isActive ? "default" : "outline"}
                          className="mt-4 w-full"
                          onClick={() => setActiveAppointmentId(appointmentId)}
                          disabled={isBusyWithOtherAppointment(appointmentId)}
                        >
                          {isBusyWithOtherAppointment(appointmentId)
                            ? "Finish current call first"
                            : isActive
                            ? "Selected"
                            : "Select session"}
                        </Button>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
};

export default StudentVideoCall;
