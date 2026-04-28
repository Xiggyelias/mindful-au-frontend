import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL ?? "").trim();
const SUPABASE_PUBLISHABLE_KEY = String(
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ""
).trim();

type BroadcastPayload = {
  type: "broadcast";
  event: string;
  payload?: unknown;
};

type ChannelStatus = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";

type SupabaseLike = {
  channel: (name: string) => {
    on: (
      type: "broadcast",
      filter: { event: string },
      callback: (payload: { payload: any }) => void
    ) => any;
    subscribe: (callback: (status: ChannelStatus) => void) => any;
    send: (payload: BroadcastPayload) => Promise<unknown>;
    unsubscribe: () => any;
  };
};

const createDisabledSupabaseClient = (reason: string): SupabaseLike => {
  const makeChannel = () => {
    let subscriptionCallback: ((status: ChannelStatus) => void) | null = null;

    return {
      on: () => makeChannel(),
      subscribe: (callback: (status: ChannelStatus) => void) => {
        subscriptionCallback = callback;
        queueMicrotask(() => subscriptionCallback?.("CHANNEL_ERROR"));
        return makeChannel();
      },
      send: async () => {
        throw new Error(reason);
      },
      unsubscribe: () => undefined,
    };
  };

  return {
    channel: () => makeChannel(),
  };
};

export const supabase: SupabaseLike =
  SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY
    ? (createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          storage: localStorage,
          persistSession: true,
          autoRefreshToken: true,
        },
      }) as unknown as SupabaseLike)
    : createDisabledSupabaseClient(
        "Supabase Realtime is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to enable video calls."
      );