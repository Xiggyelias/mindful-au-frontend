import type { Session } from "@/hooks/useChatSession";

/**
 * Resolves the chat peer user id for E2E session key storage (must match useEncryptedChat / MessageController peers).
 */
export function resolveChatPeerIdForE2E(session: Session, numericUserId: number): number | null {
  const studentId = Number(session?.chat_peer_student_id ?? session?.student_id);
  const counselorId = Number(session?.counselor_id);
  const peerCounselorId = Number(session?.peer_counselor_id);
  const assignedRole = String(session?.assigned_role || "").toLowerCase();

  if (studentId === numericUserId) {
    if (
      assignedRole === "peer_counselor" &&
      Number.isFinite(peerCounselorId) &&
      peerCounselorId > 0
    ) {
      return peerCounselorId;
    }
    if (Number.isFinite(counselorId) && counselorId > 0) {
      return counselorId;
    }
    return null;
  }

  if (counselorId === numericUserId && Number.isFinite(studentId) && studentId > 0) {
    return studentId;
  }

  if (
    peerCounselorId === numericUserId &&
    assignedRole === "peer_counselor" &&
    Number.isFinite(studentId) &&
    studentId > 0
  ) {
    return studentId;
  }

  return null;
}

export function getChatSessionKeyStorageKeyV2(sessionId: string, userA: number, userB: number): string {
  const low = Math.min(userA, userB);
  const high = Math.max(userA, userB);
  return `chat_key_v2_${sessionId}_${low}_${high}`;
}
