import { useState, useEffect, useCallback, useRef } from 'react';
import { api, getApiErrorMessage, isApiNetworkError } from '@/lib/api';
import { loadPreloadedSessionMessages } from '@/lib/chatPreloadCache';
import { loadTypingSnapshot, saveTypingSnapshot } from '@/lib/chatTypingCache';
import { playMessageNotificationSound } from '@/lib/sounds/notificationSoundManager';
import { toast } from 'sonner';
import type { ChatAttachment } from '@/lib/chatAttachments';

export type E2EVisualState = 'plain';

export interface ChatMessage {
  id: number;
  content: string;
  sender_id: number;
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
}

export type RawMessage = ChatMessage & {
  sender?: unknown;
};

interface UseEncryptedChatProps {
  sessionId: string;
  userId: string;
  sessions?: any[];
}

const MESSAGE_POLL_TIMEOUT_MS = 5000;
const OLDER_MESSAGE_BATCH_LIMIT = 30;
const MESSAGE_POLL_INTERVAL_ACTIVE_MS = 3000;
const MESSAGE_POLL_INTERVAL_HIDDEN_MS = 9000;
const TYPING_POLL_INTERVAL_ACTIVE_MS = 5000;
const TYPING_POLL_INTERVAL_HIDDEN_MS = 12000;
const POLL_JITTER_MAX_MS = 600;

const getJitter = () => Math.floor(Math.random() * POLL_JITTER_MAX_MS);

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

export const useEncryptedChat = ({ sessionId, userId, sessions }: UseEncryptedChatProps) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [isPeerTyping, setIsPeerTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  const lastMessageIdRef = useRef<number>(0);
  const oldestMessageIdRef = useRef<number>(Number.MAX_SAFE_INTEGER);
  const pollingTimeoutRef = useRef<number | null>(null);
  const typingPollTimeoutRef = useRef<number | null>(null);
  const loadInFlightRef = useRef(false);
  const loadOlderInFlightRef = useRef(false);
  const isInitializedRef = useRef(false);
  const sessionExpiredRef = useRef(false);
  const bootstrapRunningRef = useRef(false);

  const numericUserId = Number(userId);
  const hasValidUserId = Number.isFinite(numericUserId) && numericUserId > 0;

  useEffect(() => {
    sessionExpiredRef.current = false;
    bootstrapRunningRef.current = false;
    setSessionExpired(false);
    lastMessageIdRef.current = 0;
    oldestMessageIdRef.current = Number.MAX_SAFE_INTEGER;
    setMessages([]);
    setError(null);
    setIsLoading(true);
  }, [sessionId]);

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
      if (loadInFlightRef.current) return;
      loadInFlightRef.current = true;
      try {
        const queryParams = {
          limit: fullHydration ? 50 : 20,
          mark_read: true,
          timeout_ms: MESSAGE_POLL_TIMEOUT_MS,
          after_id: fullHydration ? undefined : lastMessageIdRef.current || undefined,
        };

        const rawMessages = await api.getMessages(sessionId, queryParams);
        if (signal?.aborted) return;

        if (Array.isArray(rawMessages) && rawMessages.length > 0) {
          const visibleMessages = filterVisibleMessages(rawMessages);
          const formatted = visibleMessages.map((msg: any) => ({
            ...msg,
            decryptedContent: msg.content,
            e2eVisual: 'plain' as const,
          }));

          setMessages((prev) => {
            const merged = new Map<number, ChatMessage>();
            for (const msg of prev) merged.set(msg.id, msg);
            for (const msg of formatted) merged.set(msg.id, msg);
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
      } catch (err: any) {
        if (signal?.aborted) return;
        if (err?.response?.status === 410) {
          sessionExpiredRef.current = true;
          setSessionExpired(true);
          stopRealtimeAndTimers();
          return;
        }
        if (!isApiNetworkError(err)) {
          setError(getApiErrorMessage(err, 'Failed to fetch messages.'));
        }
      } finally {
        loadInFlightRef.current = false;
        setIsLoading(false);
      }
    },
    [sessionId, stopRealtimeAndTimers]
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

      if (Array.isArray(rawMessages) && rawMessages.length > 0) {
        const visibleMessages = filterVisibleMessages(rawMessages);
        const formatted = visibleMessages.map((msg: any) => ({
          ...msg,
          decryptedContent: msg.content,
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
      return false;
    } finally {
      loadOlderInFlightRef.current = false;
      setIsLoadingOlderMessages(false);
    }
  }, [sessionId, hasOlderMessages]);

  const scheduleNextPoll = useCallback(() => {
    if (pollingTimeoutRef.current !== null) {
      window.clearTimeout(pollingTimeoutRef.current);
    }
    if (sessionExpiredRef.current) return;
    const baseInterval = document.visibilityState === 'visible'
      ? MESSAGE_POLL_INTERVAL_ACTIVE_MS
      : MESSAGE_POLL_INTERVAL_HIDDEN_MS;
    pollingTimeoutRef.current = window.setTimeout(async () => {
      await loadMessages(false);
      scheduleNextPoll();
    }, baseInterval + getJitter()) as unknown as number;
  }, [loadMessages]);

  const refreshPeerTypingStatus = useCallback(async () => {
    if (!sessionId || !hasValidUserId || sessionExpiredRef.current) return;
    try {
      const data = await api.getTypingState(sessionId, { timeout_ms: 5000 });
      if (data?.is_typing !== undefined) {
        setIsPeerTyping(data.is_typing === true);
      }
    } catch (e) {
      // ignore
    }
  }, [sessionId, hasValidUserId]);

  const scheduleTypingPoll = useCallback(() => {
    if (!sessionId) return;
    if (typingPollTimeoutRef.current !== null) {
      window.clearTimeout(typingPollTimeoutRef.current);
    }
    if (sessionExpiredRef.current) return;
    const baseInterval = document.visibilityState === 'visible'
      ? TYPING_POLL_INTERVAL_ACTIVE_MS
      : TYPING_POLL_INTERVAL_HIDDEN_MS;
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
    }, baseInterval + getJitter()) as unknown as number;
  }, [sessionId, refreshPeerTypingStatus]);

  useEffect(() => {
    if (!sessionId || !hasValidUserId || sessionExpiredRef.current) return;
    let isDisposed = false;
    const controller = new AbortController();
    bootstrapRunningRef.current = true;

    const bootstrap = async () => {
      try {
        const sessionDetails = await api.getSession(sessionId, { minimal: true }).catch((e: any) => {
          if (e?.response?.status === 410) return null;
          throw e;
        });

        if (!sessionDetails || controller.signal.aborted) {
          setIsLoading(false);
          setSessionExpired(true);
          sessionExpiredRef.current = true;
          stopRealtimeAndTimers();
          return;
        }

        const cached = await loadPreloadedSessionMessages(sessionId, {
          expectedOwnerUserId: userId,
        });
        if (Array.isArray(cached) && cached.length > 0 && !controller.signal.aborted) {
          const visibleMessages = filterVisibleMessages(cached);
          const preloaded = visibleMessages.map((msg: any) => ({
            ...msg,
            decryptedContent: msg.content,
            e2eVisual: 'plain' as const,
          }));
          setMessages(preloaded);
          const maxId = preloaded.reduce((max, msg) => Math.max(max, msg.id), 0);
          const minId = preloaded.reduce((min, msg) => Math.min(min, msg.id), Number.MAX_SAFE_INTEGER);
          lastMessageIdRef.current = maxId;
          oldestMessageIdRef.current = minId === Number.MAX_SAFE_INTEGER ? oldestMessageIdRef.current : minId;
          setHasOlderMessages(preloaded.length >= 50);
        }

        isInitializedRef.current = true;
        setIsLoading(false);

        await loadMessages(true, controller.signal);
        if (isDisposed || sessionExpiredRef.current) return;

        scheduleNextPoll();
        scheduleTypingPoll();
      } catch (err: any) {
        if (isDisposed) return;
        if (err?.response?.status === 410) {
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
        const savedMsg = {
          ...rawMsg,
          decryptedContent: rawMsg.content,
          e2eVisual: 'plain' as const,
        };

        setMessages((prev) =>
          prev.map((msg) => (msg.id === optimisticId ? savedMsg : msg))
        );
        lastMessageIdRef.current = Math.max(lastMessageIdRef.current, savedMsg.id);
        return savedMsg;
      } catch (err) {
        console.error('Send failed:', err);
        setMessages((prev) => prev.filter((msg) => msg.id !== optimisticId));
        throw err;
      }
    },
    [sessionId, numericUserId]
  );

  const deleteMessage = useCallback(
    async (messageId: number) => {
      try {
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
        await api.deleteMessage(sessionId, messageId);
      } catch (err) {
        toast.error('Failed to delete message');
      }
    },
    [sessionId]
  );

  const notifyTyping = useCallback(
    (isTyping: boolean) => {
      if (!sessionId || !hasValidUserId || sessionExpiredRef.current) return;
      api.setTypingState(sessionId, isTyping).catch(() => {});
    },
    [sessionId, hasValidUserId]
  );

  const registerServerMessage = useCallback((raw: RawMessage) => {
    if (isE2EHandshakeEnvelope(String(raw.content || ''))) return;
    const formatted = {
      ...raw,
      decryptedContent: raw.content,
      e2eVisual: 'plain' as const,
    };
    setMessages((prev) => {
      if (prev.some((m) => m.id === formatted.id)) return prev;
      return [...prev, formatted].sort((a, b) => a.id - b.id);
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
    const resolved: ChatMessage = {
      ...real,
      decryptedContent: real.decryptedContent ?? real.content,
      e2eVisual: 'plain' as const,
      isUploading: false,
      uploadFailed: false,
    };
    setMessages((prev) => prev.map((m) => (m.id === tempId ? resolved : m)));
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
    messages,
    isLoading,
    isLoadingOlderMessages,
    hasOlderMessages,
    isPeerTyping,
    error,
    sessionExpired,
    sendMessage,
    deleteMessage,
    notifyTyping,
    loadOlderMessages,
    registerServerMessage,
    addOptimisticMessage,
    resolveOptimisticMessage,
    failOptimisticMessage,
    removeOptimisticMessage,
    getKeyForSharing: async () => null,
    getEncryptionKey: () => null,
    refreshMessages: () => {},
  };
};
