import { useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api';

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

  const touchSession = useCallback(async () => {
    if (!sessionId || !enabled) return;

    try {
      // Add small jitter (0-5s) to prevent thundering herd from multiple clients
      const jitter = Math.random() * 5000;
      await new Promise(resolve => setTimeout(resolve, jitter));

      const response = await api.client.post(
        `/sessions/${sessionId}/touch`,
        {},
        { timeout: 5000 } // 5 second timeout for keep-alive
      );

      if (response.data?.ok) {
        lastTouchTimeRef.current = Date.now();
        onSuccess?.();
      } else {
        onError?.(new Error(`Keep-alive failed: ${response.data?.message || 'Unknown error'}`));
      }
    } catch (error) {
      // Silently handle network errors for keep-alive (not critical)
      const message = error instanceof Error ? error.message : String(error);
      console.debug('[SessionKeepAlive] Touch failed:', message);
      
      // Only call onError for critical failures (session expired 410, not found 404)
      if (error instanceof Error && (message.includes('410') || message.includes('404'))) {
        onError?.(error);
      }
    }
  }, [sessionId, enabled, onSuccess, onError]);

  useEffect(() => {
    if (!sessionId || !enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Initial touch immediately
    touchSession();

    // Set up recurring touches
    intervalRef.current = setInterval(touchSession, intervalMs);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [sessionId, enabled, intervalMs, touchSession]);

  return {
    /** Time of last successful keep-alive touch (milliseconds since epoch) */
    lastTouchTime: lastTouchTimeRef.current,
    
    /** Manually trigger a keep-alive touch */
    touchNow: touchSession,
  };
};
