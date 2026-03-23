import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  MessageSquare,
  Calendar,
  Bot,
  Video,
  History,
  Heart,
  Send,
  Paperclip,
  Shield,
  AlertTriangle,
  Loader2,
  Mic,
  X,
  FileText,
  Image as ImageIcon,
  User,
  Search,
  Play,
  Pause,
  Phone,
  Square,
  Trash2,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/useAuth";
import { useEncryptedChat } from "@/hooks/useEncryptedChat";
import { useChatSession } from "@/hooks/useChatSession";
import { useFileAttachment } from "@/hooks/useFileAttachment";
import { useNetworkProfile } from "@/hooks/useNetworkProfile";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { toast } from "@/components/ui/sonner";
import { VoiceNotePlayer } from "@/components/VoiceNotePlayer";
import { format } from "date-fns";
import { API_RECOVERED_EVENT, api, getApiErrorMessage } from "@/lib/api";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/student/dashboard" },
  { label: "Chat", icon: MessageSquare, path: "/student/chat" },
  { label: "Appointments", icon: Calendar, path: "/student/appointments" },
  { label: "AI Support", icon: Bot, path: "/student/ai-support" },
  { label: "Video Call", icon: Video, path: "/student/video-call" },
  { label: "Past Sessions", icon: History, path: "/student/history" },
  { label: "Wellness", icon: Heart, path: "/student/wellness" },
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

const ONLINE_WINDOW_MS = 10 * 60 * 1000;
const COUNSELOR_CACHE_TTL_MS = 60 * 1000;
const COUNSELOR_REFRESH_INTERVAL_MS = 20 * 1000;
const COUNSELOR_LIST_TIMEOUT_MS = 30000;
const COUNSELOR_PAGE_SIZE = 24;

const isWithinOnlineWindow = (lastSeenAt?: string | null) => {
  if (!lastSeenAt) return false;
  const lastSeen = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(lastSeen)) return false;
  return Date.now() - lastSeen <= ONLINE_WINDOW_MS;
};

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
  const { lowBandwidth } = useNetworkProfile();
  const userName = user?.profile?.full_name || user?.email?.split('@')[0] || "Student";
  const counselorRefreshIntervalMs = lowBandwidth ? 90000 : COUNSELOR_REFRESH_INTERVAL_MS;

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
    sessionTotalItems,
    canGoToPrevPage: canGoToPrevSessionPage,
    canGoToNextPage: canGoToNextSessionPage,
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
    getEncryptionKey,
  } = useEncryptedChat({
    sessionId: sessionId || "",
    userId: user?.id?.toString() || "",
  });

  const {
    sendFileMessage,
    isUploading,
    uploadProgress,
    error: uploadError,
    clearError: clearUploadError,
  } = useFileAttachment({
    sessionId: sessionId || "",
    userId: user?.id?.toString() || "",
    encryptionKey: getEncryptionKey(),
  });

  // Cleanup voice recorder on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  useEffect(() => {
    setCounselorPage(1);
    setCounselorTotalPages(1);
    setCounselorTotalItems(0);
  }, [user?.id]);

  // Load counselors
  useEffect(() => {
    if (!user?.id) return;

    let active = true;
    const cacheKey = `student_chat_counselors_${user.id}_${counselorPage}`;
    const cachedRaw = localStorage.getItem(cacheKey);
    let cacheLoaded = false;

    hasLoadedCounselorsRef.current = false;
    setCounselors([]);
    setIsCounselorsLoading(true);

    if (cachedRaw) {
      try {
        const parsed = JSON.parse(cachedRaw) as {
          saved_at?: number;
          counselors?: Counselor[];
          total_pages?: number;
          total_items?: number;
        };
        const savedAt = Number(parsed?.saved_at || 0);
        const cachedCounselors = Array.isArray(parsed?.counselors) ? parsed.counselors : [];
        if (Number.isFinite(savedAt) && Date.now() - savedAt <= COUNSELOR_CACHE_TTL_MS) {
          setCounselors(cachedCounselors);
          setCounselorTotalPages(Math.max(1, Number(parsed?.total_pages || 1)));
          setCounselorTotalItems(Math.max(0, Number(parsed?.total_items || cachedCounselors.length)));
          setIsCounselorsLoading(false);
          hasLoadedCounselorsRef.current = true;
          cacheLoaded = true;
        }
      } catch {
        // ignore malformed cache
      }
    }

    const loadCounselors = async (showErrorToast = false) => {
      if (!active) return;

      try {
        const payload = (await api.getCounselors({
          lightweight: true,
          page: counselorPage,
          per_page: COUNSELOR_PAGE_SIZE,
          timeout_ms: COUNSELOR_LIST_TIMEOUT_MS,
        })) as CounselorListResponse;
        const pagedPayload =
          !Array.isArray(payload) && payload && typeof payload === "object" ? payload : null;
        const nextCounselors = (
          Array.isArray(payload)
            ? payload
            : Array.isArray(pagedPayload?.data)
            ? pagedPayload.data
            : []
        ) as Counselor[];
        const receivedPage = Number(pagedPayload?.meta?.page);
        const receivedTotalPages = Number(pagedPayload?.meta?.total_pages);
        const receivedTotal = Number(pagedPayload?.meta?.total);
        const nextPage = Number.isFinite(receivedPage) && receivedPage > 0 ? Math.floor(receivedPage) : 1;
        const nextTotalPages =
          Number.isFinite(receivedTotalPages) && receivedTotalPages > 0
            ? Math.floor(receivedTotalPages)
            : 1;
        const nextTotal = Number.isFinite(receivedTotal) && receivedTotal >= 0
          ? Math.floor(receivedTotal)
          : nextCounselors.length;

        if (active) {
          setCounselors(nextCounselors);
          setCounselorTotalPages(nextTotalPages);
          setCounselorTotalItems(nextTotal);
          if (!pagedPayload && counselorPage !== 1) {
            setCounselorPage(1);
          } else if (pagedPayload && nextPage !== counselorPage) {
            setCounselorPage(nextPage);
          }

          localStorage.setItem(
            cacheKey,
            JSON.stringify({
              saved_at: Date.now(),
              counselors: nextCounselors,
              total_pages: nextTotalPages,
              total_items: nextTotal,
            })
          );
        }
      } catch (err) {
        console.error("Failed to load counselors:", err);
        if (showErrorToast && !cacheLoaded) {
          toast.error(getApiErrorMessage(err, "Failed to load counselors"));
        }
      } finally {
        if (active) {
          if (!hasLoadedCounselorsRef.current) {
            setIsCounselorsLoading(false);
            hasLoadedCounselorsRef.current = true;
          }
        }
      }
    };

    void loadCounselors(!cacheLoaded);

    const onVisibilityOrFocus = () => {
      if (document.visibilityState !== "visible") return;
      void loadCounselors(false);
    };

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadCounselors(false);
    }, counselorRefreshIntervalMs);

    window.addEventListener("focus", onVisibilityOrFocus);
    window.addEventListener("online", onVisibilityOrFocus);
    window.addEventListener(API_RECOVERED_EVENT, onVisibilityOrFocus as EventListener);
    document.addEventListener("visibilitychange", onVisibilityOrFocus);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onVisibilityOrFocus);
      window.removeEventListener("online", onVisibilityOrFocus);
      window.removeEventListener(API_RECOVERED_EVENT, onVisibilityOrFocus as EventListener);
      document.removeEventListener("visibilitychange", onVisibilityOrFocus);
    };
  }, [counselorPage, counselorRefreshIntervalMs, user?.id]);

  useEffect(() => {
    const latestMessageId = messages.length > 0 ? Number(messages[messages.length - 1]?.id) : null;
    if (!latestMessageId || !Number.isFinite(latestMessageId)) {
      lastRenderedTailMessageIdRef.current = null;
      return;
    }

    const previousTailId = lastRenderedTailMessageIdRef.current;
    if (previousTailId === null || latestMessageId !== previousTailId) {
      if (scrollRef.current) {
        scrollRef.current.scrollIntoView({ behavior: previousTailId === null ? "auto" : "smooth" });
      }
    }
    lastRenderedTailMessageIdRef.current = latestMessageId;
  }, [messages]);

  useEffect(() => {
    lastRenderedTailMessageIdRef.current = null;
    setDeletingMessageIds(new Set());
  }, [sessionId]);

  useEffect(() => {
    if (chatError) {
      toast.error(chatError);
    }
    if (sessionError) {
      toast.error(sessionError);
    }
    if (uploadError) {
      toast.error(uploadError);
      clearUploadError();
    }
  }, [chatError, sessionError, uploadError, clearUploadError]);

  useEffect(() => {
    return () => {
      notifyTyping(false);
    };
  }, [notifyTyping]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!message.trim() && !selectedFile && !recording) || isSending || !sessionId) return;
    if (!isEncryptionReady) {
      toast.error("Secure channel is initializing. Please wait a few seconds.");
      return;
    }

    setIsSending(true);

    try {
      if (selectedFile) {
        const success = await sendFileMessage(selectedFile, sendEncryptedMessage);
        if (success) {
          setSelectedFile(null);
          toast.success("File sent successfully");
        } else {
          toast.error("Failed to send file");
        }
      }
      
      if (recording) {
        // Send voice recording as file
        const success = await sendFileMessage(recording.blob, sendEncryptedMessage);
        if (success) {
          clearRecording();
          toast.success("Voice message sent successfully");
        } else {
          toast.error("Failed to send voice message");
        }
      }
      
      if (message.trim()) {
        const success = await sendEncryptedMessage(message.trim());
        if (success) {
          setMessage("");
          notifyTyping(false);
        } else if (!chatError) {
          toast.error("Failed to send message");
        }
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to send message"));
    }
    
    setIsSending(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 8 * 1024 * 1024) {
        toast.error("File size exceeds 8MB limit");
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const handleVoiceToggle = () => {
    if (isRecording) {
      stopRecording();
      setIsVoiceMode(false);
    } else {
      setIsVoiceMode(!isVoiceMode);
      if (!isVoiceMode && !recording) {
        startRecording();
      }
    }
  };

  const handleVoiceCancel = () => {
    cancelRecording();
    setIsVoiceMode(false);
  };

  const handleDeleteMessage = async (messageId: number) => {
    if (!sessionId) return;
    if (!Number.isInteger(messageId) || messageId <= 0) return;

    let shouldDelete = false;
    setDeletingMessageIds((prev) => {
      if (prev.has(messageId)) return prev;
      shouldDelete = true;
      const next = new Set(prev);
      next.add(messageId);
      return next;
    });

    if (!shouldDelete) {
      return;
    }

    try {
      const success = await deleteMessage(messageId);
      if (success) {
        toast.success("Message deleted");
      }
    } finally {
      setDeletingMessageIds((prev) => {
        if (!prev.has(messageId)) return prev;
        const next = new Set(prev);
        next.delete(messageId);
        return next;
      });
    }
  };

  const resolveOrCreateCallAppointment = async (counselorId: number) => {
    const appointments = await api.getAppointments();
    const now = Date.now();
    const callReady = (Array.isArray(appointments) ? appointments : []).find((apt: any) => {
      if (Number(apt?.counselor_id) !== counselorId) return false;
      if (!(apt?.status === "scheduled" || apt?.status === "confirmed")) return false;
      const notes = String(apt?.notes || "").trim().toLowerCase();
      if (notes.startsWith("physical")) return false;

      const scheduledAt = new Date(apt?.scheduled_at || "").getTime();
      if (!Number.isFinite(scheduledAt)) return false;

      const durationMinutes = Number(apt?.duration_minutes) || 60;
      const opensAt = scheduledAt - 15 * 60 * 1000;
      const closesAt = scheduledAt + (durationMinutes + 15) * 60 * 1000;

      return now >= opensAt && now <= closesAt;
    });

    if (callReady?.id) {
      return Number(callReady.id);
    }

    const scheduledAt = new Date(Date.now() + 60 * 1000).toISOString();
    const created = await api.createAppointment({
      counselor_id: counselorId,
      scheduled_at: scheduledAt,
      duration_minutes: 30,
      notes: "Online",
    });

    return Number(created?.id);
  };

  const handleStartVideoCall = () => {
    const start = async () => {
      if (!activeSession?.counselor_id) {
        toast.error("Select a counselor conversation first");
        return;
      }

      try {
        setIsPreparingCall(true);
        const appointmentId = await resolveOrCreateCallAppointment(activeSession.counselor_id);
        navigate(
          `/student/video-call?appointment_id=${appointmentId}&counselor_id=${activeSession.counselor_id}&mode=video&autostart=1`
        );
      } catch (error: any) {
        toast.error(getApiErrorMessage(error, "Unable to start video call"));
      } finally {
        setIsPreparingCall(false);
      }
    };

    void start();
  };

  const handleStartAudioCall = () => {
    const start = async () => {
      if (!activeSession?.counselor_id) {
        toast.error("Select a counselor conversation first");
        return;
      }

      try {
        setIsPreparingCall(true);
        const appointmentId = await resolveOrCreateCallAppointment(activeSession.counselor_id);
        navigate(
          `/student/video-call?appointment_id=${appointmentId}&counselor_id=${activeSession.counselor_id}&mode=audio&autostart=1`
        );
      } catch (error: any) {
        toast.error(getApiErrorMessage(error, "Unable to start audio call"));
      } finally {
        setIsPreparingCall(false);
      }
    };

    void start();
  };

  const formatRecordingTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const removeSelectedFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const formatTime = (dateString: string) => {
    try {
      return format(new Date(dateString), "h:mm a");
    } catch {
      return "";
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const renderMessageContent = (msg: any) => {
    const content = msg.decryptedContent || msg.content;

    if (msg.message_type === "voice") {
      return <VoiceNotePlayer messageId={msg.id} />;
    }
    
    if (msg.message_type === 'file') {
      try {
        const fileInfo = JSON.parse(content);
        const isAudio = fileInfo.fileType?.startsWith('audio/');
        const isImage = fileInfo.fileType?.startsWith('image/');
        const resolvedUrl = msg.file_url || fileInfo.url;

        if (!resolvedUrl) {
          return <p>Attachment unavailable</p>;
        }
        
        if (isAudio && resolvedUrl) {
          return (
            <div className="space-y-2">
              <audio controls className="w-full max-w-xs">
                <source src={resolvedUrl} type={fileInfo.fileType} />
                Your browser does not support the audio element.
              </audio>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Mic className="h-3 w-3" />
                <span>Voice message</span>
                <span>|</span>
                <span>{formatFileSize(fileInfo.fileSize)}</span>
              </div>
            </div>
          );
        }
        
        return (
          <div className="space-y-2">
            <a 
              href={resolvedUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-2 p-2 rounded-lg bg-background/50 hover:bg-background/80 transition-colors"
            >
              {isImage ? (
                <ImageIcon className="h-4 w-4" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{fileInfo.fileName}</p>
                <p className="text-xs opacity-70">{formatFileSize(fileInfo.fileSize)}</p>
              </div>
            </a>
          </div>
        );
      } catch {
        return <p>{content}</p>;
      }
    }
    
    return <p>{content}</p>;
  };

  const isInitialLoading = sessionLoading || (Boolean(sessionId) && messagesLoading && messages.length === 0);
  const showLoadingBubble = Boolean(sessionId) && messagesLoading && messages.length > 0;
  const visibleMessages = messages;
  const handleLoadOlderMessages = useCallback(async () => {
    if (!sessionId) return;
    if (!hasOlderMessages || isLoadingOlderMessages) return;

    const viewport = messageScrollAreaRef.current?.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]"
    );
    const previousScrollHeight = viewport?.scrollHeight ?? 0;
    const previousScrollTop = viewport?.scrollTop ?? 0;

    await loadOlderMessages();

    if (!viewport) return;
    window.requestAnimationFrame(() => {
      const nextScrollHeight = viewport.scrollHeight;
      const preservedTop = nextScrollHeight - previousScrollHeight + previousScrollTop;
      viewport.scrollTop = Math.max(0, preservedTop);
    });
  }, [hasOlderMessages, isLoadingOlderMessages, loadOlderMessages, sessionId]);

  useEffect(() => {
    if (!sessionId) return;

    const viewport = messageScrollAreaRef.current?.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]"
    );
    if (!viewport) return;

    const onScroll = () => {
      if (viewport.scrollTop > 80) return;
      if (!hasOlderMessages || isLoadingOlderMessages) return;
      void handleLoadOlderMessages();
    };

    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      viewport.removeEventListener("scroll", onScroll);
    };
  }, [handleLoadOlderMessages, hasOlderMessages, isLoadingOlderMessages, sessionId]);

  const filteredCounselors = counselors.filter(c => 
    c.profile?.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const onlineCounselors = filteredCounselors.filter((counselor) => counselor.is_online);
  const isPeerAssignedSession = (session: any) =>
    Boolean(
      session &&
      session.assigned_role === "peer_counselor" &&
      Number(session.peer_counselor_id) > 0
    );
  const hasOpenSessionWithCounselor = (counselorId: number, isAnonymous: boolean) =>
    sessions.some(
      (session) =>
        session.counselor_id === counselorId &&
        !isPeerAssignedSession(session) &&
        Boolean(session.is_anonymous) === isAnonymous &&
        session.status !== "completed" &&
        session.status !== "cancelled"
    );
  const availableCounselors = filteredCounselors.filter(
    (counselor) => !hasOpenSessionWithCounselor(counselor.id, anonymousStartMode)
  );
  const filteredCounselorCount = filteredCounselors.length;
  const counselorEmptyStateLabel = searchQuery.trim()
    ? "No counselors match your search."
    : "No counselors found right now.";
  const canGoToPrevCounselorPage = counselorPage > 1;
  const canGoToNextCounselorPage = counselorPage < counselorTotalPages;
  const counselorMap = useMemo(() => {
    const map = new Map<number, Counselor>();
    counselors.forEach((counselor) => {
      map.set(counselor.id, counselor);
    });
    return map;
  }, [counselors]);

  const activeCounselor = activeSession?.counselor_id
    ? counselorMap.get(activeSession.counselor_id)
    : undefined;
  const activeSessionIsPeerAssigned = isPeerAssignedSession(activeSession);
  const currentUserId = Number(user?.id);
  const isRecipientOnline = useMemo(() => {
    if (!activeSession) return false;

    if (activeSessionIsPeerAssigned) {
      const peer = activeSession.peer_counselor;
      if (peer?.is_online === true) {
        return true;
      }

      return isWithinOnlineWindow(peer?.last_seen_at);
    }

    if (activeCounselor?.is_online === true) {
      return true;
    }

    if (isWithinOnlineWindow(activeCounselor?.last_seen_at)) {
      return true;
    }

    if (activeSession.counselor?.is_online === true) {
      return true;
    }

    return isWithinOnlineWindow(activeSession.counselor?.last_seen_at);
  }, [activeCounselor, activeSession, activeSessionIsPeerAssigned]);

  const getCounselorLabel = (session: any) =>
    (session.assigned_role === "peer_counselor"
      ? session.peer_counselor?.profile?.full_name || session.peer_counselor?.email
      : null) ||
    session.counselor?.profile?.full_name ||
    (session.counselor_id ? counselorMap.get(session.counselor_id)?.profile?.full_name : undefined) ||
    session.counselor?.email ||
    (session.assigned_role === "peer_counselor" ? "Peer Counselor" : "Counselor");

  const getCounselorOnline = (session: any) => {
    if (!session) return false;

    if (isPeerAssignedSession(session)) {
      if (session.peer_counselor?.is_online === true) {
        return true;
      }
      return isWithinOnlineWindow(session.peer_counselor?.last_seen_at);
    }

    const counselorId = Number(session.counselor_id || 0);
    const counselorFromList = counselorId > 0 ? counselorMap.get(counselorId) : undefined;
    if (counselorFromList?.is_online === true) {
      return true;
    }
    if (isWithinOnlineWindow(counselorFromList?.last_seen_at)) {
      return true;
    }
    if (session.counselor?.is_online === true) {
      return true;
    }

    return isWithinOnlineWindow(session.counselor?.last_seen_at);
  };

  const getSessionStatusText = (session: any) => {
    if (isPeerAssignedSession(session)) {
      return "Peer support assigned";
    }
    return getCounselorOnline(session) ? "Online" : "Offline";
  };

  const handlePrevCounselorPage = () => {
    if (!canGoToPrevCounselorPage || isCounselorsLoading) return;
    setCounselorPage((current) => Math.max(1, current - 1));
  };

  const handleNextCounselorPage = () => {
    if (!canGoToNextCounselorPage || isCounselorsLoading) return;
    setCounselorPage((current) => Math.min(counselorTotalPages, current + 1));
  };

  const handleTriggerEmergency = async () => {
    if (!sessionId || isTriggeringEmergency) return;

    const confirmed = window.confirm(
      "Trigger emergency escalation for this chat now? Your counselor team will be alerted immediately."
    );
    if (!confirmed) return;

    try {
      setIsTriggeringEmergency(true);
      await api.panicEscalateSession(sessionId, {
        reason: "Student emergency request from chat",
      });
      toast.success("Emergency escalation sent.");
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to trigger emergency escalation");
    } finally {
      setIsTriggeringEmergency(false);
    }
  };

  const renderCounselorButton = (counselor: Counselor) => (
    <button
      key={counselor.id}
      onClick={async () => {
        const result = await startSessionWithCounselor(counselor.id, {
          isAnonymous: anonymousStartMode,
        });
        if (result && anonymousStartMode) {
          setAnonymousStartMode(false);
          toast.success("Anonymous support session started.");
        }
      }}
      className="group w-full rounded-[1.35rem] border border-transparent bg-background/70 p-4 text-left text-foreground shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/20 hover:bg-background hover:shadow-md"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-secondary/70 text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
          <User className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate font-bold">{counselor.profile?.full_name || counselor.email}</p>
            <span
              className={`inline-flex h-2.5 w-2.5 shrink-0 rounded-full ${
                counselor.is_online ? "bg-success" : "bg-muted-foreground/30"
              }`}
            />
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs">
            <span className={counselor.is_online ? "text-success" : "text-muted-foreground"}>
              {counselor.is_online ? "Online now" : "Available to message"}
            </span>
            <span className="text-muted-foreground/50">|</span>
            <span className="text-muted-foreground">Tap to start a secure chat</span>
          </div>
        </div>
      </div>
    </button>
  );

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
          title="Messages"
          onMenuClick={() => setSidebarOpen(true)}
        />

        <main className="h-[calc(100vh-80px)] bg-gradient-to-br from-background via-background to-primary/5 p-3 lg:h-[calc(100vh-100px)] lg:p-6">
          <Card className="flex h-full flex-col overflow-hidden rounded-[2rem] border border-border/50 bg-background/80 shadow-[0_25px_80px_-45px_rgba(15,23,42,0.45)] backdrop-blur-sm lg:flex-row">

            {/* Left Sidebar: Counselor/Chat List */}
            <div className="flex h-full w-full flex-col border-r border-border/50 bg-secondary/10 lg:w-[390px]">
              <div className="border-b border-border/50 p-4 lg:p-5">
                <div className="rounded-[1.75rem] border border-primary/15 bg-gradient-to-br from-primary/12 via-background to-background p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-primary/80">
                        Secure Space
                      </p>
                      <h2 className="mt-2 text-2xl font-display font-bold text-foreground">Chats</h2>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        Resume conversations, discover counselors, or start an anonymous support thread.
                      </p>
                    </div>
                    <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-background/80 shadow-sm sm:flex">
                      <MessageSquare className="h-5 w-5 text-primary" />
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <div className="rounded-full border border-border/60 bg-background/80 px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm">
                      {sessionTotalItems} active
                    </div>
                    <div className="rounded-full border border-border/60 bg-background/80 px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm">
                      {onlineCounselors.length} online
                    </div>
                    <div className="rounded-full border border-border/60 bg-background/80 px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm">
                      {filteredCounselorCount} visible
                    </div>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search counselors..."
                      className="h-12 rounded-2xl border-border/60 bg-background/80 pl-11 pr-4 shadow-sm focus-visible:ring-primary/20"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                  <Button
                    type="button"
                    variant={anonymousStartMode ? "default" : "outline"}
                    className={`h-auto w-full justify-start rounded-2xl px-4 py-4 text-left shadow-sm ${
                      anonymousStartMode
                        ? "border-primary/30 bg-primary text-primary-foreground shadow-primary/20"
                        : "border-border/60 bg-background/80 hover:bg-background"
                    }`}
                    onClick={() => setAnonymousStartMode((prev) => !prev)}
                  >
                    <Shield className="mr-3 h-5 w-5 shrink-0" />
                    <div>
                      <div className="font-semibold">
                        {anonymousStartMode ? "Anonymous support is on" : "Start anonymous support"}
                      </div>
                      <div className={`text-xs ${anonymousStartMode ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                        {anonymousStartMode
                          ? "Pick a counselor or existing thread to keep your identity hidden."
                          : "Turn this on before starting a new chat."}
                      </div>
                    </div>
                  </Button>
                </div>
              </div>

              <ScrollArea className="flex-1">
                <div className="space-y-5 p-4">
                  <section className="rounded-[1.75rem] border border-border/60 bg-background/80 p-3 shadow-sm">
                    <div className="mb-3 flex items-start justify-between gap-3 px-1">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
                          Active Conversations
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">Pick up where you left off.</p>
                      </div>
                      <span className="rounded-full bg-secondary/80 px-2.5 py-1 text-[11px] font-semibold text-foreground">
                        {sessionTotalItems}
                      </span>
                    </div>

                    <div className="mb-3 flex items-center justify-between gap-2 px-1 text-[11px] text-muted-foreground">
                      <span>Page {sessionPage} of {Math.max(1, sessionTotalPages)}</span>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 rounded-full border-border/60 px-2 text-xs"
                          onClick={goToPrevSessionPage}
                          disabled={!canGoToPrevSessionPage || sessionLoading}
                        >
                          Prev
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 rounded-full border-border/60 px-2 text-xs"
                          onClick={goToNextSessionPage}
                          disabled={!canGoToNextSessionPage || sessionLoading}
                        >
                          Next
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {!sessionLoading && sessions.length === 0 && (
                        <div className="rounded-[1.4rem] border border-dashed border-border/70 bg-secondary/20 px-4 py-8 text-center text-sm text-muted-foreground">
                          No active conversations yet.
                        </div>
                      )}
                      {sessions.map((session) => (
                        <button
                          key={session.id}
                          onClick={async () => {
                            if (
                              anonymousStartMode &&
                              !session.is_anonymous &&
                              Number(session.counselor_id) > 0
                            ) {
                              const result = await startSessionWithCounselor(Number(session.counselor_id), {
                                isAnonymous: true,
                              });
                              if (result) {
                                setAnonymousStartMode(false);
                                toast.success("Anonymous support session started.");
                              }
                              return;
                            }

                            selectSession(session);
                          }}
                          className={`w-full rounded-[1.4rem] border p-4 text-left transition-all duration-300 ${
                            activeSession?.id === session.id
                              ? "border-primary/30 bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                              : "border-transparent bg-background/70 hover:border-primary/15 hover:bg-background"
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
                              activeSession?.id === session.id ? "bg-white/15" : "bg-primary/10"
                            }`}>
                              <User className={`h-5 w-5 ${activeSession?.id === session.id ? "text-white" : "text-primary"}`} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-3">
                                <p className="truncate font-bold">{getCounselorLabel(session)}</p>
                                <span
                                  className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                                    activeSession?.id === session.id
                                      ? "bg-white/15 text-white/80"
                                      : "bg-secondary/70 text-muted-foreground"
                                  }`}
                                >
                                  {format(new Date(session.created_at), "h:mm a")}
                                </span>
                              </div>
                              <p
                                className={`mt-1 truncate text-xs ${
                                  activeSession?.id === session.id
                                    ? "text-white/75"
                                    : isPeerAssignedSession(session)
                                    ? "text-primary"
                                    : getCounselorOnline(session)
                                    ? "text-success"
                                    : "text-muted-foreground"
                                }`}
                              >
                                {getSessionStatusText(session)}
                              </p>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-[1.75rem] border border-border/60 bg-background/80 p-3 shadow-sm">
                    <div className="mb-3 flex items-start justify-between gap-3 px-1">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
                          Online Counselors
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">Start with someone available right now.</p>
                      </div>
                      <span className="rounded-full bg-success/10 px-2.5 py-1 text-[11px] font-semibold text-success">
                        {onlineCounselors.length}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {isCounselorsLoading ? (
                        <div className="rounded-[1.4rem] border border-dashed border-border/70 bg-secondary/20 px-4 py-8 text-center text-sm text-muted-foreground">
                          Loading counselors...
                        </div>
                      ) : onlineCounselors.length === 0 ? (
                        <div className="rounded-[1.4rem] border border-dashed border-border/70 bg-secondary/20 px-4 py-8 text-center text-sm text-muted-foreground">
                          No counselors are online right now.
                        </div>
                      ) : (
                        onlineCounselors.map((counselor) => renderCounselorButton(counselor))
                      )}
                    </div>
                  </section>

                  <section className="rounded-[1.75rem] border border-border/60 bg-background/80 p-3 shadow-sm">
                    <div className="mb-3 flex items-start justify-between gap-3 px-1">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
                          Available Counselors
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">Browse the current counselor directory.</p>
                      </div>
                      <span className="rounded-full bg-secondary/80 px-2.5 py-1 text-[11px] font-semibold text-foreground">
                        {counselorTotalItems}
                      </span>
                    </div>

                    <div className="mb-3 flex items-center justify-between gap-2 px-1 text-[11px] text-muted-foreground">
                      <span>Page {counselorPage} of {Math.max(1, counselorTotalPages)}</span>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 rounded-full border-border/60 px-2 text-xs"
                          onClick={handlePrevCounselorPage}
                          disabled={!canGoToPrevCounselorPage || isCounselorsLoading}
                        >
                          Prev
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 rounded-full border-border/60 px-2 text-xs"
                          onClick={handleNextCounselorPage}
                          disabled={!canGoToNextCounselorPage || isCounselorsLoading}
                        >
                          Next
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {isCounselorsLoading ? (
                        <div className="rounded-[1.4rem] border border-dashed border-border/70 bg-secondary/20 px-4 py-8 text-center text-sm text-muted-foreground">
                          Loading counselors...
                        </div>
                      ) : availableCounselors.length === 0 ? (
                        <div className="rounded-[1.4rem] border border-dashed border-border/70 bg-secondary/20 px-4 py-8 text-center text-sm text-muted-foreground">
                          {counselorEmptyStateLabel}
                        </div>
                      ) : (
                        availableCounselors.map((counselor) => renderCounselorButton(counselor))
                      )}
                    </div>
                  </section>
                </div>
              </ScrollArea>
            </div>

            {/* Right Side: Chat Window */}
            <div className="relative flex h-full flex-1 flex-col bg-gradient-to-b from-background via-secondary/10 to-background">
              {!sessionId ? (
                <div className="flex h-full items-center justify-center p-6 lg:p-10">
                  <div className="relative w-full max-w-4xl overflow-hidden rounded-[2.5rem] border border-primary/10 bg-gradient-to-br from-background via-background to-primary/5 p-8 text-center shadow-[0_30px_90px_-50px_rgba(15,23,42,0.45)] sm:p-10 lg:p-14">
                    <div className="absolute -left-12 -top-12 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
                    <div className="absolute -bottom-12 -right-12 h-44 w-44 rounded-full bg-info/10 blur-3xl" />

                    <div className="relative">
                      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-[1.75rem] bg-background/85 shadow-lg ring-1 ring-border/60">
                        <MessageSquare className="h-10 w-10 text-primary" />
                      </div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-primary/80">
                        Private Support
                      </p>
                      <h3 className="mt-4 font-display text-3xl font-bold text-foreground lg:text-4xl">
                        Start a conversation that feels safe and simple
                      </h3>
                      <p className="mx-auto mt-4 max-w-2xl text-base leading-8 text-muted-foreground lg:text-lg">
                        Choose a counselor from the left panel to begin a secure chat. If you want extra privacy, switch on anonymous support before you start.
                      </p>

                      <div className="mt-8 grid gap-3 text-left sm:grid-cols-3">
                        <div className="rounded-[1.5rem] border border-border/60 bg-background/80 p-4 shadow-sm">
                          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
                            <Shield className="h-5 w-5 text-success" />
                          </div>
                          <p className="font-semibold text-foreground">End-to-end encrypted</p>
                          <p className="mt-1 text-sm leading-6 text-muted-foreground">
                            Your messages stay protected from the moment you send them.
                          </p>
                        </div>
                        <div className="rounded-[1.5rem] border border-border/60 bg-background/80 p-4 shadow-sm">
                          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
                            <User className="h-5 w-5 text-primary" />
                          </div>
                          <p className="font-semibold text-foreground">Anonymous option</p>
                          <p className="mt-1 text-sm leading-6 text-muted-foreground">
                            Start a support session without revealing your identity first.
                          </p>
                        </div>
                        <div className="rounded-[1.5rem] border border-border/60 bg-background/80 p-4 shadow-sm">
                          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
                            <Search className="h-5 w-5 text-primary" />
                          </div>
                          <p className="font-semibold text-foreground">Live counselor list</p>
                          <p className="mt-1 text-sm leading-6 text-muted-foreground">
                            See who is online and begin a conversation without extra steps.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {/* Chat Header */}
                  <div className="sticky top-0 z-10 border-b border-border/60 bg-background/85 px-4 py-4 backdrop-blur-md lg:px-6 lg:py-5">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                      <div className="flex items-start gap-4">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[1.4rem] bg-primary/10 shadow-lg shadow-primary/5">
                          <User className="h-6 w-6 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-lg font-bold leading-none lg:text-xl">
                              {activeSession ? getCounselorLabel(activeSession) : "Counselor"}
                            </h2>
                            <span
                              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                                activeSessionIsPeerAssigned
                                  ? "bg-primary/10 text-primary"
                                  : isRecipientOnline
                                  ? "bg-success/10 text-success"
                                  : "bg-secondary/80 text-muted-foreground"
                              }`}
                            >
                              {activeSessionIsPeerAssigned
                                ? "Peer support assigned"
                                : isRecipientOnline
                                ? "Online"
                                : "Away"}
                            </span>
                          </div>
                          <p className="mt-2 text-sm text-muted-foreground">
                            {activeSession?.is_anonymous
                              ? "Anonymous support is enabled for this session."
                              : "Secure counseling conversation"}
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            {activeSessionIsPeerAssigned && (
                              <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-primary">
                                <span>Peer Counselor Assigned</span>
                              </div>
                            )}
                            {activeSession?.is_anonymous && (
                              <div className="inline-flex items-center gap-2 rounded-full bg-secondary/70 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-foreground">
                                <span>Anonymous Session</span>
                              </div>
                            )}
                            <div className="inline-flex items-center gap-2 rounded-full bg-secondary/70 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                              <Shield className="h-3 w-3 text-success" />
                              <span>{isEncryptionReady ? "Encrypted" : "Securing..."}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2 rounded-2xl border-destructive/30 bg-background/70 text-destructive hover:bg-destructive/5 hover:text-destructive"
                          onClick={handleTriggerEmergency}
                          disabled={isTriggeringEmergency || !activeSession}
                          title="Trigger emergency escalation"
                        >
                          <AlertTriangle className="h-4 w-4" />
                          {isTriggeringEmergency ? "Alerting..." : "Panic"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2 rounded-2xl border-border/60 bg-background/70"
                          onClick={handleStartAudioCall}
                          title="Start audio call"
                          disabled={isPreparingCall}
                        >
                          <Phone className="h-4 w-4" />
                          <span className="hidden sm:inline">Audio</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2 rounded-2xl border-border/60 bg-background/70"
                          onClick={handleStartVideoCall}
                          title="Start video call"
                          disabled={isPreparingCall}
                        >
                          <Video className="h-4 w-4" />
                          <span className="hidden sm:inline">Video</span>
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Message List */}
                  <ScrollArea ref={messageScrollAreaRef} className="flex-1 px-4 lg:px-6">
                    <div className="mx-auto max-w-5xl space-y-6 py-6">
                      {sessionId && hasOlderMessages && (
                        <div className="flex justify-center">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="rounded-full border-border/60 bg-background/80"
                            onClick={() => {
                              void handleLoadOlderMessages();
                            }}
                            disabled={isLoadingOlderMessages}
                          >
                            {isLoadingOlderMessages ? (
                              <span className="inline-flex items-center gap-2">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Loading older...
                              </span>
                            ) : (
                              "Load older messages"
                            )}
                          </Button>
                        </div>
                      )}
                      {visibleMessages.length === 0 && !isInitialLoading && (
                        <div className="mx-auto max-w-md rounded-[1.75rem] border border-dashed border-primary/20 bg-background/80 px-6 py-10 text-center shadow-sm">
                          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-secondary/50 px-4 py-2 text-xs text-muted-foreground">
                            <Shield className="h-3 w-3" />
                            Messages are end-to-end encrypted
                          </div>
                          <p className="text-base font-semibold text-foreground">Say hello to your counselor</p>
                          <p className="mt-2 text-sm text-muted-foreground">
                            This space is ready whenever you are.
                          </p>
                        </div>
                      )}
                      
                    {visibleMessages.map((msg) => (
                      <div
                        key={msg.id}
                          className={`flex ${msg.sender_id === currentUserId ? "justify-end" : "justify-start"}`}
                        >
                          <div className={`group flex flex-col gap-1 max-w-[85%] sm:max-w-[70%] ${msg.sender_id === currentUserId ? "items-end" : "items-start"}`}>
                            <div
                              className={`p-4 rounded-[1.5rem] transition-all duration-300 shadow-sm ${
                                msg.sender_id === currentUserId
                                  ? "bg-primary text-primary-foreground rounded-br-none"
                                  : "bg-secondary/50 text-foreground rounded-bl-none border border-border/50"
                              }`}
                            >
                              <div className="text-base leading-relaxed">
                          {renderMessageContent(msg)}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 px-1">
                              {msg.sender_id === currentUserId && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-5 w-5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={() => {
                                    void handleDeleteMessage(msg.id);
                                  }}
                                  disabled={deletingMessageIds.has(msg.id)}
                                  title="Delete message"
                                >
                                  {deletingMessageIds.has(msg.id) ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-3 w-3" />
                                  )}
                                </Button>
                              )}
                              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                              {formatTime(msg.created_at)}
                            </span>
                              {msg.sender_id === currentUserId && (
                                <div className="flex ml-1">
                                  <span
                                    className={`text-[10px] font-semibold ${
                                      msg.seen_at ? "text-success" : "text-muted-foreground"
                                    }`}
                                    aria-label={msg.seen_at ? "Seen" : "Sent"}
                                    title={msg.seen_at ? "Seen" : "Sent"}
                                  >
                                    {msg.seen_at ? "Seen" : "Sent"}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                      {showLoadingBubble && (
                        <div className="flex justify-start">
                          <div className="bg-secondary/50 p-4 rounded-[1.5rem] rounded-bl-none border border-border/50">
                            <div className="flex gap-1">
                              <span className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                              <span className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                              <span className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: '300ms' }} />
                          </div>
                        </div>
                      </div>
                      )}
                      {isPeerTyping && (
                        <div className="flex justify-start">
                          <div className="bg-secondary/50 p-4 rounded-[1.5rem] rounded-bl-none border border-border/50">
                            <div className="flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full bg-primary/45 animate-bounce" style={{ animationDelay: "0ms" }} />
                              <span className="h-2 w-2 rounded-full bg-primary/45 animate-bounce" style={{ animationDelay: "120ms" }} />
                              <span className="h-2 w-2 rounded-full bg-primary/45 animate-bounce" style={{ animationDelay: "240ms" }} />
                            </div>
                          </div>
                        </div>
                      )}
                    <div ref={scrollRef} />
                  </div>
              </ScrollArea>

                  {/* Chat Input Area */}
                  <div className="border-t border-border/50 bg-background/90 p-4 lg:p-6">
                    <div className="mx-auto max-w-5xl">
              {/* File preview */}
              {selectedFile && (
                <div className="mb-4 animate-in slide-in-from-bottom-2 duration-300">
                  <div className="flex items-center gap-3 p-3 rounded-2xl bg-primary/5 border border-primary/10">
                    <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                      {selectedFile.type.startsWith('image/') ? <ImageIcon className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate">{selectedFile.name}</p>
                      <p className="text-[10px] font-medium text-muted-foreground uppercase">{formatFileSize(selectedFile.size)}</p>
                    </div>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={removeSelectedFile}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  {isUploading && <Progress value={uploadProgress} className="h-1 mt-2 rounded-full" />}
                </div>
              )}

              {/* Voice recording preview */}
              {recording && (
                <div className="mb-4 animate-in slide-in-from-bottom-2 duration-300">
                  <div className="flex items-center gap-3 p-3 rounded-2xl bg-primary/5 border border-primary/10">
                    <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary animate-pulse">
                      <Mic className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate">Voice Message</p>
                      <p className="text-[10px] font-medium text-muted-foreground uppercase">{formatRecordingTime(recordingTime)} | {formatFileSize(recording.blob.size)}</p>
                    </div>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={clearRecording}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

                      <form onSubmit={handleSendMessage} className="relative flex items-center gap-2 rounded-[1.75rem] border border-border/60 bg-background/90 p-2 shadow-sm">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    className="hidden"
                    accept="image/*,audio/*,.pdf,.doc,.docx,.txt"
                  />
                  <Button 
                    type="button" 
                    variant="ghost" 
                    size="icon"
                    className="h-12 w-12 rounded-2xl bg-secondary/40 hover:bg-secondary/60 transition-all shrink-0"
                    onClick={handleAttachClick}
                    disabled={isUploading || isRecording}
                  >
                    <Paperclip className="h-5 w-5 text-muted-foreground" />
                  </Button>
                        <div className="flex-1 relative">
                  {!isVoiceMode ? (
                    <>
                      <Input
                        placeholder="Type a message..."
                        value={message}
                        onChange={(e) => {
                          const nextMessage = e.target.value;
                          setMessage(nextMessage);
                          notifyTyping(nextMessage.trim().length > 0);
                        }}
                        onBlur={() => notifyTyping(false)}
                        className="h-12 rounded-2xl border-none bg-secondary/30 pl-4 pr-20 text-base focus-visible:ring-primary/20"
                        disabled={isSending || isUploading}
                      />
                      <div className="absolute right-1 top-1 flex gap-1">
                        <Button 
                          type="button" 
                          variant="ghost" 
                          size="icon"
                          className="h-10 w-10 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-all shrink-0"
                          onClick={handleVoiceToggle}
                          disabled={isSending || isUploading}
                        >
                          <Mic className="h-5 w-5 text-muted-foreground" />
                        </Button>
                        <Button 
                          type="submit" 
                          variant="hero" 
                          size="icon"
                          className="h-10 w-10 rounded-xl bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all active:scale-95 shrink-0"
                          disabled={
                            (!message.trim() && !selectedFile && !recording) ||
                            isSending ||
                            isUploading ||
                            !isEncryptionReady
                          }
                        >
                          {isSending || isUploading ? (
                            <Loader2 className="h-5 w-5 animate-spin" />
                          ) : (
                            <Send className="h-5 w-5" />
                          )}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-2 h-12 px-4 rounded-2xl bg-secondary/30 border-none">
                      {isRecording ? (
                        <>
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
                            <span className="text-sm font-medium">{formatRecordingTime(recordingTime)}</span>
                          </div>
                          <div className="flex-1" />
                          <div className="flex gap-1">
                            <Button 
                              type="button" 
                              variant="ghost" 
                              size="icon"
                              className="h-8 w-8 rounded-full"
                              onClick={isPaused ? resumeRecording : pauseRecording}
                            >
                              {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                            </Button>
                            <Button 
                              type="button" 
                              variant="ghost" 
                              size="icon"
                              className="h-8 w-8 rounded-full text-destructive hover:text-destructive"
                              onClick={handleVoiceCancel}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                            <Button 
                              type="button" 
                              variant="hero" 
                              size="icon"
                              className="h-8 w-8 rounded-xl bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all active:scale-95"
                              onClick={handleVoiceToggle}
                            >
                              <Square className="h-4 w-4" />
                            </Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <Mic className="h-5 w-5 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">Tap to record</span>
                          </div>
                          <div className="flex-1" />
                          <Button 
                            type="button" 
                            variant="ghost" 
                            size="icon"
                            className="h-8 w-8 rounded-full"
                            onClick={() => setIsVoiceMode(false)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </form>
                    </div>
                  </div>
                </>
              )}
            </div>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default StudentChat;



