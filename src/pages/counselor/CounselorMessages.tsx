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
  ShieldCheck,
  Loader2,
  Paperclip,
  AlertTriangle,
  X,
  Image as ImageIcon,
  User,
  UserCircle2,
  Mic,
  Smile,
  Play,
  Pause,
  Square,
  Trash2,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/useAuth";
import { useEncryptedChat, ChatMessage } from "@/hooks/useEncryptedChat";
import { useFileAttachment } from "@/hooks/useFileAttachment";
import { useChatSession, Session } from "@/hooks/useChatSession";
import { API_RECOVERED_EVENT, api, getApiErrorMessage } from "@/lib/api";
import {
  CHAT_ATTACHMENT_ACCEPT,
  formatChatFileSize,
  getAttachmentKind,
  resolveMessageAttachment,
  validateChatAttachment,
} from "@/lib/chatAttachments";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import EmojiPicker, { Theme as EmojiTheme } from "emoji-picker-react";
import { 
  Popover, 
  PopoverContent, 
  PopoverTrigger 
} from "@/components/ui/popover";

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
  { label: "Dashboard", icon: LayoutDashboard, path: "/peer/dashboard" },
  { label: "Active Chats", icon: MessageSquare, path: "/peer/chats" },
  { label: "Escalated Cases", icon: AlertTriangle, path: "/peer/escalations" },
  { label: "Ethics Guidelines", icon: ShieldCheck, path: "/peer/ethics" },
  { label: "Profile", icon: UserCircle2, path: "/peer/profile" },
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
  counselorId: number;
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
  return `User_${String(Number(session.id) % 10000).padStart(4, "0")}`;
};

const getUserColor = (name: string) => {
  const colors = [
    "bg-blue-500", "bg-purple-500", "bg-emerald-500", 
    "bg-orange-500", "bg-pink-500", "bg-indigo-500",
    "bg-cyan-500", "bg-rose-500"
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
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
  const [isRevealingIdentity, setIsRevealingIdentity] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageScrollAreaRef = useRef<HTMLDivElement>(null);
  const lastRenderedTailMessageIdRef = useRef<number | null>(null);
  const hasShownLoadErrorRef = useRef(false);
  const isLoadingSessionsRef = useRef(false);
  const { user, role } = useAuth();
  const isPeerCounselor = role === "peer_counselor";
  const navItems = isPeerCounselor ? peerCounselorNavItems : counselorNavItems;
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || (isPeerCounselor ? "Peer Counselor" : "Counselor");
  const [isVoiceMode, setIsVoiceMode] = useState(false);

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

  // Cleanup voice recorder on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

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
    registerServerMessage,
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
  });

  const filteredChats = useMemo(() => {
    // Deduplicate by counselorId, keeping the most recent one per counselor
    const dedupedByCounselor = new Map<number, ChatListItem>();
    for (const chat of chats) {
      const existing = dedupedByCounselor.get(chat.counselorId);
      if (!existing || new Date(chat.lastActivity).getTime() > new Date(existing.lastActivity).getTime()) {
        dedupedByCounselor.set(chat.counselorId, chat);
      }
    }
    
    // Convert to array and sort by lastActivity descending
    let result = Array.from(dedupedByCounselor.values()).sort((a, b) => {
      const aTime = new Date(a.lastActivity).getTime();
      const bTime = new Date(b.lastActivity).getTime();
      return bTime - aTime;
    });
    
    // Apply search filter if present
    const needle = searchQuery.trim().toLowerCase();
    if (needle) {
      result = result.filter((chat) => {
        return (
          chat.studentName.toLowerCase().includes(needle) ||
          chat.studentEmail.toLowerCase().includes(needle)
        );
      });
    }
    
    return result;
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
          const isAnon = Boolean(session.is_anonymous);
          const studentId = isAnon ? String(session.anonymous_id || "") : String(session.student_id || "");
          const assignedRole = session.assigned_role || "counselor";
          const conversationKey = `s:${studentId}:a:${isAnon ? 1 : 0}:r:${assignedRole}`;
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

          if (!currentOpen && existingOpen) {
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
              counselorId: Number(session.counselor_id),
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
        if (import.meta.env.DEV) {
          console.error("Failed to load sessions:", err);
        }
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

  // Optimized scroll management using refs to avoid re-binding on every message change
  const messagesLengthRef = useRef(messages.length);
  const isAtBottomRef = useRef(true);

  // Track if we are at bottom
  useEffect(() => {
    const viewport = messageScrollAreaRef.current?.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]"
    );
    if (!viewport) return;

    const onScrollInternal = () => {
      const { scrollTop, scrollHeight, clientHeight } = viewport;
      isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 50;
    };
    viewport.addEventListener("scroll", onScrollInternal, { passive: true });
    return () => viewport.removeEventListener("scroll", onScrollInternal);
  }, []);

  useEffect(() => {
    messagesLengthRef.current = messages.length;
    const latestMessageId = messages.length > 0 ? Number(messages[messages.length - 1]?.id) : null;
    if (!latestMessageId || !Number.isFinite(latestMessageId)) {
      lastRenderedTailMessageIdRef.current = null;
      return;
    }

    const previousTailId = lastRenderedTailMessageIdRef.current;
    if (previousTailId === null || (latestMessageId !== previousTailId && isAtBottomRef.current)) {
      if (scrollRef.current) {
        scrollRef.current.scrollIntoView({ 
          behavior: previousTailId === null ? "auto" : "smooth",
          block: "end"
        });
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
    if (message.trim() && !isEncryptionReady) {
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
        const sentFile = await sendFileMessage(selectedFile);
        if (!sentFile) {
          toast.error("Failed to send file");
          return;
        }
        registerServerMessage(sentFile);
        setSelectedFile(null);
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
      if (import.meta.env.DEV) {
        console.error("Failed to send message:", error);
      }
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
    } catch (error: unknown) {
      const errMsg = (error as { response?: { data?: { message?: string } } })?.response?.data?.message || "Failed to escalate case";
      toast.error(errMsg);
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
    } catch (error: unknown) {
      const errMsg = (error as { response?: { data?: { message?: string } } })?.response?.data?.message || "Failed to send emergency escalation";
      toast.error(errMsg);
    } finally {
      setIsTriggeringEmergency(false);
    }
  };

  const handleRevealIdentity = async () => {
    if (!selectedSessionId || !selectedChat?.isAnonymous || isRevealingIdentity) {
      return;
    }
    const reason = window.prompt(
      "Provide reason for identity reveal (required for audit):",
      "Emergency safeguarding assessment"
    );
    if (!reason || reason.trim().length < 5) {
      toast.error("A detailed reason is required (minimum 5 characters).");
      return;
    }

    setIsRevealingIdentity(true);
    try {
      await api.revealAnonymousIdentity(selectedSessionId, reason.trim());
      toast.success("Identity revealed and logged.");
      await loadSessions(true);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to reveal identity."));
    } finally {
      setIsRevealingIdentity(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validationError = validateChatAttachment(file);
    if (validationError) {
      toast.error(validationError);
      e.target.value = "";
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

  const formatRecordingTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
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

  const formatFileSize = (bytes: number) => {
    return formatChatFileSize(bytes);
  };

  const canSend = Boolean(message.trim() || selectedFile || recording);
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

  const renderMessageContent = (msg: ChatMessage) => {
    const content = msg.decryptedContent || msg.content || "";

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
          <div className="space-y-2 max-w-sm">
            <a 
              href={downloadUrl || resolvedUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="block overflow-hidden rounded-2xl border border-border/50 hover:ring-2 hover:ring-primary/20 transition-all"
            >
              <img
                src={resolvedUrl}
                alt={attachment.file_name}
                className="max-h-80 w-full object-cover"
                loading="lazy"
              />
            </a>
            <div className="flex items-center justify-between gap-3 px-1 text-[10px] font-medium opacity-70 uppercase tracking-tight">
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
        {!selectedSessionId && (
          <DashboardHeader
            title={isPeerCounselor ? "Peer Support Messages" : "Messages"}
            onMenuClick={() => setSidebarOpen(true)}
          />
        )}

        <main className="p-0 overflow-hidden h-full">
          <div className={`grid lg:grid-cols-3 ${selectedSessionId ? "h-screen" : "h-[calc(100vh-80px)]"}`}>
            <Card variant="glass" className={`lg:col-span-1 rounded-none border-y-0 border-l-0 shadow-none ${selectedSessionId ? "hidden lg:block" : "flex flex-col"}`}>
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
                    {filteredChats.length > 0
                      ? `${filteredChats.length} conversation${filteredChats.length === 1 ? "" : "s"}`
                      : "No conversations"}
                  </span>
                  {chatTotalPages > 1 && (
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
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[calc(100vh-220px)]">
                  {!isLoadingChats && filteredChats.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">
                      No conversations found
                    </div>
                  ) : (
                    filteredChats.map((chat) => (
                      <div
                        key={chat.id}
                        className={`p-3 cursor-pointer transition-all border-b border-border/50 group ${
                          selectedChat?.id === chat.id 
                            ? "bg-accent border-l-4 border-l-accent-foreground/30" 
                            : "hover:bg-secondary/30"
                        }`}
                        onClick={() => setSelectedChatId(chat.id)}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`h-11 w-11 rounded-full flex items-center justify-center shrink-0 shadow-sm ${chat.isAnonymous ? "bg-slate-500" : getUserColor(chat.studentName)}`}>
                            <span className="text-white text-xs font-bold">
                              {chat.isAnonymous ? "??" : getInitials(chat.studentName)}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start mb-0.5">
                              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                                <p className={`text-[13px] font-bold truncate tracking-tight ${selectedChat?.id === chat.id ? "text-accent-foreground" : "text-foreground"}`}>
                                  {chat.isAnonymous ? "Anonymous Student" : chat.studentName}
                                </p>
                                {chat.isAnonymous && (
                                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground uppercase tracking-tight">
                                    Anon
                                  </span>
                                )}
                                {chat.isPeerAssigned && (
                                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary uppercase tracking-tight">
                                    Peer
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] font-bold text-muted-foreground/60 tabular-nums uppercase">
                                {formatTime(chat.lastActivity)}
                              </span>
                            </div>
                            <p className="text-[12px] text-muted-foreground/80 truncate leading-snug">
                              {chat.preview}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </ScrollArea>
              </CardContent>
            </Card>

            <Card variant="glass" className={`lg:col-span-2 rounded-none border-y-0 border-r-0 shadow-none ${!selectedSessionId ? "hidden lg:block" : "flex flex-col"}`}>
              <CardHeader className="border-b border-border/50">
                <CardTitle className="text-lg flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" className="lg:hidden shrink-0" onClick={() => setSidebarOpen(true)}>
                      <Menu className="h-5 w-5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="lg:hidden shrink-0" onClick={() => setSelectedChatId(null)}>
                      <X className="h-5 w-5" />
                    </Button>
                    <div className={`h-10 w-10 rounded-full flex items-center justify-center shadow-sm ${selectedChat?.isAnonymous ? "bg-slate-500" : getUserColor(selectedChat?.studentName || "Student")}`}>
                      <span className="text-white text-xs font-bold">
                        {selectedChat ? (selectedChat.isAnonymous ? "??" : getInitials(selectedChat.studentName)) : <User className="h-4 w-4" />}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-base lg:text-lg leading-tight truncate">{selectedChat?.isAnonymous ? "Anonymous Student" : (selectedChat?.studentName || "Select a conversation")}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            selectedChatIsOnline
                              ? "bg-emerald-500 animate-pulse"
                              : "bg-muted-foreground/40"
                          }`}
                        />
                        <p className={`text-[11px] font-bold tracking-tight ${selectedChatIsOnline ? "text-emerald-500" : "text-muted-foreground/60"}`}>
                          {selectedChat ? (selectedChatIsOnline ? "Online" : "Away") : ""}
                        </p>
                      </div>
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
                    <div className="hidden lg:flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-100">
                      <Shield className="h-3 w-3" />
                      <span>
                        {isEncryptionReady ? "Encrypted" : "Securing..."}
                      </span>
                    </div>
                    {selectedSessionId && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 px-3 rounded-xl bg-destructive/5 text-destructive hover:bg-destructive/10 hover:text-destructive border border-destructive/10 gap-1.5"
                        onClick={handleEmergencyEscalation}
                        disabled={isTriggeringEmergency}
                      >
                        <AlertTriangle className="h-3.5 w-3.5" />
                        <span className="text-xs font-bold uppercase tracking-tight">{isTriggeringEmergency ? "Alerting" : "Emergency"}</span>
                      </Button>
                    )}
                    {selectedSessionId && selectedChat?.isAnonymous && (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-9 px-3 rounded-xl gap-1.5"
                        onClick={handleRevealIdentity}
                        disabled={isRevealingIdentity}
                      >
                        <Shield className="h-3.5 w-3.5" />
                        <span className="text-xs font-bold uppercase tracking-tight">{isRevealingIdentity ? "Revealing" : "Reveal Identity"}</span>
                      </Button>
                    )}
                    {isPeerCounselor && selectedSessionId && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 px-3 rounded-xl gap-1.5"
                        onClick={handleEscalateToCounselor}
                        disabled={isEscalating}
                      >
                        <AlertTriangle className="h-3.5 w-3.5" />
                        <span className="text-xs font-bold uppercase tracking-tight">{isEscalating ? "Escalating" : "Escalate"}</span>
                      </Button>
                    )}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col h-[calc(100%-80px)] p-0 bg-gradient-to-b from-background to-secondary/5">
                <ScrollArea ref={messageScrollAreaRef} className="flex-1 p-4 lg:p-6">
                  {!selectedSessionId ? (
                    <div className="h-full flex flex-col items-center justify-center text-sm text-muted-foreground p-8 text-center space-y-4">
                      <div className="h-24 w-24 rounded-[2rem] bg-secondary/30 flex items-center justify-center mb-4">
                        <MessageSquare className="h-12 w-12 opacity-20" />
                      </div>
                      <h3 className="text-2xl font-bold text-foreground">Student Conversations</h3>
                      <p className="max-w-xs">
                        {selectedChat?.lastActivity 
                          ? `Last conversation was ${formatTime(selectedChat.lastActivity)}`
                          : "Select a student conversation to start chatting"}
                      </p>
                      <div className="flex items-center gap-2 px-4 py-2 bg-secondary/50 rounded-full text-xs">
                        <Shield className="h-3 w-3 text-success" />
                        <span>Encrypted and secure</span>
                      </div>
                    </div>
                  ) : messagesLoading ? (
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
                      {messages.map((msg, idx) => {
                        const isMine = msg.sender_id === currentUserId;
                        const prevMsg = messages[idx - 1];
                        const showAvatar = !isMine && (!prevMsg || prevMsg.sender_id !== msg.sender_id);
                        const senderName = isMine ? "You" : selectedChat?.studentName || "Student";

                        return (
                          <div
                            key={msg.id}
                            className={`flex items-end gap-2 ${isMine ? "justify-end" : "justify-start"}`}
                          >
                            {!isMine && (
                              <div className="w-8 shrink-0">
                                {showAvatar && (
                                  <div className={`h-8 w-8 rounded-full ${getUserColor(senderName)} flex items-center justify-center text-[10px] font-bold text-white shadow-sm ring-2 ring-background`}>
                                    {getInitials(senderName)}
                                  </div>
                                )}
                              </div>
                            )}
                            
                            <div className={`group flex flex-col gap-1 max-w-[85%] sm:max-w-[70%] ${isMine ? "items-end" : "items-start"}`}>
                              <div
                                className={`p-4 rounded-[1.5rem] transition-all duration-300 shadow-sm border ${
                                  isMine
                                    ? "bg-primary text-primary-foreground rounded-br-none border-primary/20 shadow-primary/10"
                                    : "bg-background text-foreground rounded-bl-none border-border/50"
                                }`}
                              >
                                <div className="text-[15px] leading-relaxed">
                                  {renderMessageContent(msg)}
                                </div>
                              </div>
                              <div className="flex items-center gap-1 px-1 mt-0.5">
                                <span className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-widest">
                                  {formatTime(msg.created_at)}
                                </span>
                                {isMine && (
                                  <div className="flex ml-1">
                                    <span
                                      className={`text-[10px] font-black ${
                                        msg.seen_at ? "text-emerald-500" : "text-muted-foreground/40"
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
                        );
                      })}
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

                {/* Voice recording preview */}
                {recording && (
                  <div className="px-4 py-2 border-t border-border/50">
                    <div className="flex items-center gap-3 p-2 rounded-lg bg-primary/5 border border-primary/10">
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

                <form onSubmit={handleSendMessage} className="p-4 border-t border-border/50 bg-background/50">
                  <div className="relative flex items-end gap-2 p-2 bg-background border border-border/50 rounded-[1.5rem] shadow-sm focus-within:ring-2 focus-within:ring-primary/10 transition-all">
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
                      className="h-10 w-10 rounded-full hover:bg-secondary transition-all shrink-0 mb-0.5"
                      onClick={handleAttachClick}
                      disabled={isUploading || isRecording || !selectedSessionId}
                    >
                      <Paperclip className="h-5 w-5 text-muted-foreground" />
                    </Button>
                    
                    <div className="flex-1 relative mb-0.5">
                      {!isVoiceMode ? (
                        <div className="relative flex items-center">
                          <Input
                            placeholder={selectedSessionId ? "Type your message..." : "Select a conversation"}
                            value={message}
                            onChange={(e) => {
                              const nextMessage = e.target.value;
                              setMessage(nextMessage);
                              notifyTyping(nextMessage.trim().length > 0);
                            }}
                            onBlur={() => notifyTyping(false)}
                            className="h-10 pl-1 pr-24 rounded-xl bg-transparent border-none focus-visible:ring-0 text-[15px] shadow-none"
                            disabled={isSending || isUploading || !selectedSessionId}
                          />
                          <div className="absolute right-0 flex items-center gap-1">
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button 
                                  type="button" 
                                  variant="ghost" 
                                  size="icon"
                                  className="h-8 w-8 rounded-full hover:bg-secondary transition-all"
                                  disabled={isSending || isUploading || !selectedSessionId}
                                >
                                  <Smile className="h-5 w-5 text-muted-foreground/60" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-full p-0 border-none shadow-2xl bg-transparent mb-4" align="end" side="top">
                                <EmojiPicker
                                  onEmojiClick={(emojiData) => setMessage(prev => prev + emojiData.emoji)}
                                  theme={EmojiTheme.AUTO}
                                  lazyLoadEmojis={true}
                                />
                              </PopoverContent>
                            </Popover>
                            <Button 
                              type="button" 
                              variant="ghost" 
                              size="icon"
                              className="h-8 w-8 rounded-full hover:bg-secondary transition-all"
                              onClick={handleVoiceToggle}
                              disabled={isSending || isUploading || !selectedSessionId}
                            >
                              <Mic className="h-5 w-5 text-muted-foreground/60" />
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 h-10 px-1">
                          {isRecording ? (
                            <>
                              <div className="flex items-center gap-2">
                                <div className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
                                <span className="text-xs font-bold tabular-nums">{formatRecordingTime(recordingTime)}</span>
                              </div>
                              <div className="flex-1 h-1 bg-secondary rounded-full overflow-hidden">
                                <div className="h-full bg-primary animate-progress" style={{ width: '100%' }} />
                              </div>
                              <div className="flex gap-1">
                                <Button 
                                  type="button" 
                                  variant="ghost" 
                                  size="icon"
                                  className="h-7 w-7 rounded-full"
                                  onClick={isPaused ? resumeRecording : pauseRecording}
                                >
                                  {isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                                </Button>
                                <Button 
                                  type="button" 
                                  variant="ghost" 
                                  size="icon"
                                  className="h-7 w-7 rounded-full text-destructive hover:text-destructive hover:bg-destructive/10"
                                  onClick={handleVoiceCancel}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                                <Button 
                                  type="button" 
                                  variant="hero" 
                                  size="icon"
                                  className="h-7 w-7 rounded-lg bg-primary hover:bg-primary/90 shadow-md shadow-primary/20"
                                  onClick={handleVoiceToggle}
                                >
                                  <Square className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </>
                          ) : (
                            <div className="flex-1 flex items-center justify-between">
                              <span className="text-[13px] font-medium text-muted-foreground">Voice message ready</span>
                              <Button 
                                type="button" 
                                variant="ghost" 
                                size="sm" 
                                className="h-7 text-[11px] font-bold uppercase tracking-tight"
                                onClick={() => setIsVoiceMode(false)}
                              >
                                Switch to Text
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <Button
                      type="submit"
                      variant="hero"
                      size="icon"
                      className="h-10 w-10 rounded-full bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all active:scale-95 shrink-0 mb-0.5"
                      disabled={
                        !selectedSessionId ||
                        isSending ||
                        isUploading ||
                        (!message.trim() && !selectedFile && !recording) ||
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
