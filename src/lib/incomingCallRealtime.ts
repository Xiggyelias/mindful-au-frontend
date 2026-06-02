import { supabase } from "@/integrations/supabase/client";

export const INCOMING_CALL_WAKE_BROADCAST = "incoming-call-wake";

export type IncomingCallWakePayload = {
  appointment_id: number;
  call_type?: string;
  caller_role?: "student" | "counselor";
  status?: string;
};

export const incomingCallWakeChannelName = (userId: number | string) =>
  `incoming-call-wake-${userId}`;

/**
 * Subscribe to instant incoming-call wake signals (complements HTTP polling).
 */
export function subscribeIncomingCallWake(
  userId: number | string,
  onWake: (payload: IncomingCallWakePayload) => void
): () => void {
  const channel = supabase.channel(incomingCallWakeChannelName(userId));

  channel.on("broadcast", { event: INCOMING_CALL_WAKE_BROADCAST }, ({ payload }) => {
    const row = payload as IncomingCallWakePayload | undefined;
    if (!row || typeof row.appointment_id !== "number") {
      onWake({ appointment_id: 0 });
      return;
    }
    onWake(row);
  });

  channel.subscribe();

  return () => {
    void channel.unsubscribe();
  };
}

/** Fire-and-forget wake so the callee polls immediately instead of waiting for the next interval. */
export function signalIncomingCallWake(
  targetUserId: number | string,
  payload: IncomingCallWakePayload
): void {
  void (async () => {
    const channel = supabase.channel(incomingCallWakeChannelName(targetUserId));
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("wake_channel_timeout")), 4_000);
        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            window.clearTimeout(timeout);
            resolve();
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            window.clearTimeout(timeout);
            reject(new Error(`wake_channel_${status}`));
          }
        });
      });

      await channel.send({
        type: "broadcast",
        event: INCOMING_CALL_WAKE_BROADCAST,
        payload,
      });
    } catch {
      /* Best-effort; polling still discovers the call. */
    } finally {
      void channel.unsubscribe();
    }
  })();
}
