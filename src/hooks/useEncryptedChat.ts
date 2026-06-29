import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { api, getApiErrorMessage, isApiNetworkError } from '@/lib/api';
import { loadPreloadedSessionMessages, savePreloadedSessionMessages } from '@/lib/chatPreloadCache';
import { markSessionAsExpired } from '@/hooks/useChatSession';
import { useDecryptWorker } from '@/hooks/useDecryptWorker';
import { loadPersistedSessionKey } from '@/lib/chatSessionKeys';
import type { ChatAttachment } from '@/lib/chatAttachments';
import {
  CHAT_INCOMING_DIGEST_EVENT,
  type ChatIncomingDigestDetail,
} from '@/lib/chatRealtimeEvents';

export type E2EVisualState = 'plain';

export interface ChatMessage {
  id: number;
  case_id?: number;
  content: string;
  sender_id: number;
  sender_role?: 'student' | 'peer_counselor' | 'counselor' | 'admin' | string;
  sender_name_snapshot?: string;
  sender_display_name?: string;
  recipient_id?: number | null;
  created_at: string;
  seen_at?: string | null;
  is_encrypted: boolean;
  message_type: string;
  file_url?: string;
  has_file?: boolean;
  attachment?: ChatAttachment | null;
  decryptedContent?: string;
  sent_as_anonymous?: boolean | null;
  e2eVisual?: E2EVisualState;
  /** True while an optimistic voice/file message is still uploading. */
  isUploading?: boolean;
  /** True if the upload failed — show retry/delete controls. */
  uploadFailed?: boolean;
  /** Local object URL for immediate playback before the server URL is ready. */
  localBlobUrl?: string;
  /** Client-facing delivery state for optimistic and persisted outgoing rows. */
  delivery_status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  is_deleted?: boolean;
  delete_for_everyone_until?: string | null;
}

export type RawMessage = ChatMessage & {
  sender?: { id?: number | string; name?: string; role?: string } | unknown;
};

interface UseEncryptedChatProps {
  sessionId: string;
  userId: string;
}

const MESSAGE_POLL_TIMEOUT_MS = 5000;
const OLDER_MESSAGE_BATCH_LIMIT = 40;
const MESSAGE_BATCH_LIMIT = 30;
const MESSAGE_POLL_INTERVAL_ACTIVE_MS = 10_000;
const MESSAGE_POLL_INTERVAL_HIDDEN_MS = 45_000;
const TYPING_POLL_INTERVAL_ACTIVE_MS = 20_000;
const TYPING_POLL_INTERVAL_HIDDEN_MS = 60_000;
const POLL_JITTER_MAX_MS = 2_000;
const RATE_LIMIT_BACKOFF_INITIAL_MS = 30_000;
const RATE_LIMIT_BACKOFF_MAX_MS = 5 * 60_000;
const NETWORK_BACKOFF_MAX_MS = 60_000;
const TYPING_WRITE_BACKOFF_INITIAL_MS = 30_000;
const TYPING_WRITE_MIN_GAP_ACTIVE_MS = 6_000;
const TYPING_WRITE_MIN_GAP_IDLE_MS = 2_000;
const FULL_RECONCILE_EVERY_POLLS = 5;
const DELETED_MESSAGE_TEXT = 'This message was deleted.';
export const ENCRYPTED_FALLBACK = '[Encrypted message]';

const getJitter = () => Math.floor(Math.random() * POLL_JITTER_MAX_MS);

type ChatRateLimitScope = 'messages' | 'typing-read' | 'typing-write';

const getErrorStatus = (error: unknown): number | undefined =>
  (error as { response?: { status?: number } })?.response?.status ??
  (error as { status?: number })?.status;

const retryAfterMs = (error: unknown): number | null => {
  const headers = (error as { response?: { headers?: Record<string, string> } })?.response?.headers;
  const header = headers?.['retry-after'] ?? headers?.['Retry-After'];
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  const dateMs = Date.parse(header);
  if (!Number.isFinite(dateMs)) return null;
  const delta = dateMs - Date.now();
  return delta > 0 ? delta : null;
};

const getRateLimitDelayMs = (
  error: unknown,
  previousBackoffMs: number,
  initialBackoffMs: number,
  maxBackoffMs: number
): number => {
  const fallback = previousBackoffMs > initialBackoffMs
    ? previousBackoffMs * 2
    : initialBackoffMs;
  return Math.min(
    maxBackoffMs,
    Math.max(initialBackoffMs, retryAfterMs(error) ?? fallback)
  );
};

const chatRateLimitKey = (scope: ChatRateLimitScope, sessionId: string): string =>
  `mindful:chat-rate-limit:${scope}:${encodeURIComponent(String(sessionId || ''))}`;

const getStoredRateLimitRemainingMs = (key: string): number => {
  if (typeof localStorage === 'undefined') return 0;
  try {
    const until = Number(localStorage.getItem(key) || 0);
    if (!Number.isFinite(until) || until <= 0) return 0;
    if (until <= Date.now()) {
      localStorage.removeItem(key);
      return 0;
    }
    return until - Date.now();
  } catch {
    return 0;
  }
};

const storeRateLimitDelay = (key: string, delayMs: number): number => {
  const until = Date.now() + delayMs;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(key, String(until));
    } catch {
      /* best effort */
    }
  }
  return until;
};

const isE2EHandshakeEnvelope = (content: string): boolean => {
  try {
    const parsed = JSON.parse(content);
    if (parsed?.__e2e === 'v1') return true;
  } catch {
    // not JSON; keep message visible
  }
  return false;
};

const filterVisibleMessages = <T extends { content?: unknown }>(msgs: T[]): T[] =>
  msgs.filter((msg) => {
    const content = String(msg.content || '');
    return !isE2EHandshakeEnvelope(content);
  });

const formatServerMessage = (msg: any): ChatMessage => ({
  ...msg,
  decryptedContent: msg.is_encrypted ? ENCRYPTED_FALLBACK : msg.content,
  e2eVisual: 'plain' as const,
  delivery_status: msg.seen_at ? 'read' : 'delivered',
});

export const useEncryptedChat = ({ sessionId, userId }: UseEncryptedChatProps) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [isPeerTyping, setIsPeerTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  const [temporarilyHiddenMessageIds, setTemporarilyHiddenMessageIds] = useState<number[]>([]);
  const activeTimeoutsRef = useRef<Map<number, number>>(new Map());

  const lastMessageIdRef = useRef<number>(0);
  const oldestMessageIdRef = useRef<number>(Number.MAX_SAFE_INTEGER);
  const pollingTimeoutRef = useRef<number | null>(null);
  const typingPollTimeoutRef = useRef<number | null>(null);
  const loadInFlightRef = useRef(false);
  const loadOlderInFlightRef = useRef(false);
  const isInitializedRef = useRef(false);
  const sessionExpiredRef = useRef(false);
  const bootstrapRunningRef = useRef(false);
  /** Tracks whether we have told the server "I am typing = true" so we know
   *  when to send a cancellation on tab hide / page close. */
  const isTypingRef = useRef(false);
  /** Always reflects the current sessionId so event-listener closures can read
   *  it without becoming stale. */
  const sessionIdRef = useRef(sessionId);
  const messageBackoffMsRef = useRef<number>(0);
  const typingBackoffMsRef = useRef<number>(0);
  const typingWriteBackoffUntilRef = useRef<number>(0);
  const typingWriteInFlightRef = useRef(false);
  const lastTypingSentAtRef = useRef(0);
  const lastTypingValueSentRef = useRef<boolean | null>(null);
  const pollCycleRef = useRef(0);

  const isCurrentSession = useCallback(
    (targetSessionId: string) => String(sessionIdRef.current || '') === String(targetSessionId || ''),
    []
  );

  const { decryptAsync } = useDecryptWorker();

  const numericUserId = Number(userId);
  const hasValidUserId = Number.isFinite(numericUserId) && numericUserId > 0;

  const deletedForMeKey = useMemo(() => `deleted_for_me_${userId}_${sessionId}`, [userId, sessionId]);

  const getDeletedForMeList = useCallback((): number[] => {
    try {
      const raw = localStorage.getItem(deletedForMeKey);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }, [deletedForMeKey]);

  const deleteMessageForMe = useCallback((messageId: number) => {
    setTemporarilyHiddenMessageIds((prev) => [...prev, messageId]);
    
    const timeoutId = window.setTimeout(() => {
      const deletedForMeList = getDeletedForMeList();
      if (!deletedForMeList.includes(messageId)) {
        deletedForMeList.push(messageId);
        localStorage.setItem(deletedForMeKey, JSON.stringify(deletedForMeList));
      }
      setTemporarilyHiddenMessageIds((prev) => prev.filter((id) => id !== messageId));
      activeTimeoutsRef.current.delete(messageId);
    }, 5000) as unknown as number;
    
    activeTimeoutsRef.current.set(messageId, timeoutId);
  }, [deletedForMeKey, getDeletedForMeList]);

  const undoDeleteMessageForMe = useCallback((messageId: number) => {
    const timeoutId = activeTimeoutsRef.current.get(messageId);
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
      activeTimeoutsRef.current.delete(messageId);
    }
    setTemporarilyHiddenMessageIds((prev) => prev.filter((id) => id !== messageId));
  }, []);

  const deleteMessageForEveryone = useCallback(async (messageId: number) => {
    let removed: ChatMessage | undefined;
    setMessages((prev) => {
      removed = prev.find((m) => m.id === messageId);
      return prev.map((msg) =>
        msg.id === messageId
          ? {
              ...msg,
              content: DELETED_MESSAGE_TEXT,
              decryptedContent: DELETED_MESSAGE_TEXT,
              is_encrypted: false,
              message_type: "text",
              // Clear all attachment-related fields so messageIsAttachmentFirst
              // returns false and the message renders as plain text, not a
              // voice/file bubble.
              has_file: false,
              file_url: undefined,
              localBlobUrl: undefined,
              attachment: null,
              is_deleted: true,
              delete_for_everyone_until: null,
            }
          : msg
      );
    });
    try {
      await api.deleteMessage(sessionId, messageId);
    } catch (err) {
      if (removed) {
        setMessages((prev) =>
          prev.map((msg) => (msg.id === messageId ? removed! : msg))
        );
      }
      throw err;
    }
  }, [sessionId]);

  const filteredMessages = useMemo(() => {
    const deletedForMeList = getDeletedForMeList();
    return messages.filter(
      (m) => !deletedForMeList.includes(m.id) && !temporarilyHiddenMessageIds.includes(m.id)
    );
  }, [messages, temporarilyHiddenMessageIds, getDeletedForMeList]);

  useEffect(() => {
    sessionExpiredRef.current = false;
    bootstrapRunningRef.current = false;
    loadInFlightRef.current = false;
    loadOlderInFlightRef.current = false;
    pollCycleRef.current = 0;
    messageBackoffMsRef.current = 0;
    typingBackoffMsRef.current = 0;
    typingWriteBackoffUntilRef.current = 0;
    lastTypingSentAtRef.current = 0;
    lastTypingValueSentRef.current = null;
    setSessionExpired(false);
    lastMessageIdRef.current = 0;
    oldestMessageIdRef.current = Number.MAX_SAFE_INTEGER;
    setMessages([]);
    setTemporarilyHiddenMessageIds([]);
    setError(null);
    setIsLoading(Boolean(sessionId));
  }, [sessionId]);

  // Keep sessionIdRef in sync so page-unload listeners always have the current value.
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Decrypt messages that arrived with is_encrypted=true using the Web Worker.
  // Falls back to ENCRYPTED_FALLBACK when no session key is available.
  useEffect(() => {
    const pending = messages.filter(
      (m) => m.is_encrypted && m.decryptedContent === ENCRYPTED_FALLBACK
    );
    if (pending.length === 0) return;

    const key = loadPersistedSessionKey(sessionId);
    if (!key) return;

    let cancelled = false;
    for (const msg of pending) {
      decryptAsync(msg.id, msg.content, key)
        .then((plaintext) => {
          if (cancelled) return;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === msg.id && m.decryptedContent === ENCRYPTED_FALLBACK
                ? { ...m, decryptedContent: plaintext }
                : m
            )
          );
        })
        .catch(() => {
          // Leave as ENCRYPTED_FALLBACK — wrong key or corrupt payload.
        });
    }
    return () => { cancelled = true; };
  }, [messages, sessionId, decryptAsync]);

  // When the session changes (user switches chat) or the component unmounts while
  // the user was typing, immediately clear our typing state on the old session so
  // the peer's indicator disappears straight away.
  useEffect(() => {
    return () => {
      if (isTypingRef.current) {
        const sid = sessionIdRef.current;
        if (sid && !sessionExpiredRef.current) {
          isTypingRef.current = false;
          const typingWriteKey = chatRateLimitKey('typing-write', sid);
          if (getStoredRateLimitRemainingMs(typingWriteKey) === 0) {
            api.setTypingState(sid, false, { timeout_ms: 5000 }).catch((err: unknown) => {
              if (getErrorStatus(err) === 429) {
                const delayMs = getRateLimitDelayMs(
                  err,
                  0,
                  TYPING_WRITE_BACKOFF_INITIAL_MS,
                  RATE_LIMIT_BACKOFF_MAX_MS
                );
                storeRateLimitDelay(typingWriteKey, delayMs);
              }
            });
          }
        }
      }
    };
  }, [sessionId]);

  // Clear typing state when the tab is hidden (switch / minimise) or the page is
  // being destroyed (close / navigate away).  A regular fetch won't survive page
  // teardown, so we use fetch({ keepalive: true }) which browsers guarantee to
  // deliver even after the JS context is torn down.
  useEffect(() => {
    if (!sessionId || !hasValidUserId) return;

    const sendStopTypingBeacon = () => {
      if (!isTypingRef.current) return;
      const sid = sessionIdRef.current;
      if (!sid) return;
      isTypingRef.current = false;
      if (getStoredRateLimitRemainingMs(chatRateLimitKey('typing-write', sid)) > 0) {
        return;
      }
      const base = api.getBaseUrl().replace(/\/$/, '');
      const url = `${base}/sessions/${sid}/typing`;
      const token = api.getToken();
      // keepalive: true — browser queues this even after the document is gone.
      fetch(url, {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ is_typing: false }),
      }).catch(() => {});
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        sendStopTypingBeacon();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', sendStopTypingBeacon);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', sendStopTypingBeacon);
    };
  }, [sessionId, hasValidUserId]);

  const stopRealtimeAndTimers = useCallback(() => {
    if (pollingTimeoutRef.current !== null) {
      window.clearTimeout(pollingTimeoutRef.current);
      pollingTimeoutRef.current = null;
    }
    if (typingPollTimeoutRef.current !== null) {
      window.clearTimeout(typingPollTimeoutRef.current);
      typingPollTimeoutRef.current = null;
    }
  }, []);

  const loadMessages = useCallback(
    async (fullHydration: boolean, signal?: AbortSignal) => {
      if (sessionExpiredRef.current) return;
      const messageRateLimitKey = chatRateLimitKey('messages', sessionId);
      const storedBackoffMs = getStoredRateLimitRemainingMs(messageRateLimitKey);
      if (storedBackoffMs > 0) {
        messageBackoffMsRef.current = Math.max(messageBackoffMsRef.current, storedBackoffMs);
        return;
      }
      if (loadInFlightRef.current) return;
      loadInFlightRef.current = true;
      try {
        // Use incremental polling (after_id) for lightweight polls so we only
        // fetch genuinely new messages instead of re-downloading the last N rows
        // on every tick. Full-hydration passes (every 5th poll and initial load)
        // omit after_id so the server reconciles the full latest window, which
        // catches remote deletions and server-side edits.
        const afterId =
          !fullHydration && lastMessageIdRef.current > 0
            ? lastMessageIdRef.current
            : undefined;
        const queryParams = {
          limit: fullHydration ? 50 : MESSAGE_BATCH_LIMIT,
          mark_read: true,
          timeout_ms: MESSAGE_POLL_TIMEOUT_MS,
          signal,
          after_id: afterId,
        };

        const rawMessages = await api.getMessages(sessionId, queryParams);
        if (signal?.aborted || !isCurrentSession(sessionId)) return;

        if (import.meta.env.DEV) {
          console.debug('[StudentChatSession] messages-loaded', {
            loadedConversationId: sessionId,
            selectedSessionId: sessionIdRef.current,
            messageCount: Array.isArray(rawMessages) ? rawMessages.length : 0,
            fullHydration,
            afterId,
          });
        }

        if (Array.isArray(rawMessages) && rawMessages.length > 0) {
          const visibleMessages = filterVisibleMessages(rawMessages);
          const formatted = visibleMessages.map(formatServerMessage);

          if (fullHydration && visibleMessages.length > 0) {
            void savePreloadedSessionMessages(sessionId, visibleMessages, {
              ownerUserId: userId,
            }).catch(() => undefined);
          }

          setMessages((prev) => {
            const merged = new Map<number, ChatMessage>();
            for (const msg of prev) merged.set(msg.id, msg);
            for (const msg of formatted) {
              const existing = merged.get(msg.id);
              merged.set(msg.id, existing ? { ...existing, ...msg } : msg);
            }
            return Array.from(merged.values()).sort((a, b) => a.id - b.id);
          });

          const maxId = formatted.reduce((max, msg) => Math.max(max, msg.id), lastMessageIdRef.current);
          lastMessageIdRef.current = maxId;

          if (fullHydration) {
            const minId = formatted.reduce((min, msg) => Math.min(min, msg.id), Number.MAX_SAFE_INTEGER);
            if (minId !== Number.MAX_SAFE_INTEGER) oldestMessageIdRef.current = minId;
            setHasOlderMessages(formatted.length >= 50);
          }
        }
        setError(null);
        messageBackoffMsRef.current = 0; // Reset backoff on success!
      } catch (err: any) {
        if (signal?.aborted || !isCurrentSession(sessionId)) return;
        const status = getErrorStatus(err);
        if (status === 410) {
          markSessionAsExpired(sessionId);
          sessionExpiredRef.current = true;
          setSessionExpired(true);
          stopRealtimeAndTimers();
          return;
        }
        if (status === 429) {
          const delayMs = getRateLimitDelayMs(
            err,
            messageBackoffMsRef.current,
            RATE_LIMIT_BACKOFF_INITIAL_MS,
            RATE_LIMIT_BACKOFF_MAX_MS
          );
          messageBackoffMsRef.current = delayMs;
          storeRateLimitDelay(messageRateLimitKey, delayMs);
          setError(null);
          return;
        } else {
          messageBackoffMsRef.current = Math.min(
            NETWORK_BACKOFF_MAX_MS,
            Math.max(MESSAGE_POLL_INTERVAL_ACTIVE_MS, messageBackoffMsRef.current + 5000)
          );
        }
        if (!isApiNetworkError(err)) {
          setError(getApiErrorMessage(err, 'Failed to fetch messages.'));
        }
      } finally {
        loadInFlightRef.current = false;
        if (isCurrentSession(sessionId)) {
          setIsLoading(false);
        }
      }
    },
    [isCurrentSession, sessionId, stopRealtimeAndTimers, userId]
  );

  const loadOlderMessages = useCallback(async () => {
    if (loadOlderInFlightRef.current || !hasOlderMessages || sessionExpiredRef.current) return false;
    loadOlderInFlightRef.current = true;
    setIsLoadingOlderMessages(true);
    try {
      const rawMessages = await api.getMessages(sessionId, {
        before_id: oldestMessageIdRef.current,
        limit: OLDER_MESSAGE_BATCH_LIMIT,
      });

      if (!isCurrentSession(sessionId)) return false;

      if (Array.isArray(rawMessages) && rawMessages.length > 0) {
        const visibleMessages = filterVisibleMessages(rawMessages);
        const formatted = visibleMessages.map((msg: any) => ({
          ...msg,
          decryptedContent: msg.is_encrypted ? ENCRYPTED_FALLBACK : msg.content,
          e2eVisual: 'plain' as const,
        }));

        setMessages((prev) => {
          const merged = new Map<number, ChatMessage>();
          for (const msg of prev) merged.set(msg.id, msg);
          for (const msg of formatted) merged.set(msg.id, msg);
          return Array.from(merged.values()).sort((a, b) => a.id - b.id);
        });

        const minId = formatted.reduce((min, msg) => Math.min(min, msg.id), Number.MAX_SAFE_INTEGER);
        if (minId !== Number.MAX_SAFE_INTEGER) oldestMessageIdRef.current = minId;
        setHasOlderMessages(formatted.length >= OLDER_MESSAGE_BATCH_LIMIT);
        return true;
      }
      setHasOlderMessages(false);
      return false;
    } catch (err) {
      if (!isCurrentSession(sessionId)) return false;
      const status = (err as any)?.response?.status ?? (err as any)?.status;
      if (status === 410) {
        markSessionAsExpired(sessionId);
        sessionExpiredRef.current = true;
        setSessionExpired(true);
        stopRealtimeAndTimers();
      } else if (status === 429) {
        const delayMs = getRateLimitDelayMs(
          err,
          messageBackoffMsRef.current,
          RATE_LIMIT_BACKOFF_INITIAL_MS,
          RATE_LIMIT_BACKOFF_MAX_MS
        );
        messageBackoffMsRef.current = delayMs;
        storeRateLimitDelay(chatRateLimitKey('messages', sessionId), delayMs);
      }
      return false;
    } finally {
      loadOlderInFlightRef.current = false;
      if (isCurrentSession(sessionId)) {
        setIsLoadingOlderMessages(false);
      }
    }
  }, [hasOlderMessages, isCurrentSession, sessionId, stopRealtimeAndTimers]);

  const scheduleNextPoll = useCallback(() => {
    if (pollingTimeoutRef.current !== null) {
      window.clearTimeout(pollingTimeoutRef.current);
    }
    if (sessionExpiredRef.current) return;
    const baseInterval = document.visibilityState === 'visible'
      ? MESSAGE_POLL_INTERVAL_ACTIVE_MS
      : MESSAGE_POLL_INTERVAL_HIDDEN_MS;
    const delay = Math.max(
      baseInterval,
      messageBackoffMsRef.current,
      getStoredRateLimitRemainingMs(chatRateLimitKey('messages', sessionId))
    );
    pollingTimeoutRef.current = window.setTimeout(async () => {
      pollCycleRef.current += 1;
      const shouldReconcileDeeply = pollCycleRef.current % FULL_RECONCILE_EVERY_POLLS === 0;
      await loadMessages(shouldReconcileDeeply);
      scheduleNextPoll();
    }, delay + getJitter()) as unknown as number;
  }, [loadMessages, sessionId]);

  const refreshPeerTypingStatus = useCallback(async () => {
    if (!sessionId || !hasValidUserId || sessionExpiredRef.current) return;
    const typingReadKey = chatRateLimitKey('typing-read', sessionId);
    const storedBackoffMs = getStoredRateLimitRemainingMs(typingReadKey);
    if (storedBackoffMs > 0) {
      typingBackoffMsRef.current = Math.max(typingBackoffMsRef.current, storedBackoffMs);
      return;
    }
    try {
      const data = await api.getTypingState(sessionId, { timeout_ms: 5000 });
      if (!isCurrentSession(sessionId)) return;
      if (data?.is_typing !== undefined) {
        setIsPeerTyping(data.is_typing === true);
      }
      typingBackoffMsRef.current = 0; // Reset backoff on success!
    } catch (e: any) {
      if (!isCurrentSession(sessionId)) return;
      const status = getErrorStatus(e);
      if (status === 410) {
        markSessionAsExpired(sessionId);
        sessionExpiredRef.current = true;
        setSessionExpired(true);
        stopRealtimeAndTimers();
        return;
      }
      if (status === 429) {
        const delayMs = getRateLimitDelayMs(
          e,
          typingBackoffMsRef.current,
          RATE_LIMIT_BACKOFF_INITIAL_MS,
          RATE_LIMIT_BACKOFF_MAX_MS
        );
        typingBackoffMsRef.current = delayMs;
        storeRateLimitDelay(typingReadKey, delayMs);
        return;
      } else {
        typingBackoffMsRef.current = Math.min(
          NETWORK_BACKOFF_MAX_MS,
          Math.max(TYPING_POLL_INTERVAL_ACTIVE_MS, typingBackoffMsRef.current + 5000)
        );
      }
    }
  }, [hasValidUserId, isCurrentSession, sessionId, stopRealtimeAndTimers]);

  useEffect(() => {
    if (!sessionId || typeof window === 'undefined') return;

    const onDigest = (event: Event) => {
      const detail = (event as CustomEvent<ChatIncomingDigestDetail>).detail;
      const ids = Array.isArray(detail?.session_ids)
        ? detail.session_ids.map((id) => String(id || '').trim())
        : [];
      if (!ids.includes(String(sessionId))) return;

      if (import.meta.env.DEV) {
        console.debug('[StudentChatSession] digest-refresh', {
          selectedSessionId: sessionId,
          loadedConversationId: sessionId,
        });
      }
      void loadMessages(false);
      void refreshPeerTypingStatus();
    };

    window.addEventListener(CHAT_INCOMING_DIGEST_EVENT, onDigest as EventListener);
    return () => {
      window.removeEventListener(CHAT_INCOMING_DIGEST_EVENT, onDigest as EventListener);
    };
  }, [loadMessages, refreshPeerTypingStatus, sessionId]);

  const scheduleTypingPoll = useCallback(() => {
    if (!sessionId) return;
    if (typingPollTimeoutRef.current !== null) {
      window.clearTimeout(typingPollTimeoutRef.current);
    }
    if (sessionExpiredRef.current) return;
    const baseInterval = document.visibilityState === 'visible'
      ? TYPING_POLL_INTERVAL_ACTIVE_MS
      : TYPING_POLL_INTERVAL_HIDDEN_MS;
    const delay = Math.max(
      baseInterval,
      typingBackoffMsRef.current,
      getStoredRateLimitRemainingMs(chatRateLimitKey('typing-read', sessionId))
    );
    typingPollTimeoutRef.current = window.setTimeout(async () => {
      if (!sessionId) {
        if (typingPollTimeoutRef.current !== null) {
          window.clearTimeout(typingPollTimeoutRef.current);
          typingPollTimeoutRef.current = null;
        }
        return;
      }
      await refreshPeerTypingStatus();
      scheduleTypingPoll();
    }, delay + getJitter()) as unknown as number;
  }, [sessionId, refreshPeerTypingStatus]);

  useEffect(() => {
    if (!sessionId || !hasValidUserId || sessionExpiredRef.current) return;
    let isDisposed = false;
    const controller = new AbortController();
    bootstrapRunningRef.current = true;

    const bootstrap = async () => {
      try {
        let sessionGone = false;
        const sessionPromise = api.getSession(sessionId, { minimal: true }).catch((e: any) => {
          if (e?.response?.status === 410) {
            sessionGone = true;
          } else {
            console.warn('Session metadata unavailable; loading messages directly.', e);
          }
        });

        if (isDisposed || controller.signal.aborted) {
          return;
        }

        const cached = await loadPreloadedSessionMessages(sessionId, {
          expectedOwnerUserId: userId,
        });

        if (isDisposed || controller.signal.aborted) {
          return;
        }

        if (Array.isArray(cached) && cached.length > 0) {
          const visibleMessages = filterVisibleMessages(cached);
          const preloaded = visibleMessages.map(formatServerMessage);
          setMessages(preloaded);
          const maxId = preloaded.reduce((max, msg) => Math.max(max, msg.id), 0);
          const minId = preloaded.reduce((min, msg) => Math.min(min, msg.id), Number.MAX_SAFE_INTEGER);
          lastMessageIdRef.current = maxId;
          oldestMessageIdRef.current = minId === Number.MAX_SAFE_INTEGER ? oldestMessageIdRef.current : minId;
          setHasOlderMessages(preloaded.length >= 50);
        }

        const messagesPromise = loadMessages(true, controller.signal);

        await sessionPromise;
        if (isDisposed || controller.signal.aborted) {
          return;
        }

        if (sessionGone) {
          controller.abort();
          markSessionAsExpired(sessionId);
          setIsLoading(false);
          setSessionExpired(true);
          sessionExpiredRef.current = true;
          stopRealtimeAndTimers();
          return;
        }

        isInitializedRef.current = true;

        // Keep the loading indicator up until the server fetch completes when
        // there is no local cache, avoiding a premature "No messages yet" flash.
        await messagesPromise;
        if (isDisposed || controller.signal.aborted || sessionExpiredRef.current) return;

        setIsLoading(false);
        scheduleNextPoll();
        scheduleTypingPoll();
      } catch (err: any) {
        if (isDisposed || controller.signal.aborted) return;
        if (err?.response?.status === 410) {
          markSessionAsExpired(sessionId);
          sessionExpiredRef.current = true;
          setSessionExpired(true);
          stopRealtimeAndTimers();
          setIsLoading(false);
          return;
        }
        setError(getApiErrorMessage(err, 'Failed to load conversation'));
        setIsLoading(false);
      }
    };

    void bootstrap();

    return () => {
      isDisposed = true;
      bootstrapRunningRef.current = false;
      controller.abort();
      stopRealtimeAndTimers();
    };
  }, [sessionId, hasValidUserId, loadMessages, scheduleNextPoll, scheduleTypingPoll, stopRealtimeAndTimers, userId]);

  const sendMessage = useCallback(
    async (content: string, messageType: string = 'text', fileUrl?: string, attachment?: ChatAttachment) => {
      if (!content.trim() && messageType === 'text') return null;

      const optimisticId = -Date.now();
      const optimisticMsg: ChatMessage = {
        id: optimisticId,
        content,
        decryptedContent: content,
        sender_id: numericUserId,
        created_at: new Date().toISOString(),
        is_encrypted: false,
        message_type: messageType,
        file_url: fileUrl,
        has_file: !!fileUrl,
        attachment,
        e2eVisual: 'plain',
        delivery_status: 'sending',
      };

      setMessages((prev) => [...prev, optimisticMsg]);

      try {
        const payload = {
          content,
          is_encrypted: false,
          message_type: messageType,
          file_url: fileUrl,
        };
        const savedRaw = await api.sendMessage(sessionId, payload);
        // Handle both { message: {...} } and direct message object
        const rawMsg = savedRaw?.message ?? savedRaw;
        const savedMsg = formatServerMessage(rawMsg);

        setMessages((prev) => {
          const withoutOptimistic = prev.filter((msg) => msg.id !== optimisticId);
          const existing = withoutOptimistic.find((msg) => msg.id === savedMsg.id);
          if (existing) {
            return withoutOptimistic.map((msg) =>
              msg.id === savedMsg.id ? { ...msg, ...savedMsg } : msg
            );
          }
          return [...withoutOptimistic, savedMsg].sort((a, b) => a.id - b.id);
        });
        lastMessageIdRef.current = Math.max(lastMessageIdRef.current, savedMsg.id);
        return savedMsg;
      } catch (err) {
        console.error('Send failed:', err);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === optimisticId ? { ...msg, delivery_status: 'failed' } : msg
          )
        );
        throw err;
      }
    },
    [sessionId, numericUserId]
  );

  const deleteMessage = useCallback(
    async (messageId: number) => {
      // Snapshot the message before removing it so we can restore on failure.
      let removed: ChatMessage | undefined;
      setMessages((prev) => {
        removed = prev.find((m) => m.id === messageId);
        return prev.filter((m) => m.id !== messageId);
      });
      try {
        await api.deleteMessage(sessionId, messageId);
      } catch {
        // Restore the message so nothing is silently lost.
        // No toast — the message reappearing in the list is sufficient feedback,
        // and avoids spurious errors when the server rejects the delete (e.g.
        // permission denied, already deleted, or network hiccup).
        if (removed) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === messageId)) return prev;
            return [...prev, removed!].sort((a, b) => a.id - b.id);
          });
        }
      }
    },
    [sessionId]
  );

  const notifyTyping = useCallback(
    (isTyping: boolean) => {
      if (!sessionId || !hasValidUserId || sessionExpiredRef.current) return;
      isTypingRef.current = isTyping;
      const now = Date.now();
      const typingWriteKey = chatRateLimitKey('typing-write', sessionId);
      const storedBackoffMs = getStoredRateLimitRemainingMs(typingWriteKey);
      if (storedBackoffMs > 0) {
        typingWriteBackoffUntilRef.current = Math.max(
          typingWriteBackoffUntilRef.current,
          now + storedBackoffMs
        );
        return;
      }
      if (now < typingWriteBackoffUntilRef.current) return;
      if (typingWriteInFlightRef.current) return;

      const lastValue = lastTypingValueSentRef.current;
      const lastSentAt = lastTypingSentAtRef.current;
      const minGap = isTyping ? TYPING_WRITE_MIN_GAP_ACTIVE_MS : TYPING_WRITE_MIN_GAP_IDLE_MS;
      if (lastValue === isTyping && now - lastSentAt < minGap) return;

      typingWriteInFlightRef.current = true;
      lastTypingValueSentRef.current = isTyping;
      lastTypingSentAtRef.current = now;
      api.setTypingState(sessionId, isTyping, { timeout_ms: 5000 })
        .catch((err: any) => {
          if (!isCurrentSession(sessionId)) return;
          const status = getErrorStatus(err);
          if (status === 410) {
            markSessionAsExpired(sessionId);
            sessionExpiredRef.current = true;
            setSessionExpired(true);
            stopRealtimeAndTimers();
            return;
          }
          if (status === 429) {
            const currentDelayMs = Math.max(0, typingWriteBackoffUntilRef.current - Date.now());
            const delayMs = getRateLimitDelayMs(
              err,
              currentDelayMs,
              TYPING_WRITE_BACKOFF_INITIAL_MS,
              RATE_LIMIT_BACKOFF_MAX_MS
            );
            typingWriteBackoffUntilRef.current = storeRateLimitDelay(typingWriteKey, delayMs);
          }
        })
        .finally(() => {
          typingWriteInFlightRef.current = false;
        });
    },
    [hasValidUserId, isCurrentSession, sessionId, stopRealtimeAndTimers]
  );

  const registerServerMessage = useCallback((raw: RawMessage) => {
    if (isE2EHandshakeEnvelope(String(raw.content || ''))) return;
    const formatted = formatServerMessage(raw);
    setMessages((prev) => {
      const existing = prev.find((m) => m.id === formatted.id);
      if (!existing) return [...prev, formatted].sort((a, b) => a.id - b.id);
      return prev.map((m) => (m.id === formatted.id ? { ...m, ...formatted } : m));
    });
    lastMessageIdRef.current = Math.max(lastMessageIdRef.current, formatted.id);
  }, []);

  /**
   * Insert an optimistic (pre-upload) message and return its temporary negative ID.
   * Use resolveOptimisticMessage / failOptimisticMessage to update it afterwards.
   */
  const addOptimisticMessage = useCallback((msg: Omit<ChatMessage, 'id'>): number => {
    const tempId = -(Date.now() + Math.floor(Math.random() * 1000));
    setMessages((prev) => [...prev, { ...msg, id: tempId }]);
    return tempId;
  }, []);

  /** Replace the temporary optimistic message with the real server response. */
  const resolveOptimisticMessage = useCallback((tempId: number, real: ChatMessage) => {
    const normalized = formatServerMessage(real);
    const resolved: ChatMessage = {
      ...normalized,
      decryptedContent: normalized.decryptedContent ?? normalized.content,
      e2eVisual: 'plain' as const,
      isUploading: false,
      uploadFailed: false,
    };
    setMessages((prev) => {
      const withoutOptimistic = prev.filter((msg) => msg.id !== tempId);
      const existing = withoutOptimistic.find((msg) => msg.id === resolved.id);
      if (existing) {
        return withoutOptimistic.map((msg) =>
          msg.id === resolved.id ? { ...msg, ...resolved } : msg
        );
      }
      return [...withoutOptimistic, resolved].sort((a, b) => a.id - b.id);
    });
    lastMessageIdRef.current = Math.max(lastMessageIdRef.current, real.id);
  }, []);

  /** Mark the optimistic message as failed — triggers retry/delete UI in the player. */
  const failOptimisticMessage = useCallback((tempId: number) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === tempId ? { ...m, isUploading: false, uploadFailed: true } : m))
    );
  }, []);

  /** Remove an optimistic message entirely (e.g. user deleted a failed upload). */
  const removeOptimisticMessage = useCallback((tempId: number) => {
    setMessages((prev) => prev.filter((m) => m.id !== tempId));
  }, []);

  return {
    messages: filteredMessages,
    isLoading,
    isLoadingOlderMessages,
    hasOlderMessages,
    isPeerTyping,
    error,
    sessionExpired,
    sendMessage,
    deleteMessage,
    deleteMessageForMe,
    undoDeleteMessageForMe,
    deleteMessageForEveryone,
    notifyTyping,
    loadOlderMessages,
    registerServerMessage,
    addOptimisticMessage,
    resolveOptimisticMessage,
    failOptimisticMessage,
    removeOptimisticMessage,
    getKeyForSharing: async () => null,
    getEncryptionKey: () => null,
    refreshMessages: useCallback(() => { void loadMessages(true); }, [loadMessages]),
  };
};
