import { useState, useEffect, useRef, useMemo, useCallback, useDeferredValue } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
  Shield,
  ShieldCheck,
  ArrowUpCircle,
  Loader2,
  AlertTriangle,
  X,
  User,
  UserCircle2,
  Menu,
  MoreHorizontal,
} from "lucide-react";
import { counselorNavItems, peerCounselorNavItems } from "@/config/counselorNavItems";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/hooks/useAuth";
import { useEncryptedChat, ChatMessage } from "@/hooks/useEncryptedChat";
import { useFileAttachment } from "@/hooks/useFileAttachment";
import { useChatPreloader } from "@/hooks/useChatPreloader";
import { useChatRoomPrejoin } from "@/hooks/useChatRoomPrejoin";
import { API_RECOVERED_EVENT, api, getApiErrorMessage } from "@/lib/api";
import { loadPreloadedSessionMessages, savePreloadedSessionMessages } from '@/lib/chatPreloadCache';
import { CHAT_ANONYMITY_SYNC_EVENT, CHAT_INCOMING_DIGEST_EVENT } from "@/lib/chatRealtimeEvents";
import {
  messageIsAttachmentFirst,
  validateChatAttachment,
} from "@/lib/chatAttachments";
import { CounselorMessageThread } from "@/components/chat/CounselorMessageThread";
import { ChatAttachmentView } from "@/components/chat/ChatAttachmentView";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import { detectCrisisTermsInText, isE2EHandshakeEnvelopeContent } from "@/lib/crisisTerms";
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
import { ChatInput } from "@/components/chat/ChatInput";
import { AnonymousModeIndicator } from "@/components/privacy/AnonymousModeIndicator";
import { counselorChatDedupeKeyFromSession } from "@/lib/counselorChatListDedupe";
import { isStorageQuotaError, trimLocalStorageByPrefix } from "@/lib/browserStorage";
import {
  anonymousLabelForCounselor,
  isAnonymousSessionFlag,
  isCounselorChatListableStudentSession,
} from "@/lib/anonymousMode";

const LOOKS_LIKE_E2E_CIPHER = (s: string): boolean => {
  const t = s.trim();
  return t.length >= 40 && /^[A-Za-z0-9+/=]+$/.test(t);
};

const SESSION_POLL_INTERVAL_MS = 12_000;
const CHAT_LIST_TIMEOUT_MS = 30000;
const CHAT_LIST_PAGE_SIZE = 64;
const CHAT_LIST_RETRY_PAGE_SIZE = 32;
const CHAT_LIST_CACHE_TTL_MS = 60 * 1000;
const CHAT_LIST_CACHE_VERSION = 7;
const IDENTITY_REVEAL_GRANTS_KEY = "counselor_identity_reveal_grants_v1";
const ONLINE_WINDOW_SECONDS = 10 * 60;
const CHAT_LIST_MIN_REFRESH_GAP_MS = 8000;

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
  realStudentName: string;
  realStudentEmail: string;
  studentName: string;
  studentEmail: string;
  isAnonymous: boolean;
  anonymousId: string;
  identityVisibleToViewer: boolean;
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

const readIdentityRevealGrants = (): Record<string, string> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(IDENTITY_REVEAL_GRANTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const normalized: Record<string, string> = {};
    Object.entries(parsed || {}).forEach(([sessionId, version]) => {
      if (typeof sessionId === "string" && typeof version === "string" && version.trim() !== "") {
        normalized[sessionId] = version;
      }
    });
    return normalized;
  } catch {
    return {};
  }
};

const writeIdentityRevealGrants = (grants: Record<string, string>) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(IDENTITY_REVEAL_GRANTS_KEY, JSON.stringify(grants));
  } catch {
    // Ignore localStorage failures.
  }
};

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
  if (isYesterdayInDisplayZone(d)) return "Yesterday";
  
  // WhatsApp-like: show day name if within the last 7 days
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - d.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  if (diffDays < 7) {
    return formatInDisplayZone(d, "EEEE");
  }
  
  return formatInDisplayZone(d, "d/M/yy");
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
  const { confirm, prompt } = useConfirm();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedChatId, setSelectedChatId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarLane, setSidebarLane] = useState<"direct" | "supervision">("direct");
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
  const [isSwitchingChat, setIsSwitchingChat] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageScrollAreaRef = useRef<HTMLDivElement>(null);
  const [showThreadScrollToBottom, setShowThreadScrollToBottom] = useState(false);
  const hasShownLoadErrorRef = useRef(false);
  const loadSessionsGenerationRef = useRef(0);
  const loadSessionsInFlightRef = useRef<Promise<void> | null>(null);
  const lastLoadSessionsAtRef = useRef(0);
  const activeSessionIdRef = useRef<number | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadAfterReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const digestReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingIdentityRevealGrantSessionIdRef = useRef<number | null>(null);
  const { user, role } = useAuth();
  const isPeerCounselor = role === "peer_counselor";
  const navItems = isPeerCounselor ? peerCounselorNavItems : counselorNavItems;
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || (isPeerCounselor ? "Peer Counselor" : "Counselor");
  const [deletingMessageIds, setDeletingMessageIds] = useState<Set<number>>(() => new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [messageToDelete, setMessageToDelete] = useState<any | null>(null);
  const [identityRevealGrants, setIdentityRevealGrants] = useState<Record<string, string>>(
    () => readIdentityRevealGrants()
  );

  // ── selectedChat must be derived BEFORE the useEffects below that reference
  // it in their dependency arrays.  Declaring it after those useEffect calls
  // puts it in the temporal dead zone (TDZ) and throws a ReferenceError on
  // every render, which the ErrorBoundary catches as "Something went wrong".
  const selectedChat = useMemo(() => {
    if (!chats.length) return null;
    if (!selectedChatId) return chats[0];
    return chats.find((chat) => chat.id === selectedChatId) || chats[0];
  }, [chats, selectedChatId]);

  // ── Session Prep briefing panel ──────────────────────────────────────────
  const [briefOpen, setBriefOpen] = useState(false);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefData, setBriefData] = useState<{
    riskLevel: string | null;
    riskColor: string;
    aiRecommendation: string | null;
    focusAreas: string[];
    moodScore: number | null;
    stressLevel: number | null;
    burnoutIndex: number | null;
    wellnessUpdatedAt: string | null;
  } | null>(null);

  const briefStudentIdRef = useRef<number | null>(null);

  useEffect(() => {
    const studentId = selectedChat?.studentId ?? null;

    // Only counselors (not peer counselors) have access to these endpoints
    if (isPeerCounselor || !studentId || studentId <= 0) {
      setBriefData(null);
      return;
    }

    // Skip redundant re-fetches for the same student
    if (briefStudentIdRef.current === studentId && briefData !== null) return;
    briefStudentIdRef.current = studentId;

    const riskColorMap: Record<string, string> = {
      critical: "text-destructive",
      high: "text-orange-600",
      medium: "text-yellow-600",
      elevated: "text-yellow-600",
      low: "text-success",
      normal: "text-success",
    };

    let cancelled = false;
    setBriefLoading(true);

    Promise.allSettled([
      api.getAIDiagnostics({ student_id: studentId, limit: 1 }),
      api.getStudentWellnessSummary(studentId),
    ]).then(([diagResult, wellnessResult]) => {
      if (cancelled) return;

      // ── AI Diagnostic ──
      let riskLevel: string | null = null;
      let aiRecommendation: string | null = null;
      let focusAreas: string[] = [];

      if (diagResult.status === "fulfilled") {
        const raw = diagResult.value;
        const list: any[] =
          Array.isArray(raw) ? raw :
          Array.isArray(raw?.data) ? raw.data :
          Array.isArray(raw?.diagnostics) ? raw.diagnostics :
          Array.isArray(raw?.results) ? raw.results : [];
        const latest = list[0] ?? null;
        if (latest) {
          riskLevel = typeof latest.risk_level === "string" ? latest.risk_level.toLowerCase() : null;
          aiRecommendation =
            typeof latest.ai_recommendations?.primary === "string"
              ? latest.ai_recommendations.primary
              : null;
          focusAreas = Array.isArray(latest.ai_recommendations?.focus_areas)
            ? latest.ai_recommendations.focus_areas.slice(0, 3)
            : [];
        }
      }

      // ── Wellness Summary ──
      // The /student-wellness/summary endpoint returns:
      //   { scores: { wellness_score, stress_level, burnout_risk }, labels: { risk }, ... }
      let moodScore: number | null = null;
      let stressLevel: number | null = null;
      let burnoutIndex: number | null = null;
      let wellnessUpdatedAt: string | null = null;

      if (wellnessResult.status === "fulfilled") {
        const w = wellnessResult.value;
        // Primary shape: { scores: {...} }
        // Fallback shapes: flat object or legacy log-based { latest_log / logs[] }
        const scores = w?.scores ?? w?.latest_log?.scores ?? w?.logs?.[0]?.scores ?? null;
        const flat = w?.latest_log ?? w?.logs?.[0] ?? w ?? null;

        if (scores) {
          moodScore =
            typeof scores.wellness_score === "number" ? scores.wellness_score :
            typeof scores.mood_score === "number" ? scores.mood_score : null;
          stressLevel =
            typeof scores.stress_level === "number" ? scores.stress_level : null;
          burnoutIndex =
            typeof scores.burnout_risk === "number" ? scores.burnout_risk :
            typeof scores.burnout_index === "number" ? scores.burnout_index : null;
        } else if (flat) {
          // Older/different API shape — field names directly on the object
          moodScore =
            typeof flat.wellness_score === "number" ? flat.wellness_score :
            typeof flat.mood_score === "number" ? flat.mood_score : null;
          stressLevel = typeof flat.stress_level === "number" ? flat.stress_level : null;
          burnoutIndex =
            typeof flat.burnout_risk === "number" ? flat.burnout_risk :
            typeof flat.burnout_index === "number" ? flat.burnout_index : null;
        }

        wellnessUpdatedAt =
          typeof w?.updated_at === "string" ? w.updated_at :
          typeof w?.created_at === "string" ? w.created_at :
          typeof flat?.created_at === "string" ? flat.created_at : null;
      }

      setBriefData({
        riskLevel,
        riskColor: riskLevel ? (riskColorMap[riskLevel] ?? "text-muted-foreground") : "text-muted-foreground",
        aiRecommendation,
        focusAreas,
        moodScore,
        stressLevel,
        burnoutIndex,
        wellnessUpdatedAt,
      });
      setBriefLoading(false);
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChat?.studentId, isPeerCounselor]);

  // Reset brief when session changes so stale data doesn't flash
  useEffect(() => {
    if (!selectedChat?.studentId || selectedChat.studentId !== briefStudentIdRef.current) {
      setBriefData(null);
      setBriefOpen(false);
    }
  }, [selectedChat?.studentId]);

  // Voice recording functionality
  const {
    isRecording,
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
  
  // Cleanup voice recorder on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const [searchParams] = useSearchParams();
  const targetSessionParam = searchParams.get("session");
  const targetStudentParam = searchParams.get("student");

  const selectedSessionId = selectedChat ? String(selectedChat.id) : "";
  const currentUserId = user?.id ? (isNaN(Number(user.id)) ? user.id : Number(user.id)) : 0;

  useChatPreloader({
    sessions: chats,
    activeSessionId: selectedSessionId,
    enabled: Boolean(user?.id),
    ownerUserId: user?.id?.toString() || null,
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
        String(chat.id).includes(needle) ||
        chat.peerCounselorName.toLowerCase().includes(needle)
      );
    });
  }, [chats, deferredSearchQuery]);

  const showSupervisionColumn = !isPeerCounselor;

  const { directChats, supervisoryChats } = useMemo(() => {
    if (!showSupervisionColumn) {
      return { directChats: filteredChats, supervisoryChats: [] as ChatListItem[] };
    }
    const direct: ChatListItem[] = [];
    const supervisory: ChatListItem[] = [];
    for (const chat of filteredChats) {
      if (chat.isPeerAssigned) {
        supervisory.push(chat);
      } else {
        direct.push(chat);
      }
    }
    return { directChats: direct, supervisoryChats: supervisory };
  }, [filteredChats, showSupervisionColumn]);
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
    isPeerTyping,
    error: chatError,
    sendMessage,
    notifyTyping,
    loadOlderMessages,
    registerServerMessage,
    deleteMessageForMe,
    undoDeleteMessageForMe,
    deleteMessageForEveryone,
    addOptimisticMessage,
    resolveOptimisticMessage,
    failOptimisticMessage,
    removeOptimisticMessage,
  } = useEncryptedChat({
    sessionId: selectedSessionId,
    userId: String(user?.id || ""),
    sessions: filteredChats,
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

  const withIdentityMaskedForViewer = useCallback(
    (chat: ChatListItem): ChatListItem => {
      const realName = String(chat.realStudentName || chat.studentName || "Student").trim() || "Student";
      const realEmail = String(chat.realStudentEmail || chat.studentEmail || "").trim();
      const grantVersion = identityRevealGrants[String(chat.id)] || "";
      const canShowIdentity = chat.identityVisibleToViewer && grantVersion === chat.lastActivity;
      const isMaskedForViewer = chat.isAnonymous && !canShowIdentity;
      return {
        ...chat,
        realStudentName: realName,
        realStudentEmail: realEmail,
        studentName: isMaskedForViewer ? anonymousLabelForCounselor() : realName,
        studentEmail: isMaskedForViewer ? "" : realEmail,
      };
    },
    [identityRevealGrants]
  );

  useEffect(() => {
    writeIdentityRevealGrants(identityRevealGrants);
  }, [identityRevealGrants]);


  const handleRowMouseEnter = useCallback((sessionId: number) => {
    if (!user?.id) return;
    const userIdStr = user.id.toString();
    const sidStr = String(sessionId);

    hoverTimerRef.current = setTimeout(async () => {
      // Only preload if not already cached
      const existing = await loadPreloadedSessionMessages(sidStr, {
        expectedOwnerUserId: userIdStr,
      });
      if (!existing || existing.length === 0) {
        const rawMessages = await api.getMessages(sidStr, {
          limit: 40,
          mark_read: false,
          timeout_ms: 5000,
        }).catch((err: any) => {
          const status = err?.response?.status ?? err?.status;
          if (status === 410) return null; // expired session — skip silently
          return null;
        });
        if (rawMessages?.length) {
          await savePreloadedSessionMessages(sidStr, rawMessages, {
            ownerUserId: userIdStr,
          });
        }
      }
    }, 200);
  }, [user?.id]);

  const handleRowMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);



  
  const loadSessions = useCallback(
    async (silent = false) => {
      if (!user?.id) return;
      if (loadSessionsInFlightRef.current) {
        await loadSessionsInFlightRef.current;
        return;
      }
      if (silent && Date.now() - lastLoadSessionsAtRef.current < CHAT_LIST_MIN_REFRESH_GAP_MS) {
        return;
      }

      const runner = (async () => {
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
                setChats(cachedChats.map((chat) => withIdentityMaskedForViewer(chat)));
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

        const chatSessions = normalized
          .filter(
            (session) =>
              session.session_type === "chat" && isCounselorChatListableStudentSession(session)
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

        const nextChatsRaw = Array.from(dedupedByConversation.values())
          .map(({ session }): ChatListItem => {
            const isAnonymous = isAnonymousSessionFlag(session.is_anonymous);
            const numericStudentId = Number(session.student_id || session.chat_peer_student_id || 0);
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
            const realName =
              session.student?.profile?.full_name ||
              session.student?.email?.split("@")[0] ||
              `Student #${session.id}`;
            const realEmail = session.student?.email || "";
            const rowUnread = Math.max(0, Math.floor(Number(session.unread_count ?? 0)));

            return {
              id: Number(session.id),
              studentId: visibleStudentId,
              counselorId: Number(session.counselor_id),
              realStudentName: realName,
              realStudentEmail: realEmail,
              studentName: realName,
              studentEmail: realEmail,
              isAnonymous,
              anonymousId: String(session.anonymous_id ?? "").trim(),
              identityVisibleToViewer: Boolean(session.identity_visible_to_viewer),
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

        const pendingRevealSessionId = pendingIdentityRevealGrantSessionIdRef.current;
        if (pendingRevealSessionId) {
          const justRevealed = nextChatsRaw.find((chat) => chat.id === pendingRevealSessionId);
          if (justRevealed?.identityVisibleToViewer) {
            setIdentityRevealGrants((prev) => ({
              ...prev,
              [String(pendingRevealSessionId)]: justRevealed.lastActivity,
            }));
          }
          pendingIdentityRevealGrantSessionIdRef.current = null;
        }

        const nextChats = nextChatsRaw.map((chat) => withIdentityMaskedForViewer(chat));

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
            // Fix 2: set activeSessionIdRef immediately when navigated via URL param
            // so the poll-loop badges that session as 0 right away
            activeSessionIdRef.current = targetSessionId;
            // Also mark read immediately for URL-param navigation
            void api.markSessionInboundRead(String(targetSessionId), { timeout_ms: 5000 }).catch(() => {
              setTimeout(() => {
                void api.markSessionInboundRead(String(targetSessionId), { timeout_ms: 8000 }).catch(() => {});
              }, 2000);
            });
            return targetSessionId;
          }

          if (targetStudentId && Number.isFinite(targetStudentId)) {
            const targetChat = nextChats.find(
              (chat) =>
                chat.studentId !== null &&
                chat.studentId === targetStudentId &&
                (isPeerCounselor ? chat.isPeerAssigned : !chat.isPeerAssigned)
            ) || nextChats.find((chat) => chat.studentId !== null && chat.studentId === targetStudentId);
            if (targetChat) {
              // Fix 2 (student param path): same treatment
              activeSessionIdRef.current = targetChat.id;
              void api.markSessionInboundRead(String(targetChat.id), { timeout_ms: 5000 }).catch(() => {
                setTimeout(() => {
                  void api.markSessionInboundRead(String(targetChat.id), { timeout_ms: 8000 }).catch(() => {});
                }, 2000);
              });
              return targetChat.id;
            }
          }

          return nextChats[0]?.id ?? null;
        });

        const cachePayload = JSON.stringify({
          saved_at: Date.now(),
          chats: nextChats,
          total_pages: nextTotalPages,
          total_items: nextTotal,
        });
        try {
          trimLocalStorageByPrefix("counselor_chat_list_v", 3);
          localStorage.setItem(cacheKey, cachePayload);
        } catch (error) {
          if (isStorageQuotaError(error)) {
            try {
              trimLocalStorageByPrefix("counselor_chat_list_v", 1);
              localStorage.setItem(cacheKey, cachePayload);
            } catch {
              // ignore cache write failures
            }
          }
        }

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
        lastLoadSessionsAtRef.current = Date.now();
        if (!silent) {
          setIsLoadingChats(false);
        }
      }
      })();
      loadSessionsInFlightRef.current = runner;
      try {
        await runner;
      } finally {
        loadSessionsInFlightRef.current = null;
      }
    },
    [chatPage, isPeerCounselor, targetSessionParam, targetStudentParam, user?.id, withIdentityMaskedForViewer]
  );

  const selectConversationById = useCallback((id: number) => {
    if (!Number.isFinite(id) || id <= 0) return;
    // Optimistically zero the badge immediately so the UI feels instant
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
    setSelectedChatId(id);
    activeSessionIdRef.current = id; // Track currently open session

    // Fix 1: retry markSessionInboundRead once on failure so seen_at is always set
    void api.markSessionInboundRead(String(id), { timeout_ms: 5000 }).catch(() => {
      setTimeout(() => {
        void api.markSessionInboundRead(String(id), { timeout_ms: 8000 }).catch(() => {});
      }, 2000);
    });

    // Fix 3: silent reload 3s later so the poll-loop picks up the fresh seen_at
    // count from the DB and doesn't re-inflate the badge on the next tick
    if (reloadAfterReadTimerRef.current) clearTimeout(reloadAfterReadTimerRef.current);
    reloadAfterReadTimerRef.current = setTimeout(() => {
      void loadSessions(true);
    }, 3000);
  }, [loadSessions]);

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
      if (reloadAfterReadTimerRef.current) {
        clearTimeout(reloadAfterReadTimerRef.current);
        reloadAfterReadTimerRef.current = null;
      }
    };
  }, [loadSessions, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    const onDigest = () => {
      if (digestReloadTimerRef.current) {
        clearTimeout(digestReloadTimerRef.current);
      }
      digestReloadTimerRef.current = setTimeout(() => {
        void loadSessions(true);
      }, 1500);
    };
    window.addEventListener(CHAT_INCOMING_DIGEST_EVENT, onDigest as EventListener);
    return () => {
      window.removeEventListener(CHAT_INCOMING_DIGEST_EVENT, onDigest as EventListener);
      if (digestReloadTimerRef.current) {
        clearTimeout(digestReloadTimerRef.current);
        digestReloadTimerRef.current = null;
      }
    };
  }, [loadSessions, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    const onAnon = () => void loadSessions(true);
    window.addEventListener(CHAT_ANONYMITY_SYNC_EVENT, onAnon);
    return () => window.removeEventListener(CHAT_ANONYMITY_SYNC_EVENT, onAnon);
  }, [loadSessions, user?.id]);

  useEffect(() => {
    setChats((prev) => prev.map((chat) => withIdentityMaskedForViewer(chat)));
  }, [withIdentityMaskedForViewer]);

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

  // Track file references for failed voice-note retries
  const failedVoiceFilesRef = useRef<Map<number, File>>(new Map());
  const currentUploadTempIdRef = useRef<number | null>(null);

  /** Core: upload a voice file optimistically. */
  const sendVoiceInternal = useCallback(async (file: File) => {
    if (!selectedSessionId) return;
    const localBlobUrl = URL.createObjectURL(file);
    const tempId = addOptimisticMessage({
      sender_id: currentUserId,
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
  }, [selectedSessionId, currentUserId, addOptimisticMessage, sendFileMessage, resolveOptimisticMessage, failOptimisticMessage, clearRecording]);

  /** Retry a failed optimistic voice note. */
  const handleRetryVoiceUpload = useCallback(async (tempId: number) => {
    const file = failedVoiceFilesRef.current.get(tempId);
    if (!file || !selectedSessionId) return;
    failedVoiceFilesRef.current.delete(tempId);
    removeOptimisticMessage(tempId);
    await sendVoiceInternal(file);
  }, [selectedSessionId, removeOptimisticMessage, sendVoiceInternal]);

  /** Delete a failed optimistic voice note. */
  const handleDeleteOptimistic = useCallback((tempId: number) => {
    failedVoiceFilesRef.current.delete(tempId);
    removeOptimisticMessage(tempId);
  }, [removeOptimisticMessage]);

  const handleDeleteMessage = useCallback((messageId: number) => {
    const msg = messages.find((m) => m.id === messageId);
    if (!msg) return;
    setMessageToDelete(msg);
    setDeleteDialogOpen(true);
  }, [messages]);



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
    const hasPayload = Boolean(message.trim() || selectedFile);
    if (!hasPayload || isSending || !selectedSessionId) return;
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

      if (message.trim()) {
        const text = message.trim();
        const sentText = await sendMessage(text);
        if (!sentText) {
          if (!chatError) {
            toast.error("Failed to send message");
          }
          return;
        }
        // Scan the counselor's outgoing message for crisis keywords so that
        // if a student quotes or echoes crisis language the system catches it.
        if (selectedSessionId && !isE2EHandshakeEnvelopeContent(text)) {
          const matches = detectCrisisTermsInText(text);
          if (matches.length > 0) {
            api.reportCrisisSignal(selectedSessionId, matches).catch(() => {});
          }
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

    const confirmed = await confirm({
      title: "Escalate case?",
      description: "Escalate this case to a professional counselor now?",
      confirmLabel: "Escalate",
    });
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

    const reason = await prompt({
      title: "Flag urgent concern",
      description: "Describe the urgent concern (required). This will hand the case off to a counselor immediately.",
      inputPlaceholder: "Describe the concern…",
      confirmLabel: "Flag urgent",
      variant: "destructive",
    });
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

    const confirmed = await confirm({
      title: "Trigger emergency escalation?",
      description: "This will send immediate alerts to the crisis team.",
      confirmLabel: "Trigger",
      variant: "destructive",
    });
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
    const reason = await prompt({
      title: "Reveal anonymous identity",
      description: "Provide reason for identity reveal (required for audit):",
      inputPlaceholder: "Emergency safeguarding assessment",
      defaultValue: "Emergency safeguarding assessment",
      confirmLabel: "Reveal identity",
      variant: "destructive",
    });
    if (!reason || reason.trim().length < 5) {
      toast.error("A detailed reason is required (minimum 5 characters).");
      return;
    }

    setIsRevealingIdentity(true);
    try {
      await api.revealAnonymousIdentity(selectedSessionId, reason.trim());
      pendingIdentityRevealGrantSessionIdRef.current = Number(selectedSessionId);
      toast.success("Identity revealed and logged.");
      await loadSessions(true);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to reveal identity."));
    } finally {
      setIsRevealingIdentity(false);
    }
  };

  const handleSwitchToDirectChat = async () => {
    if (!selectedChat?.studentId) {
      toast.error("Cannot resolve student details for this chat.");
      return;
    }
    const studentId = selectedChat.studentId;
    setIsSwitchingChat(true);
    try {
      const existingDirect = chats.find(
        (c) =>
          c.studentId === studentId &&
          !c.isPeerAssigned &&
          c.status !== "completed" &&
          c.status !== "cancelled"
      );

      if (existingDirect) {
        selectConversationById(existingDirect.id);
        toast.info("Switched to your direct counselor chat.");
      } else {
        const newSession = await api.createSessionAsCounselor({
          student_id: studentId,
          session_type: "chat",
        });
        toast.success("Created a new direct counselor conversation.");
        await loadSessions(false);
        selectConversationById(newSession.id);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to switch to direct chat.");
    } finally {
      setIsSwitchingChat(false);
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

  const handleVoiceCancel = () => {
    cancelRecording();
  };

  const sendVoiceNow = useCallback(async () => {
    if (isPeerCounselor) {
      toast.error("Peer counselors can only send text messages.");
      return;
    }
    if (!selectedSessionId) return;
    const file = await stopAndGetRecording();
    const durationMs = file ? (file as any).durationMs ?? 0 : 0;
    // Guard: require at least 1 second of actual audio before sending.
    if (!file || file.size === 0 || durationMs < 1000) {
      cancelRecording();
      clearRecording();
      return;
    }
    await sendVoiceInternal(file);
  }, [selectedSessionId, isPeerCounselor, stopAndGetRecording, cancelRecording, clearRecording, sendVoiceInternal]);


  
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

  const handleCounselorThreadAtBottomChange = useCallback((atBottom: boolean) => {
    setShowThreadScrollToBottom(!atBottom && messages.length > 5);
  }, [messages.length]);

  useEffect(() => {
    setShowThreadScrollToBottom(false);
  }, [selectedSessionId]);

  useEffect(() => {
    if (!showSupervisionColumn || !selectedChat) return;
    setSidebarLane(selectedChat.isPeerAssigned ? "supervision" : "direct");
  }, [selectedChat?.id, selectedChat?.isPeerAssigned, showSupervisionColumn]);

  const handleLoadOlderMessages = useCallback(async () => {
    if (!selectedSessionId) return;
    if (!hasOlderMessages || isLoadingOlderMessages) return;
    await loadOlderMessages();
  }, [hasOlderMessages, isLoadingOlderMessages, loadOlderMessages, selectedSessionId]);

  const threadStudentLabel = useMemo(
    () => selectedChat?.studentName ?? "Student",
    [selectedChat]
  );

  const renderConversationRow = useCallback(
    (chat: ChatListItem) => {
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
            "flex cursor-pointer items-center gap-2.5 border-b border-slate-100 px-3 py-3 transition-colors outline-none dark:border-slate-800/40",
            isActive
              ? "bg-slate-100/90 dark:bg-slate-800/60"
              : "hover:bg-slate-50/70 dark:hover:bg-slate-800/25"
          )}
          onClick={() => selectConversationById(chat.id)}
          onMouseEnter={() => handleRowMouseEnter(chat.id)}
          onMouseLeave={handleRowMouseLeave}
        >
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full shadow-sm ring-2 ring-background",
              chat.isAnonymous && chat.studentName === anonymousLabelForCounselor()
                ? "bg-black ring-red-600/70"
                : getUserColor(chat.studentName)
            )}
          >
            <span className="text-[10px] font-bold tracking-tight text-white">
              {chat.isAnonymous && chat.studentName === anonymousLabelForCounselor()
                ? "AU"
                : getInitials(chat.studentName)}
            </span>
          </div>

          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex min-w-0 items-center gap-1">
                <p
                  className={cn(
                    "truncate text-[13px] font-semibold tracking-tight",
                    isActive ? "font-bold text-foreground" : "text-foreground/90"
                  )}
                >
                  {chat.studentName}
                </p>
                {chat.isAnonymous && <AnonymousModeIndicator variant="inline" />}
              </div>
              <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground/80">
                {formatChatListTime(chat.lastActivity)}
              </span>
            </div>

            <div className="flex items-center justify-between gap-1.5">
              <p className="flex-1 truncate pr-1 text-[12px] text-muted-foreground/85">{chat.preview}</p>
              {chat.unreadCount > 0 && (
                <span
                  className="flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-white tabular-nums shadow-sm"
                  aria-label={`${chat.unreadCount} unread message${chat.unreadCount === 1 ? "" : "s"}`}
                >
                  {chat.unreadCount > 99 ? "99+" : chat.unreadCount}
                </span>
              )}
            </div>
          </div>
        </div>
      );
    },
    [handleRowMouseEnter, handleRowMouseLeave, selectConversationById, selectedChat?.id]
  );

  const renderConversationColumn = useCallback(
    (laneChats: ChatListItem[], emptyLabel: string) => {
      if (!isLoadingChats && laneChats.length === 0) {
        return (
          <div className="p-4 text-center text-xs text-muted-foreground">
            {emptyLabel}
          </div>
        );
      }
      return laneChats.map((chat) => renderConversationRow(chat));
    },
    [isLoadingChats, renderConversationRow]
  );

  const renderMessageContent = useCallback((msg: ChatMessage, isOutgoing: boolean) => {
    if (messageIsAttachmentFirst(msg)) {
      const isThisUpload = msg.id === currentUploadTempIdRef.current;
      const isDeletingThis = deletingMessageIds.has(msg.id);
      return (
        <ChatAttachmentView
          message={msg}
          isOutgoing={isOutgoing}
          uploadProgress={isThisUpload ? uploadProgress : 0}
          isDeleting={isDeletingThis}
          onRetry={msg.uploadFailed ? () => void handleRetryVoiceUpload(msg.id) : undefined}
          onDelete={
            msg.uploadFailed
              ? () => handleDeleteOptimistic(msg.id)
              // Server-saved attachment: allow deletion for outgoing messages if moderation is allowed
              : isOutgoing && canModerateChat && msg.id > 0 && !msg.isUploading
              ? () => void handleDeleteMessage(msg.id)
              : undefined
          }
        />
      );
    }

    if (msg.is_encrypted && !msg.decryptedContent) {
      return <p className="text-xs italic text-muted-foreground">[Message sent with previous encryption - not readable]</p>;
    }

    const content = msg.decryptedContent || msg.content || "";
    return <p>{content}</p>;
  }, [uploadProgress, handleRetryVoiceUpload, handleDeleteOptimistic, handleDeleteMessage, deletingMessageIds, canModerateChat]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100/60 via-background to-emerald-100/30">
      <DashboardSidebar
        items={navItems}
        userType={isPeerCounselor ? "peer" : "counselor"}
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-72 pl-0">
        {!selectedSessionId && (
          <DashboardHeader
            title={isPeerCounselor ? "Peer Support Messages" : "Messages"}
            onMenuClick={() => setSidebarOpen(true)}
          />
        )}

        <main className="h-full overflow-hidden p-0 lg:p-4">
          <div className={`flex min-h-0 gap-0 ${selectedSessionId ? "h-[100dvh] lg:h-screen" : "h-[calc(100dvh-64px)] sm:h-[calc(100dvh-80px)] lg:h-[calc(100vh-80px)]"}`}>
            <Card
              variant="glass"
              className={cn(
                "shrink-0 hidden lg:flex lg:flex-col lg:rounded-2xl lg:border lg:border-slate-200/80 lg:bg-background/95 lg:shadow-lg lg:shadow-slate-200/40",
                "lg:w-96",
                selectedSessionId ? "hidden lg:flex" : "flex flex-col"
              )}
            >
              <CardHeader className="pb-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={
                      showSupervisionColumn
                        ? "Search chats..."
                        : "Search conversations..."
                    }
                    className="pl-9 rounded-xl border-slate-200/80 bg-white/90 shadow-sm"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                {showSupervisionColumn && (
                  <div className="mt-3 flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white/80 p-1 shadow-sm">
                    <button
                      type="button"
                      onClick={() => setSidebarLane("direct")}
                      className={cn(
                        "flex-1 rounded-lg px-3 py-2 text-left transition-all",
                        sidebarLane === "direct"
                          ? "bg-emerald-500 text-white shadow"
                          : "text-muted-foreground hover:bg-slate-50"
                      )}
                    >
                      <p className="text-[11px] font-bold">Direct Chats</p>
                      <p className={cn("text-[10px]", sidebarLane === "direct" ? "text-white/85" : "text-muted-foreground")}>
                        You message students here
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSidebarLane("supervision")}
                      className={cn(
                        "flex-1 rounded-lg px-3 py-2 text-left transition-all",
                        sidebarLane === "supervision"
                          ? "bg-blue-600 text-white shadow"
                          : "text-muted-foreground hover:bg-slate-50"
                      )}
                    >
                      <p className="text-[11px] font-bold">Supervision</p>
                      <p className={cn("text-[10px]", sidebarLane === "supervision" ? "text-white/85" : "text-muted-foreground")}>
                        Peer support (read-only)
                      </p>
                    </button>
                  </div>
                )}
                <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {showSupervisionColumn ? (
                      filteredChats.length > 0 ? (
                        <>
                          {sidebarLane === "direct"
                            ? `${directChats.length} direct`
                            : `${supervisoryChats.length} supervising`}
                        </>
                      ) : (
                        "No conversations"
                      )
                    ) : filteredChats.length > 0 ? (
                      `${filteredChats.length} conversation${filteredChats.length === 1 ? "" : "s"}`
                    ) : (
                      "No conversations"
                    )}
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
              <CardContent className="flex min-h-0 flex-1 flex-col p-0">
                <ScrollArea className="h-[calc(100vh-220px)]">
                  <div
                    key={showSupervisionColumn ? sidebarLane : "all"}
                    className="animate-fade-in"
                  >
                    {showSupervisionColumn ? (
                      sidebarLane === "direct" ? (
                        isLoadingChats && directChats.length === 0 ? (
                          <div className="flex justify-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                          </div>
                        ) : (
                          renderConversationColumn(directChats, "No direct chats yet")
                        )
                      ) : isLoadingChats && supervisoryChats.length === 0 ? (
                        <div className="flex justify-center py-8">
                          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                      ) : (
                        renderConversationColumn(supervisoryChats, "No peer sessions to supervise")
                      )
                    ) : !isLoadingChats && filteredChats.length === 0 ? (
                      <div className="p-6 text-center text-sm text-muted-foreground">
                        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100/80 text-emerald-700">
                          <MessageSquare className="h-6 w-6" />
                        </div>
                        No conversations found
                      </div>
                    ) : (
                      renderConversationColumn(filteredChats, "No conversations found")
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card
              variant="glass"
              className={`flex min-h-0 flex-1 min-w-0 flex-col overflow-hidden lg:ml-4 lg:rounded-2xl lg:border lg:border-slate-200/80 lg:shadow-lg lg:shadow-slate-200/35 ${!selectedSessionId ? "hidden lg:flex" : "flex"}`}
            >
              <CardHeader className="shrink-0 space-y-0 border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur-xl sm:px-5">
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
                        selectedChat?.isAnonymous && selectedChat?.studentName === anonymousLabelForCounselor()
                          ? "bg-black ring-red-600/70"
                          : getUserColor(selectedChat?.studentName || "Student")
                      )}
                    >
                      <span className="text-[11px] font-bold text-white">
                        {selectedChat ? (selectedChat.isAnonymous && selectedChat.studentName === anonymousLabelForCounselor() ? "AU" : getInitials(selectedChat.studentName)) : <User className="h-4 w-4 text-muted-foreground" />}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="truncate text-base font-semibold leading-tight">
                          {selectedChat?.studentName || "Select a conversation"}
                        </p>
                        {selectedChat?.isAnonymous && (
                          <AnonymousModeIndicator variant="badge" audience="counselor" />
                        )}
                        {selectedChat?.isPeerAssigned && (
                          <span className="rounded-md bg-primary/12 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                            Peer
                          </span>
                        )}
                        <div className="hidden items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-emerald-600 xl:flex">
                          <Shield className="h-3 w-3" />
                          <span>Active</span>
                        </div>
                        
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
                      {!isPeerCounselor && selectedChat?.studentId && (
                        <Button
                          variant={briefOpen ? "secondary" : "outline"}
                          size="sm"
                          className="h-9 shrink-0 gap-1.5 rounded-xl px-3"
                          onClick={() => setBriefOpen((v) => !v)}
                        >
                          <Brain className="h-3.5 w-3.5 shrink-0" />
                          <span className="text-xs font-semibold hidden sm:inline">
                            {briefOpen ? "Hide Brief" : "Session Brief"}
                          </span>
                          {briefData?.riskLevel && briefData.riskLevel !== "normal" && briefData.riskLevel !== "low" && (
                            <span className={`h-2 w-2 rounded-full shrink-0 ${briefData.riskLevel === "critical" || briefData.riskLevel === "high" ? "bg-destructive" : "bg-yellow-500"}`} />
                          )}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 shrink-0 gap-1.5 rounded-xl border-destructive/25 bg-destructive/5 px-3 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={handleEmergencyEscalation}
                        disabled={isTriggeringEmergency}
                      >
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        <span className="text-xs font-semibold">{isTriggeringEmergency ? "Alerting..." : "Emergency"}</span>
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
                                {isRevealingIdentity ? "Revealing..." : "Reveal identity"}
                              </DropdownMenuItem>
                            )}
                            {selectedChat?.isAnonymous && isPeerCounselor && <DropdownMenuSeparator />}
                            {isPeerCounselor && (
                              <>
                                <DropdownMenuItem onClick={() => void handleEscalateToCounselor()} disabled={isEscalating}>
                                  <ArrowUpCircle className="mr-2 h-4 w-4" />
                                  {isEscalating ? "Escalating..." : "Escalate to counselor"}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-orange-700 focus:text-orange-800 dark:text-orange-300 dark:focus:text-orange-200"
                                  onClick={() => void handleFlagUrgent()}
                                  disabled={isFlaggingUrgent}
                                >
                                  <AlertTriangle className="mr-2 h-4 w-4" />
                                  {isFlaggingUrgent ? "Flagging..." : "Flag as urgent"}
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

              {/* ── Session Prep Briefing Panel ──────────────────────────── */}
              {briefOpen && !isPeerCounselor && selectedChat?.studentId && (
                <div className="shrink-0 border-b border-border/60 bg-gradient-to-r from-sky-50/80 via-background to-emerald-50/50 px-4 py-3 animate-in slide-in-from-top-1 duration-200">
                  {briefLoading && !briefData ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Loading student brief…</span>
                    </div>
                  ) : briefData ? (
                    <div className="space-y-2.5">
                      {/* Row 1: Risk + Recommendation */}
                      <div className="flex flex-wrap items-start gap-3">
                        {briefData.riskLevel && (
                          <div className="flex items-center gap-1.5 rounded-full border border-border/60 bg-background/80 px-2.5 py-1">
                            <span className={`text-[10px] font-black uppercase tracking-widest ${briefData.riskColor}`}>
                              {briefData.riskLevel} risk
                            </span>
                          </div>
                        )}
                        {briefData.aiRecommendation && (
                          <p className="flex-1 text-xs text-muted-foreground leading-relaxed min-w-0">
                            <span className="font-semibold text-foreground">AI rec: </span>
                            {briefData.aiRecommendation.length > 160
                              ? briefData.aiRecommendation.slice(0, 160) + "…"
                              : briefData.aiRecommendation}
                          </p>
                        )}
                      </div>

                      {/* Row 2: Wellness Scores */}
                      {(briefData.moodScore !== null || briefData.stressLevel !== null || briefData.burnoutIndex !== null) && (
                        <div className="flex flex-wrap gap-3">
                          {briefData.moodScore !== null && (
                            <div className="flex items-center gap-1.5 text-xs">
                              <span className="font-medium text-muted-foreground">Wellness</span>
                              <span className={`font-bold ${briefData.moodScore >= 60 ? "text-success" : briefData.moodScore >= 40 ? "text-yellow-600" : "text-destructive"}`}>
                                {briefData.moodScore}%
                              </span>
                            </div>
                          )}
                          {briefData.stressLevel !== null && (
                            <div className="flex items-center gap-1.5 text-xs">
                              <span className="font-medium text-muted-foreground">Stress</span>
                              <span className={`font-bold ${briefData.stressLevel <= 40 ? "text-success" : briefData.stressLevel <= 70 ? "text-yellow-600" : "text-destructive"}`}>
                                {briefData.stressLevel}%
                              </span>
                            </div>
                          )}
                          {briefData.burnoutIndex !== null && (
                            <div className="flex items-center gap-1.5 text-xs">
                              <span className="font-medium text-muted-foreground">Burnout</span>
                              <span className={`font-bold ${briefData.burnoutIndex <= 30 ? "text-success" : briefData.burnoutIndex <= 60 ? "text-yellow-600" : "text-destructive"}`}>
                                {briefData.burnoutIndex}%
                              </span>
                            </div>
                          )}
                          {briefData.wellnessUpdatedAt && (
                            <span className="text-[10px] text-muted-foreground/60 self-center">
                              checked in {formatChatListTime(briefData.wellnessUpdatedAt)}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Row 3: Focus areas */}
                      {briefData.focusAreas.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 self-center mr-1">Focus:</span>
                          {briefData.focusAreas.map((area) => (
                            <span key={area} className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary capitalize">
                              {area.replace(/_/g, " ")}
                            </span>
                          ))}
                        </div>
                      )}

                      {!briefData.riskLevel && !briefData.aiRecommendation && briefData.moodScore === null && (
                        <p className="text-xs text-muted-foreground italic">No recent diagnostic or wellness data on file for this student.</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">No student data available.</p>
                  )}
                </div>
              )}

              <CardContent className="flex min-h-0 flex-1 flex-col bg-gradient-to-b from-background to-slate-50/70 p-0 pt-0">
                <>
                {selectedSessionId && chatError && (
                  <div className="shrink-0 lg:hidden bg-destructive/10 border-b border-destructive/20 px-4 py-2 flex items-center justify-center gap-2">
                    <AlertTriangle className="h-3 w-3 text-destructive" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-destructive/80 truncate">{chatError}</span>
                  </div>
                )}
                <div className="min-h-0 flex-1 flex flex-col">
                  {!selectedSessionId ? (
                    <div className="h-full flex flex-col items-center justify-center text-sm text-muted-foreground p-8 text-center space-y-4">
                      <div className="mb-4 flex h-24 w-24 items-center justify-center rounded-[2rem] border border-emerald-200/70 bg-gradient-to-br from-emerald-100 via-white to-sky-100 shadow-lg shadow-emerald-100/60">
                        <MessageSquare className="h-12 w-12 text-emerald-700/70" />
                      </div>
                      <h3 className="text-2xl font-bold text-foreground">Student Conversations</h3>
                      <p className="max-w-xs">
                        {selectedChat?.lastActivity 
                          ? `Last activity ${formatChatListTime(selectedChat.lastActivity)}`
                          : "Select a student conversation to start chatting"}
                      </p>
                      <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700">
                        <Shield className="h-3 w-3 text-success" />
                        <span>Session active</span>
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
                      onRetryLoad={() => {}}
                    />
                  )}
                </div>

                {role === "counselor" && selectedChat?.isPeerAssigned ? (
                  <div className="border-t border-slate-200/80 bg-slate-50/50 p-4 sm:p-5 dark:border-slate-800/40 dark:bg-slate-900/30">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 max-w-3xl mx-auto rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50/80 via-white to-blue-50/30 p-4 shadow-sm dark:border-blue-900/30 dark:from-blue-950/20 dark:via-background dark:to-blue-950/10">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 rounded-xl bg-blue-500/10 p-2 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">
                          <Shield className="h-5 w-5" />
                        </div>
                        <div>
                          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                            Supervisory View
                          </h4>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                            You are viewing a peer support conversation in read-only mode. You cannot send messages directly in this channel.
                          </p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        className="w-full sm:w-auto shrink-0 gap-1.5 rounded-xl bg-primary text-primary-foreground shadow hover:bg-primary/90 font-medium text-xs py-2 px-4 h-9"
                        onClick={handleSwitchToDirectChat}
                        disabled={isSwitchingChat}
                      >
                        {isSwitchingChat ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Switching...
                          </>
                        ) : (
                          <>
                            <MessageSquare className="h-3.5 w-3.5" />
                            Switch to Direct Chat
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <ChatInput
                    message={message}
                    isSending={isSending}
                    isUploading={isUploading}
                    uploadProgress={uploadProgress}
                    isVoiceMode={false}
                    recording={recording}
                    recordingTime={recordingTime}
                    isPaused={isPaused}
                    selectedFile={selectedFile}
                    audioLevels={audioLevels}
                    onMessageChange={(val) => {
                      setMessage(val);
                      notifyTyping(val.trim().length > 0);
                    }}
                    onTypingChange={(isTyping) => notifyTyping(isTyping)}
                    onSubmit={handleSendMessage}
                    onFileSelect={handleFileSelect}
                    onAttachClick={handleAttachClick}
                    onVoiceStart={startRecording}
                    onVoiceStopAndSend={sendVoiceNow}
                    onVoiceSendNow={sendVoiceNow}
                    onVoicePause={pauseRecording}
                    onVoiceResume={resumeRecording}
                    onVoiceCancel={handleVoiceCancel}
                    onVoiceError={(err) => toast.error(err.message)}
                    onRemoveFile={removeSelectedFile}
                    onEmojiClick={(emojiData) => setMessage((prev) => prev + emojiData.emoji)}
                    fileInputRef={fileInputRef}
                  />
                )}
                </>
              </CardContent>
            </Card>
          </div>
        </main>
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
                {messageToDelete.sender_id === Number(user?.id)
                  ? "Would you like to delete this message for everyone in the chat, or just for yourself?"
                  : "This message will be deleted for you. Others in the chat will still be able to see it."}
              </p>
            </div>

            <div className="mt-6 flex flex-col gap-2">
              {messageToDelete.sender_id === Number(user?.id) &&
                Date.now() - new Date(messageToDelete.created_at).getTime() < 60 * 60 * 1000 && (
                  <Button
                    variant="destructive"
                    className="w-full rounded-2xl py-5 font-semibold text-sm hover:scale-[1.01] active:scale-95 transition-all shadow-md"
                    onClick={async () => {
                      const id = messageToDelete.id;
                      setDeleteDialogOpen(false);
                      setMessageToDelete(null);
                      setDeletingMessageIds((prev) => {
                        const next = new Set(prev);
                        next.add(id);
                        return next;
                      });
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

export default CounselorMessages;
