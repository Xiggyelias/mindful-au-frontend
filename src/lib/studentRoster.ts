import { formatDistanceToNow } from "date-fns";
import {
  anonymousLabelForCounselor,
  isAnonymousIdentityMaskedFromViewer,
} from "@/lib/anonymousMode";

export type StudentRosterRow = {
  id: number;
  name: string;
  email: string;
  isAnonymous: boolean;
  accountStatus: "active" | "pending";
  sessions: number;
  lastSession: string;
  riskLevel: "low" | "medium" | "high";
  isOnline: boolean;
  activeChatSessionId: number | null;
  assignedPeerCounselorId: number | null;
  needsAssessment: boolean;
};

const toMillis = (value?: string | null) => {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export const buildStudentRosterRows = ({
  studentData,
  appointmentData,
  diagnosticsData,
  sessionsData,
  chatSessionsData,
  maskAnonymous = false,
}: {
  studentData: any[];
  appointmentData: any[];
  diagnosticsData: any[];
  sessionsData: any[];
  chatSessionsData: any[];
  maskAnonymous?: boolean;
}): StudentRosterRow[] => {
  const latestRiskByStudent = new Map<number, { riskLevel: "low" | "medium" | "high"; timestamp: number }>();
  diagnosticsData.forEach((diagnostic: any) => {
    const studentId = Number(diagnostic.student_id);
    if (!studentId) return;
    const diagnosticTimestamp = Math.max(
      toMillis(diagnostic.updated_at || null),
      toMillis(diagnostic.created_at || null)
    );
    const existing = latestRiskByStudent.get(studentId);
    if (existing && existing.timestamp >= diagnosticTimestamp) {
      return;
    }
    const riskRaw = String(diagnostic.risk_level || "").toLowerCase();
    const normalizedRisk: "low" | "medium" | "high" =
      riskRaw === "high" || riskRaw === "critical"
        ? "high"
        : riskRaw === "medium"
        ? "medium"
        : "low";
    latestRiskByStudent.set(studentId, {
      riskLevel: normalizedRisk,
      timestamp: diagnosticTimestamp,
    });
  });

  const totalSessionsByStudent = new Map<number, number>();
  const lastTouchedByStudent = new Map<number, number>();
  sessionsData.forEach((session: any) => {
    const studentId = Number(session.student_id);
    if (!studentId) return;
    totalSessionsByStudent.set(studentId, (totalSessionsByStudent.get(studentId) || 0) + 1);
    const touchedAt = toMillis(session.updated_at || session.created_at || null);
    if (touchedAt > (lastTouchedByStudent.get(studentId) || 0)) {
      lastTouchedByStudent.set(studentId, touchedAt);
    }
  });

  appointmentData.forEach((appointment: any) => {
    const studentId = Number(appointment.student_id);
    if (!studentId) return;
    const touchedAt = toMillis(appointment.updated_at || appointment.created_at || null);
    if (touchedAt > (lastTouchedByStudent.get(studentId) || 0)) {
      lastTouchedByStudent.set(studentId, touchedAt);
    }
  });

  const chatSource =
    chatSessionsData.length > 0
      ? chatSessionsData
      : sessionsData.filter((session: any) => session.session_type === "chat");

  const preferredChatByStudent = new Map<number, any>();
  chatSource.forEach((session: any) => {
    if (session.session_type !== "chat") return;
    if (session.status === "completed" || session.status === "cancelled") return;

    const studentId = Number(session.student_id);
    if (!studentId) return;

    const currentBest = preferredChatByStudent.get(studentId);
    const isCurrentPeer =
      session.assigned_role === "peer_counselor" && Number(session.peer_counselor_id) > 0;
    const currentTimestamp = toMillis(session.updated_at || session.created_at || null);
    if (!currentBest) {
      preferredChatByStudent.set(studentId, session);
      return;
    }

    const bestIsPeer =
      currentBest.assigned_role === "peer_counselor" && Number(currentBest.peer_counselor_id) > 0;
    const bestTimestamp = toMillis(currentBest.updated_at || currentBest.created_at || null);
    if ((isCurrentPeer && !bestIsPeer) || currentTimestamp > bestTimestamp) {
      preferredChatByStudent.set(studentId, session);
    }
  });

  return studentData.map((student: any) => {
    const studentId = Number(student.id);
    const preferredChat = preferredChatByStudent.get(studentId) || null;
    const latestRisk = latestRiskByStudent.get(studentId)?.riskLevel || "low";
    const lastTouchedMillis = lastTouchedByStudent.get(studentId) || 0;
    const isMasked = maskAnonymous && preferredChat && isAnonymousIdentityMaskedFromViewer(preferredChat);
    const isActive = student.roles?.some((r: any) => r.role === "student" && r.approved);

    return {
      id: studentId,
      name: isMasked
        ? anonymousLabelForCounselor()
        : student.profile?.full_name ||
          student.email?.split("@")[0] ||
          `Student #${String(student.id).slice(-4)}`,
      email: isMasked ? "—" : String(student.email || "N/A"),
      isAnonymous: Boolean(isMasked),
      accountStatus: isActive ? "active" : "pending",
      sessions: totalSessionsByStudent.get(studentId) || 0,
      lastSession: lastTouchedMillis
        ? formatDistanceToNow(new Date(lastTouchedMillis), { addSuffix: true })
        : "Never",
      riskLevel: latestRisk,
      isOnline: Boolean(student.is_online),
      activeChatSessionId: preferredChat?.id ?? null,
      assignedPeerCounselorId:
        preferredChat?.assigned_role === "peer_counselor" && Number(preferredChat?.peer_counselor_id) > 0
          ? Number(preferredChat.peer_counselor_id)
          : null,
      needsAssessment: Boolean(student.needs_assessment),
    };
  });
};
