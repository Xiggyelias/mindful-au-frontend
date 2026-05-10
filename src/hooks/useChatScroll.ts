import { useEffect, useRef, useState, useCallback } from 'react';

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
  const isNearBottomRef = useRef(true);
  const prevCountRef = useRef(-1);

  // Keep ref in sync with state
  useEffect(() => {
    isNearBottomRef.current = isNearBottom;
  }, [isNearBottom]);

  const scrollToBottom = useCallback((force = false) => {
    const container = scrollRef.current;
    if (!container) return;
    
    const { scrollHeight, clientHeight } = container;
    const targetScrollTop = scrollHeight - clientHeight;
    
    if (force || isNearBottomRef.current) {
      container.scrollTo({
        top: targetScrollTop,
        behavior: smooth ? 'smooth' : 'auto',
      });
    }
  }, [smooth]);

  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    
    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceToBottom = scrollHeight - clientHeight - scrollTop;
    setIsNearBottom(distanceToBottom <= threshold);
  }, [threshold]);

  // Auto-scroll when messages change and user is near bottom
  useEffect(() => {
    // Skip if count hasn't changed (prevents loops)
    if (messageCount === prevCountRef.current) return;
    
    const container = scrollRef.current;
    if (!container) {
      prevCountRef.current = messageCount;
      return;
    }

    // Only scroll if we're near bottom or this is initial load
    if (isNearBottomRef.current || prevCountRef.current === -1) {
      // Use requestAnimationFrame for smooth DOM updates
      const frame = requestAnimationFrame(() => {
        if (scrollRef.current && isNearBottomRef.current) {
          const { scrollHeight, clientHeight } = scrollRef.current;
          scrollRef.current.scrollTop = scrollHeight - clientHeight;
        }
      });
      
      prevCountRef.current = messageCount;
      return () => cancelAnimationFrame(frame);
    }
    
    prevCountRef.current = messageCount;
  }, [messageCount]);

  return { scrollRef, handleScroll, scrollToBottom, isNearBottom };
}
