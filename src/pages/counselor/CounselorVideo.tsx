import { useState, useEffect, useMemo } from "react";
import {
  AlertTriangle,
  LayoutDashboard,
  MessageSquare,
  Calendar,
  Users,
  Brain,
  Video,
  FileText,
  Heart,
  Clock,
  Mic,
  MicOff,
  VideoOff,
  Phone,
  Loader2,
  WifiOff,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { format } from "date-fns";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/counselor/dashboard" },
  { label: "Messages", icon: MessageSquare, path: "/counselor/messages" },
  { label: "Appointments", icon: Calendar, path: "/counselor/appointments" },
  { label: "Students", icon: Users, path: "/counselor/students" },
  { label: "AI Insights", icon: Brain, path: "/counselor/ai-insights" },
  { label: "Video Sessions", icon: Video, path: "/counselor/video" },
  { label: "Session Notes", icon: FileText, path: "/counselor/notes" },
  { label: "Wellness", icon: Heart, path: "/counselor/wellness" },
];

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

const CounselorVideo = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [pendingSessionStartId, setPendingSessionStartId] = useState<string | null>(null);
  const [pendingCallMode, setPendingCallMode] = useState<"video" | "audio">("video");
  const [upcomingSessions, setUpcomingSessions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [authorizedDurationMinutes, setAuthorizedDurationMinutes] = useState<number | null>(null);
  const [isOnline, setIsOnline] = useState(
    () => (typeof navigator === "undefined" ? true : navigator.onLine)
  );
  const { user } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split('@')[0] || "Counselor";

  const {
    localStream,
    remoteStream,
    isConnected,
    isConnecting,
    isSignalingReady,
    isAudioOnly,
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
  } = useWebRTC(activeSessionId || "", String(user?.id || ""));

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
    const loadSessions = async () => {
      try {
        setIsLoading(true);
        const appointments = await api.getAppointments();
        const videoAppointments = appointments
          .filter((apt: any) => {
            if (!apt?.scheduled_at) return false;
            if (!isVideoEnabledAppointment(apt.notes)) return false;
            if (!(apt.status === "scheduled" || apt.status === "confirmed")) return false;
            const callWindow = getVideoCallWindowStatus(
              apt.scheduled_at,
              apt.duration_minutes
            );
            return !callWindow.isExpired;
          })
          .sort(
            (a: any, b: any) =>
              new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
          )
          .slice(0, 5);

        setUpcomingSessions(videoAppointments);

        if (videoAppointments.length > 0) {
          setActiveSessionId((previous) =>
            previous &&
            videoAppointments.some((item: any) => String(item.id) === previous)
              ? previous
              : String(videoAppointments[0].id)
          );
        } else {
          setActiveSessionId(null);
        }
      } catch (err: any) {
        console.error("Failed to load sessions:", err);
        toast.error("Failed to load upcoming sessions");
      } finally {
        setIsLoading(false);
      }
    };
    
    if (user) loadSessions();
  }, [user]);

  const handleToggleMute = () => {
    toggleMute();
    setIsMuted((previous) => !previous);
  };

  const handleToggleVideo = () => {
    toggleVideo();
    setIsVideoOff((previous) => !previous);
  };

  const activeSession = useMemo(
    () => upcomingSessions.find((session) => String(session.id) === activeSessionId),
    [activeSessionId, upcomingSessions]
  );

  const activeSessionWindowStatus = useMemo(() => {
    if (!activeSession) return null;
    return getVideoCallWindowStatus(
      activeSession.scheduled_at,
      activeSession.duration_minutes
    );
  }, [activeSession]);

  const handleStartSession = (sessionId: string, mode: "video" | "audio" = "video") => {
    const session = upcomingSessions.find((item) => String(item.id) === sessionId);
    if (!session) {
      toast.error("Selected session not found.");
      return;
    }

    if (localStream && activeSessionId && activeSessionId !== sessionId) {
      toast.error("End the current session before starting another one.");
      return;
    }

    const callWindow = getVideoCallWindowStatus(
      session.scheduled_at,
      session.duration_minutes
    );

    if (!callWindow.canStart) {
      toast.error(callWindow.message);
      return;
    }

    if (!isOnline) {
      toast.error("Reconnect to the internet before starting the session.");
      return;
    }

    setActiveSessionId(sessionId);
    setPendingCallMode(mode);
    setPendingSessionStartId(sessionId);
  };

  const handleEndCall = () => {
    const sessionIdToEnd = activeSessionId;
    endCall();
    setIsMuted(false);
    setIsVideoOff(false);
    setPendingSessionStartId(null);
    setPendingCallMode("video");
    setAuthorizedDurationMinutes(null);

    if (sessionIdToEnd) {
      void api.endVideoCall(sessionIdToEnd).catch(() => {
        // Best effort: call already ended locally.
      });
    }

    toast.info("Session ended");
  };

  useEffect(() => {
    setAuthorizedDurationMinutes(null);
    setPendingCallMode("video");
  }, [activeSessionId]);

  useEffect(() => {
    if (!isOnline && pendingSessionStartId) {
      setPendingSessionStartId(null);
    }
  }, [isOnline, pendingSessionStartId]);

  useEffect(() => {
    if (!pendingSessionStartId) return;
    if (!activeSessionId || pendingSessionStartId !== activeSessionId) return;
    if (!isSignalingReady) return;
    if (!isOnline) return;

    let cancelled = false;

    const beginSession = async () => {
      try {
        const authorization = await api.authorizeVideoCall(activeSessionId);
        const serverDuration = Number(authorization?.max_duration_minutes);
        setAuthorizedDurationMinutes(
          Number.isFinite(serverDuration) ? serverDuration : null
        );
      } catch (err: any) {
        if (!cancelled) {
          toast.error(err?.response?.data?.message || "Failed to start session");
          setPendingSessionStartId(null);
        }
        return;
      }

      const started =
        pendingCallMode === "audio" ? await startAudioCall() : await startCall();
      if (cancelled) return;

      if (started) {
        toast.success(
          pendingCallMode === "audio"
            ? "Audio session started - waiting for student to connect"
            : "Session started - waiting for student to connect"
        );
      }
      setPendingSessionStartId(null);
      setPendingCallMode("video");
    };

    void beginSession();

    return () => {
      cancelled = true;
    };
  }, [activeSessionId, isOnline, isSignalingReady, pendingCallMode, pendingSessionStartId, startAudioCall, startCall]);

  useEffect(() => {
    if (!isConnected || !localStream || !activeSession) {
      setRemainingSeconds(null);
      return;
    }

    const durationMinutes = normalizeVideoCallDuration(
      authorizedDurationMinutes ?? activeSession.duration_minutes
    );
    const endsAt = Date.now() + durationMinutes * 60 * 1000;
    const sessionIdToEnd = String(activeSession.id);

    const updateTimer = () => {
      const secondsLeft = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setRemainingSeconds(secondsLeft);

      if (secondsLeft === 0) {
        endCall();
        setIsMuted(false);
        setIsVideoOff(false);
        setPendingSessionStartId(null);
        setAuthorizedDurationMinutes(null);

        if (sessionIdToEnd) {
          void api.endVideoCall(sessionIdToEnd).catch(() => {
            // Best effort: call already ended locally.
          });
        }

        toast.warning(
          `Session ended after ${durationMinutes} minutes (session limit reached).`
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
  }, [activeSession, authorizedDurationMinutes, endCall, isConnected, localStream]);

  const remoteParticipantName = useMemo(
    () => getParticipantName(activeSession?.student, "Student"),
    [activeSession]
  );

  const isStartingActiveSession = Boolean(
    activeSessionId && pendingSessionStartId === activeSessionId
  );

  const statusMessage = useMemo(() => {
    if (!activeSession) {
      return "Choose a scheduled online session to open the room.";
    }
    if (!isOnline) {
      return "You are offline. Reconnect to continue the session.";
    }
    if (notice) {
      return notice;
    }
    if (error) {
      return error;
    }
    if (isStartingActiveSession) {
      return pendingCallMode === "audio"
        ? "Preparing an audio-only session..."
        : "Preparing camera, microphone, and secure call channel...";
    }
    if (isConnecting) {
      return localStream
        ? "Waiting for the student to answer..."
        : "Connecting to the session...";
    }
    if (isConnected) {
      return remoteStream
        ? isAudioOnly
          ? "Connected. Video is unavailable, but audio is live."
          : "Connected. You and the student are live."
        : "Connected. Waiting for the student video feed to appear.";
    }
    if (localStream) {
      return "Your preview is ready. Waiting for the student to join.";
    }
    if (activeSessionWindowStatus?.canStart) {
      return "The session window is open. Start when you are ready.";
    }
    return activeSessionWindowStatus?.message || "This session is not available yet.";
  }, [
    activeSession,
    activeSessionWindowStatus?.canStart,
    activeSessionWindowStatus?.message,
    isAudioOnly,
    isConnected,
    isConnecting,
    error,
    isOnline,
    isStartingActiveSession,
    localStream,
    notice,
    pendingCallMode,
    remoteStream,
  ]);

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar
        items={navItems}
        userType="counselor"
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-72">
        <DashboardHeader
          title="Video Sessions"
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
                  <Alert className={cn(
                    isRelayError 
                      ? "border-destructive/50 bg-destructive/5 text-destructive-foreground" 
                      : "border-amber-500/40 bg-amber-500/5 text-foreground"
                  )}>
                    <AlertTriangle className={cn("h-4 w-4", isRelayError && "text-destructive")} />
                    <AlertTitle className="font-bold">
                      {isRelayError ? "Session attention needed" : "Session issue"}
                    </AlertTitle>
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
                            variant={isConnected ? "default" : activeSessionWindowStatus?.canStart ? "secondary" : "outline"}
                            className="rounded-full px-3 py-1 text-xs uppercase tracking-[0.18em]"
                          >
                            {isConnected
                              ? "Live session"
                              : isStartingActiveSession
                              ? "Preparing"
                              : activeSessionWindowStatus?.canStart
                              ? "Ready"
                              : "Scheduled"}
                          </Badge>
                          {isAudioOnly && (
                            <Badge variant="outline" className="rounded-full px-3 py-1">
                              Audio only
                            </Badge>
                          )}
                          {activeSession?.scheduled_at && (
                            <Badge variant="outline" className="rounded-full px-3 py-1">
                              {formatScheduleLabel(activeSession.scheduled_at)}
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
                                : isConnecting || isStartingActiveSession
                                ? "border-amber-500/30 bg-amber-500/10 text-amber-700"
                                : "border-border/70 bg-background/70 text-muted-foreground"
                            )}
                          >
                            {isConnected
                              ? "Connected"
                              : notice
                              ? "Reconnecting"
                              : isConnecting || isStartingActiveSession
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
                              {activeSession ? getInitials(remoteParticipantName) : "--"}
                            </div>
                            <p className="text-2xl font-semibold text-foreground">
                              {activeSession ? remoteParticipantName : "No session selected"}
                            </p>
                            <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                              {statusMessage}
                            </p>
                            {isConnecting || isStartingActiveSession ? (
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
                            {activeSession ? remoteParticipantName : "Choose a session"}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {activeSession
                              ? `Scheduled ${formatScheduleLabel(activeSession.scheduled_at)}`
                              : "Only online sessions inside their call window appear here."}
                          </p>
                        </div>

                        <div className="rounded-[22px] border border-border/60 bg-background/70 p-4 shadow-sm">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                            Session status
                          </p>
                          <p className="mt-2 text-base font-medium text-foreground">
                            {statusMessage}
                          </p>
                          <p className="mt-2 text-sm text-muted-foreground">
                            Your local preview stays visible so you can confirm camera, framing, and mute state before the student joins.
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
                  {activeSessionId && (
                    <Button
                      variant="destructive"
                      size="lg"
                      className="h-14 rounded-full px-6"
                      onClick={handleEndCall}
                    >
                      <Phone className="mr-2 h-5 w-5 rotate-[135deg]" />
                      End session
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card variant="glass" className="overflow-hidden">
              <CardHeader className="space-y-2">
                <CardTitle className="text-lg">Upcoming Online Sessions</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Start the room from the session you want to host. The student appears in the main stage as soon as they answer.
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
                ) : upcomingSessions.length === 0 ? (
                  <div className="rounded-[22px] border border-dashed border-border/70 bg-background/60 p-6 text-center">
                    <p className="text-base font-medium text-foreground">No active online sessions</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Online sessions appear here up to 15 minutes before the appointment time and disappear after the window closes.
                    </p>
                  </div>
                ) : (
                  upcomingSessions.map((session) => {
                    const sessionId = String(session.id);
                    const isActive = activeSessionId === sessionId;
                    const callWindow = getVideoCallWindowStatus(
                      session.scheduled_at,
                      session.duration_minutes
                    );
                    const isBusyWithOtherCall = Boolean(
                      localStream && activeSessionId && activeSessionId !== sessionId
                    );
                    const isStarting =
                      pendingSessionStartId === sessionId ||
                      (isActive && isConnecting);

                    return (
                      <div
                        key={session.id}
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
                              {getParticipantName(
                                session.student,
                                `Student #${String(session.id).slice(-4)}`
                              )}
                            </p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {formatScheduleLabel(session.scheduled_at)}
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

                        <div className="mt-4 grid grid-cols-2 gap-2">
                          <Button
                            size="sm"
                            className="w-full gap-2"
                            onClick={() => handleStartSession(sessionId, "video")}
                            disabled={
                              isBusyWithOtherCall ||
                              isStarting ||
                              !callWindow.canStart ||
                              !isOnline
                            }
                          >
                            {isStarting && pendingCallMode === "video" ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Starting...
                              </>
                            ) : isActive && isConnected ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Live
                              </>
                            ) : (
                              <>
                                <Video className="h-4 w-4" />
                                Video
                              </>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full gap-2"
                            onClick={() => handleStartSession(sessionId, "audio")}
                            disabled={
                              isBusyWithOtherCall ||
                              isStarting ||
                              !callWindow.canStart ||
                              !isOnline
                            }
                          >
                            {isStarting && pendingCallMode === "audio" ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Starting...
                              </>
                            ) : (
                              <>
                                <Mic className="h-4 w-4" />
                                Audio
                              </>
                            )}
                          </Button>
                        </div>
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

export default CounselorVideo;
