export const VIDEO_CALL_LIMITS = {
  minDurationMinutes: 15,
  maxDurationMinutes: 120,
  defaultDurationMinutes: 60,
  joinEarlyMinutes: 15,
  joinLateGraceMinutes: 0,
  connectionTimeoutMs: 45_000,
} as const;

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
