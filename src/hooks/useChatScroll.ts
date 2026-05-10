import { useRef, useState, useCallback, useEffect } from 'react';

export function useChatScroll(
  messageCount: number,
  options: {
    threshold?: number;
    smooth?: boolean;
  } = {}
) {
  const { threshold = 150, smooth = true } = options;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const prevCountRef = useRef(0);
  const userHasScrolledUpRef = useRef(false);

  const scrollToBottom = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    
    // Reset scrolled-up state so future messages auto-scroll
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
    
    // Track if user manually scrolled up
    if (!nearBottom) {
      userHasScrolledUpRef.current = true;
    } else {
      userHasScrolledUpRef.current = false;
    }
  }, [threshold]);

  // Auto-scroll when new messages arrive and user is near bottom
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const hasNewMessages = messageCount > prevCountRef.current;
    const isInitialLoad = prevCountRef.current === 0;

    // Scroll if: initial load OR (new messages AND user hasn't scrolled up)
    if (isInitialLoad || (hasNewMessages && !userHasScrolledUpRef.current)) {
      // Use RAF to ensure DOM has updated
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
