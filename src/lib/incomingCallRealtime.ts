import { supabase } from "@/integrations/supabase/client";

export const INCOMING_CALL_WAKE_BROADCAST = "incoming-call-wake";

/** Server-side call state, mirrored on both devices. */
export type CallLifecycleState = "RINGING" | "CONNECTED" | "ENDED";

export type IncomingCallWakePayload = {
  appointment_id: number;
  /** Row id of the call (NOT the appointment id) — what removeCallLocal matches on. */
  call_id?: number;
  call_type?: string;
  caller_role?: "student" | "counselor";
  status?: string;
  state?: CallLifecycleState;
};

/** Statuses that mean the ring is over and both sides must tear down. */
const TERMINAL_STATUSES = new Set(["cancelled", "declined", "missed", "ended"]);

export const isTerminalCallSignal = (payload: IncomingCallWakePayload): boolean =>
  payload.state === "ENDED" || TERMINAL_STATUSES.has(String(payload.status || "").toLowerCase());

export const isAcceptedCallSignal = (payload: IncomingCallWakePayload): boolean =>
  payload.state === "CONNECTED" || String(payload.status || "").toLowerCase() === "accepted";

const CALL_SIGNAL_DEBUG =
  import.meta.env.DEV || String(import.meta.env.VITE_CALL_SIGNAL_DEBUG ?? "") === "true";

export const logCallSignal = (...args: unknown[]) => {
  if (CALL_SIGNAL_DEBUG) {
    console.log("[CallSignal]", ...args);
  }
};

export const incomingCallWakeChannelName = (userId: number | string) =>
  `incoming-call-wake-${userId}`;

type WakeListener = (payload: IncomingCallWakePayload) => void;

type SharedWakeChannel = {
  channel: ReturnType<typeof supabase.channel>;
  listeners: Set<WakeListener>;
};

/**
 * One realtime channel per user, shared by every listener on the page. Both the global
 * ring UI and the caller's own call page listen to the same user channel — opening a
 * second Supabase channel with the same topic tends to drop messages, so they share.
 */
const sharedWakeChannels = new Map<string, SharedWakeChannel>();

/**
 * Subscribe to call signaling for a user (incoming ring, plus accepted/declined/cancelled
 * updates for calls they placed). The backend is the authoritative sender; the caller's
 * browser also emits a best-effort copy so the two devices stay in sync even when the
 * server cannot reach realtime.
 */
export function subscribeIncomingCallWake(
  userId: number | string,
  onWake: WakeListener
): () => void {
  const name = incomingCallWakeChannelName(userId);
  let shared = sharedWakeChannels.get(name);

  if (!shared) {
    const channel = supabase.channel(name);
    const entry: SharedWakeChannel = { channel, listeners: new Set() };

    channel.on("broadcast", { event: INCOMING_CALL_WAKE_BROADCAST }, ({ payload }) => {
      const row = payload as IncomingCallWakePayload | undefined;
      if (!row || typeof row.appointment_id !== "number") {
        return;
      }
      logCallSignal("incoming call event received", { channel: name, payload: row });
      for (const listener of entry.listeners) {
        try {
          listener(row);
        } catch (error) {
          console.error("[CallSignal] listener failed", error);
        }
      }
    });

    channel.subscribe((status) => {
      logCallSignal("wake channel status", { channel: name, status });
    });

    shared = entry;
    sharedWakeChannels.set(name, entry);
  }

  shared.listeners.add(onWake);

  return () => {
    const entry = sharedWakeChannels.get(name);
    if (!entry) return;
    entry.listeners.delete(onWake);
    if (entry.listeners.size === 0) {
      sharedWakeChannels.delete(name);
      void entry.channel.unsubscribe();
    }
  };
}

/**
 * Fire-and-forget signal to the other party so their device reacts immediately instead of
 * waiting for the next poll. Best-effort by design: the backend sends the authoritative
 * copy of this same event, and polling still discovers the call if both hops fail.
 *
 * `targetUserId` must be the recipient's real user id. It is not always knowable from the
 * caller's side — a counselor calling an anonymous student sees `student_id: 0` — which is
 * exactly why the server-side broadcast exists and this stays an optimisation.
 */
export function signalIncomingCallWake(
  targetUserId: number | string,
  payload: IncomingCallWakePayload
): void {
  const name = incomingCallWakeChannelName(targetUserId);
  logCallSignal("client wake -> recipient", { channel: name, payload });

  void (async () => {
    // Same topic the recipient listens on — a broadcast only reaches subscribers of the
    // identical channel name.
    const channel = supabase.channel(name);
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
    } catch (error) {
      logCallSignal("client wake failed (server signal + polling still apply)", error);
    } finally {
      void channel.unsubscribe();
    }
  })();
}
