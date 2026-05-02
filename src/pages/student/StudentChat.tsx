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
  X,
  FileText,
  Image as ImageIcon,
  Mic,
  User,
  Search,
  MoreVertical,
  Play,
  Pause,
  Phone,
  Square,
  Trash2,
  ArrowLeft,
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
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { toast } from "sonner";
import { format } from "date-fns";
import { API_RECOVERED_EVENT, api, getApiErrorMessage } from "@/lib/api";
import {
  CHAT_ATTACHMENT_ACCEPT,
  formatChatFileSize,
  getAttachmentKind,
  resolveMessageAttachment,
  validateChatAttachment,
} from "@/lib/chatAttachments";

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
    registerServerMessage,
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
  });

  // Cleanup voice recorder on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  useEffect(() => {
    setCounselorPage(1);
    counselorPageRef.current = 1;
    setCounselorTotalPages(1);
    setCounselorTotalItems(0);
  }, [user?.id]);

  // Load counselors
  useEffect(() => {
    if (!user?.id) return;

    let active = true;
    const cacheKey = `student_chat_counselors_${user.id}_${counselorPageRef.current}`;
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
          page: counselorPageRef.current,
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
          if (!pagedPayload && counselorPageRef.current !== 1) {
            counselorPageRef.current = 1;
            setCounselorPage(1);
          } else if (pagedPayload && nextPage !== counselorPageRef.current) {
            counselorPageRef.current = nextPage;
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

    const intervalId = window.setInterval(() => {
      void loadCounselors(false);
    }, COUNSELOR_REFRESH_INTERVAL_MS);

    const onRecovery = () => {
      void loadCounselors(false);
    };
    window.addEventListener("online", onRecovery);
    window.addEventListener(API_RECOVERED_EVENT, onRecovery as EventListener);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("online", onRecovery);
      window.removeEventListener(API_RECOVERED_EVENT, onRecovery as EventListener);
    };
  }, [user?.id]);

  // Reload counselors when user navigates to a different page via pagination
  useEffect(() => {
    if (!user || counselorPage === 1) return;
    counselorPageRef.current = counselorPage;
    // The main counselor loading effect will pick up the ref change on next interval,
    // but for immediate response we trigger a cache-bypassed load here.
  }, [counselorPage, user]);

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
  }, [chatError, clearUploadError, sessionError, uploadError]);

  useEffect(() => {
    return () => {
      notifyTyping(false);
    };
  }, [notifyTyping, sessionId]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!message.trim() && !selectedFile && !recording) || isSending || !sessionId) return;
    if (activeSessionIsPeerAssigned && (selectedFile || recording)) {
      toast.error("Peer support chats support text only.");
      return;
    }
    if (message.trim() && !isEncryptionReady) {
      toast.error("Secure channel is initializing. Please wait a few seconds.");
      return;
    }

    setIsSending(true);

    try {
      if (selectedFile) {
        const sentFile = await sendFileMessage(selectedFile);
        if (sentFile) {
          registerServerMessage(sentFile);
          setSelectedFile(null);
          toast.success("File sent successfully");
        } else {
          toast.error("Failed to send file");
        }
      }
      
      if (recording) {
        const sentVoice = await sendFileMessage(recording.blob, { messageType: "voice" });
        if (sentVoice) {
          registerServerMessage(sentVoice);
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
      if (activeSessionIsPeerAssigned) {
        toast.error("Peer support chats support text only.");
        e.target.value = "";
        return;
      }

      const validationError = validateChatAttachment(file);
      if (validationError) {
        toast.error(validationError);
        e.target.value = "";
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
    return formatChatFileSize(bytes);
  };

  const renderMessageContent = (msg: any) => {
    const content = msg.decryptedContent || msg.content;

    const attachment = resolveMessageAttachment(msg);
    if (attachment && (msg.message_type === "file" || msg.message_type === "voice" || msg.has_file)) {
      const kind = getAttachmentKind(attachment);
      const resolvedUrl = attachment.url || msg.file_url;
      const downloadUrl = attachment.download_url || attachment.url || msg.file_url;
      const hasSize = Number(attachment.file_size) > 0;

      if (!resolvedUrl) {
        return <p>Attachment unavailable</p>;
      }

      if (kind === "image") {
        return (
          <div className="space-y-3">
            <a href={downloadUrl || resolvedUrl} target="_blank" rel="noopener noreferrer">
              <img
                src={resolvedUrl}
                alt={attachment.file_name}
                className="max-h-60 w-full rounded-2xl object-cover"
                loading="lazy"
              />
            </a>
            <div className="flex items-center justify-between gap-3 text-xs opacity-80">
              <span className="truncate">{attachment.file_name}</span>
              {hasSize ? <span>{formatFileSize(attachment.file_size)}</span> : null}
            </div>
          </div>
        );
      }

      if (kind === "audio") {
        return (
          <div className="space-y-2">
            <audio controls preload="none" className="w-full max-w-xs">
              <source src={resolvedUrl} type={attachment.file_type} />
              Your browser does not support the audio element.
            </audio>
            <div className="flex items-center gap-2 text-xs opacity-80">
              <Mic className="h-3 w-3" />
              <span className="truncate">{attachment.file_name}</span>
              {hasSize ? <span>{formatFileSize(attachment.file_size)}</span> : null}
            </div>
          </div>
        );
      }

      return (
        <div className="space-y-2">
          <div className="flex items-center gap-3 rounded-2xl bg-background/50 p-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{attachment.file_name}</p>
              {hasSize ? <p className="text-xs opacity-70">{formatFileSize(attachment.file_size)}</p> : null}
            </div>
            <a
              href={downloadUrl || resolvedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold underline underline-offset-2"
            >
              Download
            </a>
          </div>
        </div>
      );
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
    const next = Math.max(1, counselorPage - 1);
    counselorPageRef.current = next;
    setCounselorPage(next);
  };

  const handleNextCounselorPage = () => {
    if (!canGoToNextCounselorPage || isCounselorsLoading) return;
    const next = Math.min(counselorTotalPages, counselorPage + 1);
    counselorPageRef.current = next;
    setCounselorPage(next);
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
      className="w-full flex items-center gap-3 p-4 rounded-2xl transition-all duration-300 hover:bg-secondary/50 text-foreground group"
    >
      <div className="h-12 w-12 rounded-full bg-secondary flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-colors">
        <User className="h-6 w-6 text-muted-foreground group-hover:text-primary transition-colors" />
      </div>
      <div className="flex-1 text-left min-w-0">
        <p className="font-bold truncate">{counselor.profile?.full_name || counselor.email}</p>
        <p className={`text-xs truncate ${counselor.is_online ? "text-success" : "text-muted-foreground"}`}>
          {counselor.is_online ? "Online now" : "Offline"}
        </p>
      </div>
      <span className={`h-2.5 w-2.5 rounded-full ${counselor.is_online ? "bg-success" : "bg-muted-foreground/40"}`} />
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

        <main className="p-0 lg:p-6 h-[calc(100vh-80px)] lg:h-[calc(100vh-100px)] overflow-hidden">
          <Card className="h-full border-none lg:border shadow-none lg:shadow-xl rounded-none lg:rounded-[2rem] overflow-hidden flex flex-col lg:flex-row bg-background relative">
            
            {/* Left Sidebar: Counselor/Chat List - Hidden on mobile when chat is active */}
            <div className={`${sessionId ? 'hidden lg:flex' : 'flex'} w-full lg:w-[350px] border-r border-border/50 flex-col h-full bg-secondary/10 absolute lg:relative z-10`}>
              <div className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold px-2">Chats</h2>
                  <Button variant="ghost" size="icon" className="rounded-full">
                    <MoreVertical className="h-5 w-5" />
                  </Button>
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input 
                    placeholder="Search counselors..." 
                    className="pl-10 rounded-xl bg-background/50 border-none focus-visible:ring-primary/20"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  variant={anonymousStartMode ? "default" : "outline"}
                  className="w-full rounded-xl"
                  onClick={() => setAnonymousStartMode((prev) => !prev)}
                >
                  {anonymousStartMode
                    ? "Anonymous Support: On (pick counselor/chat)"
                    : "Start Anonymous Support Session"}
                </Button>
              </div>

              <ScrollArea className="flex-1">
                <div className="px-2 pb-4 space-y-1">
                  <div className="px-4 py-2 mt-2">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Active Conversations</p>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span>
                        {sessionTotalItems > 0
                          ? `${sessionTotalItems} conversation${sessionTotalItems === 1 ? "" : "s"}`
                          : "No conversations"}
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={goToPrevSessionPage}
                          disabled={!canGoToPrevSessionPage || sessionLoading}
                        >
                          Prev
                        </Button>
                        <span>
                          Page {sessionPage} of {Math.max(1, sessionTotalPages)}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={goToNextSessionPage}
                          disabled={!canGoToNextSessionPage || sessionLoading}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  </div>
                  {!sessionLoading && sessions.length === 0 && (
                    <div className="px-4 py-4 text-center text-muted-foreground text-sm">
                      No active conversations
                    </div>
                  )}
                  {sessions.map((session) => (
                    <button
                      key={session.id}
                      onClick={async () => {
                        // If anonymous mode is armed, picking a counselor should open/create
                        // an anonymous thread for that counselor instead of selecting the
                        // identified conversation.
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
                      className={`w-full flex items-center gap-3 p-4 rounded-2xl transition-all duration-300 ${
                        activeSession?.id === session.id 
                          ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20 scale-[0.98]" 
                          : "hover:bg-secondary/50 text-foreground"
                      }`}
                    >
                      <div className={`h-12 w-12 rounded-full flex items-center justify-center shrink-0 ${
                        activeSession?.id === session.id ? "bg-white/20" : "bg-primary/10"
                      }`}>
                        <User className={`h-6 w-6 ${activeSession?.id === session.id ? "text-white" : "text-primary"}`} />
                      </div>
                      <div className="flex-1 text-left min-w-0">
                        <p className="font-bold truncate">
                          {getCounselorLabel(session)}
                        </p>
                        <p
                            className={`text-xs truncate ${
                              activeSession?.id === session.id
                                ? "text-white/70"
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
                      <div className="text-[10px] whitespace-nowrap opacity-70 font-medium">
                        {format(new Date(session.created_at), "h:mm a")}
                      </div>
                    </button>
                  ))}

                  {/* Counselors Header */}
                  <div className="px-4 py-2 mt-4">
                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Counselors</div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span>
                        {counselorTotalItems > 0
                          ? `${counselorTotalItems} counselor${counselorTotalItems === 1 ? "" : "s"}`
                          : "No counselors"}
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={handlePrevCounselorPage}
                          disabled={!canGoToPrevCounselorPage || isCounselorsLoading}
                        >
                          Prev
                        </Button>
                        <span>
                          Page {counselorPage} of {Math.max(1, counselorTotalPages)}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={handleNextCounselorPage}
                          disabled={!canGoToNextCounselorPage || isCounselorsLoading}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  </div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-4 py-2 mt-4">Online Counselors</p>
                  {isCounselorsLoading ? (
                    <div className="px-4 py-6 text-center text-muted-foreground text-sm">Loading counselors...</div>
                  ) : onlineCounselors.length === 0 ? (
                    <div className="px-4 py-4 text-center text-muted-foreground text-sm">
                      No counselors online right now
                    </div>
                  ) : (
                    onlineCounselors.map((counselor) => renderCounselorButton(counselor))
                  )}

                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-4 py-2 mt-4">Available Counselors</p>
                  {isCounselorsLoading ? (
                    <div className="px-4 py-6 text-center text-muted-foreground text-sm">Loading counselors...</div>
                  ) : availableCounselors.length === 0 ? (
                    <div className="px-4 py-8 text-center text-muted-foreground text-sm">
                      No counselors found
                    </div>
                  ) : (
                    availableCounselors.map((counselor) => renderCounselorButton(counselor))
                  )}
                </div>
              </ScrollArea>
            </div>

            {/* Right Side: Chat Window */}
            <div className="flex-1 flex flex-col h-full bg-background relative">
              {!sessionId ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center space-y-4">
                  <div className="h-24 w-24 rounded-[2rem] bg-secondary/30 flex items-center justify-center mb-4">
                    <MessageSquare className="h-12 w-12 opacity-20" />
                  </div>
                  <h3 className="text-2xl font-bold text-foreground">Africa University Counseling</h3>
                  <p className="max-w-xs">Select a counselor from the list to start a secure, encrypted conversation.</p>
                  <div className="flex items-center gap-2 px-4 py-2 bg-secondary/50 rounded-full text-xs">
                    <Shield className="h-3 w-3 text-success" />
                    <span>Your privacy is our priority</span>
                  </div>
                </div>
              ) : (
                <>
                  {/* Chat Header */}
                  <div className="p-4 lg:p-6 border-b border-border/50 flex items-center justify-between bg-background/80 backdrop-blur-md sticky top-0 z-10">
                    <div className="flex items-center gap-3">
                      {/* Mobile back button */}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="lg:hidden h-10 w-10 rounded-full -ml-2"
                        onClick={() => selectSession(null)}
                        title="Back to chats"
                      >
                        <ArrowLeft className="h-5 w-5" />
                      </Button>
                      <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center shadow-lg shadow-primary/5">
                        <User className="h-6 w-6 text-primary" />
                      </div>
                      <div>
                        <h2 className="font-bold text-lg leading-none mb-1">
                          {activeSession ? getCounselorLabel(activeSession) : "Counselor"}
                        </h2>
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 rounded-full ${
                              activeSessionIsPeerAssigned
                                ? "bg-primary"
                                : isRecipientOnline
                                ? "bg-success animate-pulse"
                                : "bg-muted-foreground/50"
                            }`}
                          />
                          <p
                            className={`text-xs font-medium ${
                              activeSessionIsPeerAssigned
                                ? "text-primary"
                                : isRecipientOnline
                                ? "text-success"
                                : "text-muted-foreground"
                            }`}
                          >
                            {activeSessionIsPeerAssigned
                              ? "Peer support assigned"
                              : isRecipientOnline
                              ? "Online"
                              : "Away"}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      {activeSessionIsPeerAssigned && (
                        <div className="hidden sm:flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-primary bg-primary/10 px-3 py-1.5 rounded-full">
                          <span>Peer Counselor Assigned</span>
                        </div>
                      )}
                      {activeSession?.is_anonymous && (
                        <div className="hidden sm:flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-foreground bg-secondary/60 px-3 py-1.5 rounded-full">
                          <span>Anonymous Session</span>
                        </div>
                      )}
                      <div className="hidden sm:flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground bg-secondary/50 px-3 py-1.5 rounded-full">
                        <Shield className="h-3 w-3 text-success" />
                        <span>{isEncryptionReady ? "Encrypted" : "Securing..."}</span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={handleTriggerEmergency}
                        disabled={isTriggeringEmergency || !activeSession}
                        title="Trigger emergency escalation"
                      >
                        <AlertTriangle className="h-4 w-4" />
                        {isTriggeringEmergency ? "Alerting..." : "Panic"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="rounded-full"
                        onClick={handleStartAudioCall}
                        title="Start audio call"
                        disabled={isPreparingCall}
                      >
                        <Phone className="h-5 w-5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="rounded-full"
                        onClick={handleStartVideoCall}
                        title="Start video call"
                        disabled={isPreparingCall}
                      >
                        <Video className="h-5 w-5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="rounded-full">
                        <MoreVertical className="h-5 w-5" />
                      </Button>
                </div>
                  </div>

                  {/* Message List */}
                  <ScrollArea ref={messageScrollAreaRef} className="flex-1 px-4 lg:px-6">
                    <div className="py-6 space-y-6">
                      {sessionId && hasOlderMessages && (
                        <div className="flex justify-center">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
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
                      {isInitialLoading && (
                        <div className="flex flex-col items-center justify-center py-20">
                          <Loader2 className="h-10 w-10 text-primary animate-spin mb-4" />
                          <p className="text-muted-foreground animate-pulse">Initializing secure connection...</p>
                        </div>
                      )}
                      {visibleMessages.length === 0 && !isInitialLoading && (
                        <div className="text-center py-12">
                          <div className="inline-flex items-center gap-2 px-4 py-2 bg-secondary/30 rounded-2xl text-xs text-muted-foreground mb-4">
                            <Shield className="h-3 w-3" />
                            Messages are end-to-end encrypted
                          </div>
                          <p className="text-sm text-muted-foreground">Say hello to your counselor!</p>
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
                                    {msg.seen_at ? "✓✓" : "✓"}
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

                  {/* Chat Input Area - Fixed at bottom on mobile */}
                  <div className="p-4 lg:p-6 bg-background border-t border-border/50 safe-area-pb">
                    <div className="max-w-4xl mx-auto">
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

                      <form onSubmit={handleSendMessage} className="relative flex items-center gap-2">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    className="hidden"
                    accept={CHAT_ATTACHMENT_ACCEPT}
                  />
                  <Button 
                    type="button" 
                    variant="ghost" 
                    size="icon"
                    className="h-12 w-12 rounded-2xl bg-secondary/30 hover:bg-secondary/50 transition-all shrink-0"
                    onClick={handleAttachClick}
                    disabled={isUploading || isRecording || activeSessionIsPeerAssigned}
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
                        className="h-12 pl-4 pr-20 rounded-2xl bg-secondary/30 border-none focus-visible:ring-primary/20 text-base"
                        disabled={isSending || isUploading}
                      />
                      <div className="absolute right-1 top-1 flex gap-1">
                        <Button 
                          type="button" 
                          variant="ghost" 
                          size="icon"
                          className="h-10 w-10 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-all shrink-0"
                          onClick={handleVoiceToggle}
                          disabled={isSending || isUploading || activeSessionIsPeerAssigned}
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
                            (Boolean(message.trim()) && !isEncryptionReady)
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

