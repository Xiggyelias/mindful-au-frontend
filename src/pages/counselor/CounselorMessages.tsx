import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import {
  LayoutDashboard,
  MessageSquare,
  Calendar,
  Users,
  Brain,
  Video,
  FileText,
  Heart,
  Search,
  Send,
  Shield,
  Loader2,
  Paperclip,
  AlertTriangle,
  X,
  Image as ImageIcon,
  User,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/useAuth";
import { useEncryptedChat } from "@/hooks/useEncryptedChat";
import { useFileAttachment } from "@/hooks/useFileAttachment";
import { API_RECOVERED_EVENT, api, getApiErrorMessage } from "@/lib/api";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";

const counselorNavItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/counselor/dashboard" },
  { label: "Messages", icon: MessageSquare, path: "/counselor/messages" },
  { label: "Appointments", icon: Calendar, path: "/counselor/appointments" },
  { label: "Students", icon: Users, path: "/counselor/students" },
  { label: "AI Insights", icon: Brain, path: "/counselor/ai-insights" },
  { label: "Video Sessions", icon: Video, path: "/counselor/video" },
  { label: "Session Notes", icon: FileText, path: "/counselor/notes" },
  { label: "Wellness", icon: Heart, path: "/counselor/wellness" },
];

const peerCounselorNavItems = [
  { label: "Messages", icon: MessageSquare, path: "/counselor/messages" },
];

const SESSION_POLL_INTERVAL_MS = 10000;
const CHAT_LIST_TIMEOUT_MS = 30000;
const CHAT_LIST_PAGE_SIZE = 40;
const CHAT_LIST_RETRY_PAGE_SIZE = 20;
const CHAT_LIST_CACHE_TTL_MS = 60 * 1000;
const CHAT_LIST_CACHE_VERSION = 2;
const ONLINE_WINDOW_SECONDS = 10 * 60;

type RawSession = {
  id: number;
  student_id: number | null;
  counselor_id: number;
  peer_counselor_id?: number | null;
  assigned_role?: string | null;
  session_type: string;
  status: string | null;
  is_anonymous?: boolean;
  anonymous_id?: string | null;
  identity_visible_to_viewer?: boolean;
  created_at?: string;
  updated_at?: string;
  student?: {
    id?: number;
    email?: string;
    last_seen_at?: string | null;
    is_online?: boolean;
    profile?: {
      full_name?: string;
    };
  };
  peer_counselor?: {
    id?: number;
    email?: string;
    profile?: {
      full_name?: string;
    };
  };
};

type ChatListItem = {
  id: number;
  studentId: number | null;
  studentName: string;
  studentEmail: string;
  isAnonymous: boolean;
  anonymousId: string;
  status: string | null;
  lastActivity: string;
  preview: string;
  isOnline: boolean;
  lastSeenAt: string | null;
  isPeerAssigned: boolean;
  peerCounselorName: string;
};

type ChatListMeta = {
  page?: number;
  per_page?: number;
  total?: number;
  total_pages?: number;
  has_next?: boolean;
  has_prev?: boolean;
};

type ChatListResponse = RawSession[] | { data?: RawSession[]; meta?: ChatListMeta };

const getChatListCacheKey = (isPeerCounselor: boolean, page: number) =>
  `counselor_chat_list_v${CHAT_LIST_CACHE_VERSION}_${isPeerCounselor ? "peer" : "counselor"}_${page}`;

const isOpenSession = (status: string | null | undefined) =>
  status !== "completed" && status !== "cancelled";

const toTimestamp = (value?: string) => {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
};

const isOnlineFromLastSeen = (lastSeenAt?: string | null) => {
  if (!lastSeenAt) return false;
  const diffSeconds = (Date.now() - toTimestamp(lastSeenAt)) / 1000;
  return diffSeconds <= ONLINE_WINDOW_SECONDS;
};

const resolveChatOnline = (chat?: Pick<ChatListItem, "isOnline" | "lastSeenAt"> | null) => {
  if (!chat) return false;
  return chat.isOnline || isOnlineFromLastSeen(chat.lastSeenAt);
};

const formatTime = (dateString?: string) => {
  if (!dateString) return "";
  const timestamp = toTimestamp(dateString);
  if (!timestamp) return "";
  return formatDistanceToNowStrict(new Date(timestamp), { addSuffix: true });
};

const getInitials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
};

const resolveAnonymousLabel = (session: RawSession) => {
  const candidate = String(session.anonymous_id || "").trim();
  if (candidate) return candidate;
  return `ANON-${String(session.id).padStart(4, "0")}`;
};

const CounselorMessages = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedChatId, setSelectedChatId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [chats, setChats] = useState<ChatListItem[]>([]);
  const [isLoadingChats, setIsLoadingChats] = useState(true);
  const [chatPage, setChatPage] = useState(1);
  const [chatTotalPages, setChatTotalPages] = useState(1);
  const [chatTotalItems, setChatTotalItems] = useState(0);
  const [isEscalating, setIsEscalating] = useState(false);
  const [isTriggeringEmergency, setIsTriggeringEmergency] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageScrollAreaRef = useRef<HTMLDivElement>(null);
  const lastRenderedTailMessageIdRef = useRef<number | null>(null);
  const hasShownLoadErrorRef = useRef(false);
  const isLoadingSessionsRef = useRef(false);
  const { user, role } = useAuth();
  const isPeerCounselor = role === "peer_counselor";
  const navItems = isPeerCounselor ? peerCounselorNavItems : counselorNavItems;
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || "Counselor";

  const [searchParams] = useSearchParams();
  const targetSessionParam = searchParams.get("session");
  const targetStudentParam = searchParams.get("student");

  const selectedChat = useMemo(() => {
    if (!chats.length) return null;
    if (!selectedChatId) return chats[0];
    return chats.find((chat) => chat.id === selectedChatId) || chats[0];
  }, [chats, selectedChatId]);

  const selectedSessionId = selectedChat ? String(selectedChat.id) : "";
  const currentUserId = Number(user?.id || 0);

  const {
    messages,
    isLoading: messagesLoading,
    isLoadingOlderMessages,
    hasOlderMessages,
    isEncryptionReady,
    isPeerTyping,
    error: chatError,
    sendMessage: sendEncryptedMessage,
    notifyTyping,
    loadOlderMessages,
    getEncryptionKey,
  } = useEncryptedChat({
    sessionId: selectedSessionId,
    userId: String(user?.id || ""),
  });

  const {
    sendFileMessage,
    isUploading,
    uploadProgress,
    error: uploadError,
    clearError: clearUploadError,
  } = useFileAttachment({
    sessionId: selectedSessionId,
    userId: String(user?.id || ""),
    encryptionKey: getEncryptionKey(),
  });

  const filteredChats = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    if (!needle) return chats;

    return chats.filter((chat) => {
      return (
        chat.studentName.toLowerCase().includes(needle) ||
        chat.studentEmail.toLowerCase().includes(needle)
      );
    });
  }, [chats, searchQuery]);

  const loadSessions = useCallback(
    async (silent = false) => {
      if (!user?.id) return;
      if (isLoadingSessionsRef.current) return;

      try {
        isLoadingSessionsRef.current = true;
        if (!silent) {
          setIsLoadingChats(true);
        }

        const cacheKey = getChatListCacheKey(isPeerCounselor, chatPage);
        if (!silent) {
          try {
            const rawCached = localStorage.getItem(cacheKey);
            if (rawCached) {
              const parsed = JSON.parse(rawCached) as {
                saved_at?: number;
                chats?: ChatListItem[];
                total_pages?: number;
                total_items?: number;
              };
              const savedAt = Number(parsed?.saved_at || 0);
              const cachedChats = Array.isArray(parsed?.chats)
                ? parsed.chats.map((chat) => {
                    const lastSeenAt = typeof chat?.lastSeenAt === "string" ? chat.lastSeenAt : null;
                    return {
                      ...chat,
                      isOnline:
                        typeof chat?.isOnline === "boolean"
                          ? chat.isOnline || isOnlineFromLastSeen(lastSeenAt)
                          : isOnlineFromLastSeen(lastSeenAt),
                      lastSeenAt,
                    };
                  })
                : [];
              if (
                Number.isFinite(savedAt) &&
                Date.now() - savedAt <= CHAT_LIST_CACHE_TTL_MS &&
                cachedChats.length > 0
              ) {
                setChats(cachedChats);
                setChatTotalPages(Math.max(1, Number(parsed?.total_pages || 1)));
                setChatTotalItems(Math.max(0, Number(parsed?.total_items || cachedChats.length)));
                setSelectedChatId((current) => current ?? cachedChats[0]?.id ?? null);
                setIsLoadingChats(false);
              }
            }
          } catch {
            // ignore malformed cache
          }
        }

        const fetchSessions = (perPage: number) =>
          api.getChatSessions({
            open_only: true,
            page: chatPage,
            per_page: perPage,
            as_role: isPeerCounselor ? "peer_counselor" : "counselor",
            timeout_ms: CHAT_LIST_TIMEOUT_MS,
          });

        let sessions: ChatListResponse;
        try {
          sessions = (await fetchSessions(CHAT_LIST_PAGE_SIZE)) as ChatListResponse;
        } catch (err) {
          const isTimeout = (err as { code?: string })?.code === "ECONNABORTED";
          if (!isTimeout) {
            throw err;
          }

          // Retry once with a smaller payload to recover from slow responses.
          sessions = (await fetchSessions(CHAT_LIST_RETRY_PAGE_SIZE)) as ChatListResponse;
        }

        const pagedPayload =
          !Array.isArray(sessions) && sessions && typeof sessions === "object"
            ? sessions
            : null;

        const normalized = (
          Array.isArray(sessions)
            ? sessions
            : Array.isArray(pagedPayload?.data)
            ? pagedPayload.data
            : []
        ) as RawSession[];

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
          : normalized.length;
        setChatTotalPages(nextTotalPages);
        setChatTotalItems(nextTotal);
        if (!pagedPayload && chatPage !== 1) {
          setChatPage(1);
        } else if (pagedPayload && nextPage !== chatPage) {
          setChatPage(nextPage);
        }

        const chatSessions = normalized
          .filter(
            (session) =>
              session.session_type === "chat" &&
              (
                Boolean(session.is_anonymous) ||
                (Number.isInteger(Number(session.student_id)) && Number(session.student_id) > 0)
              )
          )
          .sort((a, b) => {
            const aTime = toTimestamp(a.updated_at || a.created_at);
            const bTime = toTimestamp(b.updated_at || b.created_at);
            return bTime - aTime;
          });

        const dedupedByConversation = new Map<string, RawSession>();
        for (const session of chatSessions) {
          const conversationKey = `session:${Number(session.id)}`;
          const existing = dedupedByConversation.get(conversationKey);
          if (!existing) {
            dedupedByConversation.set(conversationKey, session);
            continue;
          }

          const existingOpen = isOpenSession(existing.status);
          const currentOpen = isOpenSession(session.status);
          if (currentOpen && !existingOpen) {
            dedupedByConversation.set(conversationKey, session);
            continue;
          }

          const existingTime = toTimestamp(existing.updated_at || existing.created_at);
          const currentTime = toTimestamp(session.updated_at || session.created_at);
          if (currentTime > existingTime) {
            dedupedByConversation.set(conversationKey, session);
          }
        }

        const nextChats = Array.from(dedupedByConversation.values())
          .map((session): ChatListItem => {
            const isAnonymous = Boolean(session.is_anonymous);
            const anonymousLabel = resolveAnonymousLabel(session);
            const numericStudentId = Number(session.student_id);
            const visibleStudentId =
              Number.isInteger(numericStudentId) && numericStudentId > 0
                ? numericStudentId
                : null;
            const isPeerAssigned =
              session.assigned_role === "peer_counselor" && Number(session.peer_counselor_id) > 0;
            const peerCounselorName =
              session.peer_counselor?.profile?.full_name ||
              session.peer_counselor?.email ||
              (session.peer_counselor_id ? `Peer #${session.peer_counselor_id}` : "Peer Counselor");
            const name =
              isAnonymous
                ? anonymousLabel
                : session.student?.profile?.full_name ||
                  session.student?.email?.split("@")[0] ||
                  `Student #${session.id}`;
            const email = isAnonymous ? "" : session.student?.email || "";

            return {
              id: Number(session.id),
              studentId: visibleStudentId,
              studentName: name,
              studentEmail: email,
              isAnonymous,
              anonymousId: anonymousLabel,
              status: session.status || null,
              lastActivity: session.updated_at || session.created_at || "",
              preview: !isOpenSession(session.status)
                ? "Conversation ended"
                : isPeerAssigned
                ? isPeerCounselor
                  ? "Assigned to you by counselor"
                  : `Delegated to ${peerCounselorName}`
                : "Tap to continue chat",
              isOnline:
                typeof session.student?.is_online === "boolean"
                  ? session.student.is_online
                  : isOnlineFromLastSeen(session.student?.last_seen_at),
              lastSeenAt: session.student?.last_seen_at || null,
              isPeerAssigned,
              peerCounselorName,
            };
          })
          .sort((a, b) => toTimestamp(b.lastActivity) - toTimestamp(a.lastActivity));

        const targetSessionId = targetSessionParam ? Number(targetSessionParam) : null;
        const targetStudentId = targetStudentParam ? Number(targetStudentParam) : null;

        setChats(nextChats);
        setSelectedChatId((current) => {
          if (current && nextChats.some((chat) => chat.id === current)) {
            return current;
          }

          if (
            targetSessionId &&
            Number.isFinite(targetSessionId) &&
            nextChats.some((chat) => chat.id === targetSessionId)
          ) {
            return targetSessionId;
          }

          if (targetStudentId && Number.isFinite(targetStudentId)) {
            const targetChat = nextChats.find(
              (chat) =>
                chat.studentId !== null &&
                chat.studentId === targetStudentId &&
                (isPeerCounselor ? chat.isPeerAssigned : !chat.isPeerAssigned)
            ) || nextChats.find((chat) => chat.studentId !== null && chat.studentId === targetStudentId);
            if (targetChat) return targetChat.id;
          }

          return nextChats[0]?.id ?? null;
        });
        localStorage.setItem(
          cacheKey,
          JSON.stringify({
            saved_at: Date.now(),
            chats: nextChats,
            total_pages: nextTotalPages,
            total_items: nextTotal,
          })
        );

        hasShownLoadErrorRef.current = false;
      } catch (err) {
        console.error("Failed to load sessions:", err);
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 401) {
          return;
        }
        const message = getApiErrorMessage(err, "Failed to load conversations");
        if (!hasShownLoadErrorRef.current) {
          toast.error(message);
          hasShownLoadErrorRef.current = true;
        }
      } finally {
        isLoadingSessionsRef.current = false;
        if (!silent) {
          setIsLoadingChats(false);
        }
      }
    },
    [chatPage, isPeerCounselor, targetSessionParam, targetStudentParam, user?.id]
  );

  useEffect(() => {
    if (!user?.id) return;

    void loadSessions(false);

    const onVisibilityOrFocus = () => {
      if (document.visibilityState !== "visible") return;
      void loadSessions(true);
    };

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadSessions(true);
    }, SESSION_POLL_INTERVAL_MS);

    window.addEventListener("focus", onVisibilityOrFocus);
    window.addEventListener("online", onVisibilityOrFocus);
    window.addEventListener(API_RECOVERED_EVENT, onVisibilityOrFocus as EventListener);
    document.addEventListener("visibilitychange", onVisibilityOrFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onVisibilityOrFocus);
      window.removeEventListener("online", onVisibilityOrFocus);
      window.removeEventListener(API_RECOVERED_EVENT, onVisibilityOrFocus as EventListener);
      document.removeEventListener("visibilitychange", onVisibilityOrFocus);
    };
  }, [loadSessions, user?.id]);

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
  }, [selectedSessionId]);

  useEffect(() => {
    if (chatError) {
      toast.error(chatError);
    }
    if (uploadError) {
      toast.error(uploadError);
      clearUploadError();
    }
  }, [chatError, clearUploadError, uploadError]);

  useEffect(() => {
    return () => {
      notifyTyping(false);
    };
  }, [notifyTyping]);

  useEffect(() => {
    if (isPeerCounselor && selectedFile) {
      setSelectedFile(null);
    }
  }, [isPeerCounselor, selectedFile]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const hasPayload = isPeerCounselor ? Boolean(message.trim()) : Boolean(message.trim() || selectedFile);
    if (!hasPayload || isSending || !selectedSessionId) return;
    if (!isEncryptionReady) {
      toast.error("Secure channel is initializing. Please wait a few seconds.");
      return;
    }
    if (isPeerCounselor && selectedFile) {
      toast.error("Peer counselors can only send text messages.");
      return;
    }

    setIsSending(true);

    try {
      if (selectedFile) {
        const sentFile = await sendFileMessage(selectedFile, sendEncryptedMessage);
        if (!sentFile) {
          toast.error("Failed to send file");
          return;
        }
        setSelectedFile(null);
      }

      if (message.trim()) {
        const sentText = await sendEncryptedMessage(message.trim());
        if (!sentText) {
          if (!chatError) {
            toast.error("Failed to send message");
          }
          return;
        }
        setMessage("");
        notifyTyping(false);
      }

      void loadSessions(true);
    } catch (error) {
      console.error("Failed to send message:", error);
      toast.error(getApiErrorMessage(error, "Failed to send message"));
    } finally {
      setIsSending(false);
    }
  };

  const handleEscalateToCounselor = async () => {
    if (!selectedSessionId || !isPeerCounselor) return;

    const confirmed = window.confirm("Escalate this case to a professional counselor now?");
    if (!confirmed) return;

    try {
      setIsEscalating(true);
      await api.escalatePeerSession(selectedSessionId);
      toast.success("Case escalated to counselor.");
      setSelectedChatId(null);
      await loadSessions(false);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to escalate case");
    } finally {
      setIsEscalating(false);
    }
  };

  const handleEmergencyEscalation = async () => {
    if (!selectedSessionId || isTriggeringEmergency) return;

    const confirmed = window.confirm(
      "Trigger emergency escalation for this conversation now? This sends immediate alerts."
    );
    if (!confirmed) return;

    try {
      setIsTriggeringEmergency(true);
      await api.panicEscalateSession(selectedSessionId, {
        reason: isPeerCounselor
          ? "Peer counselor emergency escalation"
          : "Counselor emergency escalation",
      });
      toast.success("Emergency escalation sent.");
      await loadSessions(true);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to send emergency escalation");
    } finally {
      setIsTriggeringEmergency(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 8 * 1024 * 1024) {
      toast.error("File size exceeds 8MB limit");
      return;
    }

    setSelectedFile(file);
  };

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const removeSelectedFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const canSend = isPeerCounselor ? Boolean(message.trim()) : Boolean(message.trim() || selectedFile);
  const canGoToPrevPage = chatPage > 1;
  const canGoToNextPage = chatPage < chatTotalPages;
  const selectedChatIsOnline = resolveChatOnline(selectedChat);

  const handlePrevPage = () => {
    if (!canGoToPrevPage || isLoadingChats) return;
    setChatPage((current) => Math.max(1, current - 1));
  };

  const handleNextPage = () => {
    if (!canGoToNextPage || isLoadingChats) return;
    setChatPage((current) => Math.min(chatTotalPages, current + 1));
  };

  const handleLoadOlderMessages = useCallback(async () => {
    if (!selectedSessionId) return;
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
  }, [hasOlderMessages, isLoadingOlderMessages, loadOlderMessages, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId) return;

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
  }, [handleLoadOlderMessages, hasOlderMessages, isLoadingOlderMessages, selectedSessionId]);

  const renderMessageContent = (msg: any) => {
    const content = msg.decryptedContent || msg.content || "";

    if (msg.message_type === "file") {
      try {
        const fileInfo = typeof content === "string" ? JSON.parse(content) : content;
        const isImage = fileInfo.fileType?.startsWith("image/");
        const resolvedUrl = msg.file_url || fileInfo.url;

        if (!resolvedUrl) {
          return <p>Attachment unavailable</p>;
        }

        return (
          <div className="space-y-2">
            <a
              href={resolvedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 p-2 rounded-lg bg-background/50 hover:bg-background/80 transition-colors"
            >
              {isImage ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
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

  const isLoading = isLoadingChats || (Boolean(selectedSessionId) && messagesLoading);

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar
        items={navItems}
        userType={isPeerCounselor ? "peer" : "counselor"}
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-72">
        <DashboardHeader
          title={isPeerCounselor ? "Peer Support Messages" : "Messages"}
          onMenuClick={() => setSidebarOpen(true)}
        />

        <main className="p-4 lg:p-6">
          <div className="grid gap-4 lg:grid-cols-3 h-[calc(100vh-180px)]">
            <Card variant="glass" className="lg:col-span-1">
              <CardHeader className="pb-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search conversations..."
                    className="pl-9"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {chatTotalItems > 0
                      ? `${chatTotalItems} conversation${chatTotalItems === 1 ? "" : "s"}`
                      : "No conversations"}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={handlePrevPage}
                      disabled={!canGoToPrevPage || isLoadingChats}
                    >
                      Prev
                    </Button>
                    <span>
                      Page {chatPage} of {Math.max(1, chatTotalPages)}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={handleNextPage}
                      disabled={!canGoToNextPage || isLoadingChats}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[calc(100vh-360px)]">
                  {!isLoadingChats && filteredChats.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">
                      No conversations found
                    </div>
                  ) : (
                    filteredChats.map((chat) => (
                      <div
                        key={chat.id}
                        className={`p-4 cursor-pointer transition-colors border-b border-border/50 ${
                          selectedChat?.id === chat.id ? "bg-secondary/50" : "hover:bg-secondary/30"
                        }`}
                        onClick={() => setSelectedChatId(chat.id)}
                      >
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
                            <span className="text-sm font-medium text-primary">
                              {getInitials(chat.studentName)}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-center">
                              <div className="flex items-center gap-2 min-w-0">
                                <p className="font-medium text-foreground truncate">{chat.studentName}</p>
                                {chat.isAnonymous && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                                    Anonymous
                                  </span>
                                )}
                                {chat.isPeerAssigned && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary uppercase tracking-wide">
                                    Peer Assigned
                                  </span>
                                )}
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {formatTime(chat.lastActivity)}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground truncate">{chat.preview}</p>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </ScrollArea>
              </CardContent>
            </Card>

            <Card variant="glass" className="lg:col-span-2">
              <CardHeader className="border-b border-border/50">
                <CardTitle className="text-lg flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
                      <span className="text-primary font-medium">
                        {selectedChat ? getInitials(selectedChat.studentName) : <User className="h-4 w-4" />}
                      </span>
                    </div>
                    <div>
                      <p className="font-medium">{selectedChat?.studentName || "Select a conversation"}</p>
                      <p className={`text-sm ${selectedChatIsOnline ? "text-success" : "text-muted-foreground"}`}>
                        {selectedChat ? (selectedChatIsOnline ? "Online" : "Offline") : ""}
                      </p>
                      {selectedChat?.isPeerAssigned && (
                        <p className="text-xs text-primary">
                          {isPeerCounselor
                            ? "Assigned to you by counselor"
                            : `Delegated to ${selectedChat.peerCounselorName}`}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedChat?.isAnonymous && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground uppercase tracking-wide">
                        Anonymous
                      </span>
                    )}
                    {selectedChat?.isPeerAssigned && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary uppercase tracking-wide">
                        Peer Case
                      </span>
                    )}
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Shield className="h-4 w-4 text-success" />
                      <span>
                        {!selectedSessionId
                          ? "Select a conversation"
                          : isEncryptionReady
                          ? "End-to-end encrypted"
                          : "Securing channel..."}
                      </span>
                    </div>
                    {selectedSessionId && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={handleEmergencyEscalation}
                        disabled={isTriggeringEmergency}
                      >
                        <AlertTriangle className="h-4 w-4" />
                        {isTriggeringEmergency ? "Alerting..." : "Emergency"}
                      </Button>
                    )}
                    {isPeerCounselor && selectedSessionId && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={handleEscalateToCounselor}
                        disabled={isEscalating}
                      >
                        <AlertTriangle className="h-4 w-4" />
                        {isEscalating ? "Escalating..." : "Escalate to Counselor"}
                      </Button>
                    )}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col h-[calc(100%-80px)] p-0">
                <ScrollArea ref={messageScrollAreaRef} className="flex-1 p-4">
                  {!selectedSessionId ? (
                    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                      Select a student conversation to start chatting
                    </div>
                  ) : isLoading ? (
                    <div className="flex items-center justify-center h-full">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : messages.length === 0 && !isPeerTyping ? (
                    <div className="text-center text-sm text-muted-foreground py-8">
                      <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>No messages yet</p>
                      <p className="text-xs">Start the conversation by sending a message</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {selectedSessionId && hasOlderMessages && (
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
                      {messages.map((msg) => (
                        <div
                          key={msg.id}
                          className={`flex ${msg.sender_id === currentUserId ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[70%] p-3 rounded-2xl ${
                              msg.sender_id === currentUserId
                                ? "bg-primary text-primary-foreground rounded-br-md"
                                : "bg-secondary text-secondary-foreground rounded-bl-md"
                            }`}
                          >
                            {renderMessageContent(msg)}
                            <div
                              className={`flex items-center gap-1 mt-1 ${
                                msg.sender_id === currentUserId
                                  ? "text-primary-foreground/70"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {msg.is_encrypted && <Shield className="h-3 w-3" />}
                              <span className="text-xs">{formatTime(msg.created_at)}</span>
                              {msg.sender_id === currentUserId && (
                                <span
                                  className={`text-xs font-semibold ml-1 ${
                                    msg.seen_at ? "text-success/90" : "text-primary-foreground/80"
                                  }`}
                                  aria-label={msg.seen_at ? "Seen" : "Sent"}
                                  title={msg.seen_at ? "Seen" : "Sent"}
                                >
                                  {msg.seen_at ? "✓✓" : "✓"}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                      {isPeerTyping && (
                        <div className="flex justify-start">
                          <div className="max-w-[70%] p-3 rounded-2xl bg-secondary text-secondary-foreground rounded-bl-md border border-border/50">
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
                  )}
                </ScrollArea>

                {selectedFile && (
                  <div className="px-4 py-2 border-t border-border/50">
                    <div className="flex items-center gap-3 p-2 rounded-lg bg-secondary/50">
                      {selectedFile.type.startsWith("image/") ? (
                        <ImageIcon className="h-5 w-5 text-primary" />
                      ) : (
                        <FileText className="h-5 w-5 text-primary" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{selectedFile.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatFileSize(selectedFile.size)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={removeSelectedFile}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    {isUploading && <Progress value={uploadProgress} className="h-1 mt-2" />}
                  </div>
                )}

                <form onSubmit={handleSendMessage} className="p-4 border-t border-border/50">
                  <div className="flex gap-2">
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileSelect}
                      className="hidden"
                      accept="image/*,.pdf,.doc,.docx,.txt"
                    />
                    {!isPeerCounselor && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={handleAttachClick}
                        disabled={isUploading || !selectedSessionId}
                      >
                        <Paperclip className="h-5 w-5" />
                      </Button>
                    )}
                    <Input
                      placeholder={selectedSessionId ? "Type your message..." : "Select a conversation first"}
                      value={message}
                      onChange={(e) => {
                        const nextMessage = e.target.value;
                        setMessage(nextMessage);
                        notifyTyping(nextMessage.trim().length > 0);
                      }}
                      onBlur={() => notifyTyping(false)}
                      className="flex-1"
                      disabled={isSending || isUploading || !selectedSessionId}
                    />
                    <Button
                      type="submit"
                      variant="hero"
                      size="icon"
                      disabled={
                        !selectedSessionId ||
                        !canSend ||
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
                </form>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
};

export default CounselorMessages;
