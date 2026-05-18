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

const pickFallbackTipForRole = (
  tips: DailyTip[],
  role: "admin" | "counselor" | "peer_counselor" | "student" | null
): DailyTip | null => {
  if (!Array.isArray(tips) || tips.length === 0) {
    return null;
  }

  const audiencePool = role ? ["all", role] : ["all"];
  const eligible = tips
    .filter((tip) => tip && tip.is_active !== false)
    .filter((tip) => audiencePool.includes(String(tip.audience || "all")));

  if (eligible.length === 0) {
    return null;
  }

  const scored = eligible.sort((a, b) => {
    const aPriority = Number.isFinite(Number(a.priority)) ? Number(a.priority) : 0;
    const bPriority = Number.isFinite(Number(b.priority)) ? Number(b.priority) : 0;
    return bPriority - aPriority;
  });

  return scored[0] ?? null;
};

export const useDailyTip = () => {
  const { user, role } = useAuth();
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
      let nextTip = await api.getWellnessTip();

      if (!nextTip) {
        // /tips is admin-managed in some environments.
        // Avoid surfacing "Admin access required" to non-admin dashboards.
        const canReadTipsLibrary = role === "admin";
        if (canReadTipsLibrary) {
          const tips = await api.getTips();
          nextTip = pickFallbackTipForRole(tips, role);
        }
      }

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
  }, [applyTip, role, user?.id]);

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

  // Fix: Separate effect for initial load that only depends on user?.id
  // This prevents circular dependency between cachedTip and refresh
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

    // If no cached tip, fetch a fresh one
    void refresh();
  }, [user?.id, cachedTip, refresh]);

  return {
    tip,
    isLoading,
    error,
    refresh,
    toggleFavorite,
    isSavingFavorite,
  };
};
