import { useState, useEffect, useRef, useCallback, useDeferredValue, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Shield,
  Loader2,
  X,
  Video,
  AlertTriangle,
  Menu,
  Lock,
} from "lucide-react";
import { studentNavItems } from "@/config/studentNavItems";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useEncryptedChat } from "@/hooks/useEncryptedChat";
import { useChatSession } from "@/hooks/useChatSession";
import { useChatPreloader } from "@/hooks/useChatPreloader";
import { useChatRoomPrejoin } from "@/hooks/useChatRoomPrejoin";
import { useSessionKeepAlive } from "@/hooks/useSessionKeepAlive";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { useFileAttachment } from "@/hooks/useFileAttachment";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { toast } from "sonner";
import { api, getApiErrorMessage } from "@/lib/api";
import { dispatchChatAnonymitySync } from "@/lib/chatRealtimeEvents";
import { MessageList } from "@/components/chat/MessageList";
import { ChatInput } from "@/components/chat/ChatInput";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { AnonymousModeToggle } from "@/components/privacy/AnonymousModeToggle";
import { isAnonymousSessionFlag } from "@/lib/anonymousMode";
import { useProfileAnonymousMode } from "@/hooks/useProfileAnonymousMode";
import { useConfirm } from "@/hooks/useConfirm";
import { detectCrisisTermsInText, isE2EHandshakeEnvelopeContent } from "@/lib/crisisTerms";
import { canDeleteMessageForEveryone } from "@/lib/chatDeletion";
import { cn } from "@/lib/utils";

type Counselor = {
  id: number;
  email?: string;
  is_online?: boolean;
  last_seen_at?: string | null;
  profile?: {
    full_name?: string;
    };
};

type CounselorListMeta = {
  page?: number;
  per_page?: number;
  total?: number;
  total_pages?: number;
};

type CounselorListResponse = Counselor[] | { data?: Counselor[]; meta?: CounselorListMeta };

const COUNSELOR_CACHE_TTL_MS = 60 * 1000;
const COUNSELOR_REFRESH_INTERVAL_MS = 20 * 1000;
const COUNSELOR_LIST_TIMEOUT_MS = 30000;
const COUNSELOR_PAGE_SIZE = 24;

const StudentChat = () => {
  const { confirm } = useConfirm();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionFromUrl = searchParams.get("session");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isPreparingCall, setIsPreparingCall] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [deletingMessageIds, setDeletingMessageIds] = useState<Set<number>>(new Set());
  const [counselors, setCounselors] = useState<Counselor[]>([]);
  const [isCounselorsLoading, setIsCounselorsLoading] = useState(false);
  const [counselorPage, setCounselorPage] = useState(1);
  const [counselorTotalPages, setCounselorTotalPages] = useState(1);
  const counselorPageRef = useRef(counselorPage);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [anonymousStartMode, setAnonymousStartMode] = useState(false);
  const [isTriggeringEmergency, setIsTriggeringEmergency] = useState(false);
  const [isSavingChatAnonymity, setIsSavingChatAnonymity] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageScrollAreaRef = useRef<HTMLDivElement>(null);
  const hasLoadedCounselorsRef = useRef(false);
  const { user, refreshUser } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split('@')[0] || "Student";
  const {
    profileAnonymousMode,
    isSaving: isSavingProfileAnonymous,
    toggleProfileAnonymousMode,
  } = useProfileAnonymousMode();

  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [messageToDelete, setMessageToDelete] = useState<any | null>(null);

  // Voice recording functionality
  const {
    isPaused,
    recording,
    recordingTime,
    audioLevels,
    startRecording,
    stopAndGetRecording,
    pauseRecording,
    resumeRecording,
    cancelRecording,
    clearRecording,
    cleanup
  } = useVoiceRecorder();

  // Get chat sessions and manage active one
  const {
    activeSession,
    sessionId,
    sessions,
    sessionPage,
    sessionTotalPages,
    selectSession,
    goToPrevPage: goToPrevSessionPage,
    goToNextPage: goToNextSessionPage,
    startSessionWithCounselor,
    refreshSessions,
  } = useChatSession(user?.id);

  useChatPreloader({
    sessions,
    activeSessionId: sessionId,
    enabled: Boolean(user?.id),
    ownerUserId: user?.id?.toString() || null,
  });
  useChatRoomPrejoin({
    sessions,
    activeSessionId: sessionId,
    enabled: Boolean(user?.id),
  });

  useEffect(() => {
    if (!sessionFromUrl || !sessions?.length) {
      return;
    }
    const found = sessions.find((s) => String(s.id) === String(sessionFromUrl));
    if (found) {
      selectSession(found);
    }
  }, [sessionFromUrl, sessions, selectSession]);

  const {
    messages,
    isLoading: messagesLoading,
    isLoadingOlderMessages,
    hasOlderMessages,
    isPeerTyping,
    error: chatError,
    sessionExpired,
    sendMessage,
    deleteMessageForMe,
    undoDeleteMessageForMe,
    deleteMessageForEveryone,
    notifyTyping,
    loadOlderMessages,
    registerServerMessage,
    addOptimisticMessage,
    resolveOptimisticMessage,
    failOptimisticMessage,
    removeOptimisticMessage,
  } = useEncryptedChat({
    sessionId: sessionId || "",
    userId: user?.id?.toString() || "",
    sessions: sessions,
  });

  useEffect(() => {
    setAnonymousStartMode(profileAnonymousMode);
  }, [profileAnonymousMode]);

  const handleSidebarAnonymousToggle = useCallback(
    async (checked: boolean) => {
      if (!user?.id) return;
      const previous = profileAnonymousMode;
      setAnonymousStartMode(checked);
      const saved = await toggleProfileAnonymousMode(checked);
      if (!saved) {
        setAnonymousStartMode(previous);
      }
    },
    [profileAnonymousMode, toggleProfileAnonymousMode, user?.id],
  );

  const {
    sendFileMessage,
    isUploading,
    uploadProgress,
    error: uploadError,
    clearError: clearUploadError,
  } = useFileAttachment({
    sessionId: sessionId || "",
  });

  useEffect(() => {
    if (uploadError) {
      toast.error(uploadError);
      clearUploadError();
    }
  }, [uploadError, clearUploadError]);

  // Cleanup voice recorder on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  // Keep active session alive while user is in chat
  useSessionKeepAlive({
    sessionId: sessionId,
    intervalMs: 30 * 60 * 1000, // 30 minutes
    enabled: Boolean(sessionId),
    onError: (error) => {
      // Session has truly expired (410 error)
      if (error.message.includes("410")) {
        toast.error("Chat session has expired. Please start a new session.");
        selectSession(null);
        void refreshSessions(true, { force: true });
      }
    },
  });

  // Load counselors
  useEffect(() => {
    if (!user?.id) {
      setIsCounselorsLoading(false);
      return;
    }

    let active = true;
    const cacheKey = `student_chat_counselors_${user.id}_${counselorPageRef.current}`;
    const cachedRaw = localStorage.getItem(cacheKey);
    let cacheLoaded = false;

    setIsCounselorsLoading(true);

    if (cachedRaw) {
      try {
        const parsed = JSON.parse(cachedRaw);
        const savedAt = Number(parsed?.saved_at || 0);
        if (Date.now() - savedAt <= COUNSELOR_CACHE_TTL_MS) {
          setCounselors(parsed.counselors || []);
          setCounselorTotalPages(parsed.total_pages || 1);
          setIsCounselorsLoading(false);
          hasLoadedCounselorsRef.current = true;
          cacheLoaded = true;
        }
      } catch { /* ignore */ }
    }

    const loadCounselors = async (showErrorToast = false) => {
      if (!active) return;
      try {
        const payload = (await api.getCounselors({
          lightweight: true,
          page: counselorPageRef.current,
          per_page: COUNSELOR_PAGE_SIZE,
          timeout_ms: COUNSELOR_LIST_TIMEOUT_MS,
        })) as CounselorListResponse;
        
        const paged = !Array.isArray(payload) ? payload : { data: payload, meta: { page: 1, total_pages: 1, total: payload.length } };
        const nextCounselors = paged.data || [];
        
        if (active) {
          setCounselors(nextCounselors);
          setCounselorTotalPages(paged.meta?.total_pages || 1);
          localStorage.setItem(cacheKey, JSON.stringify({
            saved_at: Date.now(),
            counselors: nextCounselors,
            total_pages: paged.meta?.total_pages || 1,
            total_items: paged.meta?.total || nextCounselors.length,
          }));
        }
      } catch (err) {
        if (import.meta.env.DEV) {
          console.error("Failed to load counselors:", err);
        }
        if (showErrorToast && !cacheLoaded) toast.error("Failed to load counselors");
      } finally {
        if (active) setIsCounselorsLoading(false);
      }
    };

    void loadCounselors(!cacheLoaded);
    const intervalId = window.setInterval(() => loadCounselors(false), COUNSELOR_REFRESH_INTERVAL_MS);
    return () => { active = false; window.clearInterval(intervalId); };
  }, [user?.id, counselorPage]);

  useEffect(() => {
    setDeletingMessageIds(new Set());
  }, [sessionId]);

  // Track file references for failed voice-note retries
  const failedVoiceFilesRef = useRef<Map<number, File>>(new Map());
  const currentUploadTempIdRef = useRef<number | null>(null);

  /** Core: upload a voice file optimistically — used by both tap-hold-release and locked send. */
  const sendVoiceInternal = useCallback(async (file: File) => {
    if (!sessionId) return;
    const localBlobUrl = URL.createObjectURL(file);
    const tempId = addOptimisticMessage({
      sender_id: Number(user?.id ?? 0),
      message_type: "voice",
      content: "",
      created_at: new Date().toISOString(),
      seen_at: null,
      is_encrypted: false,
      has_file: true,
      isUploading: true,
      uploadFailed: false,
      localBlobUrl,
      attachment: {
        id: 0,
        file_name: file.name,
        file_type: file.type,
        file_size: file.size,
        url: localBlobUrl,
        download_url: localBlobUrl,
      },
    });
    currentUploadTempIdRef.current = tempId;
    try {
      const sentVoice = await sendFileMessage(file, { messageType: "voice" });
      if (sentVoice) {
        URL.revokeObjectURL(localBlobUrl);
        resolveOptimisticMessage(tempId, sentVoice);
        clearRecording();
        failedVoiceFilesRef.current.delete(tempId);
      } else {
        failedVoiceFilesRef.current.set(tempId, file);
        failOptimisticMessage(tempId);
      }
    } catch {
      failedVoiceFilesRef.current.set(tempId, file);
      failOptimisticMessage(tempId);
    } finally {
      if (currentUploadTempIdRef.current === tempId) currentUploadTempIdRef.current = null;
    }
  }, [sessionId, user?.id, addOptimisticMessage, sendFileMessage, resolveOptimisticMessage, failOptimisticMessage, clearRecording]);

  /** Called by ChatInput onVoiceStopAndSend (pointer release) and onVoiceSendNow (locked send). */
  const handleVoiceStopAndSend = useCallback(async () => {
    if (!sessionId) return;
    const file = await stopAndGetRecording();
    const durationMs = file ? (file as any).durationMs ?? 0 : 0;
    // Guard: require at least 1 second of actual audio before sending.
    // Also check file.size > 0 for safety.
    if (!file || file.size === 0 || durationMs < 1000) {
      cancelRecording();
      clearRecording();
      setIsVoiceMode(false);
      return;
    }
    setIsVoiceMode(false);
    await sendVoiceInternal(file);
  }, [sessionId, stopAndGetRecording, cancelRecording, clearRecording, sendVoiceInternal]);

  /** Retry a failed optimistic voice note. */
  const handleRetryVoiceUpload = useCallback(async (tempId: number) => {
    const file = failedVoiceFilesRef.current.get(tempId);
    if (!file || !sessionId) return;
    failedVoiceFilesRef.current.delete(tempId);
    removeOptimisticMessage(tempId);
    await sendVoiceInternal(file);
  }, [sessionId, removeOptimisticMessage, sendVoiceInternal]);

  /** Delete a failed optimistic voice note. */
  const handleDeleteOptimistic = useCallback((tempId: number) => {
    failedVoiceFilesRef.current.delete(tempId);
    removeOptimisticMessage(tempId);
  }, [removeOptimisticMessage]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!message.trim() && !selectedFile) || isSending || !sessionId) return;
    setIsSending(true);
    try {
      if (selectedFile) {
        const sentFile = await sendFileMessage(selectedFile);
        if (sentFile) registerServerMessage(sentFile);
        setSelectedFile(null);
      }
      if (message.trim()) {
        const text = message.trim();
        const success = await sendMessage(text);
        if (success) {
          // Scan the outgoing plaintext for crisis keywords and notify staff.
          // This runs client-side so encrypted sessions (where the server cannot
          // read the body) still produce a staff alert when trigger words are used.
          if (sessionId && !isE2EHandshakeEnvelopeContent(text)) {
            const matches = detectCrisisTermsInText(text);
            if (matches.length > 0) {
              api.reportCrisisSignal(sessionId, matches).catch(() => {});
            }
          }
          setMessage("");
          notifyTyping(false);
        }
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("Failed to send message:", error);
      }
      toast.error("Failed to send message");
    }
    setIsSending(false);
  };


  const handleStartVideoCall = async () => {
    if (!activeSession?.counselor_id) return toast.error("No active conversation");
    const chatAnonymous = isAnonymousSessionFlag(activeSession.is_anonymous);
    try {
      setIsPreparingCall(true);
      const scheduledAt = new Date(Date.now() + 60 * 1000).toISOString();
      const created = await api.createAppointment({
        counselor_id: activeSession.counselor_id,
        scheduled_at: scheduledAt,
        duration_minutes: 30,
        notes: chatAnonymous ? "Online audio" : "Online",
        is_anonymous: chatAnonymous,
        call_type: chatAnonymous ? "audio" : "video",
      });
      const mode = chatAnonymous ? "audio" : "video";
      navigate(`/student/video-call?appointment_id=${created.id}&counselor_id=${activeSession.counselor_id}&mode=${mode}&autostart=1`);
    } catch {
      toast.error("Unable to start video call");
    } finally {
      setIsPreparingCall(false);
    }
  };

  const handleTriggerEmergency = async () => {
    const ok = await confirm({
      title: "Trigger emergency alert?",
      description: "Our crisis team will be notified immediately.",
      confirmLabel: "Send alert",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      setIsTriggeringEmergency(true);

      let location: string | undefined;
      if (typeof navigator !== "undefined" && navigator.geolocation) {
        try {
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
          });
          location = `${position.coords.latitude}, ${position.coords.longitude}`;
        } catch {
          // Location is optional; proceed without it.
        }
      }

      if (sessionId) {
        // Active conversation: escalate to counselors and mark this session as panic.
        await api.panicEscalateSession(sessionId, {
          reason: "Student-triggered emergency from active chat",
          location,
        });
        toast.success("Emergency alert sent to professional counseling staff. Please stay on the line.");
      } else {
        // No active session: log a generic panic alert for the crisis team.
        const response = await api.createPanicLog({ location });
        const recipientsNotified = Number(
          (response as { recipients_notified?: unknown })?.recipients_notified
        );
        if (Number.isFinite(recipientsNotified) && recipientsNotified === 0) {
          toast.warning(
            "Alert logged, but no on-call responders were reachable. Please call the hotline now."
          );
        } else if (Number.isFinite(recipientsNotified) && recipientsNotified > 0) {
          toast.success(
            `Emergency alert sent to ${recipientsNotified} responder${recipientsNotified === 1 ? "" : "s"}. Please stay on the line.`
          );
        } else {
          toast.success("Emergency alert triggered. Please stay on the line.");
        }
      }
    } catch {
      toast.error("Failed to trigger alert. Please call emergency services directly.");
    } finally {
      setIsTriggeringEmergency(false);
    }
  };

  const navigateToChatSession = useCallback((id: string | number) => {
    const nextId = String(id);
    if (sessionFromUrl !== nextId) {
      navigate(`/student/chat?session=${encodeURIComponent(nextId)}`, { replace: true });
    }
  }, [navigate, sessionFromUrl]);

  const markSessionReadSoon = useCallback((id: string) => {
    void api.markSessionInboundRead(id, { timeout_ms: 5000 }).catch(() => {
      setTimeout(() => {
        void api.markSessionInboundRead(id, { timeout_ms: 8000 }).catch(() => {});
      }, 2000);
    });
  }, []);

  const handleSelectSessionById = useCallback((id: string) => {
    if (!id) {
      selectSession(null);
      if (sessionFromUrl) {
        navigate("/student/chat", { replace: true });
      }
      return;
    }

    const selectAndOpen = (session: (typeof sessions)[number]) => {
      selectSession(session);
      navigateToChatSession(id);
      markSessionReadSoon(id);
    };

    const session = sessions.find(s => String(s.id) === id);
    if (session) {
      selectAndOpen(session);
      return;
    }

    void (async () => {
      try {
        const fetchedSession = await api.getSession(id);
        if (fetchedSession?.id) {
          selectAndOpen(fetchedSession);
        }
      } catch (error: unknown) {
        toast.error(getApiErrorMessage(error, "Could not open that conversation."));
      }
    })();
  }, [markSessionReadSoon, navigate, navigateToChatSession, sessionFromUrl, sessions, selectSession]);

  const closeActiveChat = useCallback(() => {
    selectSession(null);
    if (sessionFromUrl) {
      navigate("/student/chat", { replace: true });
    }
  }, [navigate, selectSession, sessionFromUrl]);

  const handleStartSessionWrapper = useCallback((id: number, isAnon: boolean) => {
    void startSessionWithCounselor(id, { isAnonymous: isAnon }).then((session) => {
      if (session?.id) {
        navigateToChatSession(session.id);
      }
    });
  }, [navigateToChatSession, startSessionWithCounselor]);

  const handleStartFreshAnonymousSession = useCallback((counselorId: number) => {
    // Always force a brand-new anonymous session here so the anonymity
    // contract is preserved (no silent reuse of an old anonymous thread).
    void startSessionWithCounselor(counselorId, { isAnonymous: true, forceNew: true }).then((session) => {
      if (session?.id) {
        navigateToChatSession(session.id);
      }
    });
  }, [navigateToChatSession, startSessionWithCounselor]);

  const handleDeleteMessageWrapper = useCallback((id: number) => {
    const msg = messages.find((m) => m.id === id);
    if (!msg) return;
    setMessageToDelete(msg);
    setDeleteDialogOpen(true);
  }, [messages]);

  const handleMessageInputChange = useCallback((nextMessage: string) => {
    setMessage(nextMessage);
  }, []);

  const handleAtBottomChange = useCallback((atBottom: boolean) => {
    setIsAtBottom(atBottom);
    setShowScrollToBottom(!atBottom && messages.length > 5);
  }, [messages.length]);

  const handleActiveChatAnonymityToggle = useCallback(async (checked: boolean) => {
    if (!sessionId || !activeSession) return;

    const sessionIsAnonymous = isAnonymousSessionFlag(activeSession.is_anonymous);
    const hasConversationHistory = messages.length > 0;

    if (hasConversationHistory) {
      const turningOn = checked && !sessionIsAnonymous;
      const turningOff = !checked && sessionIsAnonymous;
      if (turningOn || turningOff) {
        const ok = await confirm(
          turningOn
            ? "Turn on anonymous mode for this chat?\n\nOlder messages stay exactly as you sent them. New messages and activity use anonymous identity for your support team. Continue?"
            : "Turn off anonymous mode for this chat?\n\nOlder anonymous messages stay in that context on your support team's screen. Your real name applies to new activity in this thread. Continue?",
        );
        if (!ok) return;
      }
    } else if (sessionIsAnonymous && !checked) {
      const ok = await confirm(
        "Turning this off will show your real name to this support team for active chats. Continue?",
      );
      if (!ok) return;
    }

    try {
      setIsSavingChatAnonymity(true);
      await api.updateSessionChatAnonymity(sessionId, checked);
      await refreshUser();
      await refreshSessions(true, { force: true });
      dispatchChatAnonymitySync();
      toast.success(
        checked
          ? "Counselors now see this conversation as anonymous."
          : "Your profile name is visible in chat again.",
      );
    } catch (error: unknown) {
      const message = getApiErrorMessage(error, "Could not update anonymity");
      toast.error(message || "Could not update anonymity.");
    } finally {
      setIsSavingChatAnonymity(false);
    }
  }, [activeSession, confirm, messages.length, refreshSessions, refreshUser, sessionId]);

  const sidebarAnonymousChecked = activeSession
    ? isAnonymousSessionFlag(activeSession.is_anonymous)
    : anonymousStartMode;

  const handleUnifiedAnonymousToggle = useCallback(
    async (checked: boolean) => {
      if (activeSession) {
        await handleActiveChatAnonymityToggle(checked);
        return;
      }
      await handleSidebarAnonymousToggle(checked);
    },
    [activeSession, handleActiveChatAnonymityToggle, handleSidebarAnonymousToggle]
  );

  const unifiedAnonymousToggleDisabled = activeSession
    ? isSavingChatAnonymity
    : isSavingProfileAnonymous;

  const activePeerParticipant = useMemo(() => {
    if (!activeSession) return null;

    const sessionPeerName =
      activeSession.peer_counselor?.profile?.full_name ||
      activeSession.peer_counselor?.email ||
      activeSession.case_peer_counselor?.profile?.full_name ||
      activeSession.case_peer_counselor?.email ||
      "";
    const sessionPeerId = Number(
      activeSession.peer_counselor_id ||
        activeSession.peer_counselor?.id ||
        activeSession.case_peer_counselor_id ||
        activeSession.case_peer_counselor?.id ||
        0
    );

    const currentStudentId = Number(user?.id || activeSession.student_id || 0);
    const peerMatchesStudent = sessionPeerId > 0 && sessionPeerId === currentStudentId;

    if (!peerMatchesStudent && (sessionPeerId > 0 || sessionPeerName)) {
      return {
        id: sessionPeerId || null,
        name: sessionPeerName || "Peer Counselor",
        email: activeSession.peer_counselor?.email || activeSession.case_peer_counselor?.email,
      };
    }

    const peerMessage = [...messages].reverse().find((msg) => (
      msg.sender_role === "peer_counselor" &&
      Number(msg.sender_id || 0) !== currentStudentId
    ));
    if (!peerMessage) return null;

    return {
      id: Number(peerMessage.sender_id || 0) || null,
      name: peerMessage.sender_display_name || peerMessage.sender_name_snapshot || "Peer Counselor",
    };
  }, [activeSession, messages, user?.id]);

  const activeSupportName =
    activePeerParticipant?.name ||
    activeSession?.counselor?.profile?.full_name ||
    activeSession?.counselor?.email ||
    "Support Session";
  const activeSupportSubtitle = activePeerParticipant
    ? "Supervised Peer Support Chat"
    : "Confidential support conversation";

  if (sessionExpired) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center 
                      gap-3 text-muted-foreground px-4 text-center">
        <Lock className="h-8 w-8 opacity-40" />
        <p className="text-sm font-medium">This session has ended.</p>
        <p className="text-xs opacity-60">
          This conversation is no longer available.
        </p>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-gradient-to-br from-slate-100/70 via-background to-emerald-100/40">
      <DashboardSidebar
        items={[...studentNavItems]}
        userType="student"
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex h-full min-w-0 flex-col overflow-hidden lg:pl-72 pl-0">
        {!activeSession && (
          <DashboardHeader
            title="Clinical Support"
            onMenuClick={() => setSidebarOpen(true)}
          />
        )}

        <ErrorBoundary
          title="Something went wrong"
          description="The clinical chat encountered an unexpected error. This might be due to a connection issue or an encryption sync failure."
        >
          <div className="flex min-h-0 flex-1 overflow-hidden p-0 lg:p-4 lg:gap-4">
            {/* Chat Sidebar */}
            <div className="hidden w-80 shrink-0 lg:flex lg:rounded-2xl lg:border lg:border-slate-200/80 lg:bg-background/95 lg:shadow-lg lg:shadow-slate-200/40 lg:backdrop-blur">
              <ChatSidebar
                sessions={sessions}
                activeSession={activeSession}
                counselors={counselors}
                isCounselorsLoading={isCounselorsLoading}
                searchQuery={deferredSearchQuery}
                onSearchChange={setSearchQuery}
                onSelectSession={handleSelectSessionById}
                onStartSession={handleStartSessionWrapper}
                onStartFreshAnonymousSession={handleStartFreshAnonymousSession}
                anonymousStartMode={sidebarAnonymousChecked}
                onToggleAnonymous={handleUnifiedAnonymousToggle}
                anonymousToggleDisabled={unifiedAnonymousToggleDisabled}
                counselorPage={counselorPage}
                counselorTotalPages={counselorTotalPages}
                onNextCounselorPage={() => setCounselorPage(p => Math.min(p + 1, counselorTotalPages))}
                onPrevCounselorPage={() => setCounselorPage(p => Math.max(p - 1, 1))}
                sessionPage={sessionPage}
                sessionTotalPages={sessionTotalPages}
                onNextSessionPage={goToNextSessionPage}
                onPrevSessionPage={goToPrevSessionPage}
                ownerUserId={user?.id?.toString() ?? null}
                activePeerParticipant={activePeerParticipant}
              />
            </div>

            {/* Main Chat Area */}
            <div className="relative flex min-h-0 flex-1 flex-col bg-gradient-to-b from-background via-background to-slate-50/70 lg:rounded-2xl lg:border lg:border-slate-200/80 lg:shadow-lg lg:shadow-slate-200/35">
              {/* Session Expired - Check FIRST before any other UI */}
              {sessionExpired && (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground text-sm">
                  <Lock className="w-5 h-5 opacity-50" />
                  <p>This session has ended and is no longer available.</p>
                </div>
              )}

              <>
              {activeSession && chatError && (
                <div className="shrink-0 bg-destructive/10 border-b border-destructive/20 px-4 py-3 flex items-center justify-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                  <span className="text-xs font-bold uppercase tracking-widest text-destructive/80">Chat error</span>
                </div>
              )}

              {activeSession ? (
                <>
                  <div className="relative z-10 flex shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-background/80 p-3 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70 sm:p-4 lg:px-6">
                    <div className="flex min-w-0 items-center gap-3">
                      <Button variant="ghost" size="icon" className="xl:hidden shrink-0" onClick={() => setSidebarOpen(true)}>
                        <Menu className="h-5 w-5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="xl:hidden shrink-0" onClick={closeActiveChat} aria-label="Close chat">
                        <X className="h-5 w-5" />
                      </Button>
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-primary text-xs font-bold text-primary-foreground shadow-md">
                        {(activeSupportName || "Support")
                          .split(/\s+/)
                          .filter(Boolean)
                          .slice(0, 2)
                          .map((part) => part[0])
                          .join("")
                          .toUpperCase() || "SC"}
                      </div>
                      <div className="min-w-0">
                        <h2 className="truncate text-sm sm:text-base font-bold leading-tight lg:text-lg">
                          {activeSupportName}
                        </h2>
                        <p className="truncate text-[11px] text-muted-foreground sm:text-xs">
                          {activeSupportSubtitle}
                        </p>
                        <div className="mt-0.5 flex items-center gap-2">
                          <span className={cn("h-2 w-2 shrink-0 rounded-full", chatError ? "bg-destructive" : "bg-emerald-500")} />
                          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            {chatError ? "Chat error" : "Session active"}
                          </span>
                          <span className="hidden text-[10px] font-semibold text-muted-foreground/80 sm:inline">Secure E2E channel</span>
                        </div>
                        <div className="mt-1.5 flex max-w-full flex-wrap items-center gap-1.5">
                          <span className="rounded-full border border-slate-200 bg-white/80 px-2 py-0.5 text-[10px] font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-200">
                            Student: You
                          </span>
                          {activePeerParticipant && (
                            <span className="rounded-full border border-pink-200 bg-pink-50 px-2 py-0.5 text-[10px] font-semibold text-pink-700 dark:border-pink-900/50 dark:bg-pink-950/30 dark:text-pink-200">
                              Peer Counselor: {activePeerParticipant.name}
                            </span>
                          )}
                          {Number(activeSession.counselor_id) > 0 && (
                            <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200">
                              Counselor: {activeSession.counselor?.profile?.full_name || activeSession.counselor?.email || "Counselor"}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 sm:gap-2">
                      <AnonymousModeToggle
                        id="active-chat-anonymous"
                        checked={isAnonymousSessionFlag(activeSession.is_anonymous)}
                        onCheckedChange={(v) => void handleUnifiedAnonymousToggle(v)}
                        disabled={unifiedAnonymousToggleDisabled}
                      />
                      <div className="hidden items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-emerald-600 xl:flex">
                        <Shield className="h-3 w-3" />
                        <span>Active</span>
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-8 sm:h-10 sm:w-10 rounded-full hover:bg-primary/5 hover:text-primary" onClick={handleStartVideoCall} disabled={isPreparingCall}>
                        {isPreparingCall ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-5 w-5" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 sm:h-10 sm:w-10 rounded-full hover:bg-destructive/5 hover:text-destructive" onClick={handleTriggerEmergency} disabled={isTriggeringEmergency}>
                        <AlertTriangle className="h-5 w-5" />
                      </Button>
                    </div>
                  </div>

                  <div className="flex min-h-0 flex-1 overflow-hidden">
                    {/* Message List */}
                    <div className="min-h-0 flex-1 overflow-hidden">
                      <MessageList
                        conversationKey={String(sessionId ?? "")}
                        messages={messages}
                        isLoading={messagesLoading}
                        isLoadingOlderMessages={isLoadingOlderMessages}
                        hasOlderMessages={hasOlderMessages}
                        isAtBottom={isAtBottom}
                        showScrollToBottom={showScrollToBottom}
                        user={user}
                        activeSession={activeSession}
                        isPeerTyping={isPeerTyping}
                        deletingMessageIds={deletingMessageIds}
                        error={chatError}
                        onAtBottomChange={handleAtBottomChange}
                        onLoadOlder={async () => { await loadOlderMessages(); }}
                        onDeleteMessage={async (id) => {
                          handleDeleteMessageWrapper(id);
                        }}
                        onStarterPrompt={setMessage}
                        scrollToBottom={() => scrollRef.current?.scrollIntoView({ behavior: "smooth" })}
                        messageScrollAreaRef={messageScrollAreaRef as any}
                        scrollRef={scrollRef}
                        onRetryLoad={() => {}}
                        onRetryUpload={handleRetryVoiceUpload}
                        onDeleteOptimistic={handleDeleteOptimistic}
                        uploadingTempId={currentUploadTempIdRef.current ?? undefined}
                        currentUploadProgress={uploadProgress}
                      />
                    </div>
                  </div>

                  {/* Chat Input */}
                  <ChatInput
                    message={message}
                    isSending={isSending}
                    isUploading={isUploading}
                    uploadProgress={uploadProgress}
                    isVoiceMode={isVoiceMode}
                    recording={recording}
                    recordingTime={recordingTime}
                    isPaused={isPaused}
                    selectedFile={selectedFile}
                    audioLevels={audioLevels}
                    onMessageChange={handleMessageInputChange}
                    onTypingChange={notifyTyping}
                    onSubmit={handleSendMessage}
                    onFileSelect={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setSelectedFile(file);
                      }
                    }}
                    onAttachClick={() => {
                      fileInputRef.current?.click();
                    }}
                    onVoiceStart={async () => { setIsVoiceMode(true); await startRecording(); }}
                    onVoiceStopAndSend={handleVoiceStopAndSend}
                    onVoiceSendNow={handleVoiceStopAndSend}
                    onVoicePause={pauseRecording}
                    onVoiceResume={resumeRecording}
                    onVoiceCancel={() => { cancelRecording(); setIsVoiceMode(false); }}
                    onVoiceError={(err) => toast.error(err.message)}
                    onRemoveFile={() => setSelectedFile(null)}
                    onEmojiClick={(data) => setMessage(prev => prev + data.emoji)}
                    fileInputRef={fileInputRef}
                  />

                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center overflow-y-auto p-3 sm:p-4 lg:hidden">
                  <ChatSidebar
                    sessions={sessions}
                    activeSession={activeSession}
                    counselors={counselors}
                    isCounselorsLoading={isCounselorsLoading}
                    searchQuery={deferredSearchQuery}
                    onSearchChange={setSearchQuery}
                    onSelectSession={handleSelectSessionById}
                    onStartSession={handleStartSessionWrapper}
                    onStartFreshAnonymousSession={handleStartFreshAnonymousSession}
                    anonymousStartMode={sidebarAnonymousChecked}
                    onToggleAnonymous={handleUnifiedAnonymousToggle}
                    anonymousToggleDisabled={unifiedAnonymousToggleDisabled}
                    counselorPage={counselorPage}
                    counselorTotalPages={counselorTotalPages}
                    onNextCounselorPage={() => setCounselorPage(p => Math.min(p + 1, counselorTotalPages))}
                    onPrevCounselorPage={() => setCounselorPage(p => Math.max(p - 1, 1))}
                    sessionPage={sessionPage}
                    sessionTotalPages={sessionTotalPages}
                    onNextSessionPage={goToNextSessionPage}
                    onPrevSessionPage={goToPrevSessionPage}
                    ownerUserId={user?.id?.toString() ?? null}
                  />
                </div>
              )}
              
              {!activeSession && (
                 <div className="hidden lg:flex flex-1 flex-col items-center justify-center p-10 text-center animate-in fade-in zoom-in duration-700">
                    <div className="mb-6 rounded-[2.5rem] border border-emerald-200/70 bg-gradient-to-br from-emerald-100 via-white to-sky-100 p-6 shadow-xl shadow-emerald-100/60">
                      <Shield className="h-16 w-16 text-emerald-700" />
                    </div>
                    <h2 className="mb-2 text-2xl font-display font-bold tracking-tight xl:text-3xl">Welcome to Your Counseling Space</h2>
                    <p className="mx-auto mb-3 max-w-md leading-relaxed text-muted-foreground">
                      Select a conversation from the left panel to begin your support chat session.
                    </p>
                    <p className="mx-auto mb-5 max-w-md text-sm text-muted-foreground">
                      No active sessions yet. Counselors will appear here once connected.
                    </p>
                    <div className="mb-4 flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-1.5 text-xs font-semibold text-emerald-700">
                      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                      End-to-end encrypted support
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <Button
                        type="button"
                        className="rounded-xl bg-gradient-to-r from-emerald-600 to-primary px-5 text-white shadow-md shadow-emerald-300/30"
                        onClick={() => {
                          const firstCounselor = counselors[0];
                          if (firstCounselor?.id) {
                            handleStartSessionWrapper(firstCounselor.id, sidebarAnonymousChecked);
                          } else {
                            toast.message("No available counselor right now. Please refresh shortly.");
                          }
                        }}
                      >
                        Start Session
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-xl border-slate-300 bg-white/80"
                        onClick={() => window.location.reload()}
                      >
                        Refresh Conversations
                      </Button>
                    </div>
                 </div>
              )}
              </>
            </div>
          </div>
        </ErrorBoundary>
      </div>
      {/* Delete Message Dialog */}
      {deleteDialogOpen && messageToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-sm overflow-hidden rounded-[2rem] border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950 animate-in zoom-in-95 duration-200">
            <div className="space-y-4">
              <h3 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-50">
                Delete message?
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {canDeleteMessageForEveryone(messageToDelete, user?.id)
                  ? "Would you like to delete this message for everyone in the chat, or just for yourself?"
                  : messageToDelete.sender_id === Number(user?.id)
                  ? "The delete-for-everyone window has expired. This message will only be hidden from your view."
                  : "This message will be deleted for you. Others in the chat will still be able to see it."}
              </p>
            </div>

            <div className="mt-6 flex flex-col gap-2">
              {canDeleteMessageForEveryone(messageToDelete, user?.id) && (
                  <Button
                    variant="destructive"
                    className="w-full rounded-2xl py-5 font-semibold text-sm hover:scale-[1.01] active:scale-95 transition-all shadow-md"
                    onClick={async () => {
                      const id = messageToDelete.id;
                      setDeleteDialogOpen(false);
                      setMessageToDelete(null);
                      setDeletingMessageIds((prev) => new Set(prev).add(id));
                      try {
                        await deleteMessageForEveryone(id);
                        toast.success("Message deleted for everyone.");
                      } catch {
                        toast.error("Failed to delete message.");
                      } finally {
                        setDeletingMessageIds((prev) => {
                          const next = new Set(prev);
                          next.delete(id);
                          return next;
                        });
                      }
                    }}
                  >
                    Delete for Everyone
                  </Button>
                )}

              <Button
                variant="secondary"
                className="w-full rounded-2xl py-5 font-semibold text-sm hover:bg-secondary/80 hover:scale-[1.01] active:scale-95 transition-all"
                onClick={() => {
                  const id = messageToDelete.id;
                  setDeleteDialogOpen(false);
                  setMessageToDelete(null);
                  
                  deleteMessageForMe(id);
                  
                  toast("Message deleted for me", {
                    duration: 5000,
                    action: {
                      label: "Undo",
                      onClick: () => {
                        undoDeleteMessageForMe(id);
                        toast.success("Restored message");
                      },
                    },
                  });
                }}
              >
                Delete for Me
              </Button>

              <Button
                variant="ghost"
                className="w-full rounded-2xl py-5 font-medium text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100/50 dark:hover:bg-slate-900/50 transition-colors"
                onClick={() => {
                  setDeleteDialogOpen(false);
                  setMessageToDelete(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StudentChat;
