import { useState, useEffect, useMemo } from "react";
import {
  LayoutDashboard,
  MessageSquare,
  Calendar,
  Users,
  Brain,
  Video,
  FileText,
  Heart,
  ShieldAlert,
  ArrowRightLeft,
  Clock,
  Mic,
  MicOff,
  VideoOff,
  Phone,
  Loader2,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useWebRTC } from "@/hooks/useWebRTC";
import { api } from "@/lib/api";
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
  { label: "Intake", icon: ShieldAlert, path: "/counselor/intake" },
  { label: "Referrals", icon: ArrowRightLeft, path: "/counselor/referrals" },
  { label: "Students", icon: Users, path: "/counselor/students" },
  { label: "AI Insights", icon: Brain, path: "/counselor/ai-insights" },
  { label: "Video Sessions", icon: Video, path: "/counselor/video" },
  { label: "Session Notes", icon: FileText, path: "/counselor/notes" },
  { label: "Wellness", icon: Heart, path: "/counselor/wellness" },
];

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
    localVideoRef,
    remoteVideoRef,
    startCall,
    startAudioCall,
    endCall,
    toggleMute,
    toggleVideo,
  } = useWebRTC(activeSessionId || "", String(user?.id || ""));

  useEffect(() => {
    if (error) {
      toast.error(error);
    }
  }, [error]);

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
    setIsMuted(!isMuted);
  };

  const handleToggleVideo = () => {
    toggleVideo();
    setIsVideoOff(!isVideoOff);
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
    setActiveSessionId(null);

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
    if (!pendingSessionStartId) return;
    if (!activeSessionId || pendingSessionStartId !== activeSessionId) return;
    if (!isSignalingReady) return;

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
  }, [activeSessionId, isSignalingReady, pendingCallMode, pendingSessionStartId, startAudioCall, startCall]);

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
        setActiveSessionId(null);

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
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Main Video Area */}
            <Card variant="glass" className="lg:col-span-2 h-[calc(100vh-200px)]">
              <CardContent className="h-full p-4 flex flex-col">
                <div className="flex-1 bg-secondary/30 rounded-xl flex items-center justify-center relative overflow-hidden">
                  {remoteStream ? (
                    <video
                      ref={remoteVideoRef}
                      autoPlay
                      playsInline
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-center">
                      {isConnecting ? (
                        <Loader2 className="h-16 w-16 mx-auto text-primary mb-4 animate-spin" />
                      ) : (
                        <Video className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                      )}
                      <p className="text-xl font-medium text-foreground">
                        {activeSessionId
                          ? isConnecting
                            ? "Connecting..."
                            : isConnected
                            ? isAudioOnly
                              ? "Connected (audio only)"
                              : "Connected"
                            : "Waiting for student..."
                          : "No Active Session"}
                      </p>
                      <p className="text-muted-foreground">
                        {activeSessionId
                          ? activeSessionWindowStatus?.canStart
                            ? "Student will appear here once connected"
                            : activeSessionWindowStatus?.message || "Session unavailable"
                          : "Start a session from the upcoming list"}
                      </p>
                    </div>
                  )}
                  
                  {/* Self view */}
                  <div className="absolute bottom-4 right-4 h-32 w-44 bg-secondary rounded-lg flex items-center justify-center overflow-hidden shadow-lg border border-border">
                    {localStream && !isVideoOff && !isAudioOnly ? (
                      <video
                        ref={localVideoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover"
                        style={{ transform: 'scaleX(-1)' }}
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center">
                        {isVideoOff ? (
                          <VideoOff className="h-8 w-8 text-muted-foreground" />
                        ) : (
                          <span className="text-muted-foreground text-sm">Your camera</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Connection status */}
                  {activeSessionId && (
                    <div className="absolute top-4 left-4">
                      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${
                        isConnected ? 'bg-success/20 text-success' : 'bg-warning/20 text-warning'
                      }`}>
                        <div className={`h-2 w-2 rounded-full ${
                          isConnected ? 'bg-success' : 'bg-warning animate-pulse'
                        }`} />
                        <span className="text-sm font-medium">
                          {isConnected
                            ? isAudioOnly
                              ? "Connected (audio)"
                              : "Connected"
                            : isSignalingReady
                            ? "Waiting..."
                            : "Preparing..."}
                        </span>
                      </div>
                    </div>
                  )}

                  {isConnected && remainingSeconds !== null && (
                    <div className="absolute top-4 right-4">
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary/80 text-foreground border border-border">
                        <Clock className="h-4 w-4" />
                        <span className="text-sm font-medium">
                          {formatCallDuration(remainingSeconds)} left
                        </span>
                      </div>
                    </div>
                  )}
                </div>
                
                {/* Controls */}
                <div className="flex items-center justify-center gap-4 mt-4">
                  <Button
                    variant={isMuted ? "destructive" : "outline"}
                    size="lg"
                    className="rounded-full h-14 w-14"
                    onClick={handleToggleMute}
                    disabled={!localStream}
                  >
                    {isMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
                  </Button>
                  <Button
                    variant={isVideoOff ? "destructive" : "outline"}
                    size="lg"
                    className="rounded-full h-14 w-14"
                    onClick={handleToggleVideo}
                    disabled={!localStream}
                  >
                    {isVideoOff ? <VideoOff className="h-6 w-6" /> : <Video className="h-6 w-6" />}
                  </Button>
                  {activeSessionId && (
                    <Button
                      variant="destructive"
                      size="lg"
                      className="rounded-full h-14 w-14"
                      onClick={handleEndCall}
                    >
                      <Phone className="h-6 w-6 rotate-[135deg]" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Upcoming Sessions */}
            <Card variant="glass">
              <CardHeader>
                <CardTitle className="text-lg">Upcoming Online Sessions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {isLoading ? (
                    <p className="text-sm text-muted-foreground">Loading sessions...</p>
                  ) : upcomingSessions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No upcoming online session was found.
                    </p>
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
                          className="p-4 rounded-xl bg-secondary/30 space-y-2"
                        >
                          <p className="font-medium text-foreground">
                            {session.student?.profile?.full_name ||
                              session.student?.email?.split("@")[0] ||
                              `Student #${String(session.id).slice(-4)}`}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {session.scheduled_at
                              ? `${format(new Date(session.scheduled_at), "MMM d, yyyy")} at ${format(new Date(session.scheduled_at), "h:mm a")}`
                              : "TBD"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {callWindow.canStart
                              ? "Call ready"
                              : callWindow.message}
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            <Button
                              size="sm"
                              className="w-full gap-2"
                              onClick={() => handleStartSession(sessionId, "video")}
                              disabled={
                                isBusyWithOtherCall ||
                                isStarting ||
                                !callWindow.canStart
                              }
                            >
                              {isStarting || (isActive && isConnected) ? (
                                <>
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  {isConnected ? "In Session" : "Starting..."}
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
                                !callWindow.canStart
                              }
                            >
                              <Mic className="h-4 w-4" />
                              Audio
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
};

export default CounselorVideo;
