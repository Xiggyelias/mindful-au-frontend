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
  Check,
  Save,
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
import { deriveCallStatus } from "@/lib/callState";
import {
  api,
  getApiErrorMessage,
  VideoCallAuthorizationError,
  type VideoCallAuthorization,
} from "@/lib/api";
import { Appointment } from "@/hooks/useChatSession";
import { AnonymousModeIndicator } from "@/components/privacy/AnonymousModeIndicator";
import { CounselorPreSessionCard } from "@/components/assessment/CounselorPreSessionCard";
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
import {
  isAcceptedCallSignal,
  isTerminalCallSignal,
  logCallSignal,
  signalIncomingCallWake,
  type IncomingCallWakePayload,
} from "@/lib/incomingCallRealtime";
import { useIncomingCallWakeSubscription } from "@/hooks/useIncomingCalls";
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

const CounselorVideo = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const autoStartedRef = useRef(false);
  /** The pending start already handed to beginSession — guards against duplicate attempts. */
  const beganSessionStartRef = useRef<string | null>(null);
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
  const [isFlippingCamera, setIsFlippingCamera] = useState(false);
  const [counselingSessionId, setCounselingSessionId] = useState<number | null>(null);
  const [noteText, setNoteText] = useState<string>("");
  const [lastSavedText, setLastSavedText] = useState<string>("");
  const [isSavingNote, setIsSavingNote] = useState<boolean>(false);
  const [noteSaveError, setNoteSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
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
    canFlipCamera,
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

  useScreenWakeLock(Boolean(localStream) || isConnecting || isConnected);

  const incomingRingVibratedRef = useRef(false);

  useEffect(() => {
    warmCallRingtone();
  }, []);

  // Single owner of the call ringtone on this page. Two separate effects both calling the
  // shared start/stopCallRingtone() would fight — the ringback effect's stop() would silence
  // the incoming ring the moment isIncomingCall flipped true. Precedence, highest first:
  //   1. Incoming call ringing IN (receiver) — this must win.
  //   2. Ringing OUT / ringback (caller): still connecting, no media yet, nobody answered.
  //   3. Otherwise silent (idle or connected).
  useEffect(() => {
    if (isIncomingCall) {
      startCallRingtone(incomingAudioOnly ? "audio" : "video", "call-page");
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
        stopCallRingtone("call-page");
      };
    }

    incomingRingVibratedRef.current = false;

    // `localStream` stays null for the caller until the callee accepts (media is acquired
    // only then), so isConnecting && !localStream precisely brackets "still ringing out".
    const isRingingOut = isConnecting && !localStream;
    if (isRingingOut) {
      startCallRingtone(outgoingCallMode === "audio" ? "audio" : "video", "call-page");
      return () => {
        stopCallRingtone("call-page");
      };
    }

    stopCallRingtone("call-page");
  }, [isIncomingCall, incomingAudioOnly, isConnecting, localStream, outgoingCallMode]);

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

  // Read inside the start-session effect so a background list refresh does not re-trigger it
  // (the effect places a real outgoing call; it must run exactly once per start request).
  const upcomingSessionsRef = useRef<Appointment[]>([]);
  const hasLoadedSessionsOnceRef = useRef(false);
  useEffect(() => {
    upcomingSessionsRef.current = upcomingSessions;
  }, [upcomingSessions]);

  const loadSessions = useCallback(async () => {
    try {
      if (!hasLoadedSessionsOnceRef.current) {
        setIsLoading(true);
      }
      const appointments = await api.getAppointments();
      const videoAppointments = appointments
        .filter((apt: Appointment) => {
          if (!apt?.scheduled_at) return false;
          if (!isVideoEnabledAppointment(apt.notes)) return false;
          const st = String(apt.status || "").toLowerCase();
          if (!(st === "scheduled" || st === "confirmed")) return false;
          const callWindow = getVideoCallWindowStatus(
            apt.scheduled_at,
            apt.duration_minutes,
            undefined,
            Boolean(apt.is_emergency)
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
      hasLoadedSessionsOnceRef.current = true;
      setIsLoading(false);
    }
  }, [requestedAppointmentId]);

  useEffect(() => {
    if (user?.id) {
      void loadSessions();
    }
  }, [loadSessions, user?.id]);

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

  const handleFlipCamera = useCallback(async () => {
    if (isFlippingCamera) return;
    setIsFlippingCamera(true);
    try {
      // Re-opening a camera takes a moment and can fail (busy device, permission revoked for
      // the other lens), so say so rather than leaving the picture unchanged with no reason.
      const switched = await flipCamera();
      if (!switched) {
        toast.error("Could not switch camera. It may be in use by another app.");
      }
    } finally {
      setIsFlippingCamera(false);
    }
  }, [flipCamera, isFlippingCamera]);

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
    const draftKey = `counselor_video_note_draft_${activeSession.id}`;
    try {
      // 1. Fetch or establish the server counseling session for this appointment
      const sessionData = await api.getSessionForAppointment(activeSession.id) as any;
      if (sessionData?.id) {
        const sId = Number(sessionData.id);
        setCounselingSessionId(sId);
        const serverNotes = typeof sessionData.notes === 'string' ? sessionData.notes : '';

        // Check for an unsaved local draft in localStorage
        const localDraft = localStorage.getItem(draftKey);
        if (localDraft && localDraft.trim() !== '' && localDraft.trim() !== serverNotes.trim()) {
          setNoteText(localDraft);
          setLastSavedText(serverNotes);
          toast.info("Restored unsaved note draft from this session");
        } else {
          setNoteText(serverNotes);
          setLastSavedText(serverNotes);
        }
        return;
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error("Failed to load active session note:", err);
      // Fallback: check localStorage for draft
      const localDraft = localStorage.getItem(draftKey);
      if (localDraft) {
        setNoteText(localDraft);
      }
    }
  }, [activeSession]);

  // Load note when appointment changes (does NOT wipe notes on transient WebRTC disconnects)
  useEffect(() => {
    if (activeSession) {
      void loadActiveSessionNote();
    }
  }, [activeSession?.id, loadActiveSessionNote]);

  // Keep local draft resilient against browser refresh or connection drops
  useEffect(() => {
    if (!activeSession) return;
    const draftKey = `counselor_video_note_draft_${activeSession.id}`;
    if (noteText && noteText.trim() !== '' && noteText !== lastSavedText) {
      try {
        localStorage.setItem(draftKey, noteText);
      } catch {
        /* storage quota / private mode */
      }
    } else if (noteText === lastSavedText) {
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }
    }
  }, [noteText, lastSavedText, activeSession]);

  // Debounced auto-save while the video call progresses
  useEffect(() => {
    if (counselingSessionId === null) return;
    if (noteText === lastSavedText) return;

    const delay = 1200;
    const timer = setTimeout(async () => {
      try {
        setIsSavingNote(true);
        setNoteSaveError(null);
        await api.updateSessionNote(counselingSessionId, noteText);
        setLastSavedText(noteText);
        setLastSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        if (activeSession) {
          localStorage.removeItem(`counselor_video_note_draft_${activeSession.id}`);
        }
      } catch (err) {
        if (import.meta.env.DEV) console.error("Failed to auto-save notes:", err);
        setNoteSaveError("Failed to auto-save note");
      } finally {
        setIsSavingNote(false);
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [noteText, lastSavedText, counselingSessionId, activeSession]);

  const handleManualSaveNote = useCallback(async () => {
    if (counselingSessionId === null || isSavingNote) return;
    const trimmed = noteText.trim();
    if (trimmed === "") {
      toast.error("Note cannot be empty");
      return;
    }
    try {
      setIsSavingNote(true);
      setNoteSaveError(null);
      await api.updateSessionNote(counselingSessionId, noteText);
      setLastSavedText(noteText);
      setLastSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      if (activeSession) {
        localStorage.removeItem(`counselor_video_note_draft_${activeSession.id}`);
      }
      toast.success("Session note saved");
    } catch {
      setNoteSaveError("Failed to save note");
      toast.error("Failed to save note. Please check your connection.");
    } finally {
      setIsSavingNote(false);
    }
  }, [counselingSessionId, isSavingNote, noteText, activeSession]);

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
      activeSession.duration_minutes,
      undefined,
      Boolean(activeSession.is_emergency)
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
        session.duration_minutes,
        undefined,
        Boolean(session.is_emergency)
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
      // A fresh start request, even for a session that was started (and ended) before.
      beganSessionStartRef.current = null;
      setPendingSessionStartId(sessionId);
    },
    [activeSessionId, isOnline, localStream, upcomingSessions]
  );

  /**
   * Withdraw an outgoing call we placed but never connected. The server row is what keeps
   * the student's device ringing and both participants marked busy, so dropping the ring
   * locally is not enough.
   */
  const cancelOutgoingCall = useCallback(
    async (appointmentIdToCancel: string) => {
      endCall();
      stopCallRingtone();
      setPendingSessionStartId(null);
      setPendingCallMode("video");
      setOutgoingCallMode(null);
      setAuthorizedDurationMinutes(null);
      try {
        await api.cancelVideoCall(appointmentIdToCancel);
      } catch {
        // Idempotent server-side, and stale rings are swept anyway.
      }
    },
    [endCall]
  );

  const removeSessionFromQueue = useCallback((sessionIdToRemove: string) => {
    setUpcomingSessions((previous) =>
      previous.filter((session) => String(session.id) !== sessionIdToRemove)
    );
  }, []);

  /**
   * Tell the server the call ended, and drop the slot from the queue only if the session is
   * actually over.
   *
   * `session_still_open` is the server's answer to "can this slot be hosted again?". While it
   * is true the session stays listed so a dropped or hung-up call can be restarted for the
   * rest of the booked window. Returns that flag so callers can word their feedback correctly.
   */
  const finalizeEndedSession = useCallback(
    async (appointmentIdToEnd: string): Promise<boolean> => {
      let sessionStillOpen = false;
      try {
        const result = await api.endVideoCall(appointmentIdToEnd);
        sessionStillOpen = Boolean(result?.session_still_open);
        const isCompleted =
          !sessionStillOpen ||
          result?.appointment_status === "completed" ||
          (result as any)?.appointment?.status === "completed" ||
          (result as any)?.appointment_marked_completed;
        if (isCompleted) {
          removeSessionFromQueue(appointmentIdToEnd);
        }
      } catch {
        // Best effort: the local call has already been closed. Keep the slot listed — assuming
        // the session is over on a failed request would hide a session still due to run.
        sessionStillOpen = true;
      } finally {
        void loadSessions();
      }
      return sessionStillOpen;
    },
    [loadSessions, removeSessionFromQueue]
  );

  const handleEndCall = async () => {
    const sessionIdToEnd = activeSessionId;
    const activeRow = upcomingSessions.find((item) => String(item.id) === sessionIdToEnd);
    const studentId = Number(activeRow?.student_id);

    // Eagerly flush any unsaved note draft before ending the call
    if (counselingSessionId && noteText !== lastSavedText && noteText.trim() !== "") {
      try {
        await api.updateSessionNote(counselingSessionId, noteText);
        setLastSavedText(noteText);
        setLastSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        if (sessionIdToEnd) {
          localStorage.removeItem(`counselor_video_note_draft_${sessionIdToEnd}`);
        }
      } catch {
        /* best effort */
      }
    }

    endCall();
    stopCallRingtone();
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

    // A fresh start request is allowed again for this slot once the call is down.
    beganSessionStartRef.current = null;

    if (!sessionIdToEnd) {
      toast.info("Call ended");
      return;
    }

    const sessionStillOpen = await finalizeEndedSession(sessionIdToEnd);
    toast.info(
      sessionStillOpen
        ? "Call ended. The session is still booked — you can start the room again."
        : "Session ended"
    );
  };

  useEffect(() => {
    if (pendingSessionStartId) return;
    setAuthorizedDurationMinutes(null);
    setPendingCallMode("video");
    setOutgoingCallMode(null);
  }, [activeSessionId, pendingSessionStartId]);

  /**
   * Outgoing call state, driven by the server. Without this the counselor keeps hearing
   * ringback for the full 45s connection timeout after the student has already declined,
   * because a decline made from the student's ring overlay never touches this page's
   * WebRTC channel.
   */
  const handleOutgoingCallSignal = useCallback(
    (payload: IncomingCallWakePayload) => {
      if (!activeSessionId || Number(payload.appointment_id) !== Number(activeSessionId)) {
        return;
      }

      // Anonymity can change between page loads (a student reveals their identity, or flips
      // their profile out of anonymous mode) and nothing in this tab would notice — the
      // CHAT_ANONYMITY_SYNC_EVENT that drives the refresh is a window event, so it only ever
      // fires in the student's own browser. Any call signal for the open session is a good
      // moment to re-read the row, otherwise the student stays labelled "Anonymous User"
      // here for the whole call.
      void loadSessions();

      if (isAcceptedCallSignal(payload)) {
        logCallSignal("counselor: outgoing call accepted -> CONNECTED", payload);
        toast.success("Student accepted. Connecting…");
        return;
      }

      if (!isTerminalCallSignal(payload)) {
        return;
      }

      // Only tear down while we are still ringing out — an ENDED signal that arrives
      // after the media session is up belongs to the previous ring, not this call.
      if (!isConnecting || localStream) {
        return;
      }

      logCallSignal("counselor: outgoing call ended -> ENDED", payload);
      endCall();
      stopCallRingtone();
      setPendingSessionStartId(null);
      setPendingCallMode("video");
      setOutgoingCallMode(null);
      setAuthorizedDurationMinutes(null);
      toast.info(
        payload.status === "declined" ? "The student declined the call." : "The call was not answered."
      );
    },
    [activeSessionId, endCall, isConnecting, loadSessions, localStream]
  );

  useIncomingCallWakeSubscription(user?.id, Boolean(user?.id), handleOutgoingCallSignal);

  /**
   * Release the server-side ring when an outgoing call stops ringing without connecting —
   * the WebRTC layer's 45s "no one answered" timeout only fires locally. A pending row left
   * behind keeps the student's device ringing and refuses the next attempt as busy.
   */
  const ringingOutSessionRef = useRef<string | null>(null);
  useEffect(() => {
    const isRingingOut = Boolean(outgoingCallMode) && isConnecting && !localStream;

    if (isRingingOut) {
      ringingOutSessionRef.current = activeSessionId;
      return;
    }

    const abandoned = ringingOutSessionRef.current;
    ringingOutSessionRef.current = null;

    if (!abandoned || localStream || isConnected) {
      return;
    }

    void cancelOutgoingCall(abandoned);
  }, [activeSessionId, cancelOutgoingCall, isConnected, isConnecting, localStream, outgoingCallMode]);

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
    // A background refresh of the session list used to re-run this effect while the first
    // attempt was still in flight, firing a second authorize + startCall for the same ring.
    if (beganSessionStartRef.current === pendingSessionStartId) return;
    beganSessionStartRef.current = pendingSessionStartId;

    const beginSession = async () => {
      const requestedCallType = pendingCallMode === "audio" ? "audio" : "video";
      const studentId = Number(
        upcomingSessionsRef.current.find((item) => String(item.id) === activeSessionId)?.student_id
      );

      // Authorize BEFORE opening the media channel. The server call row is what rings the
      // student (realtime signal, web push, their polling); starting the local ringback
      // first meant a failed authorize left this side ringing out at a student who was
      // never notified at all.
      let authorization: VideoCallAuthorization;
      try {
        authorization = (await api.authorizeVideoCall(activeSessionId, {
          call_type: requestedCallType,
        })) as VideoCallAuthorization;
        if ((authorization as any)?.session_id) {
          setCounselingSessionId(Number((authorization as any).session_id));
        }
      } catch (err: unknown) {
        beganSessionStartRef.current = null;
        setPendingSessionStartId(null);
        setPendingCallMode("video");
        setOutgoingCallMode(null);
        endCall();

        if (err instanceof VideoCallAuthorizationError && err.isGlare) {
          // Call glare: the student rang us at the same moment. Answer their invite instead
          // of placing a second call on top of it.
          toast.info("This student is calling you. Answer the incoming call to connect.");
          return;
        }

        const errMsg = getApiErrorMessage(err, "Failed to start session");
        toast.error(errMsg);

        if (
          errMsg.toLowerCase().includes("unavailable") ||
          errMsg.toLowerCase().includes("500") ||
          errMsg.toLowerCase().includes("internal server error")
        ) {
          toast.info("You can try refreshing the page or contact support if the issue persists.");
        }
        return;
      }

      // The server resolves the media type (anonymous and audio-only bookings are forced to
      // audio); negotiate WebRTC with the same answer so the call row and the media agree.
      const callType: "video" | "audio" =
        authorization?.call_type === "audio"
          ? "audio"
          : authorization?.call_type === "video"
          ? "video"
          : requestedCallType;

      const isOutgoingRing = authorization?.call_state === "CALLING";
      setPendingCallMode(callType);
      setOutgoingCallMode(isOutgoingRing ? callType : null);

      const serverDuration = Number(authorization?.max_duration_minutes);
      setAuthorizedDurationMinutes(Number.isFinite(serverDuration) ? serverDuration : null);
      if (authorization?.session_id) {
        setCounselingSessionId(Number(authorization.session_id));
      }

      // Best-effort browser-to-browser nudge on top of the server broadcast when we are
      // actually placing an outgoing call (not when joining a call we just accepted).
      if (isOutgoingRing && Number.isFinite(studentId) && studentId > 0) {
        signalIncomingCallWake(studentId, {
          appointment_id: Number(activeSessionId),
          call_id: authorization?.call_id ?? undefined,
          call_type: callType,
          caller_role: "counselor",
          status: "pending",
        });
      }

      try {
        const started = callType === "audio" ? await startAudioCall() : await startCall();

        if (!started) {
          await cancelOutgoingCall(activeSessionId);
          return;
        }

        toast.success(
          callType === "audio"
            ? "Audio session started - waiting for student to connect"
            : "Session started - waiting for student to connect"
        );
      } catch (err: unknown) {
        beganSessionStartRef.current = null;
        await cancelOutgoingCall(activeSessionId);
        toast.error(getApiErrorMessage(err, "Failed to start session"));
      } finally {
        setPendingSessionStartId(null);
      }
    };

    void beginSession();
  }, [
    activeSessionId,
    cancelOutgoingCall,
    isOnline,
    isSignalingReady,
    pendingCallMode,
    pendingSessionStartId,
    startAudioCall,
    startCall,
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
    // If the other side is already calling us on the WebRTC channel and we navigated here
    // via Accept (autostart=1), accept their incoming WebRTC request directly instead of
    // stalling on a second IncomingCallOverlay or placing a conflicting outgoing call.
    if (isIncomingCall) {
      autoStartedRef.current = true;
      void acceptIncomingCall();
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("autostart");
      setSearchParams(nextParams, { replace: true });
      return;
    }

    const callWindow = getVideoCallWindowStatus(
      activeSession.scheduled_at,
      activeSession.duration_minutes,
      undefined,
      Boolean(activeSession.is_emergency)
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
    acceptIncomingCall,
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

  // Single shared classification (idle/ringing/calling/connected/reconnecting) — see
  // src/lib/callState.ts. Only the copy below is page-specific; the precedence between
  // these states is decided in one place, not re-derived independently per page.
  const callStatus = deriveCallStatus({
    isIncomingCall,
    isConnecting,
    isConnected,
    isDisconnected,
    localStream,
  });

  const statusMessage = useMemo(() => {
    if (!activeSession) {
      return "Choose a scheduled online session to open the room.";
    }
    if (!isOnline) {
      return "You are offline. Reconnect to continue the session.";
    }
    if (callStatus === "ringing") {
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
    if (callStatus === "calling") {
      return localStream
        ? "Waiting for the student to answer..."
        : "Connecting to the session...";
    }
    if (callStatus === "connected") {
      return remoteStream
        ? !remoteHasVideo
          ? `${remoteParticipantName} joined without video. Audio is still live.`
          : isAudioOnly
          ? "Connected. Video is unavailable, but audio is live."
          : "Connected. You and the student are live."
        : "Connected. Waiting for the student video feed to appear.";
    }
    if (callStatus === "reconnecting") {
      return "Connection interrupted. Reconnecting...";
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
    callStatus,
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

                {isDisconnected && !isConnected && !isConnecting && !localStream && !isStartingActiveSession && (
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

                      {activeSession?.is_emergency && (
                        <div className="flex items-center gap-2 rounded-2xl border border-destructive/40 bg-destructive/10 px-3 py-2.5">
                          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
                          <div className="min-w-0">
                            <p className="text-xs font-bold uppercase tracking-wide text-destructive">Emergency session</p>
                            <p className="truncate text-xs text-muted-foreground">
                              Priority crisis call with {remoteParticipantName}.
                            </p>
                          </div>
                        </div>
                      )}

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
                          {/* Framing only. Switching camera lives in the main control bar so
                              it is reachable before the student's video arrives, too. */}
                          {isConnected && showRemoteVideo && (
                            <Button
                              size="icon"
                              variant="secondary"
                              className="h-7 w-7 rounded-full bg-background/85 text-foreground shadow-sm"
                              onClick={() => setVideoFit(prev => prev === "cover" ? "contain" : "cover")}
                              title={videoFit === "cover" ? "Fit to frame" : "Fill frame"}
                              aria-label={videoFit === "cover" ? "Fit to frame" : "Fill frame"}
                            >
                              <RefreshCw className={cn("h-3.5 w-3.5", videoFit === "contain" && "rotate-45")} />
                            </Button>
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
                  {/* Offered whenever the device actually has a second camera, rather than
                      only to anything with a mobile user agent — a counselor on a laptop with
                      an external webcam had no way to switch at all. */}
                  {canFlipCamera && (
                    <Button
                      variant="outline"
                      size="lg"
                      className="h-11 w-11 sm:h-14 sm:w-14 rounded-full"
                      onClick={handleFlipCamera}
                      disabled={!localStream || isAudioOnly || isVideoOff || isFlippingCamera}
                      title="Switch camera"
                      aria-label="Switch camera"
                    >
                      {isFlippingCamera ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <FlipHorizontal className="h-5 w-5" />
                      )}
                    </Button>
                  )}
                  {canEndActiveSession && (
                    <Button
                      variant="destructive"
                      size="lg"
                      className="h-11 sm:h-14 rounded-full px-4 sm:px-6 text-sm"
                      onClick={handleEndCall}
                    >
                      <Phone className="mr-2 h-5 w-5 rotate-[135deg]" />
                      {/* Hangs up the call. The booked session stays open and can be
                          restarted — it is not the same thing as completing the appointment. */}
                      End call
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

                  <CounselorPreSessionCard
                    studentId={activeSession?.student_id}
                    appointmentId={activeSession?.id}
                    sessionId={counselingSessionId}
                    studentName={remoteParticipantName}
                    onInsertToNotes={(clinicalSummaryText) => {
                      setNoteText((prev) => {
                        const trimmed = prev.trim();
                        return trimmed ? `${trimmed}\n\n${clinicalSummaryText}` : clinicalSummaryText;
                      });
                    }}
                  />

                  <div className="space-y-2 flex-1 flex flex-col">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Session Notes
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-normal">
                          {isSavingNote ? (
                            <span className="flex items-center gap-1 text-primary font-medium">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Auto-saving...
                            </span>
                          ) : noteSaveError ? (
                            <span className="text-destructive font-medium flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              {noteSaveError}
                            </span>
                          ) : noteText !== lastSavedText && noteText !== "" ? (
                            <span className="text-amber-500 font-medium flex items-center gap-1">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                              Draft unsaved...
                            </span>
                          ) : lastSavedAt ? (
                            <span className="text-emerald-500 font-semibold flex items-center gap-1">
                              <Check className="h-3 w-3" />
                              Saved {lastSavedAt}
                            </span>
                          ) : noteText !== "" ? (
                            <span className="text-emerald-500 font-semibold flex items-center gap-1">
                              <Check className="h-3 w-3" />
                              Saved
                            </span>
                          ) : (
                            <span className="text-muted-foreground/60">Ready</span>
                          )}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void handleManualSaveNote()}
                          disabled={isSavingNote || noteText === lastSavedText || noteText.trim() === ""}
                          className="h-6 px-2 text-[10px] gap-1 hover:bg-primary/10 hover:text-primary transition-colors shrink-0"
                          title="Save note now"
                        >
                          <Save className="h-3 w-3" />
                          Save Now
                        </Button>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 text-[10px]">
                      <span className="text-muted-foreground/70 shrink-0 font-medium">Templates:</span>
                      <button
                        type="button"
                        onClick={() => setNoteText((prev) => (prev ? prev + "\n\nS: \nO: \nA: \nP: " : "S (Subjective): \nO (Objective): \nA (Assessment): \nP (Plan): "))}
                        className="px-1.5 py-0.5 rounded bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors font-mono"
                      >
                        SOAP
                      </button>
                      <button
                        type="button"
                        onClick={() => setNoteText((prev) => (prev ? prev + "\n\nD: \nA: \nP: " : "D (Data): \nA (Assessment): \nP (Plan): "))}
                        className="px-1.5 py-0.5 rounded bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors font-mono"
                      >
                        DAP
                      </button>
                      <button
                        type="button"
                        onClick={() => setNoteText((prev) => (prev ? prev + "\n\nEmergency Triage / Crisis Safety Observations:\n" : "Emergency Triage / Crisis Safety Observations:\n- Mental Status: \n- Risk Factors: \n- Interventions: \n- Follow-up Plan: "))}
                        className="px-1.5 py-0.5 rounded bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors font-mono"
                      >
                        Crisis
                      </button>
                    </div>

                    <textarea
                      className="w-full flex-1 min-h-[220px] p-3.5 rounded-2xl bg-secondary/20 border border-border/40 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary/40 transition-all placeholder:text-muted-foreground/40 leading-relaxed font-sans"
                      placeholder="Document clinical observations, mental state, and interventions..."
                      value={noteText}
                      maxLength={5000}
                      onChange={(e) => setNoteText(e.target.value)}
                    />
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground/60 px-0.5">
                      <span>Encrypted & auto-saved to session record</span>
                      <span className={`tabular-nums ${noteText.length > 4500 ? (noteText.length >= 5000 ? "text-destructive font-bold" : "text-amber-500 font-semibold") : ""}`}>
                        {noteText.length}/5000
                      </span>
                    </div>
                  </div>
                  
                  <div className="pt-2">
                    <Button variant="outline" className="w-full justify-start gap-2 h-10 rounded-xl text-xs" onClick={() => navigate("/counselor/notes")}>
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
                        session.duration_minutes,
                        undefined,
                        Boolean(session.is_emergency)
                      );
                      const isBusyWithOtherCall = Boolean(
                        localStream && activeSessionId && activeSessionId !== sessionId
                      );
                      const isHostingThisSession = Boolean(
                        isActive && (localStream || isConnected || isConnecting || isStartingActiveSession)
                      );
                      const isStarting =
                        pendingSessionStartId === sessionId ||
                        (isActive && (isConnecting || isStartingActiveSession));

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

                          <div className="mt-3">
                            <Button
                              size="sm"
                              className="w-full gap-1.5 h-8.5 text-xs font-semibold shadow-sm"
                              onClick={() => handleStartSession(sessionId, "video")}
                              disabled={
                                isBusyWithOtherCall ||
                                isHostingThisSession ||
                                isStarting ||
                                !callWindow.canStart ||
                                !isOnline ||
                                isIncomingCall
                              }
                            >
                              {isStarting && pendingCallMode === "video" ? (
                                <>
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  Starting...
                                </>
                              ) : isActive && isConnected ? (
                                <>
                                  <Video className="h-3.5 w-3.5 text-emerald-400" />
                                  Live in Call
                                </>
                              ) : isHostingThisSession ? (
                                <>
                                  <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                                  In Room (Waiting for Student)
                                </>
                              ) : (
                                <>
                                  <Video className="h-3.5 w-3.5" />
                                  Start Video Call
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
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default CounselorVideo;
