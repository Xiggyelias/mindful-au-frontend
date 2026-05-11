import { useState, useEffect, useRef, useMemo, useCallback, useDeferredValue } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
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
  ArrowUpCircle,
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
  Menu,
  MoreHorizontal,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/useAuth";
import { useEncryptedChat, ChatMessage } from "@/hooks/useEncryptedChat";
import { useFileAttachment } from "@/hooks/useFileAttachment";
import { useChatPreloader } from "@/hooks/useChatPreloader";
import { useChatRoomPrejoin } from "@/hooks/useChatRoomPrejoin";
import { API_RECOVERED_EVENT, api, getApiErrorMessage } from "@/lib/api";
import { CHAT_ANONYMITY_SYNC_EVENT, CHAT_INCOMING_DIGEST_EVENT } from "@/lib/chatRealtimeEvents";
import {
  CHAT_ATTACHMENT_ACCEPT,
  formatChatFileSize,
  messageIsAttachmentFirst,
  validateChatAttachment,
} from "@/lib/chatAttachments";
import { EncryptedMessagePlaceholder } from "@/components/chat/EncryptedMessagePlaceholder";
import { CounselorMessageThread } from "@/components/chat/CounselorMessageThread";
import { ChatAttachmentView } from "@/components/chat/ChatAttachmentView";
import type { E2EVisualState } from "@/types/e2eChat";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  formatInDisplayZone,
  isThisYearInDisplayZone,
  isTodayInDisplayZone,
  isYesterdayInDisplayZone,
} from "@/lib/displayTimezone";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  Popover, 
  PopoverContent, 
  PopoverTrigger 
} from "@/components/ui/popover";
import { VoiceRecordingPresenceStrip } from "@/components/chat/VoiceMemoPlayer";
import { LazyEmojiPicker } from "@/components/chat/LazyEmojiPicker";
import { AnonymousModeIndicator } from "@/components/privacy/AnonymousModeIndicator";
import { counselorChatDedupeKeyFromSession } from "@/lib/counselorChatListDedupe";
import { anonymousLabelForCounselor, isAnonymousSessionFlag } from "@/lib/anonymousMode";
import {
  hasCompletedLoginChatSecurity,
  markLoginChatSecurityComplete,
} from "@/lib/chatLoginSecurity";

const LOOKS_LIKE_E2E_CIPHER = (s: string): boolean => {
  const t = s.trim();
  return t.length >= 40 && /^[A-Za-z0-9+/=]+$/.test(t);
};

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

const SESSION_POLL_INTERVAL_MS = 5000;
const CHAT_LIST_TIMEOUT_MS = 30000;
const CHAT_LIST_PAGE_SIZE = 64;
const CHAT_LIST_RETRY_PAGE_SIZE = 32;
const CHAT_LIST_CACHE_TTL_MS = 60 * 1000;
const CHAT_LIST_CACHE_VERSION = 6;
const ONLINE_WINDOW_SECONDS = 10 * 60;

type RawSession = {
  id: number;
  student_id: number | null;
  /** When anonymous, real student id for E2E if `student_id` is 0 in list payloads */
  chat_peer_student_id?: number | null;
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
  unread_count?: number;
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
  unreadCount: number;
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

/** Parse API / session timestamps (ISO8601, or legacy `Y-m-d H:i:s`) into local `Date`. */
const parseBackendDate = (value?: string | null): Date | null => {
  if (value == null) return null;
  const s = String(value).trim();
  if (s === "") return null;
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) {
    const legacy = new Date(s.replace(" ", "T"));
    if (!Number.isNaN(legacy.getTime())) return legacy;
  }
  return null;
};

const toTimestamp = (value?: string) => {
  const d = parseBackendDate(value);
  return d ? d.getTime() : 0;
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

/** Sidebar / session list: clock time in display zone (default Africa/Harare). */
const formatChatListTime = (dateString?: string) => {
  const d = parseBackendDate(dateString);
  if (!d) return "";
  if (isTodayInDisplayZone(d)) return formatInDisplayZone(d, "h:mm a");
  if (isYesterdayInDisplayZone(d)) return `Yesterday · ${formatInDisplayZone(d, "h:mm a")}`;
  if (isThisYearInDisplayZone(d)) return formatInDisplayZone(d, "MMM d · h:mm a");
  return formatInDisplayZone(d, "MMM d, yyyy · h:mm a");
};

const getInitials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
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
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedChatId, setSelectedChatId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [chats, setChats] = useState<ChatListItem[]>([]);
  const [isLoadingChats, setIsLoadingChats] = useState(true);
  const [chatPage, setChatPage] = useState(1);
  const [chatTotalPages, setChatTotalPages] = useState(1);
  const [, setChatTotalItems] = useState(0);
  const [isEscalating, setIsEscalating] = useState(false);
  const [isFlaggingUrgent, setIsFlaggingUrgent] = useState(false);
  const [isTriggeringEmergency, setIsTriggeringEmergency] = useState(false);
  const [isRevealingIdentity, setIsRevealingIdentity] = useState(false);
  const [encryptionTimedOut, setEncryptionTimedOut] = useState(false);
  const [isRetryingEncryption, setIsRetryingEncryption] = useState(false);
  const [isEntryPreflightActive, setIsEntryPreflightActive] = useState(
    () => Boolean((location.state as { secureChatPreflight?: boolean } | null)?.secureChatPreflight)
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageScrollAreaRef = useRef<HTMLDivElement>(null);
  const [showThreadScrollToBottom, setShowThreadScrollToBottom] = useState(false);
  const hasShownLoadErrorRef = useRef(false);
  const loadSessionsGenerationRef = useRef(0);
  const activeSessionIdRef = useRef<number | null>(null);
  const { user, role } = useAuth();
  const isPeerCounselor = role === "peer_counselor";
  const navItems = isPeerCounselor ? peerCounselorNavItems : counselorNavItems;
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || (isPeerCounselor ? "Peer Counselor" : "Counselor");
  const [hasLoginSecureSession, setHasLoginSecureSession] = useState(() =>
    hasCompletedLoginChatSecurity(user?.id)
  );
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [deletingMessageIds, setDeletingMessageIds] = useState<Set<number>>(() => new Set());

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

  useChatPreloader({
    sessions: chats,
    activeSessionId: selectedSessionId,
    enabled: Boolean(user?.id),
    ownerUserId: user?.id?.toString() || null,
  });
  useChatRoomPrejoin({
    sessions: chats,
    activeSessionId: selectedSessionId,
    enabled: Boolean(user?.id),
  });

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
    retryEncryption,
    nudgeEncryptionHandshake,
    deleteMessage,
  } = useEncryptedChat({
    sessionId: selectedSessionId,
    userId: String(user?.id || ""),
  });

  const isEncryptionReadyRef = useRef(isEncryptionReady);
  const chatErrorRef = useRef(chatError);
  useEffect(() => {
    isEncryptionReadyRef.current = isEncryptionReady;
    chatErrorRef.current = chatError;
  }, [isEncryptionReady, chatError]);

  useEffect(() => {
    setHasLoginSecureSession(hasCompletedLoginChatSecurity(user?.id));
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || !isEncryptionReady) return;
    markLoginChatSecurityComplete(user.id);
    setHasLoginSecureSession(true);
  }, [isEncryptionReady, user?.id]);

  useEffect(() => {
    if (
      (location.state as { secureChatPreflight?: boolean } | null)?.secureChatPreflight &&
      !hasLoginSecureSession
    ) {
      setIsEntryPreflightActive(true);
    }
  }, [hasLoginSecureSession, location.state]);

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
    // `chats` is de-duplicated in loadSessions (same student + anonymity + role lane).
    const needle = deferredSearchQuery.trim().toLowerCase();
    if (!needle) {
      return chats;
    }
    return chats.filter((chat) => {
      return (
        chat.studentName.toLowerCase().includes(needle) ||
        (chat.studentEmail || "").toLowerCase().includes(needle) ||
        String(chat.id).includes(needle)
      );
    });
  }, [chats, deferredSearchQuery]);

  const selectConversationById = useCallback((id: number) => {
    if (!Number.isFinite(id) || id <= 0) return;
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
    setSelectedChatId(id);
    activeSessionIdRef.current = id; // Track currently open session
    void api.markSessionInboundRead(String(id)).catch(() => {});
  }, []);

  const loadSessions = useCallback(
    async (silent = false) => {
      if (!user?.id) return;

      const generation = ++loadSessionsGenerationRef.current;

      try {
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
                    const unreadCount = Math.max(
                      0,
                      Math.floor(Number((chat as ChatListItem)?.unreadCount ?? 0))
                    );
                    return {
                      ...chat,
                      unreadCount,
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

        console.log('[sessions] unread counts:', 
          (normalized || []).map(s => ({ id: s.id, unread: s.unread_count }))
        );

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

        const chatSessions = normalized
          .filter(
            (session) =>
              session.session_type === "chat" &&
              (isAnonymousSessionFlag(session.is_anonymous) || Number(session.student_id) > 0)
          )
          .sort((a, b) => {
            const aTime = toTimestamp(a.updated_at || a.created_at);
            const bTime = toTimestamp(b.updated_at || b.created_at);
            return bTime - aTime;
          });

        const dedupedByConversation = new Map<string, { session: RawSession }>();

        for (const session of chatSessions) {
          const conversationKey = counselorChatDedupeKeyFromSession(session);
          const bucket = dedupedByConversation.get(conversationKey);
          if (!bucket) {
            dedupedByConversation.set(conversationKey, { session });
            continue;
          }

          const existing = bucket.session;
          const existingOpen = isOpenSession(existing.status);
          const currentOpen = isOpenSession(session.status);
          if (currentOpen && !existingOpen) {
            bucket.session = session;
            continue;
          }

          if (!currentOpen && existingOpen) {
            continue;
          }

          const existingTime = toTimestamp(existing.updated_at || existing.created_at);
          const currentTime = toTimestamp(session.updated_at || session.created_at);
          if (currentTime > existingTime) {
            bucket.session = session;
          }
        }

        const nextChats = Array.from(dedupedByConversation.values())
          .map(({ session }): ChatListItem => {
            const isAnonymous = isAnonymousSessionFlag(session.is_anonymous);
            const anonymousLabel = anonymousLabelForCounselor();
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
            const rowUnread = Math.max(0, Math.floor(Number(session.unread_count ?? 0)));

            return {
              id: Number(session.id),
              studentId: visibleStudentId,
              counselorId: Number(session.counselor_id),
              studentName: name,
              studentEmail: email,
              isAnonymous,
              anonymousId: String(session.anonymous_id ?? "").trim(),
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
              unreadCount: (session.id && activeSessionIdRef.current && Number(session.id) === activeSessionIdRef.current) ? 0 : rowUnread,
            };
          })
          .sort((a, b) => toTimestamp(b.lastActivity) - toTimestamp(a.lastActivity));

        const targetSessionId = targetSessionParam ? Number(targetSessionParam) : null;
        const targetStudentId = targetStudentParam ? Number(targetStudentParam) : null;

        if (generation !== loadSessionsGenerationRef.current) {
          return;
        }

        setChatTotalPages(nextTotalPages);
        setChatTotalItems(nextTotal);
        if (!pagedPayload && chatPage !== 1) {
          setChatPage(1);
        } else if (pagedPayload && nextPage !== chatPage) {
          setChatPage(nextPage);
        }

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
    if (!user?.id) return;
    const onDigest = () => {
      void loadSessions(true);
    };
    window.addEventListener(CHAT_INCOMING_DIGEST_EVENT, onDigest as EventListener);
    return () => window.removeEventListener(CHAT_INCOMING_DIGEST_EVENT, onDigest as EventListener);
  }, [loadSessions, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    const onAnon = () => void loadSessions(true);
    window.addEventListener(CHAT_ANONYMITY_SYNC_EVENT, onAnon);
    return () => window.removeEventListener(CHAT_ANONYMITY_SYNC_EVENT, onAnon);
  }, [loadSessions, user?.id]);

  const prevMessagesLoadingRef = useRef(false);
  useEffect(() => {
    if (prevMessagesLoadingRef.current && !messagesLoading && selectedSessionId) {
      void loadSessions(true);
    }
    prevMessagesLoadingRef.current = messagesLoading;
  }, [messagesLoading, selectedSessionId, loadSessions]);

  useEffect(() => {
    setDeletingMessageIds(new Set());
  }, [selectedSessionId]);

  const canModerateChat = role === "counselor" || role === "peer_counselor";

  const handleDeleteMessage = useCallback(
    async (messageId: number) => {
      if (!canModerateChat) return;
      setDeletingMessageIds((prev) => new Set(prev).add(messageId));
      try {
        const ok = await deleteMessage(messageId);
        if (!ok) {
          toast.error("Could not delete message");
        }
      } finally {
        setDeletingMessageIds((prev) => {
          const next = new Set(prev);
          next.delete(messageId);
          return next;
        });
      }
    },
    [canModerateChat, deleteMessage]
  );

  // Encryption timeout: if not ready after 15s, show fallback UI (refs avoid stale timer callbacks)
  useEffect(() => {
    if (!selectedSessionId || hasLoginSecureSession || isEncryptionReady || chatError) {
      setEncryptionTimedOut(false);
      return;
    }
    setEncryptionTimedOut(false);
    const timer = window.setTimeout(() => {
      if (!isEncryptionReadyRef.current && !chatErrorRef.current) {
        setEncryptionTimedOut(true);
      }
    }, 15000);
    return () => window.clearTimeout(timer);
  }, [selectedSessionId, hasLoginSecureSession, isEncryptionReady, chatError]);

  useEffect(() => {
    if (!isEntryPreflightActive) return;
    if ((!selectedSessionId && !isLoadingChats) || hasLoginSecureSession || isEncryptionReady || chatError || encryptionTimedOut) {
      setIsEntryPreflightActive(false);
      navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    }
  }, [
    chatError,
    encryptionTimedOut,
    hasLoginSecureSession,
    isEncryptionReady,
    isEntryPreflightActive,
    isLoadingChats,
    location.pathname,
    location.search,
    navigate,
    selectedSessionId,
  ]);

  const handleRetryEncryption = useCallback(async () => {
    setIsRetryingEncryption(true);
    setEncryptionTimedOut(false);
    try {
      await retryEncryption();
    } finally {
      setIsRetryingEncryption(false);
    }
  }, [retryEncryption]);

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
      activeSessionIdRef.current = null; // Clear active session
      await loadSessions(false);
    } catch (error: unknown) {
      const errMsg = (error as { response?: { data?: { message?: string } } })?.response?.data?.message || "Failed to escalate case";
      toast.error(errMsg);
    } finally {
      setIsEscalating(false);
    }
  };

  const handleFlagUrgent = async () => {
    if (!selectedSessionId || !isPeerCounselor || isFlaggingUrgent) return;

    const reason = window.prompt(
      "Describe the urgent concern (required). This will hand the case off to a counselor immediately:",
      ""
    );
    if (reason === null) return;
    const trimmed = reason.trim();
    if (trimmed.length < 5) {
      toast.error("Please provide at least 5 characters describing the urgent concern.");
      return;
    }

    try {
      setIsFlaggingUrgent(true);
      await api.flagUrgentConcern(selectedSessionId, trimmed);
      toast.success("Urgent concern flagged. Case handed off to a counselor.");
      setSelectedChatId(null);
      activeSessionIdRef.current = null; // Clear active session
      await loadSessions(false);
    } catch (error: unknown) {
      toast.error(getApiErrorMessage(error, "Failed to flag urgent concern"));
    } finally {
      setIsFlaggingUrgent(false);
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

  const canGoToPrevPage = chatPage > 1;
  const canGoToNextPage = chatPage < chatTotalPages;
  const selectedChatIsOnline = resolveChatOnline(selectedChat);
  const showEntryPreflight =
    isEntryPreflightActive &&
    !hasLoginSecureSession &&
    !chatError &&
    !encryptionTimedOut &&
    (isLoadingChats || (Boolean(selectedSessionId) && !isEncryptionReady));

  const handlePrevPage = () => {
    if (!canGoToPrevPage || isLoadingChats) return;
    setChatPage((current) => Math.max(1, current - 1));
  };

  const handleNextPage = () => {
    if (!canGoToNextPage || isLoadingChats) return;
    setChatPage((current) => Math.min(chatTotalPages, current + 1));
  };

  const handleCounselorThreadAtBottomChange = useCallback((atBottom: boolean) => {
    setShowThreadScrollToBottom(!atBottom && messages.length > 5);
  }, [messages.length]);

  useEffect(() => {
    setShowThreadScrollToBottom(false);
  }, [selectedSessionId]);

  const handleLoadOlderMessages = useCallback(async () => {
    if (!selectedSessionId) return;
    if (!hasOlderMessages || isLoadingOlderMessages) return;
    await loadOlderMessages();
  }, [hasOlderMessages, isLoadingOlderMessages, loadOlderMessages, selectedSessionId]);

  const threadStudentLabel = useMemo(
    () =>
      selectedChat?.isAnonymous ? anonymousLabelForCounselor() : (selectedChat?.studentName ?? "Student"),
    [selectedChat]
  );

  const renderMessageContent = useCallback((msg: ChatMessage, isOutgoing: boolean) => {
    if (messageIsAttachmentFirst(msg)) {
      return <ChatAttachmentView message={msg} isOutgoing={isOutgoing} />;
    }

    const failVisuals: E2EVisualState[] = ["awaiting_key", "needs_resync", "payload_invalid"];
    if (msg.is_encrypted && msg.e2eVisual && failVisuals.includes(msg.e2eVisual)) {
      return (
        <EncryptedMessagePlaceholder
          state={msg.e2eVisual as "awaiting_key" | "needs_resync" | "payload_invalid"}
          isOutgoing={isOutgoing}
          onRetryDecrypt={() => {
            void nudgeEncryptionHandshake();
          }}
          onResyncDevice={() => {
            void handleRetryEncryption();
          }}
        />
      );
    }

    const legacyBracket =
      msg.is_encrypted &&
      typeof msg.decryptedContent === "string" &&
      /^\s*\[(Encrypted message|Unable to decrypt)/i.test(msg.decryptedContent);
    if (legacyBracket) {
      return (
        <EncryptedMessagePlaceholder
          state="needs_resync"
          isOutgoing={isOutgoing}
          onRetryDecrypt={() => {
            void nudgeEncryptionHandshake();
          }}
          onResyncDevice={() => {
            void handleRetryEncryption();
          }}
        />
      );
    }

    if (
      msg.is_encrypted &&
      !msg.e2eVisual &&
      !String(msg.decryptedContent || "").trim() &&
      typeof msg.content === "string" &&
      LOOKS_LIKE_E2E_CIPHER(msg.content)
    ) {
      return (
        <EncryptedMessagePlaceholder
          state="awaiting_key"
          isOutgoing={isOutgoing}
          onRetryDecrypt={() => {
            void nudgeEncryptionHandshake();
          }}
          onResyncDevice={() => {
            void handleRetryEncryption();
          }}
        />
      );
    }

    const content = msg.decryptedContent || msg.content || "";

    return <p>{content}</p>;
  }, [handleRetryEncryption, nudgeEncryptionHandshake]);

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
          <div className={`grid min-h-0 lg:grid-cols-3 ${selectedSessionId ? "h-screen" : "h-[calc(100vh-80px)]"}`}>
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
                    filteredChats.map((chat) => {
                      const isActive = selectedChat?.id === chat.id;
                      return (
                      <div
                        key={chat.id}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            selectConversationById(chat.id);
                          }
                        }}
                        className={cn(
                          "mx-2 my-1 cursor-pointer rounded-2xl border border-transparent px-3 py-2.5 transition-colors outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-primary/35",
                          isActive
                            ? "border-primary/20 bg-primary/[0.08] shadow-sm dark:bg-primary/10"
                            : "hover:bg-muted/60 dark:hover:bg-muted/25"
                        )}
                        onClick={() => selectConversationById(chat.id)}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={cn(
                              "h-11 w-11 shrink-0 rounded-full flex items-center justify-center shadow-inner ring-2 ring-background",
                              chat.isAnonymous
                                ? "bg-black ring-red-600/70"
                                : getUserColor(chat.studentName)
                            )}
                          >
                            <span className="text-white text-[11px] font-bold tracking-tight">
                              {chat.isAnonymous ? "AU" : getInitials(chat.studentName)}
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="mb-0.5 flex items-start justify-between gap-2">
                              <div className="flex min-w-0 flex-wrap items-center gap-1">
                                <p className={cn(
                                  "truncate text-[13px] font-semibold tracking-tight",
                                  isActive ? "text-foreground" : "text-foreground/90"
                                )}>
                                  {chat.isAnonymous ? anonymousLabelForCounselor() : chat.studentName}
                                </p>
                                {chat.isAnonymous && <AnonymousModeIndicator variant="inline" />}
                                {chat.isPeerAssigned && (
                                  <span className="rounded-md bg-primary/12 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                                    Peer
                                  </span>
                                )}
                              </div>
                              <span className="flex shrink-0 items-center gap-1.5">
                                {chat.unreadCount > 0 && (
                                  <span
                                    className="flex h-[1.35rem] min-w-[1.35rem] items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-white tabular-nums shadow-sm ring-2 ring-background"
                                    aria-label={`${chat.unreadCount} unread message${chat.unreadCount === 1 ? "" : "s"}`}
                                  >
                                    {chat.unreadCount > 99 ? "99+" : chat.unreadCount}
                                  </span>
                                )}
                                <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">
                                  {formatChatListTime(chat.lastActivity)}
                                </span>
                              </span>
                            </div>
                            <p className="line-clamp-2 text-[12px] leading-snug text-muted-foreground">
                              {chat.preview}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                    })
                  )}
                </ScrollArea>
              </CardContent>
            </Card>

            <Card
              variant="glass"
              className={`flex min-h-0 flex-1 flex-col overflow-hidden lg:col-span-2 rounded-none border-y-0 border-r-0 shadow-none ${!selectedSessionId ? "hidden lg:flex" : "flex"}`}
            >
              <CardHeader className="shrink-0 space-y-0 border-b border-border/50 px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <Button variant="ghost" size="icon" className="lg:hidden shrink-0" onClick={() => setSidebarOpen(true)}>
                      <Menu className="h-5 w-5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="lg:hidden shrink-0" onClick={() => { setSelectedChatId(null); activeSessionIdRef.current = null; }}>
                      <X className="h-5 w-5" />
                    </Button>
                    <div
                      className={cn(
                        "flex h-11 w-11 shrink-0 items-center justify-center rounded-full shadow-inner ring-2 ring-background",
                        selectedChat?.isAnonymous ? "bg-black ring-red-600/70" : getUserColor(selectedChat?.studentName || "Student")
                      )}
                    >
                      <span className="text-[11px] font-bold text-white">
                        {selectedChat ? (selectedChat.isAnonymous ? "AU" : getInitials(selectedChat.studentName)) : <User className="h-4 w-4 text-muted-foreground" />}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="truncate text-base font-semibold leading-tight">
                          {selectedChat?.isAnonymous ? anonymousLabelForCounselor() : selectedChat?.studentName || "Select a conversation"}
                        </p>
                        {selectedChat?.isAnonymous && (
                          <AnonymousModeIndicator variant="badge" audience="counselor" />
                        )}
                        {selectedChat?.isPeerAssigned && (
                          <span className="rounded-md bg-primary/12 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                            Peer
                          </span>
                        )}
                        <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                          <Shield className="h-3 w-3 shrink-0" />
                          <span className="whitespace-nowrap">
                            {isEncryptionReady || hasLoginSecureSession ? "Encrypted" : encryptionTimedOut ? "Timeout" : "Securing…"}
                          </span>
                        </div>
                        {encryptionTimedOut && !isEncryptionReady && !hasLoginSecureSession && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 shrink-0 rounded-full border-amber-500/35 px-2 text-[10px] text-amber-800 hover:bg-amber-500/10 dark:text-amber-200"
                            onClick={handleRetryEncryption}
                            disabled={isRetryingEncryption}
                          >
                            {isRetryingEncryption ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> : null}
                            Retry
                          </Button>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "h-2 w-2 shrink-0 rounded-full",
                            selectedChatIsOnline ? "animate-pulse bg-emerald-500" : "bg-muted-foreground/40"
                          )}
                        />
                        <p
                          className={cn(
                            "truncate text-[11px] font-medium",
                            selectedChatIsOnline ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
                          )}
                        >
                          {selectedChat ? (selectedChatIsOnline ? "Online" : "Away") : ""}
                        </p>
                      </div>
                    </div>
                  </div>
                  {selectedSessionId && (
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 shrink-0 gap-1.5 rounded-xl border-destructive/25 bg-destructive/5 px-3 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={handleEmergencyEscalation}
                        disabled={isTriggeringEmergency}
                      >
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        <span className="text-xs font-semibold">{isTriggeringEmergency ? "Alerting…" : "Emergency"}</span>
                      </Button>
                      {(selectedChat?.isAnonymous || isPeerCounselor) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="h-9 shrink-0 gap-2 rounded-xl px-3">
                              <MoreHorizontal className="h-4 w-4" />
                              <span className="hidden font-semibold sm:inline">Actions</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            {selectedChat?.isAnonymous && (
                              <DropdownMenuItem onClick={() => void handleRevealIdentity()} disabled={isRevealingIdentity}>
                                <Shield className="mr-2 h-4 w-4" />
                                {isRevealingIdentity ? "Revealing…" : "Reveal identity"}
                              </DropdownMenuItem>
                            )}
                            {selectedChat?.isAnonymous && isPeerCounselor && <DropdownMenuSeparator />}
                            {isPeerCounselor && (
                              <>
                                <DropdownMenuItem onClick={() => void handleEscalateToCounselor()} disabled={isEscalating}>
                                  <ArrowUpCircle className="mr-2 h-4 w-4" />
                                  {isEscalating ? "Escalating…" : "Escalate to counselor"}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-orange-700 focus:text-orange-800 dark:text-orange-300 dark:focus:text-orange-200"
                                  onClick={() => void handleFlagUrgent()}
                                  disabled={isFlaggingUrgent}
                                >
                                  <AlertTriangle className="mr-2 h-4 w-4" />
                                  {isFlaggingUrgent ? "Flagging…" : "Flag as urgent"}
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col p-0 bg-gradient-to-b from-background to-secondary/5 pt-0">
                {showEntryPreflight ? (
                  <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
                    <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10">
                      <Loader2 className="h-7 w-7 animate-spin text-primary" />
                    </div>
                    <h2 className="text-xl font-display font-bold tracking-tight">Securing Your Chat</h2>
                    <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                      Verifying the private session key before opening this conversation.
                    </p>
                  </div>
                ) : (
                <>
                {/* Mobile encryption status banner */}
                {selectedSessionId && !hasLoginSecureSession && !isEncryptionReady && !chatError && !encryptionTimedOut && (
                  <div className="shrink-0 lg:hidden bg-primary/10 border-b border-primary/20 px-4 py-2 flex items-center justify-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-primary/80">Securing…</span>
                  </div>
                )}
                {selectedSessionId && !hasLoginSecureSession && !isEncryptionReady && !chatError && encryptionTimedOut && (
                  <div className="shrink-0 lg:hidden bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center justify-center gap-2">
                    <AlertTriangle className="h-3 w-3 text-amber-600" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-amber-700">Connection timeout</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[10px] rounded-full border-amber-500/30 text-amber-700 hover:bg-amber-500/10 ml-1"
                      onClick={handleRetryEncryption}
                      disabled={isRetryingEncryption}
                    >
                      {isRetryingEncryption ? <Loader2 className="h-3 w-3 animate-spin" /> : "Retry"}
                    </Button>
                  </div>
                )}
                {selectedSessionId && chatError && (
                  <div className="shrink-0 lg:hidden bg-destructive/10 border-b border-destructive/20 px-4 py-2 flex items-center justify-center gap-2">
                    <AlertTriangle className="h-3 w-3 text-destructive" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-destructive/80 truncate">{chatError}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[10px] rounded-full border-destructive/30 text-destructive hover:bg-destructive/10 ml-1"
                      onClick={handleRetryEncryption}
                      disabled={isRetryingEncryption}
                    >
                      {isRetryingEncryption ? <Loader2 className="h-3 w-3 animate-spin" /> : "Retry"}
                    </Button>
                  </div>
                )}
                <div className="min-h-0 flex-1 flex flex-col">
                  {!selectedSessionId ? (
                    <div className="h-full flex flex-col items-center justify-center text-sm text-muted-foreground p-8 text-center space-y-4">
                      <div className="h-24 w-24 rounded-[2rem] bg-secondary/30 flex items-center justify-center mb-4">
                        <MessageSquare className="h-12 w-12 opacity-20" />
                      </div>
                      <h3 className="text-2xl font-bold text-foreground">Student Conversations</h3>
                      <p className="max-w-xs">
                        {selectedChat?.lastActivity 
                          ? `Last activity ${formatChatListTime(selectedChat.lastActivity)}`
                          : "Select a student conversation to start chatting"}
                      </p>
                      <div className="flex items-center gap-2 px-4 py-2 bg-secondary/50 rounded-full text-xs">
                        <Shield className="h-3 w-3 text-success" />
                        <span>Encrypted and secure</span>
                      </div>
                    </div>
                  ) : messagesLoading ? (
                    <div className="flex min-h-[240px] flex-1 items-center justify-center">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : messages.length === 0 && !isPeerTyping ? (
                    <div className="text-center text-sm text-muted-foreground py-8">
                      <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>No messages yet</p>
                      <p className="text-xs">Start the conversation by sending a message</p>
                    </div>
                  ) : (
                    <CounselorMessageThread
                      conversationKey={selectedSessionId}
                      messages={messages}
                      currentUserId={currentUserId}
                      studentLabel={threadStudentLabel}
                      studentIsAnonymous={Boolean(selectedChat?.isAnonymous)}
                      isPeerTyping={isPeerTyping}
                      hasOlderMessages={hasOlderMessages}
                      isLoadingOlderMessages={isLoadingOlderMessages}
                      error={chatError}
                      onLoadOlder={handleLoadOlderMessages}
                      deletingMessageIds={deletingMessageIds}
                      onDeleteMessage={handleDeleteMessage}
                      canModerateChat={canModerateChat}
                      renderMessageContent={renderMessageContent}
                      scrollRef={scrollRef}
                      containerRef={messageScrollAreaRef}
                      onAtBottomChange={handleCounselorThreadAtBottomChange}
                      showScrollToBottom={showThreadScrollToBottom}
                      scrollToBottom={() => scrollRef.current?.scrollIntoView({ behavior: "smooth" })}
                      onRetryLoad={() => {
                        void retryEncryption();
                      }}
                    />
                  )}
                </div>

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
                                <LazyEmojiPicker
                                  onEmojiClick={(emojiData) => setMessage(prev => prev + emojiData.emoji)}
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
                              <VoiceRecordingPresenceStrip className="h-9 shrink-0" />
                              <span className="text-xs tabular-nums text-muted-foreground font-medium">{formatRecordingTime(recordingTime)}</span>
                              <div className="flex-1 h-1.5 rounded-full bg-muted/70 overflow-hidden">
                                <div
                                  className="h-full w-full origin-left animate-pulse bg-primary/40"
                                  aria-hidden
                                />
                              </div>
                              <div className="flex gap-1 shrink-0">
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
                                  className="h-7 w-7 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                                  onClick={handleVoiceCancel}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon"
                                  className="h-7 w-7 rounded-lg border-primary/35"
                                  onClick={handleVoiceToggle}
                                >
                                  <Square className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </>
                          ) : (
                            <div className="flex-1 flex items-center justify-between">
                              <span className="text-[13px] font-medium text-muted-foreground">
                                Voice memo ready to send
                              </span>
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
                </>
                )}
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
};

export default CounselorMessages;
