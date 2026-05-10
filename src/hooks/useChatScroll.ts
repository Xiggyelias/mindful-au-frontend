import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';

export function useChatScroll<T>(
  dependency: T,
  options: {
    threshold?: number;
    smooth?: boolean;
  } = {}
) {
  const { threshold = 150, smooth = true } = options;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const prevHeightRef = useRef<number>(0);

  const scrollToBottom = useCallback((force = false) => {
    if (scrollRef.current) {
      const { scrollHeight, clientHeight } = scrollRef.current;
      const targetScrollTop = scrollHeight - clientHeight;
      
      if (force || isNearBottom) {
        scrollRef.current.scrollTo({
          top: targetScrollTop,
          behavior: smooth ? 'smooth' : 'auto',
        });
      }
    }
  }, [isNearBottom, smooth]);

  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      // Use a larger threshold for "near bottom" to be more forgiving
      const distanceToBottom = scrollHeight - clientHeight - scrollTop;
      setIsNearBottom(distanceToBottom <= threshold);
    }
  }, [threshold]);

  // Use useLayoutEffect to capture the height before browser paint
  useLayoutEffect(() => {
    if (scrollRef.current && (isNearBottom || prevHeightRef.current === 0)) {
      const { scrollHeight, clientHeight } = scrollRef.current;
      
      // If we were at bottom, stay at bottom after content update
      if (isNearBottom) {
        scrollRef.current.scrollTop = scrollHeight - clientHeight;
      }
    }
    
    if (scrollRef.current) {
      prevHeightRef.current = scrollRef.current.scrollHeight;
    }
  }, [dependency]);

  // Secondary scroll with animation frame for smooth transitions
  useEffect(() => {
    if (isNearBottom) {
      const frame = requestAnimationFrame(() => {
        scrollToBottom();
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [dependency, isNearBottom, scrollToBottom]);

  return { scrollRef, handleScroll, scrollToBottom, isNearBottom };
}
