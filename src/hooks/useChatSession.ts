import { useState, useEffect, useCallback, useRef } from "react";
import { API_RECOVERED_EVENT, api, getApiErrorMessage } from "@/lib/api";
import { CHAT_ANONYMITY_SYNC_EVENT, CHAT_INCOMING_DIGEST_EVENT } from "@/lib/chatRealtimeEvents";

export interface Session {
  id: number;
  /** Real student user id for routing when `student_id` is masked (anonymous). */
  chat_peer_student_id?: number;
  student_id: number;
  counselor_id: number | null;
  peer_counselor_id?: number | null;
  assigned_role?: "counselor" | "peer_counselor" | string | null;
  status: string | null;
  session_type: string | null;
  is_anonymous?: boolean;
  anonymous_id?: string | null;
  created_at: string;
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
}

export interface Appointment {
  id: number;
  student_id: number;
  counselor_id: number;
  scheduled_at: string;
  duration_minutes: number;
  status: 'pending' | 'scheduled' | 'confirmed' | 'completed' | 'cancelled';
  is_anonymous?: boolean;
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
const isPeerAssignedSession = (session: Session) =>
  session.assigned_role === "peer_counselor" && Number(session.peer_counselor_id) > 0;
const conversationKey = (session: Session) => {
  const cId = session.counselor_id || 0;
  const pId = session.peer_counselor_id || 0;
  const isAnon = session.is_anonymous ? 1 : 0;
  const role = session.assigned_role || "counselor";
  return `c:${cId}:p:${pId}:a:${isAnon}:r:${role}`;
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

  const hydrateCachedSessions = useCallback(() => {
    if (!userId) return false;
    const cacheKey = `student_chat_sessions_${userId}_${sessionPageRef.current}`;

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

      const normalizedSessions = cachedSessions.filter(
        (session) =>
          session.session_type === "chat" &&
          typeof session.counselor_id === "number" &&
          session.counselor_id > 0
      );

      setSessions(normalizedSessions);
      setSessionTotalPages(Math.max(1, Number(parsed?.total_pages || 1)));
      setSessionTotalItems(Math.max(0, Number(parsed?.total_items || normalizedSessions.length)));
      setActiveSession((current) => {
        if (!normalizedSessions.length) {
          return null;
        }
        if (current) {
          const refreshedSession = normalizedSessions.find((session) => session.id === current.id);
          if (refreshedSession) {
            return refreshedSession;
          }
        }
        return normalizedSessions[0];
      });
      setIsLoading(false);
      return true;
    } catch {
      return false;
    }
  }, [userId]);

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
        api.getSessions({
          lightweight: true,
          session_type: "chat",
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
          session.counselor_id > 0
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

      // Keep unique sessions by conversation key (counselor + peer + anonymity)
      // to avoid showing multiple entries for the same chat thread.
      const dedupedByConversation = new Map<string, Session>();
      
      // Sort by ID descending first so we process latest sessions first
      const sortedByRecency = [...chatSessions].sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      
      for (const session of sortedByRecency) {
        const key = conversationKey(session);
        const existing = dedupedByConversation.get(key);
        
        if (!existing) {
          dedupedByConversation.set(key, session);
          continue;
        }

        // If we found an open version of a session we already have, prefer it
        // (though we already sorted by recency, so this is a safety check).
        if (!isOpenChatSession(existing) && isOpenChatSession(session)) {
          dedupedByConversation.set(key, session);
        }
      }

      const normalizedSessions = Array.from(dedupedByConversation.values());
      setSessions(normalizedSessions);
      const cacheKey = `student_chat_sessions_${userId}_${sessionPageRef.current}`;
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
        if (!current) {
          return normalizedSessions[0] || null;
        }

        const refreshedSession = normalizedSessions.find((session) => session.id === current.id);
        return refreshedSession || normalizedSessions[0] || null;
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
  }, [userId]);

  const selectSession = (session: Session | null) => {
    setActiveSession(session);
  };

  const canGoToPrevPage = sessionPage > 1;
  const canGoToNextPage = sessionPage < sessionTotalPages;

  const goToPrevPage = () => {
    if (!canGoToPrevPage || isLoading) return;
    const next = Math.max(1, sessionPage - 1);
    sessionPageRef.current = next;
    setSessionPage(next);
  };

  const goToNextPage = () => {
    if (!canGoToNextPage || isLoading) return;
    const next = Math.min(sessionTotalPages, sessionPage + 1);
    sessionPageRef.current = next;
    setSessionPage(next);
  };

  const startSessionWithCounselor = async (
    counselorId: number,
    options?: { isAnonymous?: boolean; forceNew?: boolean }
  ) => {
    try {
      const shouldBeAnonymous = Boolean(options?.isAnonymous);
      const forceNew = Boolean(options?.forceNew);

      // Check if session already exists. When forceNew is set (e.g. clicking
      // an anonymous entry from "Recent Support"), we always create a fresh
      // session so the anonymity contract isn't broken by resuming an old one.
      if (!forceNew) {
        const existing = sessions.find(
          (s) =>
            s.counselor_id === counselorId &&
            s.session_type === "chat" &&
            !isPeerAssignedSession(s) &&
            Boolean(s.is_anonymous) === shouldBeAnonymous &&
            isOpenChatSession(s)
        );
        if (existing) {
          setActiveSession(existing);
          return existing;
        }
      }

      // Create new session - set loading to show activity but don't block UI
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
          return [newSession, ...withoutSameSession];
        });
        // Set active session immediately so UI opens the chat
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
