/**
 * Merge duplicate open chat sessions for the same counselor-student conversation
 * (e.g. multiple pending/active rows) into one list entry. Unread badges use the
 * representative row's unread_count only (same session id as the row), not a sum
 * across merged rows. Summing inflated badges vs. what you see after opening chat.
 */

import { isAnonymousSessionFlag } from "@/lib/anonymousMode";

export function isValidChatListRow(row: unknown): row is Record<string, unknown> {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    return false;
  }
  const id = Number((row as Record<string, unknown>).id);
  return Number.isInteger(id) && id > 0;
}

export function chatListRowTimeMs(row: { updated_at?: unknown; created_at?: unknown }): number {
  const raw = row.updated_at ?? row.created_at;
  if (raw == null || raw === "") return 0;
  const t = new Date(String(raw)).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Most reliable numeric student id on a row (anonymous masked rows may still carry chat_peer_student_id). */
function realStudentId(row: Record<string, unknown>): number {
  const a = _numberOrZero(row.chat_peer_student_id);
  const b = _numberOrZero(row.student_id);
  const student = row.student as Record<string, unknown> | undefined;
  const c = _numberOrZero(student?.id);
  return Math.max(a, b, c);
}

function _numberOrZero(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function normalizedNameKey(row: Record<string, unknown>): string {
  const student = row.student as Record<string, unknown> | undefined;
  const profile = student?.profile as Record<string, unknown> | undefined;
  let nm = String(profile?.full_name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!nm && student && typeof student.email === "string") {
    nm = student.email.split("@")[0]?.trim().toLowerCase() ?? "";
  }
  return nm;
}

/**
 * One row per student on the counselor home strip (ignores peer-vs-pro split so duplicates disappear).
 */
function counselorChatListDashboardKey(row: Record<string, unknown>): string {
  const isAnon = isAnonymousSessionFlag(row.is_anonymous);
  const rid = realStudentId(row);
  if (isAnon) {
    if (rid > 0) return `dash:anon:u:${rid}`;
    const handle = String(row.anonymous_id ?? "").trim();
    if (handle) return `dash:anon:h:${handle}`;
    return `dash:anon:id:${row.id}`;
  }
  if (rid > 0) return `dash:named:u:${rid}`;
  const nk = normalizedNameKey(row);
  if (nk) return `dash:named:nm:${nk}`;
  return `dash:named:id:${row.id}`;
}

export type CounselorChatDedupeMode = "messages" | "dashboard";

export function counselorChatListLane(row: Record<string, unknown>): "direct" | "supervision" {
  const assignedRole = String(row.assigned_role ?? "").trim();
  const peerCounselorId = _numberOrZero(row.peer_counselor_id);
  const casePeerCounselorId = _numberOrZero(row.case_peer_counselor_id);
  const peerCounselor = row.peer_counselor as Record<string, unknown> | undefined;
  const casePeerCounselor = row.case_peer_counselor as Record<string, unknown> | undefined;

  if (
    assignedRole === "peer_counselor" ||
    peerCounselorId > 0 ||
    casePeerCounselorId > 0 ||
    _numberOrZero(peerCounselor?.id) > 0 ||
    _numberOrZero(casePeerCounselor?.id) > 0
  ) {
    return "supervision";
  }

  return "direct";
}

/**
 * Stable key: same real student + anonymity + lane -> one row.
 * The lane keeps direct counselor chats separate from supervised peer cases.
 */
export function counselorChatListDedupeKey(
  row: Record<string, unknown>,
  mode: CounselorChatDedupeMode = "messages",
): string {
  if (mode === "dashboard") {
    return counselorChatListDashboardKey(row);
  }

  const isAnon = isAnonymousSessionFlag(row.is_anonymous);
  const lane = counselorChatListLane(row);

  if (isAnon) {
    const rid = realStudentId(row);
    if (rid > 0) {
      return `${lane}:anon:stu:${rid}`;
    }
    const handle = String(row.anonymous_id ?? "").trim();
    if (handle) {
      return `${lane}:anon:h:${handle}`;
    }
    return `${lane}:anon:sid:${row.id}`;
  }

  const sid = realStudentId(row);
  if (sid > 0) {
    return `${lane}:id:stu:${sid}`;
  }
  const nk = normalizedNameKey(row);
  if (nk) return `${lane}:id:nm:${nk}`;
  return `${lane}:id:sid:${row.id}`;
}

export function dedupeCounselorChatListRows(
  rows: Record<string, unknown>[],
  mode: CounselorChatDedupeMode = "messages",
): Record<string, unknown>[] {
  const safe = rows.filter(isValidChatListRow);
  type Bucket = { row: Record<string, unknown>; timeMs: number };
  const map = new Map<string, Bucket>();

  for (const row of safe) {
    const key = counselorChatListDedupeKey(row, mode);
    const timeMs = chatListRowTimeMs(row);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { row: { ...row }, timeMs });
      continue;
    }
    if (timeMs >= existing.timeMs) {
      existing.row = { ...row };
      existing.timeMs = timeMs;
    }
  }

  return Array.from(map.values())
    .sort((a, b) => b.timeMs - a.timeMs)
    .map((b) => {
      const unread = Math.max(0, Math.floor(Number(b.row.unread_count ?? 0)));
      return {
        ...b.row,
        unread_count: unread,
      };
    });
}

/** Same key as {@link counselorChatListDedupeKey} for strongly typed session rows. */
export function counselorChatDedupeKeyFromSession(session: {
  id: number;
  student_id?: number | null;
  chat_peer_student_id?: number | null;
  assigned_role?: string | null;
  peer_counselor_id?: number | null;
  case_peer_counselor_id?: number | null;
  is_anonymous?: unknown;
  anonymous_id?: string | null;
}): string {
  return counselorChatListDedupeKey({
    id: session.id,
    student_id: session.student_id,
    chat_peer_student_id: session.chat_peer_student_id,
    assigned_role: session.assigned_role,
    peer_counselor_id: session.peer_counselor_id,
    case_peer_counselor_id: session.case_peer_counselor_id,
    is_anonymous: session.is_anonymous,
    anonymous_id: session.anonymous_id,
  }, "messages");
}
