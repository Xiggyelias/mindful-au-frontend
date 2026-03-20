import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";

type BandwidthContextType = {
  lowBandwidthMode: boolean;
  setLowBandwidthMode: (value: boolean) => void;
  toggleLowBandwidthMode: () => void;
};

const STORAGE_KEY = "low_bandwidth_mode";

/* eslint-disable react-refresh/only-export-components */
const BandwidthContext = createContext<BandwidthContextType | undefined>(undefined);

const getInitialBandwidthMode = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "true" || stored === "1") {
    return true;
  }
  if (stored === "false" || stored === "0") {
    return false;
  }

  const connection = (window.navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return Boolean(connection?.saveData);
};

export const BandwidthProvider = ({ children }: { children: ReactNode }) => {
  const [lowBandwidthMode, setLowBandwidthMode] = useState<boolean>(getInitialBandwidthMode);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const root = window.document.documentElement;
    root.classList.toggle("low-bandwidth", lowBandwidthMode);
    window.localStorage.setItem(STORAGE_KEY, lowBandwidthMode ? "true" : "false");
  }, [lowBandwidthMode]);

  const value = useMemo(
    () => ({
      lowBandwidthMode,
      setLowBandwidthMode,
      toggleLowBandwidthMode: () => setLowBandwidthMode((prev) => !prev),
    }),
    [lowBandwidthMode]
  );

  return <BandwidthContext.Provider value={value}>{children}</BandwidthContext.Provider>;
};

export const useBandwidthMode = () => {
  const context = useContext(BandwidthContext);
  if (!context) {
    throw new Error("useBandwidthMode must be used within a BandwidthProvider");
  }
  return context;
};

