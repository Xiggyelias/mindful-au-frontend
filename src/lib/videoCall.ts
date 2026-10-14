import { isAnonymousSessionFlag } from "@/lib/anonymousMode";

export const VIDEO_CALL_LIMITS = {
  minDurationMinutes: 15,
  maxDurationMinutes: 120,
  defaultDurationMinutes: 60,
  joinEarlyMinutes: 15,
  joinLateGraceMinutes: 15,
  /**
   * WhatsApp-style call ring timeout: calls ring for 35 seconds before stopping
   * sound and transitioning to "No answer / User unavailable".
   */
  connectionTimeoutMs: 35_000,
  /**
   * How long an unanswered call rings before it counts as missed. Must match
   * `CallCoordinator::RING_TTL_SECONDS` on the backend: the countdown ring on the incoming
   * overlay, the timer that dismisses it, and the server's own expiry all describe the same
   * deadline, and a shorter client timeout would report "declined" for calls the server was
   * still ringing.
   */
  ringTimeoutMs: 35_000,
} as const;

const DEFAULT_STUN_SERVERS = [
  "stun:stun.l.google.com:19302",
  "stun:stun1.l.google.com:19302",
  "stun:stun2.l.google.com:19302",
  "stun:stun3.l.google.com:19302",
  "stun:stun4.l.google.com:19302",
  "stun:stun.cloudflare.com:3478",
  "stun:stun.services.mozilla.com:3478",
] as const;

/**
 * Public WebRTC relay servers used when no custom TURN server is configured in env.
 * Essential for NAT traversal across different mobile networks / cellular data (20+ km away).
 */
const PUBLIC_RELAY_SERVERS: RTCIceServer[] = [
  {
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:443",
      "turns:openrelay.metered.ca:443?transport=tcp",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

const isDummyUrl = (url: string): boolean =>
  /example\.com|your-turn|change-me/i.test(url);

const normalizeIceServer = (value: unknown): RTCIceServer | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as RTCIceServer;
  const rawUrls = candidate.urls;
  const urls = (Array.isArray(rawUrls)
    ? rawUrls.map((item) => String(item).trim()).filter(Boolean)
    : typeof rawUrls === "string"
    ? [rawUrls.trim()]
    : []
  ).filter((url) => !isDummyUrl(url));

  if (urls.length === 0) {
    return null;
  }

  return {
    urls: urls.length === 1 ? urls[0] : urls,
    username:
      typeof candidate.username === "string" && candidate.username.trim()
        ? candidate.username.trim()
        : undefined,
    credential:
      typeof candidate.credential === "string" && candidate.credential.trim()
        ? candidate.credential.trim()
        : undefined,
  };
};

const parseCsvUrls = (value?: string) =>
  (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => Boolean(item) && !isDummyUrl(item));

const getFallbackIceServers = (): RTCIceServer[] => {
  const stunUrls = parseCsvUrls(import.meta.env.VITE_WEBRTC_STUN_URLS);
  const turnUrls = parseCsvUrls(import.meta.env.VITE_WEBRTC_TURN_URLS);
  const turnUsername = import.meta.env.VITE_WEBRTC_TURN_USERNAME?.trim();
  const turnCredential = import.meta.env.VITE_WEBRTC_TURN_CREDENTIAL?.trim();

  const servers: RTCIceServer[] = [
    {
      urls: stunUrls.length > 0 ? stunUrls : [...DEFAULT_STUN_SERVERS],
    },
  ];

  if (turnUrls.length > 0 && turnUsername && turnCredential && !isDummyUrl(turnUsername)) {
    servers.push({
      urls: turnUrls,
      username: turnUsername,
      credential: turnCredential,
    });
  } else {
    // If no custom TURN server is specified, provide the public open relay
    // to guarantee connectivity across distant cellular/carrier NAT networks.
    servers.push(...PUBLIC_RELAY_SERVERS);
  }

  return servers;
};

export const getWebRtcIceServers = (): RTCIceServer[] => {
  const rawIceServers = import.meta.env.VITE_WEBRTC_ICE_SERVERS;
  if (!rawIceServers) {
    return getFallbackIceServers();
  }

  try {
    const parsed = JSON.parse(rawIceServers);
    if (!Array.isArray(parsed)) {
      return getFallbackIceServers();
    }

    const validServers = parsed
      .map((server) => normalizeIceServer(server))
      .filter((server): server is RTCIceServer => server !== null);

    if (validServers.length === 0) {
      return getFallbackIceServers();
    }

    // If configured servers contain only STUN without TURN relay, append fallback relay
    if (!hasRelayIceServer(validServers)) {
      validServers.push(...PUBLIC_RELAY_SERVERS);
    }

    return validServers;
  } catch (error) {
    console.warn("Invalid VITE_WEBRTC_ICE_SERVERS value. Falling back to default ICE servers.", error);
    return getFallbackIceServers();
  }
};

export const hasRelayIceServer = (iceServers: RTCIceServer[]): boolean =>
  iceServers.some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some((url) => {
      const normalized = String(url || "").trim().toLowerCase();
      return normalized.startsWith("turn:") || normalized.startsWith("turns:");
    });
  });

export interface VideoCallWindowStatus {
  canStart: boolean;
  isUpcoming: boolean;
  isExpired: boolean;
  startsInSeconds: number;
  endsInSeconds: number;
  message: string;
}

export const normalizeVideoCallDuration = (durationMinutes?: number | null): number => {
  if (typeof durationMinutes !== "number" || Number.isNaN(durationMinutes)) {
    return VIDEO_CALL_LIMITS.defaultDurationMinutes;
  }

  return Math.min(
    VIDEO_CALL_LIMITS.maxDurationMinutes,
    Math.max(VIDEO_CALL_LIMITS.minDurationMinutes, Math.round(durationMinutes))
  );
};

export const isVideoEnabledAppointment = (notes?: string | null): boolean => {
  const normalized = (notes || "").trim().toLowerCase();
  return !normalized.startsWith("physical");
};

/** Booking form stores online audio-only as notes starting with `Online audio`. */
export const prefersAudioOnlyOnlineCall = (notes?: string | null): boolean => {
  if (!isVideoEnabledAppointment(notes)) {
    return false;
  }
  return (notes || "").trim().toLowerCase().startsWith("online audio");
};

export type AppointmentCallMediaInput = {
  is_anonymous?: unknown;
  call_type?: string | null;
  notes?: string | null;
};

/**
 * Audio-only WebRTC for this appointment: an anonymous booking, an explicit `call_type` of
 * audio, or legacy "Online audio" notes.
 *
 * Anonymity is checked first and on its own. The backend forces anonymous online appointments
 * to audio, but a row whose flag and format have drifted apart — anonymous while `notes` still
 * read "Online" — must still be treated as audio here. Reading only `notes`/`call_type` let
 * such a row negotiate video against a call the server had recorded as audio, so the two
 * participants disagreed about the session they were in.
 */
export const isAppointmentAudioOnly = (apt?: AppointmentCallMediaInput | null): boolean => {
  if (!apt) {
    return false;
  }
  if (isAnonymousSessionFlag(apt.is_anonymous)) {
    return true;
  }
  if (String(apt.call_type || "").toLowerCase() === "audio") {
    return true;
  }
  return prefersAudioOnlyOnlineCall(apt.notes);
};

/**
 * Single entry for navigation / ringtone / icons: never treat anonymous online (or other audio-only rows) as video.
 */
export function effectiveWebRtcCallMode(
  row: AppointmentCallMediaInput | null | undefined
): "audio" | "video" {
  if (!row || isAppointmentAudioOnly(row)) {
    return "audio";
  }
  return String(row.call_type || "").toLowerCase() === "audio" ? "audio" : "video";
}

export function describeOnlineAppointmentFormat(
  notes?: string | null
): "In-person" | "Audio / online" | "Video / online" {
  if (!isVideoEnabledAppointment(notes)) {
    return "In-person";
  }
  return prefersAudioOnlyOnlineCall(notes) ? "Audio / online" : "Video / online";
}

/**
 * Where/how the session takes place — same categories as the appointments dashboard,
 * with optional extra text for in-person notes (e.g. `Physical — Room 12`).
 */
export function getAppointmentWhereLabel(notes?: string | null): string {
  const raw = (notes || "").trim();
  if (!raw) {
    return describeOnlineAppointmentFormat(notes);
  }
  if (!isVideoEnabledAppointment(notes)) {
    const detail = raw.replace(/^physical\b\s*[:\-–—|·]\s*/i, "").trim();
    return detail ? `${describeOnlineAppointmentFormat(notes)} · ${detail}` : describeOnlineAppointmentFormat(notes);
  }
  return describeOnlineAppointmentFormat(notes);
}

export const getVideoCallWindowStatus = (
  scheduledAt: string | Date | null | undefined,
  durationMinutes?: number | null,
  now = new Date(),
  isEmergency = false
): VideoCallWindowStatus => {
  if (!scheduledAt) {
    return {
      canStart: false,
      isUpcoming: false,
      isExpired: true,
      startsInSeconds: 0,
      endsInSeconds: 0,
      message: "Scheduled time is missing for this appointment.",
    };
  }

  const scheduledAtDate = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
  const scheduledAtMs = scheduledAtDate.getTime();

  if (!Number.isFinite(scheduledAtMs)) {
    return {
      canStart: false,
      isUpcoming: false,
      isExpired: true,
      startsInSeconds: 0,
      endsInSeconds: 0,
      message: "Scheduled time is invalid for this appointment.",
    };
  }

  const safeDurationMinutes = normalizeVideoCallDuration(durationMinutes);
  const nowMs = now.getTime();
  const callOpensAtMs = isEmergency
    ? Math.min(nowMs - 60_000, scheduledAtMs - VIDEO_CALL_LIMITS.joinEarlyMinutes * 60 * 1_000)
    : scheduledAtMs - VIDEO_CALL_LIMITS.joinEarlyMinutes * 60 * 1_000;
  let callClosesAtMs =
    scheduledAtMs +
    (safeDurationMinutes + VIDEO_CALL_LIMITS.joinLateGraceMinutes) * 60 * 1_000;

  if (isEmergency && callClosesAtMs <= nowMs) {
    const elapsedSinceScheduledMs = nowMs - scheduledAtMs;
    if (elapsedSinceScheduledMs < 6 * 60 * 60 * 1_000) {
      callClosesAtMs = nowMs + (safeDurationMinutes + VIDEO_CALL_LIMITS.joinLateGraceMinutes) * 60 * 1_000;
    }
  }

  if (nowMs < callOpensAtMs) {
    const startsInSeconds = Math.ceil((callOpensAtMs - nowMs) / 1_000);
    return {
      canStart: false,
      isUpcoming: true,
      isExpired: false,
      startsInSeconds,
      endsInSeconds: Math.ceil((callClosesAtMs - nowMs) / 1_000),
      message: `Call is locked until ${VIDEO_CALL_LIMITS.joinEarlyMinutes} minutes before the scheduled time.`,
    };
  }

  const secondsUntilClose = Math.ceil((callClosesAtMs - nowMs) / 1_000);

  if (nowMs >= callClosesAtMs || secondsUntilClose < 60) {
    return {
      canStart: false,
      isUpcoming: false,
      isExpired: true,
      startsInSeconds: 0,
      endsInSeconds: 0,
      message: "This call window has closed.",
    };
  }

  return {
    canStart: true,
    isUpcoming: false,
    isExpired: false,
    startsInSeconds: 0,
    endsInSeconds: secondsUntilClose,
    message: "Call is ready.",
  };
};

export const formatCallDuration = (totalSeconds?: number | null): string => {
  if (typeof totalSeconds !== "number" || totalSeconds < 0) {
    return "00:00";
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};
