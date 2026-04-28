import { useCallback, useEffect, useMemo, useState } from "react";
import { DailyTip, api, getApiErrorMessage } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

const DAILY_TIP_CACHE_KEY = "wellness_tip_cache";

type CachedDailyTip = {
  userId: number;
  servedForDate: string | null;
  tip: DailyTip | null;
};

const readCachedTip = (userId?: number | null): DailyTip | null => {
  if (!userId || typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(DAILY_TIP_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as CachedDailyTip;
    if (parsed?.userId !== userId || !parsed.tip) {
      return null;
    }

    const today = new Date().toISOString().slice(0, 10);
    return parsed.servedForDate === today ? parsed.tip : null;
  } catch {
    return null;
  }
};

const writeCachedTip = (userId: number, tip: DailyTip | null) => {
  if (typeof window === "undefined") {
    return;
  }

  const payload: CachedDailyTip = {
    userId,
    servedForDate: tip?.served_for_date ?? null,
    tip,
  };

  try {
    window.localStorage.setItem(DAILY_TIP_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore local cache failures.
  }
};

export const useDailyTip = () => {
  const { user } = useAuth();
  const cachedTip = useMemo(() => readCachedTip(user?.id ?? null), [user?.id]);
  const [tip, setTip] = useState<DailyTip | null>(cachedTip);
  const [isLoading, setIsLoading] = useState(!cachedTip);
  const [isSavingFavorite, setIsSavingFavorite] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyTip = useCallback(
    (nextTip: DailyTip | null) => {
      setTip(nextTip);
      if (user?.id) {
        writeCachedTip(user.id, nextTip);
      }
    },
    [user?.id]
  );

  const refresh = useCallback(async () => {
    if (!user?.id) {
      applyTip(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const nextTip = await api.getWellnessTip();
      applyTip(nextTip);
      if (!nextTip) {
        setError("No active wellness tip is available right now.");
      }
    } catch (loadError) {
      applyTip(null);
      setError(getApiErrorMessage(loadError, "Unable to load the daily wellness tip right now."));
    } finally {
      setIsLoading(false);
    }
  }, [applyTip, user?.id]);

  const toggleFavorite = useCallback(async () => {
    if (!tip?.id) {
      return false;
    }

    try {
      setIsSavingFavorite(true);
      setError(null);
      const nextTip = tip.is_favorite
        ? await api.unfavoriteTip(tip.id)
        : await api.favoriteTip(tip.id);

      applyTip({
        ...tip,
        ...(nextTip ?? {}),
        is_favorite: nextTip?.is_favorite ?? !tip.is_favorite,
      });
      return true;
    } catch (favoriteError) {
      setError(getApiErrorMessage(favoriteError, "Unable to update the saved tip right now."));
      return false;
    } finally {
      setIsSavingFavorite(false);
    }
  }, [applyTip, tip]);

  useEffect(() => {
    if (!user?.id) {
      setTip(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    if (cachedTip) {
      setTip(cachedTip);
      setIsLoading(false);
      setError(null);
      return;
    }

    setTip(null);
    void refresh();
  }, [cachedTip, refresh, user?.id]);

  return {
    tip,
    isLoading,
    error,
    refresh,
    toggleFavorite,
    isSavingFavorite,
  };
};
