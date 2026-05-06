/**
 * Merge duplicate open chat sessions for the same counselor–student conversation
 * (e.g. multiple pending/active rows) into one list entry with combined unread counts.
 */

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

/**
 * Stable key: same real student + anonymity + assignment lane → one row.
 * Mirrors Counselor Messages sidebar semantics so dashboard and messages stay aligned.
 */
export function counselorChatListDedupeKey(row: Record<string, unknown>): string {
  const isAnon = row.is_anonymous === true || row.is_anonymous === 1 || row.is_anonymous === "1";
  const role = String(row.assigned_role || "counselor");
  const targetPeer = Number(row.peer_counselor_id ?? 0);
  const peerSuffix =
    role === "peer_counselor" && Number.isFinite(targetPeer) && targetPeer > 0 ? `:pc:${targetPeer}` : "";

  if (isAnon) {
    const peerStudent = Number(row.chat_peer_student_id ?? 0);
    if (Number.isFinite(peerStudent) && peerStudent > 0) {
      return `anon:${role}${peerSuffix}:stu:${peerStudent}`;
    }
    const handle = String(row.anonymous_id ?? "").trim();
    if (handle) {
      return `anon:${role}${peerSuffix}:h:${handle}`;
    }
    return `anon:${role}${peerSuffix}:sid:${row.id}`;
  }

  const sid = Number(row.student_id ?? 0);
  if (Number.isFinite(sid) && sid > 0) {
    return `id:${role}${peerSuffix}:stu:${sid}`;
  }
  const fallbackPeer = Number(row.chat_peer_student_id ?? 0);
  if (Number.isFinite(fallbackPeer) && fallbackPeer > 0) {
    return `id:${role}${peerSuffix}:stu:${fallbackPeer}`;
  }
  return `id:${role}${peerSuffix}:sid:${row.id}`;
}

export function dedupeCounselorChatListRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const safe = rows.filter(isValidChatListRow);
  type Bucket = { row: Record<string, unknown>; timeMs: number; unread: number };
  const map = new Map<string, Bucket>();

  for (const row of safe) {
    const key = counselorChatListDedupeKey(row);
    const unread = Math.max(0, Math.floor(Number(row.unread_count ?? 0)));
    const timeMs = chatListRowTimeMs(row);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { row: { ...row }, timeMs, unread });
      continue;
    }
    existing.unread += unread;
    if (timeMs >= existing.timeMs) {
      existing.row = { ...row };
      existing.timeMs = timeMs;
    }
  }

  return Array.from(map.values())
    .sort((a, b) => b.timeMs - a.timeMs)
    .map((b) => ({
      ...b.row,
      unread_count: b.unread,
    }));
}

/** Same key as {@link counselorChatListDedupeKey} for strongly typed session rows. */
export function counselorChatDedupeKeyFromSession(session: {
  id: number;
  student_id?: number | null;
  chat_peer_student_id?: number | null;
  assigned_role?: string | null;
  peer_counselor_id?: number | null;
  is_anonymous?: unknown;
  anonymous_id?: string | null;
}): string {
  return counselorChatListDedupeKey({
    id: session.id,
    student_id: session.student_id,
    chat_peer_student_id: session.chat_peer_student_id,
    assigned_role: session.assigned_role,
    peer_counselor_id: session.peer_counselor_id,
    is_anonymous: session.is_anonymous,
    anonymous_id: session.anonymous_id,
  });
}
