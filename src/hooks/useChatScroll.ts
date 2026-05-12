import { useRef, useState, useCallback, useEffect } from 'react';

/**
 * Per-session scroll position preservation.
 *
 * Stores the last scrollTop for each session ID. When switching sessions:
 *   - Saves the outgoing session's scrollTop
 *   - Restores the incoming session's saved position (or scrolls to bottom on first open)
 *
 * Auto-scrolls to bottom only when:
 *   - The session is opened for the first time (no saved position)
 *   - A new message arrives AND the user is near the bottom
 */

const NEAR_BOTTOM_THRESHOLD = 150;

export function useChatScroll(
  messageCount: number,
  options: {
    threshold?: number;
    smooth?: boolean;
    sessionId?: string | null;
  } = {}
) {
  const { threshold = NEAR_BOTTOM_THRESHOLD, smooth = true, sessionId } = options;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const prevCountRef = useRef(0);
  const prevSessionIdRef = useRef<string | null>(null);
  const userHasScrolledUpRef = useRef(false);

  /** Map of sessionId → saved scrollTop. Module-scope so it persists across re-renders. */
  const scrollPositions = useRef<Map<string, number>>(new Map());

  // ── Session switch: save old position, restore new one ───────────────────
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const prevId = prevSessionIdRef.current;
    const nextId = sessionId ?? null;

    if (prevId && prevId !== nextId) {
      // Save the outgoing session's scroll position
      scrollPositions.current.set(prevId, container.scrollTop);
    }

    if (nextId && nextId !== prevId) {
      const saved = scrollPositions.current.get(nextId);
      if (saved !== undefined) {
        // Restore saved position without animation
        requestAnimationFrame(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = saved;
          }
        });
        userHasScrolledUpRef.current = saved < container.scrollHeight - container.clientHeight - threshold;
      } else {
        // First open — scroll to bottom
        requestAnimationFrame(() => {
          if (scrollRef.current) {
            const { scrollHeight, clientHeight } = scrollRef.current;
            scrollRef.current.scrollTop = scrollHeight - clientHeight;
          }
        });
        userHasScrolledUpRef.current = false;
      }
      prevCountRef.current = 0; // treat as fresh load for auto-scroll logic
    }

    prevSessionIdRef.current = nextId;
  }, [sessionId, threshold]);

  const scrollToBottom = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    userHasScrolledUpRef.current = false;
    const { scrollHeight, clientHeight } = container;
    container.scrollTo({
      top: scrollHeight - clientHeight,
      behavior: smooth ? 'smooth' : 'auto',
    });
  }, [smooth]);

  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceToBottom = scrollHeight - clientHeight - scrollTop;
    const nearBottom = distanceToBottom <= threshold;
    setIsNearBottom(nearBottom);
    userHasScrolledUpRef.current = !nearBottom;
  }, [threshold]);

  // ── Auto-scroll when new messages arrive ─────────────────────────────────
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const hasNewMessages = messageCount > prevCountRef.current;
    const isInitialLoad = prevCountRef.current === 0;

    if (isInitialLoad || (hasNewMessages && !userHasScrolledUpRef.current)) {
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          const { scrollHeight, clientHeight } = scrollRef.current;
          scrollRef.current.scrollTop = scrollHeight - clientHeight;
        }
      });
    }
    prevCountRef.current = messageCount;
  }, [messageCount]);

  return { scrollRef, handleScroll, scrollToBottom, isNearBottom };
}
