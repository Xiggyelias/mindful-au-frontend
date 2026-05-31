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
  const matchedStatus = message.match(/\b(404|410)\b/);
  return matchedStatus ? Number(matchedStatus[1]) : null;
};

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
  const sessionIdRef = useRef<string | number | undefined>(sessionId);
  const enabledRef = useRef(enabled);
  const onErrorRef = useRef(onError);
  const onSuccessRef = useRef(onSuccess);

  sessionIdRef.current = sessionId;
  enabledRef.current = enabled;
  onErrorRef.current = onError;
  onSuccessRef.current = onSuccess;

  const clearTouchInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const touchSession = useCallback(async () => {
    const currentSessionId = sessionIdRef.current;
    const currentSessionKey = String(currentSessionId || '').trim();
    if (!currentSessionKey || !enabledRef.current || isSessionExpired(currentSessionKey)) return;

    try {
      // Add small jitter (0-5s) to prevent thundering herd from multiple clients
      const jitter = Math.random() * 5000;
      await new Promise(resolve => setTimeout(resolve, jitter));

      if (
        String(sessionIdRef.current || '').trim() !== currentSessionKey ||
        !enabledRef.current ||
        isSessionExpired(currentSessionKey)
      ) {
        return;
      }

      const response = await api.client.post(
        `/sessions/${currentSessionKey}/touch`,
        {},
        { timeout: 5000 } // 5 second timeout for keep-alive
      );

      if (response.data?.ok) {
        lastTouchTimeRef.current = Date.now();
        onSuccessRef.current?.();
      } else {
        onErrorRef.current?.(new Error(`Keep-alive failed: ${response.data?.message || 'Unknown error'}`));
      }
    } catch (error) {
      // Silently handle network errors for keep-alive (not critical)
      const message = error instanceof Error ? error.message : String(error);
      console.debug('[SessionKeepAlive] Touch failed:', message);

      const status = getErrorStatus(error);
      if (status === 410 || status === 404) {
        const wasAlreadyExpired = isSessionExpired(currentSessionKey);
        markSessionAsExpired(currentSessionKey);
        clearTouchInterval();

        if (!wasAlreadyExpired) {
          onErrorRef.current?.(error instanceof Error ? error : new Error(message));
        }
      }
    }
  }, [clearTouchInterval]);

  useEffect(() => {
    if (!sessionId || !enabled || isSessionExpired(String(sessionId))) {
      clearTouchInterval();
      return;
    }

    // Initial touch immediately
    touchSession();

    // Set up recurring touches
    intervalRef.current = setInterval(touchSession, intervalMs);

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
