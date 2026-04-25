import { useCallback, useEffect, useState } from "react";
import { DailyTip, api, getApiErrorMessage } from "@/lib/api";

export const useDailyTip = () => {
  const [tip, setTip] = useState<DailyTip | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const nextTip = await api.getTodayTip();
      setTip(nextTip);
      if (!nextTip) {
        setError("No active tip is available right now.");
      }
    } catch (loadError) {
      setTip(null);
      setError(getApiErrorMessage(loadError, "Unable to load the daily tip right now."));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    tip,
    isLoading,
    error,
    refresh,
  };
};
