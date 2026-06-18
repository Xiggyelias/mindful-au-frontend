export const VIDEO_CALL_LIMITS = {
  minDurationMinutes: 15,
  maxDurationMinutes: 120,
  defaultDurationMinutes: 60,
  joinEarlyMinutes: 15,
  joinLateGraceMinutes: 15,
  connectionTimeoutMs: 45_000,
} as const;

const DEFAULT_STUN_SERVERS = [
  "stun:stun.l.google.com:19302",
  "stun:stun1.l.google.com:19302",
  "stun:stun2.l.google.com:19302",
  "stun:stun3.l.google.com:19302",
  "stun:stun4.l.google.com:19302",
] as const;

const normalizeIceServer = (value: unknown): RTCIceServer | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as RTCIceServer;
  const rawUrls = candidate.urls;
  const urls = Array.isArray(rawUrls)
    ? rawUrls.map((item) => String(item).trim()).filter(Boolean)
    : typeof rawUrls === "string"
    ? rawUrls.trim()
    : "";

  if (
    (Array.isArray(urls) && urls.length === 0) ||
    (!Array.isArray(urls) && !urls)
  ) {
    return null;
  }

  return {
    urls,
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
    .filter(Boolean);

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

  if (turnUrls.length > 0 && turnUsername && turnCredential) {
    servers.push({
      urls: turnUrls,
      username: turnUsername,
      credential: turnCredential,
    });
  } else if (turnUrls.length > 0) {
    console.warn("Relay (TURN) URLs provided but username or credential missing. Relay will be unavailable.");
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

    return validServers.length > 0 ? validServers : getFallbackIceServers();
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

/**
 * Audio-only WebRTC for this appointment: explicit `call_type` audio, legacy "Online audio" notes.
 */
export const isAppointmentAudioOnly = (
  apt?: { is_anonymous?: boolean; call_type?: string | null; notes?: string | null } | null
): boolean => {
  if (!apt) {
    return false;
  }
  if (String(apt.call_type || "").toLowerCase() === "audio") {
    return true;
  }
  return prefersAudioOnlyOnlineCall(apt.notes);
};

export type AppointmentCallMediaInput = {
  is_anonymous?: unknown;
  call_type?: string | null;
  notes?: string | null;
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
  now = new Date()
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
  const callOpensAtMs =
    scheduledAtMs - VIDEO_CALL_LIMITS.joinEarlyMinutes * 60 * 1_000;
  const callClosesAtMs =
    scheduledAtMs +
    (safeDurationMinutes + VIDEO_CALL_LIMITS.joinLateGraceMinutes) * 60 * 1_000;
  const nowMs = now.getTime();

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
