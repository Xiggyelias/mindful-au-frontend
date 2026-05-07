/**
 * Single source of truth for anonymous flags from the API (Laravel / JSON).
 * Handles boolean, 0/1, and common string encodings so UI matches server intent everywhere.
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

/** Profile default for new sessions / bookings (`users.profile.anonymous_mode`). */
export function isProfileAnonymousMode(value: unknown): boolean {
  return isAnonymousSessionFlag(value);
}

export const ANONYMOUS_DISPLAY_NAME_COUNSELOR = "Anonymous User" as const;

/** Counselor-facing list: fixed label (server may mask `anonymous_id`). */
export function anonymousLabelForCounselor(): string {
  return ANONYMOUS_DISPLAY_NAME_COUNSELOR;
}

/**
 * Student-facing session title on dashboard/history when the thread is anonymous.
 */
export function formatStudentAnonymousSessionTitle(anonymousId: unknown): string {
  const label = typeof anonymousId === "string" ? anonymousId.trim() : "";
  return label !== "" ? `Anonymous (${label})` : "Anonymous session";
}
