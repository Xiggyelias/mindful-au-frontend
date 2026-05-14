import { useState, useEffect, useCallback, useRef } from 'react';
import { api, getApiErrorMessage } from '@/lib/api';
import { markSessionAsExpired, isSessionExpired } from '@/hooks/useChatSession';
import { detectCrisisTermsInText, isE2EHandshakeEnvelopeContent } from '@/lib/crisisTerms';
import {
  getOrCreateDeviceKeyPair,
  importPeerPublicKey,
  encryptSessionKeyForPeer,
  decryptSessionKeyFromPeer,
  DeviceKeyPair,
  generateEncryptionKey,
  exportKey,
  importKey,
  encryptMessage,
  decryptChatPayload,
  logCryptoDebug,
  clearDecryptPlaintextCache,
} from '@/lib/encryption';
import {
  loadPersistedSessionKey,
  persistSessionKey,
  deletePersistedSessionKey,
} from '@/lib/chatSessionKeys';
import {
  getPreloadedSessionKey,
} from '@/lib/encryptionPreloader';
import { loadPreloadedSessionMessages, savePreloadedSessionMessages } from '@/lib/chatPreloadCache';
import { loadTypingSnapshot, saveTypingSnapshot } from '@/lib/chatTypingCache';
import { recordChatOpenLatency, recordWarmHydrateResult } from '@/lib/chatPerfMetrics';
import { playMessageNotificationSound } from '@/lib/sounds/notificationSoundManager';
import { toast } from 'sonner';
import type { ChatAttachment } from '@/lib/chatAttachments';
import type { Session } from '@/hooks/useChatSession';
import type { E2EVisualState } from '@/types/e2eChat';

export type { E2EVisualState };

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
  /** Server snapshot: anonymous session flag when the message was stored (`null` = legacy). */
  sent_as_anonymous?: boolean | null;
  /** Set client-side after decrypt (or placeholder state). */
  e2eVisual?: E2EVisualState;
}

type RawMessage = ChatMessage & {
  sender?: unknown;
};

interface E2EPublicEnvelope {
  __e2e: 'v1';
  kind: 'pub';
  from?: number;
  to?: number;
  sessionId?: string;
  publicKey?: string;
  createdAt?: number;
}

interface E2ESessionKeyEnvelope {
  __e2e: 'v1';
  kind: 'key';
  from?: number;
  to?: number;
  sessionId?: string;
  encryptedSessionKey?: string;
  createdAt?: number;
}

type E2EEnvelope = E2EPublicEnvelope | E2ESessionKeyEnvelope;

interface UseEncryptedChatProps {
  sessionId: string;
  userId: string;
  sessions?: any[];
}

interface RealtimeBroadcastChannel {
  send(payload: {
    type: 'broadcast';
    event: string;
    payload: Record<string, unknown>;
  }): Promise<unknown>;
  on(
    type: 'broadcast',
    filter: { event: string },
    callback: (payload: { payload?: unknown }) => void
  ): RealtimeBroadcastChannel;
  subscribe(callback?: (status: string) => void): RealtimeBroadcastChannel;
  unsubscribe?: () => void;
}

interface RealtimeClient {
  channel(topic: string): RealtimeBroadcastChannel;
  removeChannel(channel: RealtimeBroadcastChannel): Promise<unknown> | unknown;
}

const DEFAULT_POLLING_INTERVAL_MS = 6500;
const ACTIVE_POLLING_INTERVAL_MS = 2800;
const POLLING_BOOST_DURATION_MS = 12000;

/** Aligned with API max; fewer round-trips for history sync. */
const MESSAGE_BATCH_LIMIT = 40;
const INITIAL_SYNC_BATCH_LIMIT = 40;
const MESSAGE_RETRY_BATCH_LIMIT = 20;
const OLDER_MESSAGE_BATCH_LIMIT = 40;
const RECEIPT_FULL_SYNC_EVERY_POLLS = 20;
const MESSAGE_POLL_TIMEOUT_MS = 5000;
const MESSAGE_POLL_RETRY_TIMEOUT_MS = 8000;
const REALTIME_SYNC_DEBOUNCE_MS = 75;
const TYPING_HEARTBEAT_MS = 1300;
const PEER_TYPING_IDLE_TIMEOUT_MS = 2400;
const TYPING_STATUS_TIMEOUT_MS = 3200;
const TYPING_POLL_INTERVAL_MS = 2800;
const MAX_CLIENT_MESSAGES = 500;
const DECRYPT_BATCH_SIZE = 20;
const E2E_VERSION = 'v1';
const SESSION_KEY_PREFIX = 'chat_key_';
const SESSION_KEY_V2_PREFIX = 'chat_key_v2_';
const SESSION_PEER_MARKER_PREFIX = 'chat_key_peer_';
const PEER_KEY_PREFIX = 'chat_peer_pub_';
const OPTIMISTIC_MESSAGE_ID_THRESHOLD = 1_000_000_000_000_000;
const MIN_ENCRYPTED_PAYLOAD_LENGTH = 40;
const ENCRYPTED_PAYLOAD_REGEX = /^[A-Za-z0-9+/=]+$/;

const getLegacySessionKeyStorageKey = (sessionId: string) => `${SESSION_KEY_PREFIX}${sessionId}`;
const getSessionPeerMarkerStorageKey = (sessionId: string) => `${SESSION_PEER_MARKER_PREFIX}${sessionId}`;
const getSessionKeyStorageKey = (sessionId: string, userA: number, userB: number) => {
  const low = Math.min(userA, userB);
  const high = Math.max(userA, userB);
  return `${SESSION_KEY_V2_PREFIX}${sessionId}_${low}_${high}`;
};
const getPeerKeyStorageKey = (sessionId: string, peerId: number) =>
  `${PEER_KEY_PREFIX}${sessionId}_${peerId}`;

type RuntimeEncryptionContext = {
  key: CryptoKey;
  keyString: string;
  peerId: number;
  storageKey: string;
  peerPublicKey: CryptoKey | null;
};

const runtimeEncryptionContexts = new Map<string, RuntimeEncryptionContext>();

const getRuntimeEncryptionContextKey = (sessionId: string, userId: string | number) =>
  `${sessionId}:${userId}`;

const isTimeoutError = (error: unknown): boolean => {
  const code = (error as { code?: unknown })?.code;
  if (code === 'ECONNABORTED') {
    return true;
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';

  return /timeout/i.test(message);
};

const extractApiErrorMessage = (error: unknown, fallback: string): string => {
  if (isTimeoutError(error)) {
    return 'Connection is slow. Retrying messages...';
  }

  return getApiErrorMessage(error, fallback);
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * True when replaying history should not fail the whole messages sync (network / crypto).
 */
const runHandshakeOutbound = async (fn: () => Promise<void>): Promise<void> => {
  try {
    await fn();
  } catch {
    // Outbound handshake is best-effort during history replay; polling will retry.
  }
};

const isLikelyEncryptedPayload = (content: string): boolean => {
  const trimmed = content.trim();
  return (
    trimmed.length >= MIN_ENCRYPTED_PAYLOAD_LENGTH &&
    ENCRYPTED_PAYLOAD_REGEX.test(trimmed)
  );
};

const messageNeedsKeyOrDecryptRetry = (message: ChatMessage): boolean =>
  message.is_encrypted &&
  (message.e2eVisual === 'awaiting_key' || message.e2eVisual === 'needs_resync');

const parseEnvelope = (rawContent: string): E2EEnvelope | null => {
  if (!rawContent || rawContent[0] !== '{') return null;

  try {
    const parsed = JSON.parse(rawContent);
    if (parsed?.__e2e !== E2E_VERSION || !parsed?.kind) return null;
    if (parsed.kind !== 'pub' && parsed.kind !== 'key') return null;
    return parsed as E2EEnvelope;
  } catch {
    return null;
  }
};

const createOptimisticMessageId = (): number => Date.now() * 1000 + Math.floor(Math.random() * 1000);
const isOptimisticMessageId = (id: number): boolean => id >= OPTIMISTIC_MESSAGE_ID_THRESHOLD;

const sortAndTrimMessages = (messages: ChatMessage[]): ChatMessage[] => {
  return [...messages].sort((a, b) => a.id - b.id).slice(-MAX_CLIENT_MESSAGES);
};

const normalizeExternalMessage = (message: ChatMessage): ChatMessage => {
  if (message.is_encrypted) {
    return message;
  }

  return {
    ...message,
    decryptedContent: message.decryptedContent ?? message.content,
    e2eVisual: 'plain',
  };
};

const normalizeMessagePayload = (payload: unknown): RawMessage[] => {
  if (Array.isArray(payload)) {
    return payload as RawMessage[];
  }

  if (payload && typeof payload === 'object') {
    const data = (payload as { data?: unknown }).data;
    if (Array.isArray(data)) {
      return data as RawMessage[];
    }
  }

  return [];
};

export const useEncryptedChat = ({ sessionId, userId, sessions }: UseEncryptedChatProps) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(true);
  const [isEncryptionReady, setIsEncryptionReady] = useState(false);
  const [isPeerTyping, setIsPeerTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const sessionExpiredRef = useRef(false);
  const bootstrapRunningRef = useRef(false);

  const encryptionKeyRef = useRef<CryptoKey | null>(null);
  const keyStringRef = useRef<string | null>(null);
  const deviceKeyPairRef = useRef<DeviceKeyPair | null>(null);
  const peerPublicKeyRef = useRef<CryptoKey | null>(null);
  const peerIdRef = useRef<number | null>(null);
  const isPeerTypingRef = useRef(false);
  const hasSentPublicKeyRef = useRef(false);
  const hasSentSessionKeyRef = useRef(false);
  const lastMessageIdRef = useRef(0);
  const oldestMessageIdRef = useRef(0);
  const messageCountRef = useRef(0);
  const isInitializedRef = useRef(false);
  const pollingTimeoutRef = useRef<number | null>(null);
  const loadInFlightRef = useRef(false);
  const loadOlderInFlightRef = useRef(false);
  const hasUndecryptedMessagesRef = useRef(false);

  const getNextSessionId = useCallback((currentId: string): string | null => {
    if (!sessions || !Array.isArray(sessions) || sessions.length < 2) return null;
    const currentIndex = sessions.findIndex(s => String(s.id) === currentId);
    if (currentIndex === -1 || currentIndex === sessions.length - 1) return null;
    return String(sessions[currentIndex + 1].id);
  }, [sessions]);
  const pollCountRef = useRef(0);
  const sessionKeyStorageKeyRef = useRef<string | null>(null);
  const realtimeClientRef = useRef<RealtimeClient | null>(null);
  const realtimeChannelRef = useRef<RealtimeBroadcastChannel | null>(null);
  const realtimeSyncTimeoutRef = useRef<number | null>(null);
  const peerTypingTimeoutRef = useRef<number | null>(null);
  const typingPollTimeoutRef = useRef<number | null>(null);
  const localTypingStateRef = useRef(false);
  const localTypingLastSentAtRef = useRef(0);
  const lastActiveAtRef = useRef(0);
  /** Keeps pagination gate in sync for handshake catch-up (avoids stale `useCallback` closures). */
  const hasOlderMessagesRef = useRef(true);

  useEffect(() => {
    hasOlderMessagesRef.current = hasOlderMessages;
  }, [hasOlderMessages]);

  const numericUserId = Number(userId);
  const hasValidUserId = Number.isInteger(numericUserId) && numericUserId > 0;
  const isSessionKeyInitiator = useCallback(
    () => peerIdRef.current !== null && numericUserId < peerIdRef.current,
    [numericUserId]
  );

  const detachRealtimeChannel = useCallback(() => {
    if (realtimeSyncTimeoutRef.current !== null) {
      window.clearTimeout(realtimeSyncTimeoutRef.current);
      realtimeSyncTimeoutRef.current = null;
    }
    if (peerTypingTimeoutRef.current !== null) {
      window.clearTimeout(peerTypingTimeoutRef.current);
      peerTypingTimeoutRef.current = null;
    }
    setIsPeerTyping(false);

    const channel = realtimeChannelRef.current;
    realtimeChannelRef.current = null;

    if (!channel) {
      return;
    }

    const client = realtimeClientRef.current;
    if (client) {
      void Promise.resolve(client.removeChannel(channel)).catch(() => {
        // noop
      });
      return;
    }

    if (typeof channel.unsubscribe === 'function') {
      try {
        channel.unsubscribe();
      } catch {
        // noop
      }
    }
  }, []);

  const emitRealtimeSyncHint = useCallback(async () => {
    if (!sessionId || !hasValidUserId || !realtimeChannelRef.current) {
      return;
    }

    try {
      await realtimeChannelRef.current.send({
        type: 'broadcast',
        event: 'message-updated',
        payload: {
          sessionId,
          senderId: numericUserId,
          timestamp: Date.now(),
        },
      });
    } catch {
      // Best-effort realtime hint only; polling fallback still runs.
    }
  }, [hasValidUserId, numericUserId, sessionId]);

  const emitRealtimeDeletionHint = useCallback(
    async (messageId: number) => {
      if (!sessionId || !hasValidUserId || !realtimeChannelRef.current) {
        return;
      }
      if (!Number.isInteger(messageId) || messageId <= 0) {
        return;
      }

      try {
        await realtimeChannelRef.current.send({
          type: 'broadcast',
          event: 'message-deleted',
          payload: {
            sessionId,
            senderId: numericUserId,
            messageId,
            timestamp: Date.now(),
          },
        });
      } catch {
        // Best-effort realtime hint only; polling fallback still runs.
      }
    },
    [hasValidUserId, numericUserId, sessionId]
  );

  const removeMessageFromState = useCallback((messageId: number) => {
    if (!Number.isInteger(messageId) || messageId <= 0) {
      return;
    }

    setMessages((previous) => {
      const next = previous.filter((message) => message.id !== messageId);
      return next.length === previous.length ? previous : next;
    });
  }, []);

  const applyPeerTypingState = useCallback((isTyping: boolean) => {
    if (!isTyping) {
      if (peerTypingTimeoutRef.current !== null) {
        window.clearTimeout(peerTypingTimeoutRef.current);
        peerTypingTimeoutRef.current = null;
      }
      setIsPeerTyping(false);
      if (sessionId) {
        saveTypingSnapshot(sessionId, false, { ownerUserId: userId });
      }
      return;
    }

    setIsPeerTyping(true);
    if (sessionId) {
      saveTypingSnapshot(sessionId, true, { ownerUserId: userId });
    }
    if (peerTypingTimeoutRef.current !== null) {
      window.clearTimeout(peerTypingTimeoutRef.current);
    }
    peerTypingTimeoutRef.current = window.setTimeout(() => {
      peerTypingTimeoutRef.current = null;
      setIsPeerTyping(false);
      if (sessionId) {
        saveTypingSnapshot(sessionId, false, { ownerUserId: userId });
      }
    }, PEER_TYPING_IDLE_TIMEOUT_MS);
  }, [sessionId, userId]);

  const syncTypingStateToServer = useCallback(
    async (isTyping: boolean) => {
      if (!sessionId || !hasValidUserId) {
        return;
      }

      try {
        await api.setTypingState(sessionId, isTyping, {
          timeout_ms: TYPING_STATUS_TIMEOUT_MS,
        });
      } catch {
        // Best-effort typing sync only.
      }
    },
    [hasValidUserId, sessionId]
  );

  const refreshPeerTypingStatus = useCallback(async () => {
    if (!sessionId || !hasValidUserId) {
      return;
    }

    try {
      const status = await api.getTypingState(sessionId, {
        timeout_ms: TYPING_STATUS_TIMEOUT_MS,
      });
      applyPeerTypingState(status?.is_typing === true);
    } catch {
      // Best-effort fallback; realtime and subsequent polls still run.
    }
  }, [applyPeerTypingState, hasValidUserId, sessionId]);

  const emitTypingSignal = useCallback(
    async (isTyping: boolean) => {
      if (!sessionId || !hasValidUserId || !realtimeChannelRef.current) {
        return;
      }

      try {
        await realtimeChannelRef.current.send({
          type: 'broadcast',
          event: 'typing',
          payload: {
            sessionId,
            senderId: numericUserId,
            isTyping,
            timestamp: Date.now(),
          },
        });
      } catch {
        // Best-effort typing indicator only.
      }
    },
    [hasValidUserId, numericUserId, sessionId]
  );

  const requestSessionKey = useCallback(async () => {
    if (!sessionId || !hasValidUserId || !realtimeChannelRef.current) {
      return;
    }

    // Only non-initiators should request session key
    if (isSessionKeyInitiator()) {
      return;
    }

    try {
      await realtimeChannelRef.current.send({
        type: 'broadcast',
        event: 'request-session-key',
        payload: {
          sessionId,
          senderId: numericUserId,
        },
      });
    } catch {
      // Best-effort session key request only.
    }
  }, [hasValidUserId, isSessionKeyInitiator, numericUserId, sessionId]);

  const notifyTyping = useCallback(
    (isTyping: boolean) => {
      if (!sessionId || !hasValidUserId) {
        return;
      }

      const now = Date.now();
      if (isTyping) {
        const shouldSend =
          !localTypingStateRef.current ||
          now - localTypingLastSentAtRef.current >= TYPING_HEARTBEAT_MS;
        localTypingStateRef.current = true;

        if (shouldSend) {
          localTypingLastSentAtRef.current = now;
          void emitTypingSignal(true);
          void syncTypingStateToServer(true);
        }
        return;
      }

      if (!localTypingStateRef.current) {
        return;
      }

      localTypingStateRef.current = false;
      localTypingLastSentAtRef.current = now;
      void emitTypingSignal(false);
      void syncTypingStateToServer(false);
    },
    [emitTypingSignal, hasValidUserId, sessionId, syncTypingStateToServer]
  );

  const sendPublicKeyEnvelope = useCallback(
    async (targetUserId?: number) => {
      if (!sessionId || !deviceKeyPairRef.current || !hasValidUserId) {
        return;
      }

      const payload: E2EPublicEnvelope = {
        __e2e: E2E_VERSION,
        kind: 'pub',
        from: numericUserId,
        to: typeof targetUserId === 'number' ? targetUserId : undefined,
        sessionId,
        publicKey: deviceKeyPairRef.current.publicKeyBase64,
        createdAt: Date.now(),
      };

      await api.sendMessage(sessionId, {
        content: JSON.stringify(payload),
        message_type: 'text',
        is_encrypted: false,
      });

      hasSentPublicKeyRef.current = true;
      void emitRealtimeSyncHint();
    },
    [emitRealtimeSyncHint, hasValidUserId, numericUserId, sessionId]
  );

  const ensureSessionKey = useCallback(async () => {
    if (encryptionKeyRef.current && keyStringRef.current) {
      setIsEncryptionReady(true);
      return;
    }

    if (!sessionKeyStorageKeyRef.current || !peerIdRef.current) {
      return;
    }

    // Only the lower user id invents the AES key. The other party must receive it via a `kind:key` envelope;
    // otherwise they hold a random key that can never decrypt the peer's ciphertext (shown as "unavailable").
    if (!isSessionKeyInitiator()) {
      return;
    }

    const generatedKey = await generateEncryptionKey();
    const generatedKeyString = await exportKey(generatedKey);

    encryptionKeyRef.current = generatedKey;
    keyStringRef.current = generatedKeyString;
    await persistSessionKey(sessionKeyStorageKeyRef.current, generatedKeyString);
    runtimeEncryptionContexts.set(getRuntimeEncryptionContextKey(sessionId, userId), {
      key: generatedKey,
      keyString: generatedKeyString,
      peerId: peerIdRef.current,
      storageKey: sessionKeyStorageKeyRef.current,
      peerPublicKey: peerPublicKeyRef.current,
    });
    setIsEncryptionReady(true);
  }, [isSessionKeyInitiator, sessionId, userId]);

  const sendSessionKeyEnvelope = useCallback(
    async (targetUserId: number) => {
      if (!sessionId || !hasValidUserId) return;
      if (!peerPublicKeyRef.current) return;
      if (hasSentSessionKeyRef.current) return;

      await ensureSessionKey();
      if (!keyStringRef.current) return;

      const encryptedSessionKey = await encryptSessionKeyForPeer(
        keyStringRef.current,
        peerPublicKeyRef.current
      );

      const payload: E2ESessionKeyEnvelope = {
        __e2e: E2E_VERSION,
        kind: 'key',
        from: numericUserId,
        to: targetUserId,
        sessionId,
        encryptedSessionKey,
        createdAt: Date.now(),
      };

      await api.sendMessage(sessionId, {
        content: JSON.stringify(payload),
        message_type: 'text',
        is_encrypted: false,
      });

      hasSentSessionKeyRef.current = true;
      void emitRealtimeSyncHint();
    },
    [emitRealtimeSyncHint, ensureSessionKey, hasValidUserId, numericUserId, sessionId]
  );

  const initializeEncryption = useCallback(async (signal?: AbortSignal, preloadedSession?: Session | null) => {
    if (!sessionId || !hasValidUserId) return;

    try {
      // Parallelize device key generation and session fetch for faster startup.
      // Accept a pre-fetched session to avoid a double round-trip during bootstrap.
      const [deviceKeyPair, session] = await Promise.all([
        getOrCreateDeviceKeyPair(),
        preloadedSession !== undefined
          ? Promise.resolve(preloadedSession)
          : (api.getSession(sessionId, { signal, minimal: true }) as Promise<Session | null | undefined>),
      ]);

      deviceKeyPairRef.current = deviceKeyPair;
      hasSentPublicKeyRef.current = false;
      hasSentSessionKeyRef.current = false;
      // Anonymous sessions mask student_id in JSON for counselors; backend sends chat_peer_student_id for E2E.
      const studentId = Number(session?.chat_peer_student_id ?? session?.student_id);
      const counselorId = Number(session?.counselor_id);
      const peerCounselorId = Number(session?.peer_counselor_id);
      const assignedRole = String(session?.assigned_role || "").toLowerCase();
      let storedKey: string | null = null;

      if (studentId === numericUserId) {
        if (
          assignedRole === 'peer_counselor'
          && Number.isFinite(peerCounselorId)
          && peerCounselorId > 0
        ) {
          peerIdRef.current = peerCounselorId;
        } else if (Number.isFinite(counselorId) && counselorId > 0) {
          peerIdRef.current = counselorId;
        } else {
          peerIdRef.current = null;
        }
      } else if (counselorId === numericUserId && Number.isFinite(studentId) && studentId > 0) {
        peerIdRef.current = studentId;
      } else if (
        peerCounselorId === numericUserId
        && assignedRole === 'peer_counselor'
        && Number.isFinite(studentId)
        && studentId > 0
      ) {
        peerIdRef.current = studentId;
      } else {
        peerIdRef.current = null;
      }

      // Validate that we have a valid peer to communicate with
      if (!peerIdRef.current || !Number.isFinite(peerIdRef.current) || peerIdRef.current <= 0) {
        throw new Error('Unable to identify chat participant. Please refresh and try again.');
      }

      if (peerIdRef.current) {
        const peerMarkerKey = getSessionPeerMarkerStorageKey(sessionId);
        const previousPeerId = Number(localStorage.getItem(peerMarkerKey) || 0);
        const activeSessionStorageKey = getSessionKeyStorageKey(
          sessionId,
          numericUserId,
          peerIdRef.current
        );
        sessionKeyStorageKeyRef.current = activeSessionStorageKey;

        // If the participant changed on the same session, force a fresh
        // session key for the new participant pair.
        if (previousPeerId > 0 && previousPeerId !== peerIdRef.current) {
          const previousPairStorageKey = getSessionKeyStorageKey(
            sessionId,
            numericUserId,
            previousPeerId
          );
          // Parallel cleanup operations
          await Promise.all([
            deletePersistedSessionKey(previousPairStorageKey),
            Promise.resolve(localStorage.removeItem(getLegacySessionKeyStorageKey(sessionId)))
          ]);
        }

        const runtimeContext = runtimeEncryptionContexts.get(
          getRuntimeEncryptionContextKey(sessionId, userId)
        );
        if (
          runtimeContext &&
          runtimeContext.peerId === peerIdRef.current &&
          runtimeContext.storageKey === activeSessionStorageKey
        ) {
          encryptionKeyRef.current = runtimeContext.key;
          keyStringRef.current = runtimeContext.keyString;
          peerPublicKeyRef.current = runtimeContext.peerPublicKey;
          storedKey = runtimeContext.keyString;
          setIsEncryptionReady(true);
        } else {
          encryptionKeyRef.current = null;
          keyStringRef.current = null;
          peerPublicKeyRef.current = null;
          setIsEncryptionReady(false);
          storedKey = await loadPersistedSessionKey(activeSessionStorageKey);

          // If we found a stored key, set it immediately so messages can start decrypting
          // while the handshake runs in the background
          if (storedKey) {
            try {
              const importedKey = await importKey(storedKey);
              encryptionKeyRef.current = importedKey;
              keyStringRef.current = storedKey;
              sessionKeyStorageKeyRef.current = activeSessionStorageKey;
              setIsEncryptionReady(true);
              setError(null);

              // Store in runtime cache for immediate access
              runtimeEncryptionContexts.set(getRuntimeEncryptionContextKey(sessionId, userId), {
                key: importedKey,
                keyString: storedKey,
                peerId: peerIdRef.current,
                storageKey: activeSessionStorageKey,
                peerPublicKey: peerPublicKeyRef.current,
              });

              logCryptoDebug('session key loaded from storage before handshake', {
                sessionId,
                storageKeySuffix: peerIdRef.current || 'legacy',
              });
            } catch (err) {
              console.warn('Failed to import stored session key:', err);
              // Continue with handshake if stored key is corrupted
            }
          }
        }

        const isPeerParticipant =
          (peerCounselorId === numericUserId && assignedRole === 'peer_counselor') ||
          (
            studentId === numericUserId &&
            assignedRole === 'peer_counselor' &&
            Number.isFinite(peerCounselorId) &&
            peerCounselorId > 0
          );

        // Best-effort migration from old storage key only when peer did not change.
        if (
          !storedKey &&
          (previousPeerId === peerIdRef.current || (previousPeerId <= 0 && !isPeerParticipant))
        ) {
          const legacyKey = localStorage.getItem(getLegacySessionKeyStorageKey(sessionId));
          if (legacyKey) {
            storedKey = legacyKey;
            await persistSessionKey(activeSessionStorageKey, legacyKey);
          }
        }

        // Check for preloaded key first (fastest path)
        if (!storedKey && peerIdRef.current) {
          storedKey = getPreloadedSessionKey(sessionId, numericUserId, peerIdRef.current);
        }

        if (storedKey) {
          // Parallel key import and persistence for faster startup
          const [importedKey] = await Promise.all([
            encryptionKeyRef.current && keyStringRef.current === storedKey
              ? Promise.resolve(encryptionKeyRef.current)
              : importKey(storedKey),
            persistSessionKey(activeSessionStorageKey, storedKey)
          ]);
          encryptionKeyRef.current = importedKey;
          keyStringRef.current = storedKey;
          runtimeEncryptionContexts.set(getRuntimeEncryptionContextKey(sessionId, userId), {
            key: encryptionKeyRef.current,
            keyString: storedKey,
            peerId: peerIdRef.current,
            storageKey: activeSessionStorageKey,
            peerPublicKey: peerPublicKeyRef.current,
          });
          setIsEncryptionReady(true);
        }

        localStorage.setItem(peerMarkerKey, String(peerIdRef.current));
      }

      if (peerIdRef.current) {
        // Load peer key from localStorage (still using LS for peer keys)
        const storedPeerKey = localStorage.getItem(
          getPeerKeyStorageKey(sessionId, peerIdRef.current)
        );

        // Pre-import peer key while other operations run
        peerPublicKeyRef.current = storedPeerKey
          ? await importPeerPublicKey(storedPeerKey)
          : null;

        if (encryptionKeyRef.current && keyStringRef.current && sessionKeyStorageKeyRef.current) {
          runtimeEncryptionContexts.set(getRuntimeEncryptionContextKey(sessionId, userId), {
            key: encryptionKeyRef.current,
            keyString: keyStringRef.current,
            peerId: peerIdRef.current,
            storageKey: sessionKeyStorageKeyRef.current,
            peerPublicKey: peerPublicKeyRef.current,
          });
        }
      }

      // Both initiator and non-initiator need a session key so the UI is not stuck
      // on "Securing your connection…" while waiting for the peer's envelope.
      // The initiator will also encrypt and send the key to the peer; the
      // non-initiator's locally-generated key will be replaced once the peer's
      // encrypted session key envelope arrives (handled in handleEnvelope).
      if (!storedKey) {
        await ensureSessionKey();
      }

      const targetPeerId = peerIdRef.current;
      const shouldRefreshHandshake = !storedKey || !peerPublicKeyRef.current;

      // Parallel handshake operations when possible
      const handshakePromises: Promise<void>[] = [];

      if (shouldRefreshHandshake) {
        handshakePromises.push(sendPublicKeyEnvelope(targetPeerId ?? undefined));
      }

      // If we already know the peer key from cache, complete handshake immediately
      // so first outbound text is not delayed waiting for another poll cycle.
      if (!storedKey && targetPeerId !== null && peerPublicKeyRef.current && isSessionKeyInitiator()) {
        handshakePromises.push(sendSessionKeyEnvelope(targetPeerId));
      }

      // Execute handshake operations in parallel
      if (handshakePromises.length > 0) {
        await Promise.all(handshakePromises);
      }

      isInitializedRef.current = true;
    } catch (err) {
      console.error('Failed to initialize encryption:', err);
      setError(extractApiErrorMessage(err, 'Failed to initialize secure chat'));
    }
  }, [
    ensureSessionKey,
    hasValidUserId,
    isSessionKeyInitiator,
    numericUserId,
    sendPublicKeyEnvelope,
    sendSessionKeyEnvelope,
    sessionId,
    userId,
  ]);

  const handleEnvelope = useCallback(
    async (message: RawMessage): Promise<boolean> => {
      const envelope = parseEnvelope(message.content);
      if (!envelope) {
        return false;
      }
      // Hide all E2E control envelopes from UI, even if malformed/legacy.
      const envelopeSessionId =
        typeof envelope.sessionId === 'string' ? envelope.sessionId : null;
      if (envelopeSessionId && String(envelopeSessionId) !== String(sessionId)) {
        return true;
      }

      if (!hasValidUserId) {
        return true;
      }

      const rawSenderFromApi = Number(message.sender_id);
      if (!Number.isFinite(rawSenderFromApi)) {
        return true;
      }
      const envelopeFrom = Number(envelope.from);
      if (!Number.isFinite(envelopeFrom)) {
        return true;
      }

      // DB row sender_id vs JSON envelope.from normally match; when anonymous sessions hide
      // the student's id on list payloads, APIs may expose sender_id=0 while preserving from.
      const trustedSenderId =
        envelopeFrom === rawSenderFromApi
          ? envelopeFrom
          : rawSenderFromApi === 0 && envelopeFrom > 0
            ? envelopeFrom
            : null;
      if (!trustedSenderId) {
        return true;
      }

      if (envelope.kind === 'pub') {
        if (trustedSenderId === numericUserId) {
          return true;
        }

        const envelopeTo = Number(envelope.to);
        if (Number.isFinite(envelopeTo) && envelopeTo !== numericUserId) {
          return true;
        }
        if (!envelope.publicKey) {
          return true;
        }

        try {
          peerIdRef.current = trustedSenderId;
          localStorage.setItem(
            getPeerKeyStorageKey(sessionId, trustedSenderId),
            envelope.publicKey
          );
          peerPublicKeyRef.current = await importPeerPublicKey(envelope.publicKey);
        } catch {
          // Corrupt or legacy key material — do not fail loading the whole thread.
          return true;
        }
        hasSentSessionKeyRef.current = false;

        if (!hasSentPublicKeyRef.current) {
          await runHandshakeOutbound(() => sendPublicKeyEnvelope(trustedSenderId));
        }

        const shouldInitiate = numericUserId < trustedSenderId;
        if (shouldInitiate) {
          await runHandshakeOutbound(() => sendSessionKeyEnvelope(trustedSenderId));
        } else {
          // Non-initiator: request session key via realtime if we don't have it
          if (!encryptionKeyRef.current && realtimeChannelRef.current) {
            void requestSessionKey();
          }
        }

        return true;
      }

      if (envelope.kind === 'key') {
        if (trustedSenderId === numericUserId) {
          return true;
        }

        const envelopeTo = Number(envelope.to);
        if (!Number.isFinite(envelopeTo) || envelopeTo !== numericUserId) {
          return true;
        }
        if (!envelope.encryptedSessionKey) {
          return true;
        }

        if (!deviceKeyPairRef.current) {
          return true;
        }

        let decryptedKey: string;
        try {
          decryptedKey = await decryptSessionKeyFromPeer(
            envelope.encryptedSessionKey,
            deviceKeyPairRef.current.privateKey
          );
        } catch {
          return true;
        }

        try {
          peerIdRef.current = trustedSenderId;
          sessionKeyStorageKeyRef.current = getSessionKeyStorageKey(
            sessionId,
            numericUserId,
            trustedSenderId
          );
          encryptionKeyRef.current = await importKey(decryptedKey);
          keyStringRef.current = decryptedKey;
          await persistSessionKey(sessionKeyStorageKeyRef.current, decryptedKey);
          runtimeEncryptionContexts.set(getRuntimeEncryptionContextKey(sessionId, userId), {
            key: encryptionKeyRef.current,
            keyString: decryptedKey,
            peerId: trustedSenderId,
            storageKey: sessionKeyStorageKeyRef.current,
            peerPublicKey: peerPublicKeyRef.current,
          });
          localStorage.setItem(getSessionPeerMarkerStorageKey(sessionId), String(trustedSenderId));
          logCryptoDebug('session key unwrapped from peer envelope', {
            sessionId,
            storageKeySuffix: trustedSenderId,
          });
          setIsEncryptionReady(true);
          setError(null);

          hasUndecryptedMessagesRef.current = true;
        } catch {
          return true;
        }

        return true;
      }

      return false;
    },
    [hasValidUserId, numericUserId, requestSessionKey, sendPublicKeyEnvelope, sendSessionKeyEnvelope, sessionId, userId]
  );

  const decryptMessages = useCallback(
    async (msgs: RawMessage[]): Promise<ChatMessage[]> => {
      const ordered = [...msgs].sort((a, b) => a.id - b.id);

      // Pass 1: apply every handshake envelope so session + peer keys exist before any decrypt.
      for (const message of ordered) {
        try {
          await handleEnvelope(message);
        } catch (err) {
          if (import.meta.env.DEV) {
            console.warn('[chat] Skipped message during envelope processing', message.id, err);
          }
        }
      }

      const decryptOneMessage = async (message: RawMessage): Promise<ChatMessage | null> => {
        if (parseEnvelope(message.content)) {
          return null;
        }

        if (message.is_encrypted) {
          // Some legacy rows were saved as plaintext with is_encrypted=1.
          // If payload is not valid ciphertext, treat it as unencrypted content.
          if (!isLikelyEncryptedPayload(message.content)) {
            return {
              ...message,
              is_encrypted: false,
              decryptedContent: message.content,
              e2eVisual: 'plain',
            };
          }

          if (!encryptionKeyRef.current) {
            logCryptoDebug('decrypt deferred: no AES key yet', { messageId: message.id });
            return {
              ...message,
              e2eVisual: 'awaiting_key',
              decryptedContent: undefined,
            };
          }

          const result = await decryptChatPayload(message.content, encryptionKeyRef.current);
          if (result.ok) {
            logCryptoDebug('decrypt ok', { messageId: message.id });
            return {
              ...message,
              decryptedContent: result.plaintext,
              e2eVisual: 'decrypted',
            };
          }

          // Handle error case - result is { ok: false; reason: ... }
          const errorResult = result as { ok: false; reason: 'invalid_base64' | 'payload_too_short' | 'decrypt_failed' };
          logCryptoDebug('decrypt failed', { messageId: message.id, reason: errorResult.reason });
          const e2eVisual: E2EVisualState =
            errorResult.reason === 'invalid_base64' || errorResult.reason === 'payload_too_short'
              ? 'payload_invalid'
              : 'needs_resync';
          return {
            ...message,
            e2eVisual,
            decryptedContent: undefined,
          };
        }

        return {
          ...message,
          decryptedContent: message.content,
          e2eVisual: 'plain',
        };
      };

      const visibleMessages: ChatMessage[] = [];
      const visibleRawMessages: RawMessage[] = [];

      for (const msg of ordered) {
        if (!parseEnvelope(msg.content)) {
          visibleRawMessages.push(msg);
        }
      }

      for (let i = 0; i < visibleRawMessages.length; i += DECRYPT_BATCH_SIZE) {
        const chunk = visibleRawMessages.slice(i, i + DECRYPT_BATCH_SIZE);
        const decryptedChunk = await Promise.all(chunk.map(decryptOneMessage));
        for (const message of decryptedChunk) {
          if (message) {
            visibleMessages.push(message);
          }
        }
      }

      hasUndecryptedMessagesRef.current = visibleMessages.some(messageNeedsKeyOrDecryptRetry);

      return visibleMessages;
    },
    [handleEnvelope]
  );

  const loadMessages = useCallback(
    async (forceInitial = false, signal?: AbortSignal) => {
      if (sessionExpiredRef.current) {
        detachRealtimeChannel();
        return;
      }
      if (!sessionId) {
        setIsLoading(false);
        setIsLoadingOlderMessages(false);
        setHasOlderMessages(false);
        return;
      }
      if (loadInFlightRef.current) {
        if (!forceInitial) return;
        // forceInitial overrides the guard — wait briefly for any concurrent fetch to release.
        await sleep(100);
        // If still in-flight after the brief yield, bail to avoid double work.
        if (loadInFlightRef.current) return;
      }

      loadInFlightRef.current = true;
      if (forceInitial) setIsLoading(true);

      try {
        const shouldReloadAll =
          forceInitial ||
          hasUndecryptedMessagesRef.current ||
          (pollCountRef.current % RECEIPT_FULL_SYNC_EVERY_POLLS === 0);
        const afterId = shouldReloadAll ? 0 : lastMessageIdRef.current;
        const limit = shouldReloadAll ? INITIAL_SYNC_BATCH_LIMIT : MESSAGE_BATCH_LIMIT;
        const fetchMessages = (requestLimit: number, timeoutMs: number) =>
          api.getMessages(sessionId, {
            after_id: afterId > 0 ? afterId : undefined,
            limit: requestLimit,
            timeout_ms: timeoutMs,
            mark_read: shouldReloadAll,
            signal,
          });

        const maxFetchAttempts = pollCountRef.current === 0 && shouldReloadAll ? 2 : 1;
        let data: RawMessage[] = [];

        for (let attempt = 0; attempt < maxFetchAttempts; attempt++) {
          try {
            try {
              data = (await fetchMessages(limit, MESSAGE_POLL_TIMEOUT_MS)) as RawMessage[];
            } catch (err) {
              if (!isTimeoutError(err)) {
                throw err;
              }
              data = (await fetchMessages(MESSAGE_RETRY_BATCH_LIMIT, MESSAGE_POLL_RETRY_TIMEOUT_MS)) as RawMessage[];
            }
            break;
          } catch (err) {
            if (attempt < maxFetchAttempts - 1) {
              await sleep(400 * (attempt + 1));
              continue;
            }
            throw err;
          }
        }

        const rawMessages = normalizeMessagePayload(data);
        if (rawMessages.length > 0) {
          void savePreloadedSessionMessages(sessionId, rawMessages, {
            ownerUserId: userId,
            keyScope: sessionKeyStorageKeyRef.current,
          });
        }
        if (rawMessages.length > 0) {
          const maxId = rawMessages.reduce((max, msg) => Math.max(max, msg.id), lastMessageIdRef.current);
          lastMessageIdRef.current = maxId;
        }

        if (
          !shouldReloadAll &&
          rawMessages.some(
            (msg) =>
              Number(msg.recipient_id) === numericUserId &&
              msg.seen_at == null &&
              !parseEnvelope(String(msg.content || ''))
          )
        ) {
          void api.markSessionInboundRead(sessionId, { timeout_ms: 5000 }).catch(() => {
            setTimeout(() => {
              void api.markSessionInboundRead(sessionId, { timeout_ms: 8000 }).catch(() => {});
            }, 2000);
          });
        }

        if (shouldReloadAll) {
          if (rawMessages.length > 0) {
            oldestMessageIdRef.current = rawMessages.reduce(
              (min, msg) => Math.min(min, msg.id),
              Number.MAX_SAFE_INTEGER
            );
          } else {
            oldestMessageIdRef.current = 0;
          }

          setHasOlderMessages(
            oldestMessageIdRef.current > 0 &&
            rawMessages.length >= limit
          );
        }

        const decryptedMessages = await decryptMessages(rawMessages);

        if (shouldReloadAll) {
          const refreshedMessageIds = new Set<number>();
          let refreshedMinId = Number.POSITIVE_INFINITY;
          let refreshedMaxId = 0;

          for (const msg of decryptedMessages) {
            refreshedMessageIds.add(msg.id);
            refreshedMinId = Math.min(refreshedMinId, msg.id);
            refreshedMaxId = Math.max(refreshedMaxId, msg.id);
          }

          setMessages((previous) => {
            const merged = new Map<number, ChatMessage>();

            if (decryptedMessages.length === 0) {
              for (const msg of previous) {
                if (isOptimisticMessageId(msg.id)) {
                  merged.set(msg.id, msg);
                }
              }
            } else {
              for (const msg of previous) {
                if (isOptimisticMessageId(msg.id)) {
                  merged.set(msg.id, msg);
                  continue;
                }

                // Keep messages outside the refreshed id window so older history
                // stays intact, but drop disappeared ids inside the refreshed slice.
                if (msg.id < refreshedMinId || msg.id > refreshedMaxId) {
                  merged.set(msg.id, msg);
                  continue;
                }

                if (refreshedMessageIds.has(msg.id)) {
                  merged.set(msg.id, msg);
                }
              }
            }

            for (const msg of decryptedMessages) {
              merged.set(msg.id, msg);
            }
            return sortAndTrimMessages(Array.from(merged.values()));
          });
        } else if (decryptedMessages.length > 0) {
          setMessages((previous) => {
            const merged = new Map<number, ChatMessage>();
            for (const msg of previous) merged.set(msg.id, msg);
            for (const msg of decryptedMessages) merged.set(msg.id, msg);
            return sortAndTrimMessages(Array.from(merged.values()));
          });
        }

        setError(null);
        pollCountRef.current += 1;
      } catch (err: any) {
        const status = err?.response?.status ?? err?.status ?? 0;
        if (status === 410) {
          sessionExpiredRef.current = true;
          setSessionExpired(true);
          markSessionAsExpired(sessionId);
          detachRealtimeChannel(); // ← ensure this is here
          setIsLoading(false);
          // Clear ALL pending timers so nothing retries
          if (pollingTimeoutRef.current !== null) {
            window.clearTimeout(pollingTimeoutRef.current);
            pollingTimeoutRef.current = null;
          }
          if (typingPollTimeoutRef.current !== null) {
            window.clearTimeout(typingPollTimeoutRef.current);
            typingPollTimeoutRef.current = null;
          }
          if (realtimeSyncTimeoutRef.current !== null) {
            window.clearTimeout(realtimeSyncTimeoutRef.current);
            realtimeSyncTimeoutRef.current = null;
          }
          if (peerTypingTimeoutRef.current !== null) {
            window.clearTimeout(peerTypingTimeoutRef.current);
            peerTypingTimeoutRef.current = null;
          }
          return;
        }
        console.error('Failed to load messages:', err);
        if (messageCountRef.current === 0) {
          setError(extractApiErrorMessage(err, 'Failed to load messages'));
        }
      } finally {
        setIsLoading(false);
        loadInFlightRef.current = false;
      }
    },
    [decryptMessages, numericUserId, sessionId, userId, detachRealtimeChannel]
  );

  const loadOlderMessages = useCallback(
    async (opts?: { force?: boolean }): Promise<boolean> => {
      if (!sessionId) return false;
      if (loadInFlightRef.current || loadOlderInFlightRef.current) return false;

      const forced = Boolean(opts?.force);
      if (!forced && (!hasOlderMessagesRef.current || oldestMessageIdRef.current <= 0)) {
        return false;
      }
      if (forced && oldestMessageIdRef.current <= 0) {
        return false;
      }

      loadOlderInFlightRef.current = true;
      setIsLoadingOlderMessages(true);

      try {
        const beforeId = oldestMessageIdRef.current;
        const fetchOlder = (timeoutMs: number, limit: number) =>
          api.getMessages(sessionId, {
            before_id: beforeId,
            limit,
            timeout_ms: timeoutMs,
          });

        let data: RawMessage[];
        try {
          data = (await fetchOlder(MESSAGE_POLL_TIMEOUT_MS, OLDER_MESSAGE_BATCH_LIMIT)) as RawMessage[];
        } catch (err) {
          if (!isTimeoutError(err)) {
            throw err;
          }

          data = (await fetchOlder(MESSAGE_POLL_RETRY_TIMEOUT_MS, MESSAGE_RETRY_BATCH_LIMIT)) as RawMessage[];
        }

        const rawOlder = normalizeMessagePayload(data);
        if (rawOlder.length === 0) {
          setHasOlderMessages(false);
          hasOlderMessagesRef.current = false;
          return false;
        }

        const nextOldestId = rawOlder.reduce(
          (min, msg) => Math.min(min, msg.id),
          Number.MAX_SAFE_INTEGER
        );
        oldestMessageIdRef.current = nextOldestId;
        const nextHasOlder = rawOlder.length >= OLDER_MESSAGE_BATCH_LIMIT && nextOldestId > 0;
        setHasOlderMessages(nextHasOlder);
        hasOlderMessagesRef.current = nextHasOlder;

        const decryptedOlder = await decryptMessages(rawOlder);
        if (decryptedOlder.length > 0) {
          setMessages((previous) => {
            const merged = new Map<number, ChatMessage>();
            for (const msg of previous) merged.set(msg.id, msg);
            for (const msg of decryptedOlder) {
              if (!merged.has(msg.id) || !isOptimisticMessageId(msg.id)) {
                merged.set(msg.id, msg);
              }
            }
            return sortAndTrimMessages(Array.from(merged.values()));
          });
        }

        setError(null);
        return true;
      } catch (err) {
        console.error('Failed to load older messages:', err);
        return false;
      } finally {
        setIsLoadingOlderMessages(false);
        loadOlderInFlightRef.current = false;
      }
    },
    [decryptMessages, sessionId]
  );

  /**
   * E2E `kind:key` envelopes are often at the start of a long thread, while the initial
   * poll only returns the latest page. Non-initiators would stay on "Securing…" forever.
   */
  const runHandshakeHistoryCatchup = useCallback(async () => {
    if (!sessionId || !isInitializedRef.current) return;
    if (encryptionKeyRef.current) return;
    if (isSessionKeyInitiator()) return;

    const MAX_PAGES = 25;
    const PAGE_SIZE = 50;

    let localOldestId = oldestMessageIdRef.current;

    for (let page = 0; page < MAX_PAGES; page++) {
      if (encryptionKeyRef.current || sessionExpiredRef.current) break;
      if (localOldestId <= 0) break;

      try {
        const data = (await api.getMessages(sessionId, {
          before_id: localOldestId,
          limit: PAGE_SIZE,
          timeout_ms: MESSAGE_POLL_TIMEOUT_MS,
        })) as RawMessage[];

        if (!data || data.length === 0) break;

        // Track the oldest id in this page for the next iteration.
        const pageMin = data.reduce((min, msg) => Math.min(min, msg.id), localOldestId);
        localOldestId = pageMin;

        let foundKey = false;
        for (const message of data) {
          const envelope = parseEnvelope(message.content);
          if (envelope && envelope.kind === 'key') {
            await handleEnvelope(message);
            foundKey = true;
            break;
          }
        }

        if (foundKey) break;
        if (data.length < PAGE_SIZE) break; // Reached the start of history.

        // Yield to the main thread to keep UI responsive
        await sleep(40);
      } catch (err) {
        console.warn(`[runHandshakeHistoryCatchup] page ${page} failed:`, err);
        break;
      }
    }

    if (encryptionKeyRef.current) {
      setIsEncryptionReady(true);
      setError(null);
    }
  }, [isSessionKeyInitiator, sessionId, handleEnvelope]);

  useEffect(() => {
    messageCountRef.current = messages.length;
  }, [messages.length]);

  // Key transition watcher: re-decrypt awaiting_key messages when key becomes available.
  // Uses a ref snapshot to avoid running on every message-array change.
  const prevKeyRef = useRef<CryptoKey | null>(null);
  const messagesRef = useRef<ChatMessage[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const currentKey = encryptionKeyRef.current;
    const prevKey = prevKeyRef.current;

    if (!prevKey && currentKey) {
      prevKeyRef.current = currentKey;

      // Mark as decrypting via the ref snapshot — avoids stale-closure issue.
      setMessages(prev => {
        const updated = prev.map(m =>
          m.e2eVisual === 'awaiting_key' ? { ...m, e2eVisual: 'decrypting' as const } : m
        );
        return updated.some((m, i) => m !== prev[i]) ? updated : prev;
      });

      const snapshot = messagesRef.current.filter(
        m => m.e2eVisual === 'awaiting_key' || m.e2eVisual === 'decrypting'
      );
      if (snapshot.length > 0) {
        const rawMessages: RawMessage[] = snapshot.map(m => ({
          id: m.id,
          content: m.content,
          sender_id: m.sender_id,
          recipient_id: m.recipient_id,
          created_at: m.created_at,
          message_type: m.message_type,
          file_url: m.file_url,
          is_encrypted: m.is_encrypted,
          seen_at: m.seen_at,
        }));
        void decryptMessages(rawMessages).then(decrypted => {
          if (decrypted.length > 0) {
            setMessages(prev => {
              const merged = new Map<number, ChatMessage>();
              for (const msg of prev) merged.set(msg.id, msg);
              for (const msg of decrypted) merged.set(msg.id, msg);
              return sortAndTrimMessages(Array.from(merged.values()));
            });
          }
        });
      }
    } else if (currentKey) {
      prevKeyRef.current = currentKey;
    }
    // Intentionally NOT watching `messages` here — we use messagesRef to avoid
    // re-running on every message change. The effect only needs to react to isEncryptionReady.
  }, [isEncryptionReady, decryptMessages]);

  const sendMessage = useCallback(async (content: string, fileUrl?: string, messageType: string = 'text') => {
    lastActiveAtRef.current = Date.now();

    if (!sessionId || !userId) {
      setError('Cannot send message: session is not initialized');
      return false;
    }

    const shouldUseOptimisticSend = messageType === 'text';
    const optimisticMessageId = shouldUseOptimisticSend ? createOptimisticMessageId() : null;

    // Render outgoing text immediately so UI feels instant even on slow networks.
    if (optimisticMessageId !== null) {
      const optimisticMessage: ChatMessage = {
        id: optimisticMessageId,
        content,
        sender_id: numericUserId,
        recipient_id: peerIdRef.current,
        created_at: new Date().toISOString(),
        seen_at: null,
        is_encrypted: true,
        message_type: messageType,
        file_url: fileUrl,
        decryptedContent: content,
        e2eVisual: 'decrypted',
      };

      setMessages((prev) => {
        const merged = new Map<number, ChatMessage>();
        for (const msg of prev) merged.set(msg.id, msg);
        merged.set(optimisticMessage.id, optimisticMessage);
        return sortAndTrimMessages(Array.from(merged.values()));
      });
    }

    const persistMessage = async () => {
      if (!encryptionKeyRef.current && isSessionKeyInitiator()) {
        await ensureSessionKey();
      }

      if (!encryptionKeyRef.current) {
        if (!hasSentPublicKeyRef.current) {
          await sendPublicKeyEnvelope(peerIdRef.current ?? undefined);
        }

        // Opportunistic key bootstrap (initiator only): once peer public key is known, send the session key.
        if (
          peerIdRef.current !== null &&
          peerPublicKeyRef.current &&
          isSessionKeyInitiator()
        ) {
          await sendSessionKeyEnvelope(peerIdRef.current);
        }
      }

      if (!encryptionKeyRef.current) {
        throw new Error('Secure channel is still initializing. Please retry in a few seconds.');
      }

      if (
        messageType === 'text' &&
        content.trim() !== ''
        && !isE2EHandshakeEnvelopeContent(content)
      ) {
        const crisisTerms = detectCrisisTermsInText(content);
        if (crisisTerms.length > 0) {
          void api.reportCrisisSignal(sessionId, crisisTerms).catch(() => {
            // Best-effort: encrypted message still sends; alerting is secondary.
          });
        }
      }

      const encryptedContent = await encryptMessage(content, encryptionKeyRef.current);

      const newMessage = await api.sendMessage(sessionId, {
        content: encryptedContent,
        is_encrypted: true,
        message_type: messageType,
        file_url: fileUrl,
      });

      const decrypted = { ...newMessage, decryptedContent: content, e2eVisual: 'decrypted' as const };
      lastMessageIdRef.current = Math.max(lastMessageIdRef.current, newMessage.id || 0);
      setMessages((prev) => {
        const merged = new Map<number, ChatMessage>();
        for (const msg of prev) {
          if (optimisticMessageId !== null && msg.id === optimisticMessageId) continue;
          merged.set(msg.id, msg);
        }
        merged.set(decrypted.id, decrypted);
        return sortAndTrimMessages(Array.from(merged.values()));
      });
      setError(null);
      void emitRealtimeSyncHint();
    };

    if (optimisticMessageId !== null) {
      notifyTyping(false);
      void persistMessage().catch((err) => {
        console.error('Failed to send message:', err);
        setMessages((prev) => prev.filter((msg) => msg.id !== optimisticMessageId));
        setError(extractApiErrorMessage(err, 'Failed to send message'));
      });
      return true;
    }

    try {
      await persistMessage();
      notifyTyping(false);
      return true;
    } catch (err) {
      console.error('Failed to send message:', err);
      setError(extractApiErrorMessage(err, 'Failed to send message'));
      return false;
    }
  }, [
    emitRealtimeSyncHint,
    ensureSessionKey,
    isSessionKeyInitiator,
    notifyTyping,
    numericUserId,
    sendPublicKeyEnvelope,
    sendSessionKeyEnvelope,
    sessionId,
    userId,
  ]);

  const deleteMessage = useCallback(
    async (messageId: number) => {
      if (!sessionId || !hasValidUserId) {
        setError('Cannot delete message: session is not initialized');
        return false;
      }

      const normalizedMessageId = Number(messageId);
      if (!Number.isInteger(normalizedMessageId) || normalizedMessageId <= 0) {
        setError('Cannot delete message: invalid message identifier');
        return false;
      }

      let removedMessage: ChatMessage | null = null;
      setMessages((previous) => {
        const existing = previous.find((msg) => msg.id === normalizedMessageId);
        if (!existing) {
          return previous;
        }

        removedMessage = existing;
        return previous.filter((msg) => msg.id !== normalizedMessageId);
      });

      try {
        await api.deleteMessage(sessionId, normalizedMessageId);
        removeMessageFromState(normalizedMessageId);
        setError(null);
        void emitRealtimeDeletionHint(normalizedMessageId);
        void emitRealtimeSyncHint();
        return true;
      } catch (err) {
        if (removedMessage) {
          setMessages((previous) => {
            if (previous.some((msg) => msg.id === normalizedMessageId)) {
              return previous;
            }
            return sortAndTrimMessages([...previous, removedMessage as ChatMessage]);
          });
        }
        setError(extractApiErrorMessage(err, 'Failed to delete message'));
        return false;
      }
    },
    [
      emitRealtimeDeletionHint,
      emitRealtimeSyncHint,
      hasValidUserId,
      removeMessageFromState,
      sessionId,
    ]
  );

  const registerServerMessage = useCallback(
    (message: ChatMessage | null | undefined) => {
      if (!message) {
        return;
      }

      const normalizedMessage = normalizeExternalMessage(message);
      if (!Number.isInteger(normalizedMessage.id) || normalizedMessage.id <= 0) {
        return;
      }

      lastMessageIdRef.current = Math.max(lastMessageIdRef.current, normalizedMessage.id);
      if (oldestMessageIdRef.current <= 0) {
        oldestMessageIdRef.current = normalizedMessage.id;
      } else {
        oldestMessageIdRef.current = Math.min(oldestMessageIdRef.current, normalizedMessage.id);
      }

      setMessages((previous) => {
        const merged = new Map<number, ChatMessage>();
        for (const existing of previous) {
          merged.set(existing.id, existing);
        }
        merged.set(normalizedMessage.id, normalizedMessage);
        return sortAndTrimMessages(Array.from(merged.values()));
      });

      setError(null);
      void emitRealtimeSyncHint();
    },
    [emitRealtimeSyncHint]
  );

  useEffect(() => {
    const hasRealtimeConfig = Boolean(
      import.meta.env.VITE_SUPABASE_URL &&
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
    );

    if (!sessionId || !hasValidUserId || !hasRealtimeConfig) {
      detachRealtimeChannel();
      return;
    }

    detachRealtimeChannel();
    let isDisposed = false;

    const setupRealtimeSync = async () => {
      if (sessionExpiredRef.current) return;
      try {
        const { supabase } = await import('@/integrations/supabase/client');
        if (isDisposed) return;

        const client = supabase as unknown as RealtimeClient;
        realtimeClientRef.current = client;
        const channel = client.channel(`chat-sync:${sessionId}`);
        realtimeChannelRef.current = channel;

        channel
          .on('broadcast', { event: 'message-updated' }, ({ payload }) => {
            const payloadSessionId = String(
              (payload as { sessionId?: unknown })?.sessionId ?? ''
            );
            if (payloadSessionId !== sessionId) {
              return;
            }

            const senderId = Number((payload as { senderId?: unknown })?.senderId ?? 0);
            if (Number.isFinite(senderId) && senderId === numericUserId) {
              return;
            }

            // Play notification sound for new message
            playMessageNotificationSound();

            // Show toast notification if document is hidden (user on another tab/dashboard)
            if (document.visibilityState === 'hidden') {
              const preview = String((payload as { preview?: unknown })?.preview ?? 'New message');
              toast.info('New Message', {
                description: preview.length > 80 ? preview.slice(0, 80) + '…' : preview,
                duration: 5000,
              });
            }

            if (realtimeSyncTimeoutRef.current !== null) {
              return;
            }

            if (sessionExpiredRef.current) return;
            realtimeSyncTimeoutRef.current = window.setTimeout(() => {
              realtimeSyncTimeoutRef.current = null;
              if (sessionExpiredRef.current) return; // session gone — don't retry
              if (document.visibilityState !== 'visible') return;
              void loadMessages(false);
            }, REALTIME_SYNC_DEBOUNCE_MS);
          })
          .on('broadcast', { event: 'message-deleted' }, ({ payload }) => {
            const payloadSessionId = String(
              (payload as { sessionId?: unknown })?.sessionId ?? ''
            );
            if (payloadSessionId !== sessionId) {
              return;
            }

            const senderId = Number((payload as { senderId?: unknown })?.senderId ?? 0);
            if (Number.isFinite(senderId) && senderId === numericUserId) {
              return;
            }

            const deletedMessageId = Number((payload as { messageId?: unknown })?.messageId ?? 0);
            if (!Number.isInteger(deletedMessageId) || deletedMessageId <= 0) {
              return;
            }

            removeMessageFromState(deletedMessageId);
            if (realtimeSyncTimeoutRef.current !== null) {
              return;
            }

            if (sessionExpiredRef.current) return;
            realtimeSyncTimeoutRef.current = window.setTimeout(() => {
              realtimeSyncTimeoutRef.current = null;
              if (sessionExpiredRef.current) return; // session gone — don't retry
              if (document.visibilityState !== 'visible') return;
              void loadMessages(true);
            }, REALTIME_SYNC_DEBOUNCE_MS);
          })
          .on('broadcast', { event: 'typing' }, ({ payload }) => {
            const payloadSessionId = String(
              (payload as { sessionId?: unknown })?.sessionId ?? ''
            );
            if (payloadSessionId !== sessionId) {
              return;
            }

            const senderId = Number((payload as { senderId?: unknown })?.senderId ?? 0);
            if (!Number.isFinite(senderId) || senderId === numericUserId) {
              return;
            }

            const peerIsTyping = (payload as { isTyping?: unknown })?.isTyping === true;
            applyPeerTypingState(peerIsTyping);
          })
          .on('broadcast', { event: 'request-session-key' }, ({ payload }) => {
            const payloadSessionId = String(
              (payload as { sessionId?: unknown })?.sessionId ?? ''
            );
            if (payloadSessionId !== sessionId) {
              return;
            }

            const senderId = Number((payload as { senderId?: unknown })?.senderId ?? 0);
            if (!Number.isFinite(senderId) || senderId === numericUserId) {
              return;
            }

            // If we're the initiator and have a session key, send it to the requester
            if (isSessionKeyInitiator() && encryptionKeyRef.current && keyStringRef.current && peerPublicKeyRef.current) {
              void sendSessionKeyEnvelope(senderId);
            }
          })
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              // Channel is ready - request session key if non-initiator and still needs it
              if (!isSessionKeyInitiator() && !encryptionKeyRef.current && peerIdRef.current) {
                void requestSessionKey();
              }
            }
          });
      } catch {
        // Realtime is optional for chat sync; polling remains the fallback.
      }
    };

    void setupRealtimeSync();

    return () => {
      isDisposed = true;
      detachRealtimeChannel();
    };
  }, [
    applyPeerTypingState,
    detachRealtimeChannel,
    hasValidUserId,
    isSessionKeyInitiator,
    loadMessages,
    numericUserId,
    removeMessageFromState,
    requestSessionKey,
    sendSessionKeyEnvelope,
    sessionId,
  ]);

  useEffect(() => {
    isPeerTypingRef.current = isPeerTyping;
  }, [isPeerTyping]);

  useEffect(() => {
    sessionExpiredRef.current = false;
    setSessionExpired(false);
    if (!sessionId) {
      if (pollingTimeoutRef.current !== null) {
        window.clearTimeout(pollingTimeoutRef.current);
        pollingTimeoutRef.current = null;
      }
      if (typingPollTimeoutRef.current !== null) {
        window.clearTimeout(typingPollTimeoutRef.current);
        typingPollTimeoutRef.current = null;
      }
      detachRealtimeChannel();
      encryptionKeyRef.current = null;
      keyStringRef.current = null;
      peerPublicKeyRef.current = null;
      peerIdRef.current = null;
      lastMessageIdRef.current = 0;
      oldestMessageIdRef.current = 0;
      pollCountRef.current = 0;
      isInitializedRef.current = false;
      hasSentPublicKeyRef.current = false;
      hasSentSessionKeyRef.current = false;
      hasUndecryptedMessagesRef.current = false;
      loadOlderInFlightRef.current = false;
      localTypingStateRef.current = false;
      localTypingLastSentAtRef.current = 0;
      sessionKeyStorageKeyRef.current = null;
      clearDecryptPlaintextCache();
      setMessages([]);
      setIsLoading(false);
      setIsLoadingOlderMessages(false);
      setHasOlderMessages(false);
      setIsEncryptionReady(false);
      setIsPeerTyping(false);
      setError(null);
      return;
    }

    const runtimeContext = runtimeEncryptionContexts.get(
      getRuntimeEncryptionContextKey(sessionId, userId)
    );
    if (runtimeContext) {
      encryptionKeyRef.current = runtimeContext.key;
      keyStringRef.current = runtimeContext.keyString;
      peerPublicKeyRef.current = runtimeContext.peerPublicKey;
      peerIdRef.current = runtimeContext.peerId;
      sessionKeyStorageKeyRef.current = runtimeContext.storageKey;
    } else {
      encryptionKeyRef.current = null;
      keyStringRef.current = null;
      peerPublicKeyRef.current = null;
      peerIdRef.current = null;
      sessionKeyStorageKeyRef.current = null;
    }
    lastMessageIdRef.current = 0;
    oldestMessageIdRef.current = 0;
    pollCountRef.current = 0;
    isInitializedRef.current = false;
    hasSentPublicKeyRef.current = false;
    hasSentSessionKeyRef.current = false;
    hasUndecryptedMessagesRef.current = false;
    loadOlderInFlightRef.current = false;
    localTypingStateRef.current = false;
    localTypingLastSentAtRef.current = 0;
    clearDecryptPlaintextCache();
    setMessages([]);
    setIsLoading(true);
    setIsLoadingOlderMessages(false);
    setHasOlderMessages(true);
    setIsEncryptionReady(Boolean(runtimeContext));
    setIsPeerTyping(false);
    let isDisposed = false;

    if (pollingTimeoutRef.current !== null) {
      window.clearTimeout(pollingTimeoutRef.current);
      pollingTimeoutRef.current = null;
    }
    if (typingPollTimeoutRef.current !== null) {
      window.clearTimeout(typingPollTimeoutRef.current);
      typingPollTimeoutRef.current = null;
    }

    const onVisibilityOrFocus = () => {
      if (sessionExpiredRef.current) return; // ref — not stale state
      if (!isInitializedRef.current) return;
      if (document.visibilityState !== 'visible') return;
      void loadMessages(false);
      void refreshPeerTypingStatus();
    };

    const scheduleNextPoll = () => {
      if (sessionExpiredRef.current) return; // ref — never stale
      if (isDisposed || !isInitializedRef.current) {
        if (!isDisposed && !sessionExpiredRef.current) {
          pollingTimeoutRef.current = window.setTimeout(scheduleNextPoll, 2000);
        }
        return;
      }
      const now = Date.now();
      const shouldBoost = (now - lastActiveAtRef.current < POLLING_BOOST_DURATION_MS) || isPeerTypingRef.current;
      const nextInterval = shouldBoost ? ACTIVE_POLLING_INTERVAL_MS : DEFAULT_POLLING_INTERVAL_MS;

      if (pollingTimeoutRef.current !== null) {
        window.clearTimeout(pollingTimeoutRef.current);
        pollingTimeoutRef.current = null;
      }

      pollingTimeoutRef.current = window.setTimeout(async () => {
        if (sessionExpiredRef.current) {
          detachRealtimeChannel();
          return;
        }
        if (isDisposed || !isInitializedRef.current) return;
        if (document.visibilityState === 'visible') {
          await loadMessages(false);
        }
        if (!sessionExpiredRef.current && !isDisposed) {
          scheduleNextPoll();
        }
      }, nextInterval);
    };

    const scheduleTypingPoll = () => {
      if (sessionExpiredRef.current) return; // ref — never stale
      if (isDisposed || !isInitializedRef.current) {
        if (!isDisposed && !sessionExpiredRef.current) {
          typingPollTimeoutRef.current = window.setTimeout(scheduleTypingPoll, 2000);
        }
        return;
      }

      typingPollTimeoutRef.current = window.setTimeout(async () => {
        if (sessionExpiredRef.current) return; // check inside timer
        if (isDisposed || !isInitializedRef.current) return;

        if (document.visibilityState === 'visible') {
          await refreshPeerTypingStatus();
        }

        if (!sessionExpiredRef.current && !isDisposed) {
          scheduleTypingPoll();
        }
      }, TYPING_POLL_INTERVAL_MS);
    };

    const bootstrap = async (signal: AbortSignal) => {
      console.log('[bootstrap] start - sessionId:', sessionId, 'time:', Date.now());
      const bootstrapStartedAt = Date.now();
      let warmHydrateHit = false;

      // Fetch session once and reuse it for initializeEncryption — avoids a double round-trip.
      try {
        console.log(`[chat:${sessionId}] Starting bootstrap...`);

        const [sessionDetails, cachedMessages] = await Promise.all([
          api.getSession(sessionId, { minimal: true }).catch((e: any) => {
            if ((e?.response?.status ?? e?.status) === 410) return null;
            throw e;
          }),
          loadPreloadedSessionMessages(sessionId, {
            expectedOwnerUserId: userId,
            expectedKeyScope: sessionKeyStorageKeyRef.current,
          })
        ]);

        if (!sessionDetails || signal.aborted) {
          setIsLoading(false);
          setSessionExpired(true);
          sessionExpiredRef.current = true;
          return;
        }

        // Then pass sessionDetails to initializeEncryption
        // Reduced timeout for encryption init to ensure UI is unblocked faster.
        const encryptionTimeout = new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Encryption timeout')), 3000)
        );
        await Promise.race([
          initializeEncryption(signal, sessionDetails),
          encryptionTimeout,
        ]).catch(() => {
          // Encryption timed out — continue anyway, messages may show
          // awaiting_key state but UI is unblocked
          if (!isDisposed) setIsLoading(false);
        });
        // Even if encryption times out, continue loading messages.
        // They will show awaiting_key and decrypt when key arrives.
        if (!isDisposed && !signal.aborted) {
          setIsLoading(false);
        }

        // Force encryption ready if key already exists in runtime cache
        if (encryptionKeyRef.current && !isEncryptionReady) {
          setIsEncryptionReady(true);
          setError(null);
        }

        console.log('[bootstrap] init+cache done in:', Date.now() - bootstrapStartedAt, 'ms', 'cachedMessages:', cachedMessages?.length ?? 0);

        if (isDisposed || signal.aborted) return;

        setIsLoading(false); // ADD THIS — unblock UI immediately
        console.log('[bootstrap] UI unblocked at:', Date.now() - bootstrapStartedAt, 'ms');

        const normalizedCachedMessages = normalizeMessagePayload(cachedMessages);
        const cachedTyping = loadTypingSnapshot(sessionId, { expectedOwnerUserId: userId });
        if (!isDisposed && cachedTyping) {
          applyPeerTypingState(cachedTyping.isPeerTyping === true);
        }

        // Show UI immediately when cached messages are available
        if (normalizedCachedMessages.length > 0) {
          decryptMessages(normalizedCachedMessages).then((decryptedCached) => {
            if (!isDisposed && decryptedCached.length > 0) {
              warmHydrateHit = true;
              setMessages(decryptedCached);
              const maxId = decryptedCached.reduce((max, msg) => Math.max(max, msg.id), 0);
              const minId = decryptedCached.reduce((min, msg) => Math.min(min, msg.id), Number.MAX_SAFE_INTEGER);
              if (maxId > 0) lastMessageIdRef.current = maxId;
              if (Number.isFinite(minId) && minId !== Number.MAX_SAFE_INTEGER) {
                oldestMessageIdRef.current = minId;
              }
              console.log('[bootstrap] warm hydration rendered:', decryptedCached.length, 'messages');
            }
          });
        }
        recordWarmHydrateResult(warmHydrateHit);

        // Load fresh messages after both init and cached messages are done
        await loadMessages(true, signal);
        console.log('[bootstrap] loadMessages done at:', Date.now() - bootstrapStartedAt, 'ms');
        if (isDisposed) return;
        if (sessionExpiredRef.current) return;

        // Optimistic preload: fetch adjacent conversation history in the background
        const nextSessionId = getNextSessionId(sessionId);
        if (nextSessionId) {
          if (!isSessionExpired(nextSessionId)) {
            void api.getMessages(nextSessionId, {
              limit: 40,
              mark_read: false,
              timeout_ms: 5000,
            }).then(rawMessages => {
              if (rawMessages?.length) {
                void savePreloadedSessionMessages(nextSessionId, rawMessages, {
                  ownerUserId: userId,
                });
              }
            }).catch((err: any) => {
              const status = err?.response?.status ?? err?.status;
              if (status === 410) {
                markSessionAsExpired(nextSessionId);
                return null;
              }
              // All other errors ignored silently
              return null;
            });
          }
        }

        void runHandshakeHistoryCatchup().then(() => {
          if (!encryptionKeyRef.current && !isSessionKeyInitiator() && peerIdRef.current) {
            // Request key immediately and again after 2 seconds.
            void requestSessionKey();
            window.setTimeout(() => {
              if (!encryptionKeyRef.current) void requestSessionKey();
            }, 2000);
          }
        });

        await refreshPeerTypingStatus();
        scheduleNextPoll();
        scheduleTypingPoll();
        recordChatOpenLatency(Date.now() - bootstrapStartedAt, sessionId);
      } catch (err: any) {
        const status = err?.response?.status ?? err?.status;
        if (status === 410) {
          sessionExpiredRef.current = true; // ref first — stops all in-flight reschedules
          setSessionExpired(true);
          detachRealtimeChannel();
          setIsLoading(false);
          if (pollingTimeoutRef.current !== null) {
            window.clearTimeout(pollingTimeoutRef.current);
            pollingTimeoutRef.current = null;
          }
          if (typingPollTimeoutRef.current !== null) {
            window.clearTimeout(typingPollTimeoutRef.current);
            typingPollTimeoutRef.current = null;
          }
          return;
        }

        if (!isDisposed) {
          console.error('[useEncryptedChat] Bootstrap failed:', err);
          const errorMessage = extractApiErrorMessage(err, 'Failed to load conversation');
          setError(errorMessage);
          setIsLoading(false);
        }
      }
    };

    const controller = new AbortController();
    const loadingTimeoutId = window.setTimeout(() => {
      if (!isDisposed && (isInitializedRef.current === false || loadInFlightRef.current)) {
        console.warn('[useEncryptedChat] Loading timeout - recovering state');
        setError('Conversation is taking a bit longer to load...');
        setIsLoading(false);
        loadInFlightRef.current = false;
      }
    }, 12000);

    if (bootstrapRunningRef.current) return;
    bootstrapRunningRef.current = true;

    void bootstrap(controller.signal).finally(() => {
      window.clearTimeout(loadingTimeoutId);
    });
    window.addEventListener('focus', onVisibilityOrFocus);
    document.addEventListener('visibilitychange', onVisibilityOrFocus);

    // Periodic session key request for non-initiators (every 5 seconds, max 12 attempts = 1 minute)
    let sessionKeyRequestAttempts = 0;
    const maxSessionKeyRequestAttempts = 12;
    const sessionKeyRequestInterval = window.setInterval(() => {
      if (encryptionKeyRef.current || isSessionKeyInitiator() || sessionKeyRequestAttempts >= maxSessionKeyRequestAttempts || sessionExpiredRef.current) {
        window.clearInterval(sessionKeyRequestInterval);
        return;
      }
      sessionKeyRequestAttempts++;
      void requestSessionKey();
    }, 5000);

    return () => {
      isDisposed = true;
      window.clearInterval(sessionKeyRequestInterval);
      if (pollingTimeoutRef.current !== null) {
        window.clearTimeout(pollingTimeoutRef.current);
        pollingTimeoutRef.current = null;
      }
      if (typingPollTimeoutRef.current !== null) {
        window.clearTimeout(typingPollTimeoutRef.current);
        typingPollTimeoutRef.current = null;
      }
      window.removeEventListener('focus', onVisibilityOrFocus);
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);
      isInitializedRef.current = false;
      loadInFlightRef.current = false;
      loadOlderInFlightRef.current = false;
    };
  }, [
    applyPeerTypingState,
    decryptMessages,
    detachRealtimeChannel,
    hasValidUserId,
    initializeEncryption,
    isSessionKeyInitiator,
    loadMessages,
    refreshPeerTypingStatus,
    requestSessionKey,
    runHandshakeHistoryCatchup,
    sessionId,
    userId,
    getNextSessionId,
    ]);

  const refreshMessages = useCallback(
    async (opts?: { forceFull?: boolean }) => {
      if (!sessionId) return;
      await loadMessages(Boolean(opts?.forceFull));
      if (opts?.forceFull) {
        await runHandshakeHistoryCatchup();
      }
      if (encryptionKeyRef.current) {
        setIsEncryptionReady(true);
        setError(null);
      }
    },
    [loadMessages, runHandshakeHistoryCatchup, sessionId]
  );

  const nudgeEncryptionHandshake = useCallback(async () => {
    await refreshMessages({ forceFull: true });
  }, [refreshMessages]);

  const getEncryptionKey = useCallback(() => encryptionKeyRef.current, []);
  const getKeyForSharing = useCallback(() => keyStringRef.current, []);

  const retryEncryption = useCallback(async () => {
    if (!sessionId || !hasValidUserId) return;
    setError(null);

    // Clear all stored keys for this session.
    const peer = peerIdRef.current;
    if (peer !== null && Number.isFinite(peer) && peer > 0) {
      await deletePersistedSessionKey(getSessionKeyStorageKey(sessionId, numericUserId, peer));
    }
    await deletePersistedSessionKey(getLegacySessionKeyStorageKey(sessionId));
    runtimeEncryptionContexts.delete(getRuntimeEncryptionContextKey(sessionId, userId));

    // Also clear peer public key so a fresh public-key envelope is sent.
    localStorage.removeItem(getPeerKeyStorageKey(sessionId, numericUserId));
    if (peerIdRef.current) localStorage.removeItem(getPeerKeyStorageKey(sessionId, peerIdRef.current));
    hasSentPublicKeyRef.current = false;
    hasSentSessionKeyRef.current = false;

    encryptionKeyRef.current = null;
    keyStringRef.current = null;
    peerPublicKeyRef.current = null;
    sessionKeyStorageKeyRef.current = null;
    hasSentPublicKeyRef.current = false;
    hasSentSessionKeyRef.current = false;
    setIsEncryptionReady(false);

    isInitializedRef.current = false;
    await initializeEncryption();
    if (isInitializedRef.current) {
      await loadMessages(true);
      void runHandshakeHistoryCatchup();

      // If non-initiator still doesn't have encryption key, request it from initiator
      if (!encryptionKeyRef.current && !isSessionKeyInitiator() && peerIdRef.current) {
        void requestSessionKey();
      }
    }
  }, [
    hasValidUserId,
    initializeEncryption,
    isSessionKeyInitiator,
    loadMessages,
    numericUserId,
    requestSessionKey,
    runHandshakeHistoryCatchup,
    sessionId,
    userId,
  ]);

  return {
    messages,
    isLoading,
    isLoadingOlderMessages,
    hasOlderMessages,
    isEncryptionReady,
    isPeerTyping,
    error,
    sessionExpired,
    sendMessage,
    deleteMessage,
    notifyTyping,
    loadOlderMessages,
    getKeyForSharing,
    getEncryptionKey,
    refreshMessages,
    nudgeEncryptionHandshake,
    registerServerMessage,
    retryEncryption,
  };
};
