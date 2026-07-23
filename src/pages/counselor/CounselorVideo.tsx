import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Users,
  FileText,
  Clock,
  MapPin,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Phone,
  FlipHorizontal,
  RefreshCw,
  Loader2,
  WifiOff,
} from "lucide-react";
import { counselorNavItems } from "@/config/counselorNavItems";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useScreenWakeLock } from "@/hooks/useScreenWakeLock";
import { api, getApiErrorMessage } from "@/lib/api";
import { Appointment } from "@/hooks/useChatSession";
import { AnonymousModeIndicator } from "@/components/privacy/AnonymousModeIndicator";
import {
  isAnonymousIdentityMaskedFromViewer,
  resolveCounselorStudentDisplayName,
} from "@/lib/anonymousMode";
import { cn } from "@/lib/utils";
import {
  formatCallDuration,
  getVideoCallWindowStatus,
  isAppointmentAudioOnly,
  isVideoEnabledAppointment,
  effectiveWebRtcCallMode,
  normalizeVideoCallDuration,
  getAppointmentWhereLabel,
} from "@/lib/videoCall";
import { toast } from "sonner";
import { format } from "date-fns";
import { startCallRingtone, stopCallRingtone, warmCallRingtone } from "@/lib/sounds/notificationSoundManager";
import { signalIncomingCallWake } from "@/lib/incomingCallRealtime";
import { CHAT_INCOMING_DIGEST_EVENT, CHAT_ANONYMITY_SYNC_EVENT } from "@/lib/chatRealtimeEvents";
import { IncomingCallOverlay } from "@/components/call/IncomingCallOverlay";

const getParticipantName = (participant: any, fallback: string) =>
  (participant as { profile?: { full_name?: string }, full_name?: string, email?: string })?.profile?.full_name ||
  (participant as { profile?: { full_name?: string }, full_name?: string, email?: string })?.full_name ||
  (participant as { profile?: { full_name?: string }, full_name?: string, email?: string })?.email?.split("@")[0] ||
  fallback;

const getInitials = (value: string) =>
  value
    .split(" ")
    .map((item) => item[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

const formatScheduleLabel = (scheduledAt?: string | null): string => {
  if (!scheduledAt) return "TBD";
  try {
    const d = new Date(scheduledAt);
    if (!isFinite(d.getTime())) return "TBD";
    return format(d, "MMM d, yyyy h:mm a");
  } catch {
    return "TBD";
  }
};

const isMobileOrTablet = () =>
  typeof navigator !== "undefined" &&
  (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)));

const CounselorVideo = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const autoStartedRef = useRef(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [pendingSessionStartId, setPendingSessionStartId] = useState<string | null>(null);
  const [pendingCallMode, setPendingCallMode] = useState<"video" | "audio">("video");
  const [outgoingCallMode, setOutgoingCallMode] = useState<"video" | "audio" | null>(null);
  const [upcomingSessions, setUpcomingSessions] = useState<Appointment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [authorizedDurationMinutes, setAuthorizedDurationMinutes] = useState<number | null>(null);
  const [isOnline, setIsOnline] = useState(
    () => (typeof navigator === "undefined" ? true : navigator.onLine)
  );
  const [rejoinSecondsLeft, setRejoinSecondsLeft] = useState<number | null>(null);
  const [isRejoining, setIsRejoining] = useState(false);
  const [videoFit, setVideoFit] = useState<"cover" | "contain">("cover");
  const [counselingSessionId, setCounselingSessionId] = useState<number | null>(null);
  const [noteText, setNoteText] = useState<string>("");
  const [lastSavedText, setLastSavedText] = useState<string>("");
  const [isSavingNote, setIsSavingNote] = useState<boolean>(false);
  const [noteSaveError, setNoteSaveError] = useState<string | null>(null);
  const { user } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split('@')[0] || "Counselor";
  const requestedAppointmentId = useMemo(() => {
    const parsed = Number(searchParams.get("appointment_id"));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [searchParams]);
  const shouldAutostart = searchParams.get("autostart") === "1";

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
    isDisconnected,
    rejoinDeadline,
    localVideoRef,
    remoteVideoRef,
    startCall,
    startAudioCall,
    endCall,
    rejoinCall,
    toggleMute,
    toggleVideo,
    flipCamera,
    acceptIncomingCall,
    rejectIncomingCall,
  } = useWebRTC(activeSessionId || "", String(user?.id || ""));

  const isMobile = isMobileOrTablet();

  useScreenWakeLock(Boolean(localStream) || isConnecting || isConnected);

  const incomingRingVibratedRef = useRef(false);

  useEffect(() => {
    warmCallRingtone();
  }, []);

  useEffect(() => {
    if (!isIncomingCall) {
      incomingRingVibratedRef.current = false;
      stopCallRingtone();
      return;
    }
    startCallRingtone(incomingAudioOnly ? "audio" : "video");
    if (!incomingRingVibratedRef.current) {
      incomingRingVibratedRef.current = true;
      try {
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          navigator.vibrate([300, 100, 300]);
        }
      } catch {
        /* ignore */
      }
    }
    return () => {
      stopCallRingtone();
    };
  }, [isIncomingCall, incomingAudioOnly]);

  // Ringback for the CALLER: audible/looping from the moment we place the call until the
  // other side answers, declines, we cancel, or it times out. `localStream` stays null for
  // the caller until the callee accepts (media is only acquired then), so
  // isConnecting && !localStream precisely brackets "still ringing, nobody's answered yet."
  useEffect(() => {
    const isRingingOut = isConnecting && !isIncomingCall && !localStream;
    if (!isRingingOut) {
      stopCallRingtone();
      return;
    }
    startCallRingtone(outgoingCallMode === "audio" ? "audio" : "video");
    return () => {
      stopCallRingtone();
    };
  }, [isConnecting, isIncomingCall, localStream, outgoingCallMode]);

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

  const loadSessions = useCallback(async () => {
    try {
      setIsLoading(true);
      const appointments = await api.getAppointments();
      const videoAppointments = appointments
        .filter((apt: Appointment) => {
          if (!apt?.scheduled_at) return false;
          if (!isVideoEnabledAppointment(apt.notes)) return false;
          const st = String(apt.status || "").toLowerCase();
          if (!(st === "scheduled" || st === "confirmed")) return false;
          const callWindow = getVideoCallWindowStatus(
            apt.scheduled_at,
            apt.duration_minutes
          );
          return !callWindow.isExpired;
        })
        .sort(
          (a: Appointment, b: Appointment) =>
            new Date(a.scheduled_at || 0).getTime() - new Date(b.scheduled_at || 0).getTime()
        )
        .slice(0, 5);

      setUpcomingSessions(videoAppointments);

      if (videoAppointments.length === 0) {
        setActiveSessionId(null);
        return;
      }

      const requestedSession =
        requestedAppointmentId !== null
          ? videoAppointments.find((item: Appointment) => Number(item.id) === requestedAppointmentId)
          : null;

      setActiveSessionId((previous) =>
        previous && videoAppointments.some((item: Appointment) => String(item.id) === previous)
          ? previous
          : requestedSession
          ? String(requestedSession.id)
          : String(videoAppointments[0].id)
      );
    } catch (err: unknown) {
      if (import.meta.env.DEV) {
        console.error("Failed to load sessions:", err);
      }
      toast.error("Failed to load upcoming sessions");
    } finally {
      setIsLoading(false);
    }
  }, [requestedAppointmentId]);

  useEffect(() => {
    if (user) {
      void loadSessions();
    }
  }, [loadSessions, user]);

  useEffect(() => {
    const handleRefresh = () => {
      void loadSessions();
    };
    window.addEventListener(CHAT_INCOMING_DIGEST_EVENT as any, handleRefresh);
    window.addEventListener(CHAT_ANONYMITY_SYNC_EVENT as any, handleRefresh);
    return () => {
      window.removeEventListener(CHAT_INCOMING_DIGEST_EVENT as any, handleRefresh);
      window.removeEventListener(CHAT_ANONYMITY_SYNC_EVENT as any, handleRefresh);
    };
  }, [loadSessions]);

  const handleToggleMute = () => {
    toggleMute();
    setIsMuted((previous) => !previous);
  };

  const handleAcceptIncomingCall = () => {
    void acceptIncomingCall();
  };

  const handleRejectIncomingCall = () => {
    void rejectIncomingCall();
  };

  const handleRejoinCall = useCallback(async () => {
    if (!rejoinDeadline || Date.now() > rejoinDeadline) {
      toast.error("Rejoin window has expired. Please start a new session.");
      return;
    }
    setIsRejoining(true);
    try {
      const success = await rejoinCall();
      if (success) {
        toast.success("Rejoined the session successfully");
      }
    } catch {
      toast.error("Failed to rejoin session. You can try again.");
    } finally {
      setIsRejoining(false);
    }
  }, [rejoinCall, rejoinDeadline]);

  const activeSession = useMemo(
    () => upcomingSessions.find((session) => String(session.id) === activeSessionId),
    [activeSessionId, upcomingSessions]
  );

  const activeSessionAudioOnly = useMemo(
    () => isAppointmentAudioOnly(activeSession ?? null),
    [activeSession]
  );

  const handleToggleVideo = () => {
    if (activeSessionAudioOnly) {
      toast.message("This session is audio-only.");
      return;
    }
    void toggleVideo();
  };

  const requestedMode = useMemo((): "video" | "audio" => {
    const rawMode = searchParams.get("mode");
    if (rawMode === "audio") {
      return "audio";
    }
    if (rawMode === "video") {
      return activeSession && effectiveWebRtcCallMode(activeSession) === "audio"
        ? "audio"
        : "video";
    }
    return activeSession ? effectiveWebRtcCallMode(activeSession) : "video";
  }, [searchParams, activeSession]);

  const loadActiveSessionNote = useCallback(async () => {
    if (!activeSession) return;
    try {
      const payload = await api.getSessions({ status: 'active', limit: 50 });
      const sessionsList = Array.isArray(payload) ? payload : (Array.isArray(payload?.data) ? payload.data : []);
      const matched = sessionsList.find(
        (s: any) =>
          s.session_type === 'video' &&
          Number(s.student_id) === Number(activeSession.student_id) &&
          Number(s.counselor_id) === Number(activeSession.counselor_id)
      );
      if (matched) {
        const sId = Number(matched.id);
        setCounselingSessionId(sId);
        const initialNotes = typeof matched.notes === 'string' ? matched.notes : '';
        setNoteText(initialNotes);
        setLastSavedText(initialNotes);
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error("Failed to load active session notes:", err);
    }
  }, [activeSession]);

  useEffect(() => {
    if (isConnected && activeSession) {
      void loadActiveSessionNote();
    } else {
      setCounselingSessionId(null);
      setNoteText("");
      setLastSavedText("");
    }
  }, [isConnected, activeSession, loadActiveSessionNote]);

  useEffect(() => {
    if (counselingSessionId === null) return;
    if (noteText === lastSavedText) return;

    const delay = 1500;
    const timer = setTimeout(async () => {
      try {
        setIsSavingNote(true);
        setNoteSaveError(null);
        await api.updateSessionNote(counselingSessionId, noteText);
        setLastSavedText(noteText);
      } catch (err) {
        if (import.meta.env.DEV) console.error("Failed to auto-save notes:", err);
        setNoteSaveError("Failed to save note");
      } finally {
        setIsSavingNote(false);
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [noteText, lastSavedText, counselingSessionId]);

  useEffect(() => {
    if (upcomingSessions.length === 0) {
      if (activeSessionId !== null) {
        setActiveSessionId(null);
      }
      return;
    }

    if (!activeSessionId || !upcomingSessions.some((session) => String(session.id) === activeSessionId)) {
      setActiveSessionId(String(upcomingSessions[0].id));
    }
  }, [activeSessionId, upcomingSessions]);

  const activeSessionWindowStatus = useMemo(() => {
    if (!activeSession) return null;
    return getVideoCallWindowStatus(
      activeSession.scheduled_at,
      activeSession.duration_minutes
    );
  }, [activeSession]);

  const handleStartSession = useCallback(
    (sessionId: string, mode: "video" | "audio" = "video") => {
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

      const resolvedMode = isAppointmentAudioOnly(session) ? "audio" : mode;

      setActiveSessionId(sessionId);
      setPendingCallMode(resolvedMode);
      setOutgoingCallMode(resolvedMode);
      setPendingSessionStartId(sessionId);
    },
    [activeSessionId, isOnline, localStream, upcomingSessions]
  );

  const removeSessionFromQueue = useCallback((sessionIdToRemove: string) => {
    setUpcomingSessions((previous) =>
      previous.filter((session) => String(session.id) !== sessionIdToRemove)
    );
  }, []);

  const finalizeEndedSession = useCallback(
    async (appointmentIdToEnd: string) => {
      try {
        const result = await api.endVideoCall(appointmentIdToEnd);
        if (
          result?.appointment_status === "completed" ||
          result?.status === "completed"
        ) {
          removeSessionFromQueue(appointmentIdToEnd);
        }
      } catch {
        // Best effort: the local call has already been closed.
      } finally {
        void loadSessions();
      }
    },
    [loadSessions, removeSessionFromQueue]
  );

  const handleEndCall = async () => {
    const sessionIdToEnd = activeSessionId;
    const activeRow = upcomingSessions.find((item) => String(item.id) === sessionIdToEnd);
    const studentId = Number(activeRow?.student_id);

    endCall();
    setIsMuted(false);
    setPendingSessionStartId(null);
    setPendingCallMode("video");
    setOutgoingCallMode(null);
    setAuthorizedDurationMinutes(null);

    if (studentId && Number.isFinite(studentId) && studentId > 0 && sessionIdToEnd) {
      signalIncomingCallWake(studentId, {
        appointment_id: Number(sessionIdToEnd),
        status: "cancelled",
      });
    }

    if (sessionIdToEnd) {
      await finalizeEndedSession(sessionIdToEnd);
    }

    toast.info("Session ended");
  };

  useEffect(() => {
    setAuthorizedDurationMinutes(null);
    setPendingCallMode("video");
    setOutgoingCallMode(null);
  }, [activeSessionId]);

  useEffect(() => {
    if (!isDisconnected || !rejoinDeadline) {
      setRejoinSecondsLeft(null);
      return;
    }

    const updateTimer = () => {
      const secondsLeft = Math.max(0, Math.ceil((rejoinDeadline - Date.now()) / 1000));
      setRejoinSecondsLeft(secondsLeft);

      if (secondsLeft === 0) {
        return true;
      }
      return false;
    };

    updateTimer();
    const timer = window.setInterval(() => {
      if (updateTimer()) {
        window.clearInterval(timer);
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isDisconnected, rejoinDeadline]);

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
      const callType = pendingCallMode === "audio" ? "audio" : "video";
      const activeRow = upcomingSessions.find((item) => String(item.id) === activeSessionId);
      const studentId = Number(activeRow?.student_id);

      try {
        const [authorization, started] = await Promise.all([
          api.authorizeVideoCall(activeSessionId, { call_type: callType }),
          pendingCallMode === "audio" ? startAudioCall() : startCall(),
        ]);
        const serverDuration = Number(authorization?.max_duration_minutes);
        setAuthorizedDurationMinutes(
          Number.isFinite(serverDuration) ? serverDuration : null
        );
        if (authorization?.session_id) {
          setCounselingSessionId(Number(authorization.session_id));
        }

        if (!cancelled && Number.isFinite(studentId) && studentId > 0) {
          signalIncomingCallWake(studentId, {
            appointment_id: Number(activeSessionId),
            call_type: callType,
            caller_role: "counselor",
            status: "pending",
          });
        }

        if (cancelled) return;

        if (started) {
          toast.success(
            pendingCallMode === "audio"
              ? "Audio session started - waiting for student to connect"
              : "Session started - waiting for student to connect"
          );
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const errMsg = getApiErrorMessage(err, "Failed to start session");
          toast.error(errMsg);

          if (
            errMsg.toLowerCase().includes("unavailable") ||
            errMsg.toLowerCase().includes("500") ||
            errMsg.toLowerCase().includes("internal server error")
          ) {
            toast.info("You can try refreshing the page or contact support if the issue persists.");
          }

          setPendingSessionStartId(null);
        }
        return;
      }

      setPendingSessionStartId(null);
      setPendingCallMode("video");
    };

    void beginSession();

    return () => {
      cancelled = true;
    };
  }, [
    activeSessionId,
    isOnline,
    isSignalingReady,
    pendingCallMode,
    pendingSessionStartId,
    startAudioCall,
    startCall,
    upcomingSessions,
  ]);

  const isStartingActiveSession = Boolean(
    activeSessionId && pendingSessionStartId === activeSessionId
  );

  useEffect(() => {
    if (!shouldAutostart) {
      autoStartedRef.current = false;
      return;
    }

    if (autoStartedRef.current) return;
    if (!activeSession || !activeSessionId) return;
    if (localStream || isConnecting || isStartingActiveSession) return;
    if (!isSignalingReady || !isOnline) return;
    // The other side is already calling us — let the IncomingCallOverlay's
    // acceptIncomingCall() handle it instead of placing our own outgoing call
    // on top of it (see the overlay render below for why that collides).
    if (isIncomingCall) return;

    const callWindow = getVideoCallWindowStatus(
      activeSession.scheduled_at,
      activeSession.duration_minutes
    );

    if (!callWindow.canStart) {
      return;
    }

    autoStartedRef.current = true;
    handleStartSession(activeSessionId, requestedMode);

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("autostart");
    setSearchParams(nextParams, { replace: true });
  }, [
    activeSession,
    activeSessionId,
    handleStartSession,
    isConnecting,
    isIncomingCall,
    isOnline,
    isSignalingReady,
    isStartingActiveSession,
    localStream,
    requestedMode,
    searchParams,
    setSearchParams,
    shouldAutostart,
  ]);

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
        setPendingSessionStartId(null);
        setAuthorizedDurationMinutes(null);

        if (sessionIdToEnd) {
          void finalizeEndedSession(sessionIdToEnd);
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
  }, [activeSession, authorizedDurationMinutes, endCall, finalizeEndedSession, isConnected, localStream]);

  const remoteParticipantName = useMemo(
    () =>
      resolveCounselorStudentDisplayName(
        activeSession,
        getParticipantName(activeSession?.student, "Student")
      ),
    [activeSession]
  );
  const isVideoOff = Boolean(localStream && !isAudioOnly && !isLocalVideoEnabled);
  const showRemoteVideo = Boolean(remoteStream && remoteHasVideo);

  const statusMessage = useMemo(() => {
    if (!activeSession) {
      return "Choose a scheduled online session to open the room.";
    }
    if (!isOnline) {
      return "You are offline. Reconnect to continue the session.";
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
        ? !remoteHasVideo
          ? `${remoteParticipantName} joined without video. Audio is still live.`
          : isAudioOnly
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
    isIncomingCall,
    incomingAudioOnly,
    error,
    isOnline,
    isStartingActiveSession,
    localStream,
    notice,
    pendingCallMode,
    remoteHasVideo,
    remoteParticipantName,
    remoteStream,
  ]);

  const remoteVideoStatusMessage =
    remoteStream && !remoteHasVideo
      ? `${remoteParticipantName} is connected in audio mode or has camera sharing turned off. Audio is still live.`
      : statusMessage;
  const counselorVisibilityLabel = !localStream
    ? "Camera preview unavailable"
    : isAudioOnly
    ? "Audio only"
    : isVideoOff
    ? "Hidden from student"
    : "Visible to student";
  const canEndActiveSession = Boolean(
    activeSessionId && (localStream || isConnected || isConnecting || isStartingActiveSession)
  );

  return (
    <div className="h-[100dvh] min-h-[100svh] overflow-hidden bg-background">
      {/* Render incoming call overlay directly on the call page so Accept goes
          through acceptIncomingCall() rather than the simultaneous-call path. */}
      {isIncomingCall && activeSession && (
        <IncomingCallOverlay
          call={{
            id: Number(activeSessionId),
            appointment_id: Number(activeSessionId),
            callerName: remoteParticipantName,
            is_anonymous: false,
            call_type: incomingAudioOnly ? "audio" : "video",
            scheduled_at: activeSession.scheduled_at ?? null,
          }}
          busy={false}
          onAccept={handleAcceptIncomingCall}
          onDecline={handleRejectIncomingCall}
        />
      )}
      <DashboardSidebar
        items={counselorNavItems}
        userType="counselor"
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        className={cn(isConnected && "hidden lg:hidden")}
      />

      <div className={cn(
        "h-full min-w-0 transition-all duration-500",
        isConnected ? "lg:pl-0" : "lg:pl-72 pl-0"
      )}>
        {!isConnected && (
          <DashboardHeader
            title="Video Sessions"
            onMenuClick={() => setSidebarOpen(true)}
          />
        )}

        <main className={cn(
          "transition-all duration-500",
          isConnected ? "h-full p-0" : "mx-auto h-[calc(100dvh-64px)] max-w-full p-3 sm:h-[calc(100dvh-80px)] sm:p-4 lg:p-6"
        )}>
          <div className={cn(
            "grid grid-cols-1 gap-6 transition-all duration-500",
            isConnected 
              ? "xl:grid-cols-[1fr_380px] h-full"
              : localStream 
                ? "xl:grid-cols-[minmax(0,1fr)_320px]"
                : "xl:grid-cols-[minmax(0,2fr)_360px]"
          )}>
            <Card
              variant="glass"
              className={cn(
                "overflow-hidden transition-all duration-500",
                isConnected ? "h-full border-primary/20 shadow-2xl" : "min-h-[50svh] sm:min-h-[60svh] xl:h-[calc(100dvh-160px)]"
              )}
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

                {isDisconnected && (
                  <Alert className="border-amber-500/40 bg-amber-500/5 text-foreground">
                    <WifiOff className="h-4 w-4 text-amber-500" />
                    <AlertTitle>Connection lost</AlertTitle>
                    <AlertDescription className="mt-2 flex flex-wrap items-center gap-3">
                      <span className="text-sm">
                        {rejoinSecondsLeft !== null && rejoinSecondsLeft > 0
                          ? `You can rejoin within ${formatCallDuration(rejoinSecondsLeft)}`
                          : "Rejoin window has expired"}
                      </span>
                      <Button
                        size="sm"
                        onClick={handleRejoinCall}
                        disabled={isRejoining || !rejoinSecondsLeft || rejoinSecondsLeft <= 0}
                      >
                        {isRejoining ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Rejoining...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="mr-2 h-4 w-4" />
                            Rejoin Session
                          </>
                        )}
                      </Button>
                    </AlertDescription>
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
                      <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2">
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
                          {activeSession && (
                            <Badge
                              variant="outline"
                              className="rounded-full px-3 py-1 max-w-[min(100%,280px)] gap-1"
                              title={getAppointmentWhereLabel(activeSession.notes)}
                            >
                              <MapPin className="h-3.5 w-3.5 shrink-0 opacity-80" />
                              <span className="truncate">{getAppointmentWhereLabel(activeSession.notes)}</span>
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
                            className={cn(
                              showRemoteVideo
                                ? cn("h-full w-full opacity-100", videoFit === "cover" ? "object-cover" : "object-contain")
                                : "absolute h-full w-full object-cover opacity-0 pointer-events-none"
                            )}
                          />
                        ) : null}

                        {!showRemoteVideo && (
                          <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-6 text-center">
                            <div className="mb-5 flex h-24 w-24 items-center justify-center rounded-full bg-primary/12 text-3xl font-semibold text-primary shadow-inner">
                              {activeSession ? getInitials(remoteParticipantName) : "--"}
                            </div>
                            <p className="text-2xl font-semibold text-foreground">
                              {activeSession ? remoteParticipantName : "No session selected"}
                            </p>
                            <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                              {remoteVideoStatusMessage}
                            </p>
                            {isConnecting || isStartingActiveSession ? (
                              <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/80 px-4 py-2 text-sm text-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Connecting securely
                              </div>
                            ) : null}
                          </div>
                        )}

                        <div className="absolute left-3 top-3 flex items-center gap-2">
                          <Badge className="rounded-full bg-background/85 px-3 py-1 text-foreground shadow-sm">
                            {remoteParticipantName}{remoteSpeaking ? " • speaking" : ""}
                          </Badge>
                          {isConnected && showRemoteVideo && (
                            isMobile ? (
                              <Button
                                size="icon"
                                variant="secondary"
                                className="h-7 w-7 rounded-full bg-background/85 text-foreground shadow-sm"
                                onClick={() => void flipCamera()}
                                disabled={isAudioOnly}
                                title="Flip camera"
                              >
                                <FlipHorizontal className="h-3.5 w-3.5" />
                              </Button>
                            ) : (
                              <Button
                                size="icon"
                                variant="secondary"
                                className="h-7 w-7 rounded-full bg-background/85 text-foreground shadow-sm"
                                onClick={() => setVideoFit(prev => prev === "cover" ? "contain" : "cover")}
                                title={videoFit === "cover" ? "Fit to frame" : "Fill frame"}
                              >
                                <RefreshCw className={cn("h-3.5 w-3.5", videoFit === "contain" && "rotate-45")} />
                              </Button>
                            )
                          )}
                        </div>

                        <div className="absolute bottom-4 right-4 w-24 overflow-hidden rounded-[20px] border border-white/25 bg-slate-950/80 shadow-2xl shadow-slate-950/40 sm:w-32 md:w-40 lg:w-48">
                          <div className="pointer-events-none absolute left-2 top-2 z-10">
                            <Badge
                              variant="secondary"
                              className="rounded-full bg-black/55 px-2.5 py-0.5 text-[11px] text-white"
                            >
                              You
                              {localSpeaking ? " • speaking" : ""}
                            </Badge>
                          </div>

                          <div className="aspect-video w-full">
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
                                  {counselorVisibilityLabel}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
                  <Button
                    variant={isMuted ? "destructive" : "outline"}
                    size="lg"
                    className="h-11 w-11 sm:h-14 sm:w-14 rounded-full"
                    onClick={handleToggleMute}
                    disabled={!localStream}
                  >
                    {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                  </Button>
                  <Button
                    variant={isVideoOff ? "destructive" : "outline"}
                    size="lg"
                    className="h-11 w-11 sm:h-14 sm:w-14 rounded-full"
                    onClick={handleToggleVideo}
                    disabled={!localStream || activeSessionAudioOnly}
                  >
                    {isVideoOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
                  </Button>
                  {canEndActiveSession && (
                    <Button
                      variant="destructive"
                      size="lg"
                      className="h-11 sm:h-14 rounded-full px-4 sm:px-6 text-sm"
                      onClick={handleEndCall}
                    >
                      <Phone className="mr-2 h-5 w-5 rotate-[135deg]" />
                      End session
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {isConnected && (
              <Card variant="glass" className="h-full flex flex-col overflow-hidden border-primary/10">
                <CardHeader className="p-4 border-b border-border/40">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" />
                    Session Workspace
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 overflow-y-auto p-4 space-y-5">
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Student</p>
                    <div className="flex items-center gap-3 p-3 rounded-2xl bg-primary/5 border border-primary/10">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                        {getInitials(remoteParticipantName)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{remoteParticipantName}</p>
                        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <MapPin className="h-3 w-3 shrink-0" />
                          <span className="truncate">
                            {activeSession ? getAppointmentWhereLabel(activeSession.notes) : "Session"}
                          </span>
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Session Intel</p>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs p-2.5 rounded-xl bg-secondary/30">
                        <span className="text-muted-foreground">Status</span>
                        <span className="font-medium text-emerald-500">Connected</span>
                      </div>
                      <div className="flex items-center justify-between text-xs p-2.5 rounded-xl bg-secondary/30">
                        <span className="text-muted-foreground">Mode</span>
                        <span className="font-medium">{isAudioOnly ? "Audio only" : "Video + Audio"}</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 flex-1 flex flex-col">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                      Session Notes
                      <span className="normal-case font-normal text-muted-foreground/60">
                        {isSavingNote ? (
                          <span className="flex items-center gap-1">
                            <Loader2 className="h-3 w-3 animate-spin text-primary" />
                            Auto-saving...
                          </span>
                        ) : noteSaveError ? (
                          <span className="text-destructive">{noteSaveError}</span>
                        ) : noteText !== lastSavedText && noteText !== "" ? (
                          <span>Unsaved changes...</span>
                        ) : noteText === "" && lastSavedText === "" ? (
                          <span>Ready</span>
                        ) : (
                          <span className="text-emerald-500 font-semibold">Auto-saved</span>
                        )}
                      </span>
                    </p>
                    <textarea
                      className="w-full flex-1 min-h-[200px] p-4 rounded-2xl bg-secondary/20 border border-border/40 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
                      placeholder="Type your session observations here..."
                      value={noteText}
                      maxLength={5000}
                      onChange={(e) => setNoteText(e.target.value)}
                    />
                    <p className={`text-[10px] text-right tabular-nums ${noteText.length > 4500 ? (noteText.length >= 5000 ? "text-destructive" : "text-warning") : "text-muted-foreground/50"}`}>
                      {noteText.length}/5000
                    </p>
                  </div>
                  
                  <div className="pt-2">
                    <Button variant="outline" className="w-full justify-start gap-2 h-11 rounded-xl text-xs" onClick={() => navigate("/counselor/notes")}>
                      <FileText className="h-4 w-4" />
                      View Past Notes
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {!isConnected && (
              <Card variant="glass" className="overflow-hidden h-fit max-h-[50vh] xl:max-h-none overflow-y-auto">
                <CardHeader className="p-4 space-y-2">
                  <CardTitle className="text-lg">Upcoming Online Sessions</CardTitle>
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    Start the room from the session you want to host. The student appears in the main stage.
                  </p>
                </CardHeader>
                <CardContent className="p-4 pt-0 space-y-3">
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
                      <p className="mt-2 text-xs text-muted-foreground">
                        Online sessions appear here up to 15 minutes before the appointment time.
                      </p>
                    </div>
                  ) : (
                    upcomingSessions.map((session) => {
                      const sessionId = String(session.id);
                      const isActive = activeSessionId === sessionId;
                      const sessionAudioOnly = isAppointmentAudioOnly(session);
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
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-foreground truncate">
                                {resolveCounselorStudentDisplayName(
                                  session,
                                  getParticipantName(
                                    session.student,
                                    `Student #${String(session.id).slice(-4)}`
                                  )
                                )}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {formatScheduleLabel(session.scheduled_at)}
                              </p>
                              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                                <MapPin className="h-3.5 w-3.5 shrink-0" />
                                <span className="line-clamp-2">{getAppointmentWhereLabel(session.notes)}</span>
                              </p>
                              {isAnonymousIdentityMaskedFromViewer(session) && (
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <AnonymousModeIndicator variant="badge" audience="counselor" />
                                  <span className="text-[10px] font-medium text-muted-foreground">
                                    Audio only · identity hidden
                                  </span>
                                </div>
                              )}
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

                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <Button
                              size="sm"
                              className="w-full gap-1 h-8 text-[11px]"
                              onClick={() => handleStartSession(sessionId, "video")}
                              disabled={
                                sessionAudioOnly ||
                                isBusyWithOtherCall ||
                                isStarting ||
                                !callWindow.canStart ||
                                !isOnline ||
                                isIncomingCall
                              }
                            >
                              {isStarting && pendingCallMode === "video" ? (
                                <>
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  ...
                                </>
                              ) : isActive && isConnected ? (
                                "Live"
                              ) : (
                                "Video"
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full gap-1 h-8 text-[11px]"
                              onClick={() => handleStartSession(sessionId, "audio")}
                              disabled={
                                isBusyWithOtherCall ||
                                isStarting ||
                                !callWindow.canStart ||
                                !isOnline ||
                                isIncomingCall
                              }
                            >
                              {isStarting && pendingCallMode === "audio" ? (
                                "..."
                              ) : (
                                "Audio"
                              )}
                            </Button>
                          </div>
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

export default CounselorVideo;
