import { useState, useEffect, useRef, useCallback, useDeferredValue } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  Shield,
  Loader2,
  X,
  Video,
  AlertTriangle,
  LayoutDashboard,
  MessageSquare,
  Calendar,
  Bot,
  History,
  Heart,
  Menu,
  ClipboardCheck,
  Lock,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useEncryptedChat } from "@/hooks/useEncryptedChat";
import { useChatSession } from "@/hooks/useChatSession";
import { useChatPreloader } from "@/hooks/useChatPreloader";
import { useChatRoomPrejoin } from "@/hooks/useChatRoomPrejoin";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { useFileAttachment } from "@/hooks/useFileAttachment";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { toast } from "sonner";
import { api, getApiErrorMessage } from "@/lib/api";
import { dispatchChatAnonymitySync } from "@/lib/chatRealtimeEvents";
import { MessageList } from "@/components/chat/MessageList";
import { ChatInput } from "@/components/chat/ChatInput";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { AnonymousModeIndicator } from "@/components/privacy/AnonymousModeIndicator";
import { AnonymousModeToggle } from "@/components/privacy/AnonymousModeToggle";
import { isAnonymousSessionFlag } from "@/lib/anonymousMode";
import { useProfileAnonymousMode } from "@/hooks/useProfileAnonymousMode";
import { cn } from "@/lib/utils";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/student/dashboard" },
  { label: "Chat", icon: MessageSquare, path: "/student/chat" },
  { label: "Appointments", icon: Calendar, path: "/student/appointments" },
  { label: "AI Support", icon: Bot, path: "/student/ai-support" },
  { label: "Video Call", icon: Video, path: "/student/video-call" },
  { label: "Past Sessions", icon: History, path: "/student/history" },
  { label: "Wellness", icon: Heart, path: "/student/wellness" },
  { label: "Assessment", icon: ClipboardCheck, path: "/student/diagnostic-assessment" },
];

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
  const navigate = useNavigate();
  const location = useLocation();
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

  // Voice recording functionality
  const {
    isRecording,
    isPaused,
    recording,
    recordingTime,
    startRecording,
    stopRecording,
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
    isLoading: isSessionsLoading,
    selectSession,
    goToPrevPage: goToPrevSessionPage,
    goToNextPage: goToNextSessionPage,
    startSessionWithCounselor
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
    deleteMessage,
    notifyTyping,
    loadOlderMessages,
    registerServerMessage,
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
      setAnonymousStartMode(checked);
      await toggleProfileAnonymousMode(checked);
    },
    [toggleProfileAnonymousMode, user?.id],
  );

  const {
    sendFileMessage,
    isUploading,
    uploadProgress,
  } = useFileAttachment({
    sessionId: sessionId || "",
  });

  // Cleanup voice recorder on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

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

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!message.trim() && !selectedFile && !recording) || isSending || !sessionId) return;
    if (message.trim() && !true) {
      toast.error("Secure channel is initializing. Please wait a few seconds.");
      return;
    }

    setIsSending(true);
    try {
      if (selectedFile) {
        const sentFile = await sendFileMessage(selectedFile);
        if (sentFile) registerServerMessage(sentFile);
        setSelectedFile(null);
      }
      if (recording) {
        const sentVoice = await sendFileMessage(recording.blob, { messageType: "voice" });
        if (sentVoice) {
          registerServerMessage(sentVoice);
          clearRecording();
        }
      }
      if (message.trim()) {
        const success = await sendMessage(message.trim());
        if (success) {
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
    if (!window.confirm("Trigger emergency alert? Our crisis team will be notified immediately.")) return;
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

  const handleSelectSessionById = useCallback((id: string) => {
    if (!id) {
      selectSession(null);
      return;
    }
    const session = sessions.find(s => s.id.toString() === id);
    if (session) {
      selectSession(session);
      void api.markSessionInboundRead(id, { timeout_ms: 5000 }).catch(() => {
        setTimeout(() => {
          void api.markSessionInboundRead(id, { timeout_ms: 8000 }).catch(() => {});
        }, 2000);
      });
    }
  }, [sessions, selectSession]);

  const handleStartSessionWrapper = useCallback((id: number, isAnon: boolean) => {
    void startSessionWithCounselor(id, { isAnonymous: isAnon });
  }, [startSessionWithCounselor]);

  const handleStartFreshAnonymousSession = useCallback((counselorId: number) => {
    // Always force a brand-new anonymous session here so the anonymity
    // contract is preserved (no silent reuse of an old anonymous thread).
    void startSessionWithCounselor(counselorId, { isAnonymous: true, forceNew: true });
  }, [startSessionWithCounselor]);

  const handleDeleteMessageWrapper = useCallback(async (id: number) => {
    await deleteMessage(id);
  }, [deleteMessage]);

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
        const ok = window.confirm(
          turningOn
            ? "Turn on anonymous mode for this chat?\n\nOlder messages stay exactly as you sent them. New messages and activity use anonymous identity for your counselor. Continue?"
            : "Turn off anonymous mode for this chat?\n\nOlder anonymous messages stay in that context on your counselor's screen. Your real name applies to new activity in this thread. Continue?",
        );
        if (!ok) return;
      }
    } else if (sessionIsAnonymous && !checked) {
      const ok = window.confirm(
        "Turning this off will show your real name to this counselor for active chats. Continue?",
      );
      if (!ok) return;
    }

    try {
      setIsSavingChatAnonymity(true);
      await api.updateSessionChatAnonymity(sessionId, checked);
      await refreshUser();
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
  }, [activeSession, messages.length, refreshUser, sessionId]);

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
  const showEntryPreflight = false;

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
    <div className="h-screen bg-background overflow-hidden">
      <DashboardSidebar
        items={navItems}
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
          <div className="flex min-h-0 flex-1 overflow-hidden">
            {/* Chat Sidebar */}
            <div className="hidden w-72 shrink-0 xl:flex lg:flex">
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

            {/* Main Chat Area */}
            <div className="relative flex min-h-0 flex-1 flex-col bg-gradient-to-b from-background to-secondary/5">
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
                  <div className="relative z-10 flex shrink-0 items-center justify-between gap-2 border-b border-border/50 bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:p-4 lg:px-6">
                    <div className="flex min-w-0 items-center gap-3">
                      <Button variant="ghost" size="icon" className="xl:hidden shrink-0" onClick={() => setSidebarOpen(true)}>
                        <Menu className="h-5 w-5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="xl:hidden shrink-0" onClick={() => selectSession(null)}>
                        <X className="h-5 w-5" />
                      </Button>
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground shadow-sm">
                        {(activeSession.assigned_role === 'peer_counselor'
                          ? activeSession.peer_counselor?.profile?.full_name || "Peer Support"
                          : activeSession.counselor?.profile?.full_name || "Support")
                          .split(/\s+/)
                          .filter(Boolean)
                          .slice(0, 2)
                          .map((part) => part[0])
                          .join("")
                          .toUpperCase() || "SC"}
                      </div>
                      <div className="min-w-0">
                        <h2 className="truncate text-sm sm:text-base font-bold leading-tight lg:text-lg">
                          {activeSession.counselor?.profile?.full_name || "Support Session"}
                        </h2>
                        <div className="mt-0.5 flex items-center gap-2">
                          <span className={cn("h-2 w-2 shrink-0 rounded-full", chatError ? "bg-destructive" : "bg-emerald-500")} />
                          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            {chatError ? "Chat error" : "Session active"}
                          </span>
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

                  {/* Message List */}
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
                    onDeleteMessage={handleDeleteMessageWrapper}
                    onStarterPrompt={setMessage}
                    scrollToBottom={() => scrollRef.current?.scrollIntoView({ behavior: "smooth" })}
                    messageScrollAreaRef={messageScrollAreaRef as any}
                    scrollRef={scrollRef}
                    onRetryLoad={() => {}}
                  />

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
                    onMessageChange={handleMessageInputChange}
                    onTypingChange={notifyTyping}
                    onSubmit={handleSendMessage}
                    onFileSelect={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        if (activeSession?.assigned_role === 'peer_counselor') {
                          toast.error("Peer support sessions are text-only for now.");
                          return;
                        }
                        setSelectedFile(file);
                      }
                    }}
                    onAttachClick={() => {
                      if (activeSession?.assigned_role === 'peer_counselor') {
                        toast.error("Peer support sessions are text-only for now.");
                        return;
                      }
                      fileInputRef.current?.click();
                    }}
                    onVoiceToggle={() => {
                      if (activeSession?.assigned_role === 'peer_counselor') {
                        toast.error("Peer support sessions are text-only for now.");
                        return;
                      }
                      if (isRecording) { stopRecording(); setIsVoiceMode(false); }
                      else { setIsVoiceMode(true); startRecording(); }
                    }}
                    onVoicePause={pauseRecording}
                    onVoiceResume={resumeRecording}
                    onVoiceCancel={() => { cancelRecording(); setIsVoiceMode(false); }}
                    onRemoveFile={() => setSelectedFile(null)}
                    onEmojiClick={(data) => setMessage(prev => prev + data.emoji)}
                    fileInputRef={fileInputRef}
                  />

                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center overflow-y-auto p-3 sm:p-4 xl:hidden">
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
                 <div className="hidden xl:flex flex-1 flex-col items-center justify-center p-8 text-center animate-in fade-in zoom-in duration-700">
                    <div className="p-6 rounded-[2.5rem] bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/10 shadow-2xl shadow-primary/5 mb-6">
                      <Shield className="h-16 w-16 text-primary" />
                    </div>
                    <h2 className="text-2xl xl:text-3xl font-display font-bold tracking-tight mb-2">Clinical Safe Space</h2>
                    <p className="text-muted-foreground max-w-sm mx-auto leading-relaxed">
                      Select a conversation or start a new one to begin your secure, encrypted session with a qualified counselor.
                    </p>
                 </div>
              )}
              </>
            </div>
          </div>
        </ErrorBoundary>
      </div>
    </div>
  );
};

export default StudentChat;
