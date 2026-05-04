import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Shield,
  Loader2,
  X,
  Phone,
  Video,
  AlertTriangle,
  LayoutDashboard,
  MessageSquare,
  Calendar,
  Bot,
  History,
  Heart,
  Menu,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useEncryptedChat } from "@/hooks/useEncryptedChat";
import { useChatSession } from "@/hooks/useChatSession";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { useFileAttachment } from "@/hooks/useFileAttachment";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { toast } from "sonner";
import { API_RECOVERED_EVENT, api, getApiErrorMessage } from "@/lib/api";
import { MessageList } from "@/components/chat/MessageList";
import { ChatInput } from "@/components/chat/ChatInput";
import { ChatSidebar } from "@/components/chat/ChatSidebar";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/student/dashboard" },
  { label: "Chat", icon: MessageSquare, path: "/student/chat" },
  { label: "Appointments", icon: Calendar, path: "/student/appointments" },
  { label: "AI Support", icon: Bot, path: "/student/ai-support" },
  { label: "Video Call", icon: Video, path: "/student/video-call" },
  { label: "Past Sessions", icon: History, path: "/student/history" },
  { label: "Wellness", icon: Heart, path: "/student/wellness" },
];

// Note: Using placeholders for nav icons to keep this file cleaner, 
// DashboardSidebar handles the icon components if they match the label/path.

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
  const [counselorTotalItems, setCounselorTotalItems] = useState(0);
  const counselorPageRef = useRef(counselorPage);
  const [searchQuery, setSearchQuery] = useState("");
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [anonymousStartMode, setAnonymousStartMode] = useState(false);
  const [isTriggeringEmergency, setIsTriggeringEmergency] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageScrollAreaRef = useRef<HTMLDivElement>(null);
  const lastRenderedTailMessageIdRef = useRef<number | null>(null);
  const hasLoadedCounselorsRef = useRef(false);
  const { user } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split('@')[0] || "Student";

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
    isLoading: sessionLoading, 
    error: sessionError,
    selectSession,
    goToPrevPage: goToPrevSessionPage,
    goToNextPage: goToNextSessionPage,
    startSessionWithCounselor
  } = useChatSession(user?.id);

  const {
    messages,
    isLoading: messagesLoading,
    isLoadingOlderMessages,
    hasOlderMessages,
    isEncryptionReady,
    isPeerTyping,
    error: chatError,
    sendMessage: sendEncryptedMessage,
    deleteMessage,
    notifyTyping,
    loadOlderMessages,
    registerServerMessage,
    retryEncryption,
  } = useEncryptedChat({
    sessionId: sessionId || "",
    userId: user?.id?.toString() || "",
  });

  const [encryptionTimedOut, setEncryptionTimedOut] = useState(false);
  const [isRetryingEncryption, setIsRetryingEncryption] = useState(false);

  const {
    sendFileMessage,
    isUploading,
    uploadProgress,
    error: uploadError,
    clearError: clearUploadError,
  } = useFileAttachment({
    sessionId: sessionId || "",
  });

  // Cleanup voice recorder on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  // Encryption timeout: if not ready after 15s, show fallback UI
  useEffect(() => {
    if (!activeSession || isEncryptionReady || chatError) {
      setEncryptionTimedOut(false);
      return;
    }
    setEncryptionTimedOut(false);
    const timer = window.setTimeout(() => {
      if (!isEncryptionReady && !chatError) {
        setEncryptionTimedOut(true);
      }
    }, 15000);
    return () => window.clearTimeout(timer);
  }, [activeSession, isEncryptionReady, chatError]);

  const handleRetryEncryption = useCallback(async () => {
    setIsRetryingEncryption(true);
    setEncryptionTimedOut(false);
    try {
      await retryEncryption();
    } finally {
      setIsRetryingEncryption(false);
    }
  }, [retryEncryption]);

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
          setCounselorTotalItems(parsed.total_items || 0);
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
          setCounselorTotalItems(paged.meta?.total || nextCounselors.length);
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

  // Smart Scroll Management
  useEffect(() => {
    const latestMessageId = messages.length > 0 ? Number(messages[messages.length - 1]?.id) : null;
    if (!latestMessageId || !Number.isFinite(latestMessageId)) {
      lastRenderedTailMessageIdRef.current = null;
      return;
    }

    const previousTailId = lastRenderedTailMessageIdRef.current;
    if (previousTailId === null || (latestMessageId !== previousTailId && isAtBottom)) {
      if (scrollRef.current) {
        scrollRef.current.scrollIntoView({ 
          behavior: previousTailId === null ? "auto" : "smooth",
          block: "end"
        });
      }
    }
    lastRenderedTailMessageIdRef.current = latestMessageId;
  }, [messages, isAtBottom]);

  useEffect(() => {
    lastRenderedTailMessageIdRef.current = null;
    setDeletingMessageIds(new Set());
  }, [sessionId]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!message.trim() && !selectedFile && !recording) || isSending || !sessionId) return;
    if (message.trim() && !isEncryptionReady) {
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
        const success = await sendEncryptedMessage(message.trim());
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
    try {
      setIsPreparingCall(true);
      const scheduledAt = new Date(Date.now() + 60 * 1000).toISOString();
      const created = await api.createAppointment({
        counselor_id: activeSession.counselor_id,
        scheduled_at: scheduledAt,
        duration_minutes: 30,
        notes: "Online",
      });
      navigate(`/student/video-call?appointment_id=${created.id}&counselor_id=${activeSession.counselor_id}&mode=video&autostart=1`);
    } catch (error) {
      toast.error("Unable to start video call");
    } finally {
      setIsPreparingCall(false);
    }
  };

  const handleTriggerEmergency = async () => {
    if (!window.confirm("Trigger emergency alert? Our crisis team will be notified immediately.")) return;
    try {
      setIsTriggeringEmergency(true);
      await api.triggerEmergencyAlert();
      toast.success("Emergency alert triggered. Please stay on the line.");
    } catch (error) {
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
    if (session) selectSession(session);
  }, [sessions, selectSession]);

  const handleStartSessionWrapper = useCallback((id: number, isAnon: boolean) => {
    void startSessionWithCounselor(id, { isAnonymous: isAnon });
  }, [startSessionWithCounselor]);

  const handleDeleteMessageWrapper = useCallback(async (id: number) => {
    await deleteMessage(id);
  }, [deleteMessage]);

  // Refs for scroll handler to avoid re-creating callback on every message change
  const messagesLengthRef = useRef(messages.length);
  const hasOlderMessagesRef = useRef(hasOlderMessages);
  const isLoadingOlderMessagesRef = useRef(isLoadingOlderMessages);
  const loadOlderMessagesRef = useRef(loadOlderMessages);

  // Keep refs updated without causing re-renders
  messagesLengthRef.current = messages.length;
  hasOlderMessagesRef.current = hasOlderMessages;
  isLoadingOlderMessagesRef.current = isLoadingOlderMessages;
  loadOlderMessagesRef.current = loadOlderMessages;

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const viewport = e.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    const atBottom = scrollHeight - scrollTop - clientHeight < 50;
    setIsAtBottom(atBottom);
    setShowScrollToBottom(!atBottom && messagesLengthRef.current > 5);
    if (scrollTop < 80 && hasOlderMessagesRef.current && !isLoadingOlderMessagesRef.current) {
      loadOlderMessagesRef.current();
    }
  }, []); // Empty deps - uses refs for changing values

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <DashboardSidebar
        items={navItems}
        userType="student"
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {!activeSession && (
          <DashboardHeader
            title="Clinical Support"
            onMenuClick={() => setSidebarOpen(true)}
          />
        )}

        <ErrorBoundary>
          <div className="flex-1 flex overflow-hidden">
            {/* Chat Sidebar */}
            <div className="hidden lg:block">
              <ChatSidebar
                sessions={sessions}
                activeSession={activeSession}
                counselors={counselors}
                isCounselorsLoading={isCounselorsLoading}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onSelectSession={handleSelectSessionById}
                onStartSession={handleStartSessionWrapper}
                anonymousStartMode={anonymousStartMode}
                onToggleAnonymous={setAnonymousStartMode}
                counselorPage={counselorPage}
                counselorTotalPages={counselorTotalPages}
                onNextCounselorPage={() => setCounselorPage(p => Math.min(p + 1, counselorTotalPages))}
                onPrevCounselorPage={() => setCounselorPage(p => Math.max(p - 1, 1))}
                sessionPage={sessionPage}
                sessionTotalPages={sessionTotalPages}
                onNextSessionPage={goToNextSessionPage}
                onPrevSessionPage={goToPrevSessionPage}
              />
            </div>

            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col bg-gradient-to-b from-background to-secondary/10 relative min-h-0">
              {/* Handshake Indicator - non-blocking inline banner */}
              {activeSession && !isEncryptionReady && !chatError && !encryptionTimedOut && (
                <div className="shrink-0 bg-primary/10 border-b border-primary/20 px-4 py-2 flex items-center justify-center gap-3">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-xs font-bold uppercase tracking-widest text-primary/80">Securing your connection…</span>
                </div>
              )}

              {/* Encryption Timeout Fallback */}
              {activeSession && !isEncryptionReady && !chatError && encryptionTimedOut && (
                <div className="shrink-0 bg-amber-500/10 border-b border-amber-500/20 px-4 py-3 flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-3">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                  <span className="text-xs font-bold uppercase tracking-widest text-amber-700">Connection is taking longer than expected</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-3 text-xs rounded-full border-amber-500/30 text-amber-700 hover:bg-amber-500/10"
                    onClick={handleRetryEncryption}
                    disabled={isRetryingEncryption}
                  >
                    {isRetryingEncryption ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                    {isRetryingEncryption ? "Retrying…" : "Retry Connection"}
                  </Button>
                </div>
              )}

              {/* Encryption Error */}
              {activeSession && chatError && (
                <div className="shrink-0 bg-destructive/10 border-b border-destructive/20 px-4 py-3 flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-3">
                  <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                  <span className="text-xs font-bold uppercase tracking-widest text-destructive/80">{chatError}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-3 text-xs rounded-full border-destructive/30 text-destructive hover:bg-destructive/10"
                    onClick={handleRetryEncryption}
                    disabled={isRetryingEncryption}
                  >
                    {isRetryingEncryption ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                    {isRetryingEncryption ? "Retrying…" : "Retry"}
                  </Button>
                </div>
              )}

              {activeSession ? (
                <>
                  {/* Chat Header */}
                  <div className="shrink-0 p-4 lg:px-8 border-b border-border/50 bg-background/50 backdrop-blur-md flex items-center justify-between relative z-0">
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="icon" className="lg:hidden shrink-0" onClick={() => setSidebarOpen(true)}>
                        <Menu className="h-5 w-5" />
                      </Button>
                      <div className="flex items-center gap-4">
                        <Button variant="ghost" size="icon" className="lg:hidden shrink-0" onClick={() => selectSession(null)}>
                          <X className="h-5 w-5" />
                        </Button>
                        <div className="min-w-0">
                          <h2 className="text-lg font-bold truncate">
                            {activeSession.counselor?.profile?.full_name || "Support Session"}
                          </h2>
                          <div className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
                            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Session Active</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="icon" className="rounded-full hover:bg-primary/5 hover:text-primary" onClick={handleStartVideoCall} disabled={isPreparingCall}>
                        {isPreparingCall ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-5 w-5" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="rounded-full hover:bg-destructive/5 hover:text-destructive" onClick={handleTriggerEmergency} disabled={isTriggeringEmergency}>
                        <AlertTriangle className="h-5 w-5" />
                      </Button>
                    </div>
                  </div>

                  {/* Message List */}
                  <MessageList
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
                    onScroll={handleScroll}
                    onLoadOlder={loadOlderMessages}
                    onDeleteMessage={handleDeleteMessageWrapper}
                    scrollToBottom={() => scrollRef.current?.scrollIntoView({ behavior: "smooth" })}
                    messageScrollAreaRef={messageScrollAreaRef as any}
                    scrollRef={scrollRef}
                  />

                  {/* Chat Input */}
                  <ChatInput
                    message={message}
                    isSending={isSending}
                    isUploading={isUploading}
                    uploadProgress={uploadProgress}
                    isEncryptionReady={isEncryptionReady}
                    isVoiceMode={isVoiceMode}
                    recording={recording}
                    recordingTime={recordingTime}
                    isPaused={isPaused}
                    selectedFile={selectedFile}
                    onMessageChange={setMessage}
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
                <div className="flex-1 flex flex-col items-center justify-center p-4 lg:hidden overflow-y-auto">
                  <ChatSidebar
                    sessions={sessions}
                    activeSession={activeSession}
                    counselors={counselors}
                    isCounselorsLoading={isCounselorsLoading}
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    onSelectSession={handleSelectSessionById}
                    onStartSession={handleStartSessionWrapper}
                    anonymousStartMode={anonymousStartMode}
                    onToggleAnonymous={setAnonymousStartMode}
                    counselorPage={counselorPage}
                    counselorTotalPages={counselorTotalPages}
                    onNextCounselorPage={() => setCounselorPage(p => Math.min(p + 1, counselorTotalPages))}
                    onPrevCounselorPage={() => setCounselorPage(p => Math.max(p - 1, 1))}
                    sessionPage={sessionPage}
                    sessionTotalPages={sessionTotalPages}
                    onNextSessionPage={goToNextSessionPage}
                    onPrevSessionPage={goToPrevSessionPage}
                  />
                </div>
              )}
              
              {!activeSession && (
                 <div className="hidden lg:flex flex-1 flex-col items-center justify-center p-8 text-center animate-in fade-in zoom-in duration-700">
                    <div className="p-6 rounded-[2.5rem] bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/10 shadow-2xl shadow-primary/5 mb-6">
                      <Shield className="h-16 w-16 text-primary" />
                    </div>
                    <h2 className="text-3xl font-display font-bold tracking-tight mb-2">Clinical Safe Space</h2>
                    <p className="text-muted-foreground max-w-sm mx-auto leading-relaxed">
                      Select a conversation or start a new one to begin your secure, encrypted session with a qualified counselor.
                    </p>
                 </div>
              )}
            </div>
          </div>
        </ErrorBoundary>
      </div>
    </div>
  );
};

export default StudentChat;
