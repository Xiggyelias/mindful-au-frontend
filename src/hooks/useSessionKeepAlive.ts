import { useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api';
import { isSessionExpired, markSessionAsExpired } from '@/hooks/useChatSession';

interface UseSessionKeepAliveOptions {
  /** Session ID to keep alive */
  sessionId?: string | number;
  
  /** Interval in milliseconds between keep-alive pings (default: 30 minutes) */
  intervalMs?: number;
  
  /** Whether to enable keep-alive (default: true) */
  enabled?: boolean;
  
  /** Called if keep-alive fails (network error, session expired, etc.) */
  onError?: (error: Error) => void;
  
  /** Called when keep-alive succeeds */
  onSuccess?: () => void;
}

const getErrorStatus = (error: unknown): number | null => {
  const rawStatus =
    (error as { response?: { status?: unknown }; status?: unknown })?.response?.status ??
    (error as { status?: unknown })?.status;
  const status = Number(rawStatus);
  if (Number.isFinite(status)) return status;

  const message = error instanceof Error ? error.message : String(error);
  const matchedStatus = message.match(/\b(404|410|429)\b/);
  return matchedStatus ? Number(matchedStatus[1]) : null;
};

const MIN_TOUCH_GAP_MS = 60 * 1000;
const NETWORK_BACKOFF_MS = 30 * 1000;
const RATE_LIMIT_BACKOFF_MS = 90 * 1000;
const TOUCH_JITTER_MS = 2500;

/**
 * Keep a chat session alive by periodically pinging the backend.
 * Prevents session expiration due to inactivity while user is active.
 * 
 * Usage:
 * ```tsx
 * useSessionKeepAlive({
 *   sessionId: activeSessionId,
 *   intervalMs: 30 * 60 * 1000,  // 30 minutes
 *   enabled: Boolean(activeSessionId),
 *   onError: (err) => console.error('Keep-alive failed:', err),
 * });
 * ```
 */
export const useSessionKeepAlive = ({
  sessionId,
  intervalMs = 30 * 60 * 1000,  // 30 minutes default
  enabled = true,
  onError,
  onSuccess,
}: UseSessionKeepAliveOptions) => {
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastTouchTimeRef = useRef<number>(0);
  const lastTouchBySessionRef = useRef<Map<string, number>>(new Map());
  const backoffUntilBySessionRef = useRef<Map<string, number>>(new Map());
  const touchInFlightRef = useRef<Promise<void> | null>(null);
  const sessionIdRef = useRef<string | number | undefined>(sessionId);
  const enabledRef = useRef(enabled);
  const intervalMsRef = useRef(intervalMs);
  const onErrorRef = useRef(onError);
  const onSuccessRef = useRef(onSuccess);

  sessionIdRef.current = sessionId;
  enabledRef.current = enabled;
  intervalMsRef.current = intervalMs;
  onErrorRef.current = onError;
  onSuccessRef.current = onSuccess;

  const clearTouchInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const touchSession = useCallback(async (options?: { force?: boolean }) => {
    const currentSessionId = sessionIdRef.current;
    const currentSessionKey = String(currentSessionId || '').trim();
    if (!currentSessionKey || !enabledRef.current || isSessionExpired(currentSessionKey)) return;
    if (touchInFlightRef.current) {
      await touchInFlightRef.current;
      return;
    }

    const now = Date.now();
    const backoffUntil = backoffUntilBySessionRef.current.get(currentSessionKey) || 0;
    if (now < backoffUntil) return;

    const lastTouchAt = lastTouchBySessionRef.current.get(currentSessionKey) || 0;
    const configuredInterval = Math.max(MIN_TOUCH_GAP_MS, Number(intervalMsRef.current || 0));
    const minTouchGap = Math.min(configuredInterval, Math.max(MIN_TOUCH_GAP_MS, configuredInterval / 3));
    if (!options?.force && now - lastTouchAt < minTouchGap) return;

    const run = (async () => {
      // Small jitter prevents multiple tabs/dev StrictMode mounts from touching at once.
      const jitter = Math.random() * TOUCH_JITTER_MS;
      await new Promise(resolve => setTimeout(resolve, jitter));

      if (
        String(sessionIdRef.current || '').trim() !== currentSessionKey ||
        !enabledRef.current ||
        isSessionExpired(currentSessionKey)
      ) {
        return;
      }

      try {
        const response = await api.touchSession(currentSessionKey, { timeout_ms: 5000 });

        if (response.data?.ok) {
          const touchedAt = Date.now();
          lastTouchTimeRef.current = touchedAt;
          lastTouchBySessionRef.current.set(currentSessionKey, touchedAt);
          backoffUntilBySessionRef.current.delete(currentSessionKey);
          onSuccessRef.current?.();
        } else {
          onErrorRef.current?.(new Error(`Keep-alive failed: ${response.data?.message || 'Unknown error'}`));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (import.meta.env.DEV) console.debug('[SessionKeepAlive] Touch failed:', message);

        const status = getErrorStatus(error);
        if (status === 410 || status === 404) {
          const wasAlreadyExpired = isSessionExpired(currentSessionKey);
          markSessionAsExpired(currentSessionKey);
          clearTouchInterval();

          if (!wasAlreadyExpired) {
            onErrorRef.current?.(error instanceof Error ? error : new Error(message));
          }
          return;
        }

        if (status === 429) {
          backoffUntilBySessionRef.current.set(currentSessionKey, Date.now() + RATE_LIMIT_BACKOFF_MS);
          return;
        }

        backoffUntilBySessionRef.current.set(currentSessionKey, Date.now() + NETWORK_BACKOFF_MS);
      }
    })();

    touchInFlightRef.current = run;
    try {
      await run;
    } finally {
      if (touchInFlightRef.current === run) {
        touchInFlightRef.current = null;
      }
    }
  }, [clearTouchInterval]);

  useEffect(() => {
    clearTouchInterval();

    if (!sessionId || !enabled || isSessionExpired(String(sessionId))) {
      return;
    }

    void touchSession();

    intervalRef.current = setInterval(() => {
      void touchSession({ force: true });
    }, Math.max(MIN_TOUCH_GAP_MS, intervalMs));

    return () => {
      clearTouchInterval();
    };
  }, [sessionId, enabled, intervalMs, touchSession, clearTouchInterval]);

  return {
    /** Time of last successful keep-alive touch (milliseconds since epoch) */
    lastTouchTime: lastTouchTimeRef.current,
    
    /** Manually trigger a keep-alive touch */
    touchNow: touchSession,
  };
};
