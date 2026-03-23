import { useEffect, useState } from "react";

type ConnectionWithMetrics = {
  effectiveType?: string;
  saveData?: boolean;
  downlink?: number;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

export type NetworkProfile = {
  effectiveType: string | null;
  saveData: boolean;
  downlink: number | null;
  lowBandwidth: boolean;
};

const getConnection = (): ConnectionWithMetrics | null => {
  if (typeof navigator === "undefined") {
    return null;
  }

  return (
    (navigator as Navigator & { connection?: ConnectionWithMetrics }).connection ??
    null
  );
};

const readNetworkProfile = (): NetworkProfile => {
  const connection = getConnection();
  const effectiveType =
    typeof connection?.effectiveType === "string" ? connection.effectiveType : null;
  const saveData = connection?.saveData === true;
  const downlink =
    typeof connection?.downlink === "number" && Number.isFinite(connection.downlink)
      ? connection.downlink
      : null;

  const lowBandwidth =
    saveData ||
    effectiveType === "slow-2g" ||
    effectiveType === "2g" ||
    effectiveType === "3g" ||
    (downlink !== null && downlink < 1.5);

  return {
    effectiveType,
    saveData,
    downlink,
    lowBandwidth,
  };
};

export const useNetworkProfile = (): NetworkProfile => {
  const [profile, setProfile] = useState<NetworkProfile>(() => readNetworkProfile());

  useEffect(() => {
    const updateProfile = () => {
      setProfile(readNetworkProfile());
    };

    const connection = getConnection();
    connection?.addEventListener?.("change", updateProfile);
    window.addEventListener("online", updateProfile);
    window.addEventListener("offline", updateProfile);

    return () => {
      connection?.removeEventListener?.("change", updateProfile);
      window.removeEventListener("online", updateProfile);
      window.removeEventListener("offline", updateProfile);
    };
  }, []);

  return profile;
};
