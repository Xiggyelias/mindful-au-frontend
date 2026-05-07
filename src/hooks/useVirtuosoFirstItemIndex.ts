import { useEffect, useRef, useState } from "react";

const INITIAL_FIRST_ITEM_INDEX = 1_000_000;

/** Keeps scroll position when older chat messages are prepended (react-virtuoso `firstItemIndex` pattern). */
export function useVirtuosoFirstItemIndex(
  messages: readonly { id: number }[],
  conversationKey: string
): number {
  const [firstItemIndex, setFirstItemIndex] = useState(INITIAL_FIRST_ITEM_INDEX);
  const prevIdsRef = useRef<number[]>([]);
  const prevKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const ids = messages.map((m) => m.id);
    if (ids.length === 0) {
      prevIdsRef.current = [];
      setFirstItemIndex(INITIAL_FIRST_ITEM_INDEX);
      prevKeyRef.current = conversationKey;
      return;
    }

    if (prevKeyRef.current !== conversationKey) {
      prevKeyRef.current = conversationKey;
      prevIdsRef.current = ids;
      setFirstItemIndex(INITIAL_FIRST_ITEM_INDEX);
      return;
    }

    const prev = prevIdsRef.current;
    if (prev.length === 0) {
      prevIdsRef.current = ids;
      return;
    }

    const oldFirst = prev[0]!;
    const idxOldInNew = ids.indexOf(oldFirst);
    if (idxOldInNew > 0) {
      setFirstItemIndex((f) => f - idxOldInNew);
    } else {
      const newFirst = ids[0]!;
      if (newFirst !== oldFirst) {
        const idxNewInOld = prev.indexOf(newFirst);
        if (idxNewInOld > 0) {
          setFirstItemIndex((f) => f + idxNewInOld);
        }
      }
    }

    prevIdsRef.current = ids;
  }, [messages, conversationKey]);

  return firstItemIndex;
}
