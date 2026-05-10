import { useRef, useState, useCallback } from 'react';

export function useChatScroll(
  _messageCount: number,
  options: {
    threshold?: number;
    smooth?: boolean;
  } = {}
) {
  const { threshold = 150, smooth = true } = options;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);

  const scrollToBottom = useCallback((force = true) => {
    const container = scrollRef.current;
    if (!container) return;
    
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
    setIsNearBottom(distanceToBottom <= threshold);
  }, [threshold]);

  return { scrollRef, handleScroll, scrollToBottom, isNearBottom };
}
