import { useState, useEffect, useCallback, useRef } from "react";
import { API_RECOVERED_EVENT, api, getApiErrorMessage } from "@/lib/api";
import { CHAT_ANONYMITY_SYNC_EVENT, CHAT_INCOMING_DIGEST_EVENT } from "@/lib/chatRealtimeEvents";

export const expiredSessionIds = new Set<string>();

export const markSessionAsExpired = (sessionId: string) => {
  const id = String(sessionId || "").trim();
  if (!id) return;
  const wasAlreadyExpired = expiredSessionIds.has(id);
  expiredSessionIds.add(id);
  if (!wasAlreadyExpired && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("CHAT_SESSION_EXPIRED", { detail: { sessionId: id } }));
  }
};

export const isSessionExpired = (sessionId: string): boolean =>
  expiredSessionIds.has(sessionId);

export interface Session {
  id: number;
  /** Real student user id for routing when `student_id` is masked (anonymous). */
  chat_peer_student_id?: number;
  student_id: number;
  counselor_id: number | null;
  peer_counselor_id?: number | null;
  case_peer_counselor_id?: number | null;
  assigned_role?: "counselor" | "peer_counselor" | string | null;
  status: string | null;
  session_type: string | null;
  is_anonymous?: boolean;
  anonymous_id?: string | null;
  unread_count?: number;
  created_at: string;
  updated_at?: string | null;
  student?: {
    id: number;
    email?: string | null;
    is_online?: boolean;
    last_seen_at?: string | null;
    profile?: {
      full_name?: string;
      avatar_url?: string | null;
    };
  };
  counselor?: {
    id: number;
    email?: string;
    is_online?: boolean;
    last_seen_at?: string | null;
    profile?: {
      full_name?: string;
      avatar_url?: string;
    };
  };
  peer_counselor?: {
    id: number;
    email?: string;
    is_online?: boolean;
    last_seen_at?: string | null;
    profile?: {
      full_name?: string;
      avatar_url?: string;
    };
  };
  case_peer_counselor?: {
    id: number;
    email?: string;
    is_online?: boolean;
    last_seen_at?: string | null;
    profile?: {
      full_name?: string;
      avatar_url?: string;
    };
  } | null;
}

export interface Appointment {
  id: number;
  student_id: number;
  counselor_id: number;
  scheduled_at: string;
  duration_minutes: number;
  status: 'pending' | 'scheduled' | 'confirmed' | 'completed' | 'cancelled';
  is_anonymous?: boolean;
  /** Booked via the emergency "assigned counselor" flow — surface crisis context in the call UI. */
  is_emergency?: boolean;
  anonymous_id?: string | null;
  identity_visible_to_viewer?: boolean;
  /** Booked media: `audio` | `video` (anonymous online is always audio). */
  call_type?: string | null;
  notes?: string;
  cancellation_reason?: string;
  created_at?: string;
  updated_at?: string;
  student?: {
    id: number;
    email: string;
    profile?: {
      full_name: string;
    };
  };
  counselor?: {
    id: number;
    email: string;
    profile?: {
      full_name: string;
    };
  };
}

const SESSION_POLL_INTERVAL_MS = 12000;
const SESSION_CACHE_TTL_MS = 60 * 1000;
const SESSION_CACHE_VERSION = 7;
const SESSION_LIST_TIMEOUT_MS = 20000;
const SESSION_LIST_RETRY_TIMEOUT_MS = 45000;
const SESSION_PAGE_SIZE = 24;
const SESSION_RETRY_PAGE_SIZE = 12;
const SESSION_REFRESH_MIN_GAP_MS = 5000;
type PagedMeta = {
  page?: number;
  per_page?: number;
  total?: number;
  total_pages?: number;
};
type SessionListResponse = Session[] | { data?: Session[]; meta?: PagedMeta };
const isOpenChatSession = (session: Session) =>
  session.status !== "completed" && session.status !== "cancelled";
const getHttpStatus = (error: unknown) =>
  Number(
    (error as { response?: { status?: unknown }; status?: unknown })?.response?.status ??
      (error as { status?: unknown })?.status ??
      0
  );
const sessionActivityTime = (session: Session): number => {
  const timestamp = new Date(session.updated_at || session.created_at || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export const supportSessionDedupeKey = (session: Session): string => {
  const studentId = Number(session.chat_peer_student_id || session.student_id || session.student?.id || 0);
  const sessionType = String(session.session_type || "chat");
  const peerId = Number(session.peer_counselor_id || session.peer_counselor?.id || 0);
  const counselorId = Number(session.counselor_id || session.counselor?.id || 0);

  if (session.assigned_role === "peer_counselor" && peerId > 0) {
    return `peer:${studentId}:${peerId}:${sessionType}`;
  }

  if (counselorId > 0) {
    return `counselor:${studentId}:${counselorId}:${sessionType}`;
  }

  return `session:${session.id}`;
};

export const dedupeChatSessions = (items: Session[]): Session[] => {
  const bySessionId = new Map<string, Session>();

  items.forEach((item) => {
    if (!item?.id) return;
    const sessionId = String(item.id);
    const current = bySessionId.get(sessionId);
    if (!current || sessionActivityTime(item) >= sessionActivityTime(current)) {
      bySessionId.set(sessionId, item);
    }
  });

  const bySupport = new Map<string, Session>();
  Array.from(bySessionId.values()).forEach((item) => {
    const key = supportSessionDedupeKey(item);
    const current = bySupport.get(key);
    if (
      !current ||
      sessionActivityTime(item) > sessionActivityTime(current) ||
      (sessionActivityTime(item) === sessionActivityTime(current) && Number(item.id) > Number(current.id))
    ) {
      bySupport.set(key, item);
    }
  });

  return Array.from(bySupport.values()).sort((a, b) => {
    const byActivity = sessionActivityTime(b) - sessionActivityTime(a);
    if (byActivity !== 0) return byActivity;
    return Number(b.id) - Number(a.id);
  });
};

const logStudentSessionDebug = (event: string, payload: Record<string, unknown>) => {
  if (import.meta.env.DEV) {
    console.debug(`[StudentChatSession] ${event}`, payload);
  }
};


export const useChatSession = (userId: number | undefined) => {
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionPage, setSessionPage] = useState(1);
  const [sessionTotalPages, setSessionTotalPages] = useState(1);
  const [sessionTotalItems, setSessionTotalItems] = useState(0);
  const sessionsRequestInFlightRef = useRef<Promise<void> | null>(null);
  const lastSessionsLoadAtRef = useRef(0);
  const sessionPageRef = useRef(sessionPage);
  const activeSessionIdRef = useRef<string | null>(null);

  const resolveActiveSession = useCallback((current: Session | null, nextSessions: Session[]) => {
    const preferredId = activeSessionIdRef.current;
    if (preferredId) {
      const refreshedSession = nextSessions.find((session) => String(session.id) === preferredId);
      if (refreshedSession) {
        activeSessionIdRef.current = String(refreshedSession.id);
        return refreshedSession;
      }

      if (current && String(current.id) === preferredId) {
        const equivalentSession = nextSessions.find(
          (session) => supportSessionDedupeKey(session) === supportSessionDedupeKey(current)
        );
        if (equivalentSession) {
          activeSessionIdRef.current = String(equivalentSession.id);
          return equivalentSession;
        }
      }

      if (
        current &&
        String(current.id) === preferredId &&
        isOpenChatSession(current) &&
        !isSessionExpired(String(current.id))
      ) {
        return current;
      }
    }

    activeSessionIdRef.current = null;
    return null;
  }, []);

  const hydrateCachedSessions = useCallback(() => {
    if (!userId) return false;
    const cacheKey = `student_chat_sessions_v${SESSION_CACHE_VERSION}_${userId}_${sessionPageRef.current}`;

    try {
      const raw = localStorage.getItem(cacheKey);
      if (!raw) return false;

      const parsed = JSON.parse(raw) as {
        saved_at?: number;
        sessions?: Session[];
        total_pages?: number;
        total_items?: number;
      };
      const savedAt = Number(parsed?.saved_at || 0);
      const cachedSessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
      if (!Number.isFinite(savedAt) || Date.now() - savedAt > SESSION_CACHE_TTL_MS) {
        return false;
      }
      if (!cachedSessions.length) {
        return false;
      }

      const normalizedSessions = dedupeChatSessions(
        cachedSessions.filter(
          (session) =>
            session.session_type === "chat" &&
            typeof session.counselor_id === "number" &&
            session.counselor_id > 0 &&
            isOpenChatSession(session) &&
            !isSessionExpired(String(session.id))
        )
      );

      setSessions(normalizedSessions);
      setSessionTotalPages(Math.max(1, Number(parsed?.total_pages || 1)));
      setSessionTotalItems(Math.max(0, Number(parsed?.total_items || normalizedSessions.length)));
      setActiveSession((current) => {
        return resolveActiveSession(current, normalizedSessions);
      });
      setIsLoading(false);
      return true;
    } catch {
      return false;
    }
  }, [resolveActiveSession, userId]);

  const loadSessions = useCallback(async (silent = false, options?: { force?: boolean }) => {
    if (!userId) {
      setIsLoading(false);
      return;
    }
    if (sessionsRequestInFlightRef.current) {
      await sessionsRequestInFlightRef.current;
      return;
    }

    const force = Boolean(options?.force);
    if (!force && Date.now() - lastSessionsLoadAtRef.current < SESSION_REFRESH_MIN_GAP_MS) {
      // If we're throttling and not silent, still clear loading state
      if (!silent) {
        setIsLoading(false);
      }
      return;
    }

    const requestPromise = (async () => {
    try {
      if (!silent) {
        setIsLoading(true);
      }

      const fetchSessions = (perPage: number, timeoutMs: number) =>
        api.getChatSessions({
          as_role: "student",
          open_only: true,
          page: sessionPageRef.current,
          per_page: perPage,
          timeout_ms: timeoutMs,
        });

      let payload: SessionListResponse;
      try {
        payload = (await fetchSessions(SESSION_PAGE_SIZE, SESSION_LIST_TIMEOUT_MS)) as SessionListResponse;
      } catch (err) {
        const isTimeout = (err as { code?: string })?.code === "ECONNABORTED";
        if (!isTimeout) {
          throw err;
        }

        payload = (await fetchSessions(SESSION_RETRY_PAGE_SIZE, SESSION_LIST_RETRY_TIMEOUT_MS)) as SessionListResponse;
      }

      const pagedPayload =
        !Array.isArray(payload) && payload && typeof payload === "object"
          ? payload
          : null;
      const normalizedInput = (
        Array.isArray(payload)
          ? payload
          : Array.isArray(pagedPayload?.data)
          ? pagedPayload.data
          : []
      ) as Session[];
      const chatSessions = normalizedInput.filter(
        (session: Session) =>
          session.session_type === "chat" &&
          typeof session.counselor_id === "number" &&
          session.counselor_id > 0 &&
          isOpenChatSession(session)
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
        : chatSessions.length;
      setSessionTotalPages(nextTotalPages);
      setSessionTotalItems(nextTotal);

      if (!pagedPayload && sessionPageRef.current !== 1) {
        sessionPageRef.current = 1;
        setSessionPage(1);
      } else if (pagedPayload && nextPage !== sessionPageRef.current) {
        sessionPageRef.current = nextPage;
        setSessionPage(nextPage);
      }

      const normalizedSessions = dedupeChatSessions(
        chatSessions.filter((session) => !isSessionExpired(String(session.id)))
      );
      const activeSessionId = activeSessionIdRef.current;
      if (
        activeSessionId &&
        !normalizedSessions.some((session) => String(session.id) === activeSessionId)
      ) {
        try {
          const activeSnapshot = (await api.getSession(activeSessionId, {
            minimal: true,
            timeout_ms: 8000,
          })) as Session;
          const activeStillOpen =
            activeSnapshot &&
            typeof activeSnapshot.counselor_id === "number" &&
            activeSnapshot.counselor_id > 0 &&
            isOpenChatSession(activeSnapshot) &&
            !isSessionExpired(activeSessionId);

          if (!activeStillOpen) {
            activeSessionIdRef.current = null;
            markSessionAsExpired(activeSessionId);
          }
        } catch (activeErr) {
          const status = getHttpStatus(activeErr);
          if (status === 403 || status === 404 || status === 410) {
            activeSessionIdRef.current = null;
            markSessionAsExpired(activeSessionId);
          }
        }
      }
      setSessions(normalizedSessions);
      const cacheKey = `student_chat_sessions_v${SESSION_CACHE_VERSION}_${userId}_${sessionPageRef.current}`;
      localStorage.setItem(
        cacheKey,
          JSON.stringify({
            saved_at: Date.now(),
            sessions: normalizedSessions,
            total_pages: nextTotalPages,
            total_items: nextTotal,
          })
        );
      setError(null);

      // If active session is missing/invalid, switch to the latest valid one.
      setActiveSession((current) => {
        return resolveActiveSession(current, normalizedSessions);
      });
    } catch (err) {
      console.error("Failed to load sessions:", err);
      const apiMessage = getApiErrorMessage(err, "Failed to load chat sessions");
      setError(apiMessage);
    } finally {
      lastSessionsLoadAtRef.current = Date.now();
      if (!silent) {
        setIsLoading(false);
      }
    }
    })();

    sessionsRequestInFlightRef.current = requestPromise;
    try {
      await requestPromise;
    } finally {
      sessionsRequestInFlightRef.current = null;
    }
  }, [resolveActiveSession, userId]);

  useEffect(() => {
    const handleExpired = (event: Event) => {
      const expiredId = String((event as CustomEvent<{ sessionId?: string }>).detail?.sessionId || "").trim();
      if (expiredId && activeSessionIdRef.current === expiredId) {
        activeSessionIdRef.current = null;
      }

      setSessions(prev => dedupeChatSessions(prev.filter(s => !isSessionExpired(String(s.id)))));
      setActiveSession(prev => {
        if (!prev || !isSessionExpired(String(prev.id))) {
          return prev;
        }

        if (!expiredId || String(prev.id) === expiredId) {
          activeSessionIdRef.current = null;
        }
        return null;
      });
    };
    window.addEventListener('CHAT_SESSION_EXPIRED', handleExpired);
    return () => window.removeEventListener('CHAT_SESSION_EXPIRED', handleExpired);
  }, []);

  const selectSession = useCallback((session: Session | null) => {
    const previousSessionId = activeSessionIdRef.current;
    activeSessionIdRef.current = session ? String(session.id) : null;
    if (session) {
      setSessions((prev) => {
        const nextSession = { ...session, unread_count: 0 };
        const next = prev.some((s) => String(s.id) === String(session.id))
          ? prev.map((s) => (String(s.id) === String(session.id) ? nextSession : s))
          : [nextSession, ...prev];
        return dedupeChatSessions(next);
      });
    }
    logStudentSessionDebug("select", {
      previousSessionId,
      selectedSessionId: session ? String(session.id) : null,
      counselorId: session?.counselor_id ?? null,
      peerCounselorId: session?.peer_counselor_id ?? null,
      assignedRole: session?.assigned_role ?? null,
    });
    setActiveSession(session);
  }, []);

  const canGoToPrevPage = sessionPage > 1;
  const canGoToNextPage = sessionPage < sessionTotalPages;

  const goToPrevPage = () => {
    if (!canGoToPrevPage || isLoading) return;
    const next = Math.max(1, sessionPage - 1);
    sessionPageRef.current = next;
    setSessionPage(next);
    void loadSessions(true, { force: true });
  };

  const goToNextPage = () => {
    if (!canGoToNextPage || isLoading) return;
    const next = Math.min(sessionTotalPages, sessionPage + 1);
    sessionPageRef.current = next;
    setSessionPage(next);
    void loadSessions(true, { force: true });
  };

  const startSessionWithCounselor = async (
    counselorId: number,
    options?: { isAnonymous?: boolean }
  ) => {
    try {
      const shouldBeAnonymous = Boolean(options?.isAnonymous);

      // Always consult the backend to get or create the session.
      // This avoids reusing locally cached sessions that have expired on the server.
      setIsLoading(true);
      const newSession = await api.createSession({
        counselor_id: counselorId,
        session_type: "chat",
        is_anonymous: shouldBeAnonymous,
      });
      
      if (newSession) {
        setSessions((prev) => {
          const withoutSameSession = prev.filter(
            (session) => Number(session.id) !== Number(newSession.id)
          );
          return dedupeChatSessions([newSession, ...withoutSameSession]);
        });
        // Set active session immediately so UI opens the chat
        activeSessionIdRef.current = String(newSession.id);
        setActiveSession(newSession);
        // Loading false immediately so chat UI is accessible
        setIsLoading(false);
        return newSession;
      }
      setIsLoading(false);
      return null;
    } catch (err) {
      console.error("Failed to start session:", err);
      setError("Failed to start chat with counselor");
      setIsLoading(false);
      return null;
    }
  };

  useEffect(() => {
    setSessionPage(1);
    sessionPageRef.current = 1;
    setSessionTotalPages(1);
    setSessionTotalItems(0);
    sessionsRequestInFlightRef.current = null;
    lastSessionsLoadAtRef.current = 0;
    // If no userId, make sure we're not stuck in loading state
    if (!userId) {
      setIsLoading(false);
      setSessions([]);
      setActiveSession(null);
    }
  }, [userId]);

  // Reload sessions when user navigates to a different page via pagination
  useEffect(() => {
    if (!userId || sessionPage === 1) return;
    sessionPageRef.current = sessionPage;
    void loadSessions(true, { force: true });
  }, [loadSessions, sessionPage, userId]);

  useEffect(() => {
    if (!userId) return;

    const hydrated = hydrateCachedSessions();
    void loadSessions(hydrated, { force: true });

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
  }, [hydrateCachedSessions, loadSessions, userId]);

  useEffect(() => {
    if (!userId) {
      return;
    }
    const refresh = () => {
      void loadSessions(true, { force: true });
    };
    window.addEventListener(CHAT_INCOMING_DIGEST_EVENT, refresh as EventListener);
    return () => window.removeEventListener(CHAT_INCOMING_DIGEST_EVENT, refresh as EventListener);
  }, [loadSessions, userId]);

  useEffect(() => {
    if (!userId) {
      return;
    }
    const refresh = () => {
      void loadSessions(true, { force: true });
    };
    window.addEventListener(CHAT_ANONYMITY_SYNC_EVENT, refresh);
    return () => window.removeEventListener(CHAT_ANONYMITY_SYNC_EVENT, refresh);
  }, [loadSessions, userId]);

  return {
    activeSession,
    sessionId: activeSession?.id?.toString() || null,
    sessions,
    sessionPage,
    sessionTotalPages,
    sessionTotalItems,
    canGoToPrevPage,
    canGoToNextPage,
    isLoading,
    error,
    selectSession,
    goToPrevPage,
    goToNextPage,
    startSessionWithCounselor,
    refreshSessions: loadSessions,
  };
};
