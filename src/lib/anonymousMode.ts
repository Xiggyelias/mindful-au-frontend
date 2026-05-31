/**
 * Single source of truth for anonymous flags from the API (Laravel / JSON).
 * Handles boolean, 0/1, and common string encodings so UI matches server intent everywhere.
 *
 * Online anonymous bookings are always audio-only for WebRTC; use
 * `effectiveWebRtcCallMode` / `isAppointmentAudioOnly` from `@/lib/videoCall` so video vs audio
 * stays aligned with the backend (do not infer from `isProfileAnonymousMode` alone).
 */

/** Session, appointment, or message snapshot: is this row anonymous? */
export function isAnonymousSessionFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value === null || value === undefined) return false;
  if (typeof value === "string") {
    const t = value.trim().toLowerCase();
    return t === "1" || t === "true" || t === "yes" || t === "on";
  }
  return false;
}

/**
 * API `identity_visible_to_viewer` (appointments / sessions): when true, the current viewer
 * may see the real student identity; when false/omitted, treat as masked for anonymous rows.
 */
export function isIdentityVisibleToViewerFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === "string") {
    const t = value.trim().toLowerCase();
    return t === "1" || t === "true" || t === "yes" || t === "on";
  }
  return false;
}

/**
 * Anonymous booking/session where the viewer still must not see the student's real identity
 * (counselor video list, badges). Non-anonymous rows are never masked.
 */
export function isAnonymousIdentityMaskedFromViewer(
  entity: { is_anonymous?: unknown; identity_visible_to_viewer?: unknown } | null | undefined
): boolean {
  if (!entity) return false;
  if (!isAnonymousSessionFlag(entity.is_anonymous)) return false;
  return !isIdentityVisibleToViewerFlag(entity.identity_visible_to_viewer);
}

/**
 * Counselor chat inbox: include a chat session row when it either has a real student id or is
 * anonymous (anonymous list payloads may use `student_id: 0` while masking).
 */
export function isCounselorChatListableStudentSession(session: {
  is_anonymous?: unknown;
  student_id?: unknown;
}): boolean {
  if (isAnonymousSessionFlag(session.is_anonymous)) return true;
  const id = Number(session.student_id);
  return Number.isInteger(id) && id > 0;
}

/** Profile default for new sessions / bookings (`users.profile.anonymous_mode`). */
export function isProfileAnonymousMode(value: unknown): boolean {
  return isAnonymousSessionFlag(value);
}

export const ANONYMOUS_DISPLAY_NAME_COUNSELOR = "Anonymous User" as const;

/** Counselor-facing list: fixed label (server may mask `anonymous_id`). */
export function anonymousLabelForCounselor(): string {
  return ANONYMOUS_DISPLAY_NAME_COUNSELOR;
}

/** Student-facing session title on dashboard/history when the thread is anonymous. */
export function formatStudentAnonymousSessionTitle(anonymousId: unknown): string {
  const label = typeof anonymousId === "string" ? anonymousId.trim() : "";
  return label !== "" ? `Anonymous (${label})` : "Anonymous session";
}

/** Row shape shared by appointments and video sessions in counselor UI. */
export type CounselorStudentIdentityRow = {
  is_anonymous?: unknown;
  identity_visible_to_viewer?: unknown;
  student?: {
    profile?: { full_name?: string | null } | null;
    full_name?: string | null;
    name?: string | null;
  } | null;
  counselor_student_name?: string | null;
  student_name?: string | null;
};

/** Unified counselor-facing student label: masked only when the API says identity is hidden. */
export function resolveCounselorStudentDisplayName(
  row: CounselorStudentIdentityRow | null | undefined,
  fallback = "Student"
): string {
  if (!row) {
    return fallback;
  }
  if (isAnonymousIdentityMaskedFromViewer(row)) {
    return anonymousLabelForCounselor();
  }
  const fromProfile = row.student?.profile?.full_name?.trim();
  if (fromProfile) {
    return fromProfile;
  }
  const alt =
    row.student?.full_name?.trim() ||
    row.student?.name?.trim() ||
    row.counselor_student_name?.trim() ||
    row.student_name?.trim();
  return alt || fallback;
}

/** Whether this booking runs as anonymous (appointment/session flag is the source of truth). */
export function isAnonymousBookingForParticipant(
  row: { is_anonymous?: unknown } | null | undefined
): boolean {
  return isAnonymousSessionFlag(row?.is_anonymous);
}
