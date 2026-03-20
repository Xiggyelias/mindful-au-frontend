import { useCallback, useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  LayoutDashboard,
  MessageSquare,
  Calendar,
  Bot,
  Mic,
  Video,
  History,
  Heart,
  ArrowRightLeft,
  MicOff,
  VideoOff,
  Phone,
  Loader2,
  Clock,
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
  { label: "Dashboard", icon: LayoutDashboard, path: "/student/dashboard" },
  { label: "Chat", icon: MessageSquare, path: "/student/chat" },
  { label: "Appointments", icon: Calendar, path: "/student/appointments" },
  { label: "Referrals", icon: ArrowRightLeft, path: "/student/referrals" },
  { label: "AI Support", icon: Bot, path: "/student/ai-support" },
  { label: "Video Call", icon: Video, path: "/student/video-call" },
  { label: "Past Sessions", icon: History, path: "/student/history" },
  { label: "Wellness", icon: Heart, path: "/student/wellness" },
];

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
  const { user } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split('@')[0] || "Student";
  const requestedAppointmentId = useMemo(() => {
    const parsed = Number(searchParams.get("appointment_id"));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [searchParams]);
  const requestedCounselorId = useMemo(() => {
    const parsed = Number(searchParams.get("counselor_id"));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [searchParams]);
  const requestedMode = searchParams.get("mode") === "audio" ? "audio" : "video";
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
    const loadAppointments = async () => {
      try {
        setIsLoading(true);
        const appointments = await api.getAppointments();
        const availableNow = appointments
          .filter((apt: any) => {
            if (!apt.scheduled_at) return false;
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

        setUpcomingAppointments(availableNow);
        if (availableNow.length > 0) {
          const matchingRequestedAppointment =
            requestedAppointmentId !== null
              ? availableNow.find((apt: any) => Number(apt.id) === requestedAppointmentId)
              : null;
          const matchingRequestedCounselor =
            requestedCounselorId !== null
              ? availableNow.find((apt: any) => Number(apt.counselor_id) === requestedCounselorId)
              : null;

          setActiveAppointmentId((previous) => {
            if (previous && availableNow.some((apt: any) => String(apt.id) === previous)) {
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
        } else {
          setActiveAppointmentId(null);
        }
      } catch (err) {
        console.error("Failed to load appointments:", err);
        toast.error("Failed to load upcoming appointments");
      } finally {
        setIsLoading(false);
      }
    };

    if (user) {
      loadAppointments();
    }
  }, [requestedAppointmentId, requestedCounselorId, user]);

  const activeAppointment = useMemo(
    () => upcomingAppointments.find((apt) => String(apt.id) === activeAppointmentId),
    [activeAppointmentId, upcomingAppointments]
  );
  const activeWindowStatus = useMemo(() => {
    if (!activeAppointment) return null;
    return getVideoCallWindowStatus(
      activeAppointment.scheduled_at,
      activeAppointment.duration_minutes
    );
  }, [activeAppointment]);

  const handleToggleMute = () => {
    toggleMute();
    setIsMuted(!isMuted);
  };

  const handleToggleVideo = () => {
    toggleVideo();
    setIsVideoOff(!isVideoOff);
  };

  const handleStartCall = useCallback(async () => {
    if (!activeAppointmentId) {
      toast.error("Select an appointment to start a call");
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

    if (!isSignalingReady) {
      toast.error("Preparing secure call channel. Please try again in a moment.");
      return;
    }

    try {
      const authorization = await api.authorizeVideoCall(activeAppointmentId);
      const serverDuration = Number(authorization?.max_duration_minutes);
      setAuthorizedDurationMinutes(
        Number.isFinite(serverDuration) ? serverDuration : null
      );

      const started = await startCall();
      if (started) {
        toast.success("Call started - waiting for counselor to join");
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to start call");
    }
  }, [activeAppointment, activeAppointmentId, isSignalingReady, startCall]);

  const handleStartAudioCall = useCallback(async () => {
    if (!activeAppointmentId) {
      toast.error("Select an appointment to start a call");
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

    if (!isSignalingReady) {
      toast.error("Preparing secure call channel. Please try again in a moment.");
      return;
    }

    try {
      const authorization = await api.authorizeVideoCall(activeAppointmentId);
      const serverDuration = Number(authorization?.max_duration_minutes);
      setAuthorizedDurationMinutes(
        Number.isFinite(serverDuration) ? serverDuration : null
      );

      const started = await startAudioCall();
      if (started) {
        toast.success("Audio call started - waiting for counselor to join");
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to start audio call");
    }
  }, [activeAppointment, activeAppointmentId, isSignalingReady, startAudioCall]);

  const handleEndCall = () => {
    const appointmentIdToEnd = activeAppointmentId;
    endCall();
    setIsMuted(false);
    setIsVideoOff(false);
    setAuthorizedDurationMinutes(null);

    if (appointmentIdToEnd) {
      void api.endVideoCall(appointmentIdToEnd).catch(() => {
        // Best effort: call already ended locally.
      });
    }

    toast.info("Call ended");
  };

  useEffect(() => {
    setAuthorizedDurationMinutes(null);
  }, [activeAppointmentId]);

  useEffect(() => {
    if (!shouldAutostart) {
      autoStartedRef.current = false;
      return;
    }

    if (autoStartedRef.current) return;
    if (!activeAppointment || !activeAppointmentId) return;
    if (localStream || isConnecting) return;
    if (!isSignalingReady) return;

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
    isSignalingReady,
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

        if (appointmentIdToEnd) {
          void api.endVideoCall(appointmentIdToEnd).catch(() => {
            // Best effort: call already ended locally.
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
          <div className="grid gap-6 lg:grid-cols-3">
            <Card variant="glass" className="lg:col-span-2 h-[calc(100vh-200px)]">
              <CardContent className="h-full p-4 flex flex-col">
                <div className="flex-1 bg-secondary/30 rounded-xl flex items-center justify-center relative overflow-hidden">
                  {/* Remote video (full screen) */}
                  {remoteStream ? (
                    <video
                      ref={remoteVideoRef}
                      autoPlay
                      playsInline
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-center">
                      <div className="h-24 w-24 mx-auto rounded-full bg-info/20 flex items-center justify-center mb-4">
                        {isConnecting ? (
                          <Loader2 className="h-10 w-10 text-info animate-spin" />
                        ) : (
                          <span className="text-3xl font-bold text-info">
                            {activeAppointment
                              ? (activeAppointment.counselor?.profile?.full_name ||
                                  activeAppointment.counselor?.email ||
                                  "Counselor")
                                  .split(" ")
                                  .map((n: string) => n[0])
                                  .join("")
                                  .slice(0, 2)
                                  .toUpperCase()
                              : "--"}
                          </span>
                        )}
                      </div>
                      <p className="text-xl font-medium">
                        {activeAppointment
                          ? activeAppointment.counselor?.profile?.full_name ||
                            activeAppointment.counselor?.email?.split("@")[0] ||
                            "Counselor"
                          : "No Session Available Right Now"}
                      </p>
                      <p className="text-muted-foreground">
                        {!activeAppointment
                          ? "Video calls are available only at the scheduled meeting time."
                          : isConnecting
                          ? "Connecting..."
                          : isConnected
                          ? isAudioOnly
                            ? "Connected (audio only)"
                            : "Connected"
                          : localStream
                          ? "Waiting for counselor..."
                          : activeWindowStatus?.canStart
                          ? "Click 'Start Call' to begin"
                          : activeWindowStatus?.message || "Call unavailable"}
                      </p>
                      {activeAppointment?.scheduled_at && (
                        <p className="text-xs text-muted-foreground mt-2">
                          Scheduled {format(new Date(activeAppointment.scheduled_at), "MMM d, yyyy h:mm a")}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Self view (picture-in-picture) */}
                  <div className="absolute bottom-4 right-4 h-32 w-44 bg-secondary rounded-lg flex items-center justify-center overflow-hidden shadow-lg border border-border">
                    {localStream && !isVideoOff && !isAudioOnly ? (
                      <video
                        ref={localVideoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover mirror"
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

                  {/* Connection status indicator */}
                  {(isConnected || isConnecting) && (
                    <div className="absolute top-4 left-4">
                      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${
                        isConnected ? 'bg-success/20 text-success' : 'bg-warning/20 text-warning'
                      }`}>
                        <div className={`h-2 w-2 rounded-full ${
                          isConnected ? 'bg-success' : 'bg-warning animate-pulse'
                        }`} />
                        <span className="text-sm font-medium">
                          {isConnected ? 'Connected' : 'Connecting...'}
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

                  {!localStream ? (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="hero"
                        size="lg"
                        className="rounded-full h-14 px-6 gap-2"
                        onClick={handleStartCall}
                        disabled={
                          isConnecting ||
                          !activeAppointmentId ||
                          !isSignalingReady ||
                          !activeWindowStatus?.canStart
                        }
                      >
                        {isConnecting || !isSignalingReady ? (
                          <Loader2 className="h-6 w-6 animate-spin" />
                        ) : (
                          <Video className="h-6 w-6" />
                        )}
                        {isSignalingReady ? "Video Call" : "Preparing..."}
                      </Button>
                      <Button
                        variant="outline"
                        size="lg"
                        className="rounded-full h-14 px-6 gap-2"
                        onClick={handleStartAudioCall}
                        disabled={
                          isConnecting ||
                          !activeAppointmentId ||
                          !isSignalingReady ||
                          !activeWindowStatus?.canStart
                        }
                      >
                        {isConnecting || !isSignalingReady ? (
                          <Loader2 className="h-6 w-6 animate-spin" />
                        ) : (
                          <Mic className="h-6 w-6" />
                        )}
                        Audio Call
                      </Button>
                    </div>
                  ) : (
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

            <Card variant="glass">
              <CardHeader>
                <CardTitle className="text-lg">Upcoming Online Sessions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {isLoading ? (
                    <p className="text-sm text-muted-foreground">Loading appointments...</p>
                  ) : upcomingAppointments.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No upcoming online session was found.
                    </p>
                  ) : (
                    upcomingAppointments.map((apt) => {
                      const isActive = String(apt.id) === activeAppointmentId;
                      const callWindow = getVideoCallWindowStatus(
                        apt.scheduled_at,
                        apt.duration_minutes
                      );

                      return (
                        <div
                          key={apt.id}
                          className={`p-4 rounded-xl border transition-all ${
                            isActive
                              ? "border-primary/40 bg-primary/5"
                              : "border-transparent bg-secondary/30"
                          }`}
                        >
                          <p className="font-medium text-foreground">
                            {apt.counselor?.profile?.full_name ||
                              apt.counselor?.email?.split("@")[0] ||
                              "Counselor"}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {apt.scheduled_at
                              ? format(new Date(apt.scheduled_at), "MMM d, yyyy h:mm a")
                              : "TBD"}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {callWindow.canStart
                              ? "Call ready"
                              : callWindow.message}
                          </p>
                          <Button
                            size="sm"
                            className="w-full mt-3"
                            variant={isActive ? "default" : "outline"}
                            onClick={() => setActiveAppointmentId(String(apt.id))}
                            disabled={Boolean(localStream) && !isActive}
                          >
                            {isActive ? "Selected" : "Select"}
                          </Button>
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

export default StudentVideoCall;
