import { useWebRTC, useActiveCallDock } from "@/hooks/useWebRTC";

/**
 * Legacy compatibility bridge: maps any useLiveKit calls to the robust WebRTC engine.
 */
export const useLiveKit = (appointmentId: number | string, userId: string) => {
  return useWebRTC(String(appointmentId || ""), userId);
};

export const useLiveKitActiveCallDock = () => {
  return useActiveCallDock();
};

export default useLiveKit;
