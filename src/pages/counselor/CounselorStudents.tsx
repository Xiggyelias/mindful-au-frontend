import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  MessageSquare,
  Calendar,
  Users,
  Brain,
  Video,
  FileText,
  Heart,
  Search,
  Filter,
  AlertTriangle,
  FilterX,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/counselor/dashboard" },
  { label: "Messages", icon: MessageSquare, path: "/counselor/messages" },
  { label: "Appointments", icon: Calendar, path: "/counselor/appointments" },
  { label: "Students", icon: Users, path: "/counselor/students" },
  { label: "AI Insights", icon: Brain, path: "/counselor/ai-insights" },
  { label: "Video Sessions", icon: Video, path: "/counselor/video" },
  { label: "Session Notes", icon: FileText, path: "/counselor/notes" },
  { label: "Wellness", icon: Heart, path: "/counselor/wellness" },
];

const toMillis = (value?: string | null) => {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const readArrayResult = (result: PromiseSettledResult<any>) =>
  result.status === "fulfilled" && Array.isArray(result.value) ? result.value : [];

const readChatListResult = (result: PromiseSettledResult<any>) => {
  if (result.status !== "fulfilled") return [];
  if (Array.isArray(result.value)) return result.value;
  if (Array.isArray(result.value?.data)) return result.value.data;
  return [];
};

const CounselorStudents = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || "Counselor";
  const [students, setStudents] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [messagingStudentId, setMessagingStudentId] = useState<number | null>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [peerCounselors, setPeerCounselors] = useState<any[]>([]);
  const [selectedPeerByStudent, setSelectedPeerByStudent] = useState<Record<number, string>>({});
  const [assigningStudentId, setAssigningStudentId] = useState<number | null>(null);
  const [peerAssignmentAction, setPeerAssignmentAction] = useState<"assign" | "unassign" | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [riskFilter, setRiskFilter] = useState<"all" | "high" | "medium" | "low">("all");
  const navigate = useNavigate();

  const buildStudentRows = ({
    studentData,
    appointmentData,
    diagnosticsData,
    sessionsData,
    chatSessionsData,
  }: {
    studentData: any[];
    appointmentData: any[];
    diagnosticsData: any[];
    sessionsData: any[];
    chatSessionsData: any[];
  }) => {
    const latestRiskByStudent = new Map<number, { riskLevel: string; timestamp: number }>();
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
      const normalizedRisk = riskRaw === "high" || riskRaw === "medium" ? riskRaw : "low";
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

    const chatSource = chatSessionsData.length > 0
      ? chatSessionsData
      : sessionsData.filter((session: any) => session.session_type === "chat");

    const preferredChatByStudent = new Map<number, any>();
    chatSource.forEach((session: any) => {
      if (session.session_type !== "chat") return;
      if (session.status === "completed" || session.status === "cancelled") return;

      const studentId = Number(session.student_id);
      if (!studentId) return;

      const currentBest = preferredChatByStudent.get(studentId);
      const isCurrentPeer = session.assigned_role === "peer_counselor" && Number(session.peer_counselor_id) > 0;
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

      return {
        id: student.id,
        name:
          student.profile?.full_name ||
          student.email?.split("@")[0] ||
          `Student #${String(student.id).slice(-4)}`,
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
      };
    });
  };

  useEffect(() => {
    const loadStudents = async () => {
      try {
        setIsLoading(true);
        // Stage 1: fetch only critical datasets required for first paint.
        const [studentsResult, chatSessionsResult, peerCounselorsResult] = await Promise.allSettled([
          api.getStudents(),
          api.getChatSessions({ open_only: true, limit: 200, as_role: "counselor", timeout_ms: 25000 }),
          api.getPeerCounselors(),
        ]);

        if (studentsResult.status === "rejected") {
          throw studentsResult.reason;
        }

        const studentData = readArrayResult(studentsResult);
        const chatSessionsData = readChatListResult(chatSessionsResult);
        const peerCounselorsData = readArrayResult(peerCounselorsResult);

        const stageOneRows = buildStudentRows({
          studentData,
          appointmentData: [],
          diagnosticsData: [],
          sessionsData: chatSessionsData,
          chatSessionsData,
        });

        setStudents(stageOneRows);
        setSessions(chatSessionsData);
        setPeerCounselors(peerCounselorsData);
        setIsLoading(false);

        // Stage 2: fetch secondary datasets in the background and enrich rows.
        const [appointmentsResult, diagnosticsResult, sessionsResult] = await Promise.allSettled([
          api.getAppointments({ limit: 300 }),
          api.getAIDiagnostics(),
          api.getSessions({ lightweight: true, limit: 300 }),
        ]);

        const appointmentData = readArrayResult(appointmentsResult);
        const diagnosticsData = readArrayResult(diagnosticsResult);
        const sessionsData = readArrayResult(sessionsResult);

        const enrichedRows = buildStudentRows({
          studentData,
          appointmentData,
          diagnosticsData,
          sessionsData,
          chatSessionsData,
        });

        setStudents(enrichedRows);
        setSessions(
          chatSessionsData.length > 0
            ? chatSessionsData
            : (sessionsData || []).filter((session: any) => session.session_type === "chat")
        );
      } catch (err: any) {
        console.error("Failed to load students:", err);
        toast.error("Failed to load students");
      } finally {
        setIsLoading(false);
      }
    };

    if (!user) {
      setIsLoading(false);
      return;
    }

    loadStudents();
  }, [user, reloadToken]);

  const handleMessage = (studentId: number) => {
    const preferredCounselorSession = sessions.find(
      (s: any) =>
        Number(s.student_id) === Number(studentId) &&
        s.session_type === "chat" &&
        s.assigned_role !== "peer_counselor" &&
        s.status !== "completed" &&
        s.status !== "cancelled"
    );
    const fallbackSession = sessions.find(
      (s: any) =>
        Number(s.student_id) === Number(studentId) &&
        s.session_type === "chat" &&
        s.status !== "completed" &&
        s.status !== "cancelled"
    );
    const session = preferredCounselorSession || fallbackSession;
    if (session) {
      navigate(`/counselor/messages?session=${session.id}`);
      return;
    }

    const createAndNavigate = async () => {
      try {
        setMessagingStudentId(studentId);
        const newSession = await api.createSessionAsCounselor({
          student_id: studentId,
          session_type: "chat",
        });
        navigate(`/counselor/messages?session=${newSession.id}`);
      } catch (err: any) {
        toast.error(
          err?.response?.data?.message || "Failed to start a chat. Try creating an appointment first."
        );
      } finally {
        setMessagingStudentId(null);
      }
    };

    createAndNavigate();
  };

  const peerCounselorNameById = useMemo(() => {
    const map = new Map<number, string>();
    peerCounselors.forEach((peer: any) => {
      const label = peer?.profile?.full_name || peer?.email || `Peer Counselor #${peer?.id}`;
      map.set(Number(peer.id), label);
    });
    return map;
  }, [peerCounselors]);

  const handleAssignPeerCounselor = async (student: any) => {
    const selectedPeerId = Number(
      selectedPeerByStudent[student.id] ||
        student.assignedPeerCounselorId ||
        peerCounselors[0]?.id ||
        0
    );

    if (!selectedPeerId) {
      toast.error("Select a peer counselor first.");
      return;
    }

    if (student.riskLevel !== "low") {
      toast.error("Only low-risk students can be assigned to peer counselors.");
      return;
    }

    try {
      setAssigningStudentId(student.id);
      setPeerAssignmentAction("assign");

      let sessionId = Number(student.activeChatSessionId || 0);
      if (!sessionId) {
        const created = await api.createSessionAsCounselor({
          student_id: student.id,
          session_type: "chat",
        });
        sessionId = Number(created?.id || 0);
      }

      if (!sessionId) {
        toast.error("Could not resolve a chat case for this student.");
        return;
      }

      const assignedSession = await api.assignPeerCounselor(sessionId, selectedPeerId);
      const assignedPeerLabel =
        peerCounselorNameById.get(selectedPeerId) || `Peer counselor #${selectedPeerId}`;
      toast.success(`Case assigned to ${assignedPeerLabel}.`);

      // Immediate UI reflection: keep row in "Assigned" state until counselor changes selection.
      setSelectedPeerByStudent((prev) => ({
        ...prev,
        [student.id]: String(selectedPeerId),
      }));

      setStudents((prev) =>
        prev.map((row) =>
          Number(row.id) === Number(student.id)
            ? {
                ...row,
                activeChatSessionId: Number(assignedSession?.id || sessionId),
                assignedPeerCounselorId: selectedPeerId,
              }
            : row
        )
      );

      setSessions((prev) => {
        const normalized = {
          ...(assignedSession || {}),
          id: Number(assignedSession?.id || sessionId),
          student_id: Number(assignedSession?.student_id || student.id),
          session_type: "chat",
          assigned_role: "peer_counselor",
          peer_counselor_id: selectedPeerId,
        };
        const existingIndex = prev.findIndex((s: any) => Number(s.id) === Number(normalized.id));
        if (existingIndex === -1) {
          return [normalized, ...prev];
        }

        const next = [...prev];
        next[existingIndex] = {
          ...next[existingIndex],
          ...normalized,
        };
        return next;
      });

      setReloadToken((prev) => prev + 1);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to assign peer counselor.");
    } finally {
      setAssigningStudentId(null);
      setPeerAssignmentAction(null);
    }
  };

  const handleUnassignPeerCounselor = async (student: any) => {
    const delegatedSession = sessions.find(
      (session: any) =>
        Number(session.student_id) === Number(student.id) &&
        session.session_type === "chat" &&
        session.assigned_role === "peer_counselor" &&
        Number(session.peer_counselor_id) > 0 &&
        session.status !== "completed" &&
        session.status !== "cancelled"
    );

    const sessionId = Number(delegatedSession?.id || student.activeChatSessionId || 0);
    if (!sessionId) {
      toast.error("No active peer assignment found for this student.");
      return;
    }

    try {
      setAssigningStudentId(student.id);
      setPeerAssignmentAction("unassign");

      const updatedSession = await api.unassignPeerCounselor(sessionId);
      toast.success("Peer counselor assignment removed.");

      setSelectedPeerByStudent((prev) => {
        const next = { ...prev };
        delete next[student.id];
        return next;
      });

      setStudents((prev) =>
        prev.map((row) =>
          Number(row.id) === Number(student.id)
            ? {
                ...row,
                activeChatSessionId: Number(updatedSession?.id || sessionId),
                assignedPeerCounselorId: null,
              }
            : row
        )
      );

      setSessions((prev) => {
        const normalized = {
          ...(updatedSession || {}),
          id: Number(updatedSession?.id || sessionId),
          student_id: Number(updatedSession?.student_id || student.id),
          session_type: "chat",
          assigned_role: "counselor",
          peer_counselor_id: null,
        };
        const existingIndex = prev.findIndex((s: any) => Number(s.id) === Number(normalized.id));
        if (existingIndex === -1) {
          return [normalized, ...prev];
        }

        const next = [...prev];
        next[existingIndex] = {
          ...next[existingIndex],
          ...normalized,
        };
        return next;
      });

      setReloadToken((prev) => prev + 1);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to remove peer counselor assignment.");
    } finally {
      setAssigningStudentId(null);
      setPeerAssignmentAction(null);
    }
  };

  const filteredStudents = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();
    const riskRank: Record<string, number> = { high: 3, medium: 2, low: 1 };

    return students
      .filter((student) => {
        const name = String(student.name || "").toLowerCase();
        const idText = String(student.id || "");
        const matchesSearch = search.length === 0 || name.includes(search) || idText.includes(search);
        const matchesRisk = riskFilter === "all" || student.riskLevel === riskFilter;
        return matchesSearch && matchesRisk;
      })
      .sort((a, b) => {
        const riskDiff = (riskRank[b.riskLevel] || 0) - (riskRank[a.riskLevel] || 0);
        if (riskDiff !== 0) return riskDiff;
        return a.name.localeCompare(b.name);
      });
  }, [students, searchQuery, riskFilter]);

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar
        items={navItems}
        userType="counselor"
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-72 pl-0 pl-0">
        <DashboardHeader title="My Students" onMenuClick={() => setSidebarOpen(true)} />

        <main className="p-4 lg:p-6 space-y-6">
          <div className="flex flex-col md:flex-row md:flex-wrap gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search students by name or ID..."
                className="pl-9"
              />
            </div>
            <Button
              variant={riskFilter === "all" ? "default" : "outline"}
              className="gap-2"
              onClick={() => setRiskFilter("all")}
            >
              <Filter className="h-4 w-4" />
              All Risk
            </Button>
            <Button
              variant={riskFilter === "high" ? "default" : "outline"}
              className="gap-2"
              onClick={() => setRiskFilter("high")}
            >
              High
            </Button>
            <Button
              variant={riskFilter === "medium" ? "default" : "outline"}
              className="gap-2"
              onClick={() => setRiskFilter("medium")}
            >
              Medium
            </Button>
            <Button
              variant={riskFilter === "low" ? "default" : "outline"}
              className="gap-2"
              onClick={() => setRiskFilter("low")}
            >
              Low
            </Button>
            {(riskFilter !== "all" || searchQuery.trim().length > 0) && (
              <Button
                variant="ghost"
                className="gap-2"
                onClick={() => {
                  setSearchQuery("");
                  setRiskFilter("all");
                }}
              >
                <FilterX className="h-4 w-4" />
                Clear
              </Button>
            )}
          </div>

          <p className="text-sm text-muted-foreground">
            Showing {filteredStudents.length} of {students.length} students
          </p>

          <Card variant="glass">
            <CardHeader>
              <CardTitle className="text-lg">Students ({students.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading students...</p>
              ) : (
                <div className="space-y-4">
                  {filteredStudents.map((student) => {
                    const selectedPeerIdForStudent = Number(
                      selectedPeerByStudent[student.id] ??
                        (student.assignedPeerCounselorId ? String(student.assignedPeerCounselorId) : "")
                    );
                    const hasAssignedPeer = Number(student.assignedPeerCounselorId) > 0;
                    const isAssignedToSelectedPeer =
                      hasAssignedPeer &&
                      selectedPeerIdForStudent === Number(student.assignedPeerCounselorId);

                    return (
                      <div
                        key={student.id}
                        className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl bg-secondary/30"
                      >
                      <div className="flex items-center gap-4">
                        <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center">
                          <span className="text-primary font-medium">
                            {student.name
                              .split(" ")
                              .map((part: string) => part[0])
                              .join("")
                              .slice(0, 2)
                              .toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{student.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {student.sessions} sessions - Last: {student.lastSession}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-medium ${
                            student.isOnline ? "bg-success/20 text-success" : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {student.isOnline ? "online" : "offline"}
                        </span>
                        <span
                          className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium ${
                            student.riskLevel === "low"
                              ? "bg-success/20 text-success"
                              : student.riskLevel === "medium"
                              ? "bg-warning/20 text-warning"
                              : "bg-destructive/20 text-destructive"
                          }`}
                        >
                          {student.riskLevel === "high" && <AlertTriangle className="h-3 w-3" />}
                          {student.riskLevel} risk
                        </span>
                        {hasAssignedPeer && (
                          <span className="px-3 py-1 rounded-full text-xs font-medium bg-primary/15 text-primary">
                            Assigned
                          </span>
                        )}
                        <Button size="sm" variant="outline">
                          View Profile
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleMessage(student.id)}
                          disabled={messagingStudentId !== null}
                        >
                          {messagingStudentId === student.id ? "Opening..." : "Message"}
                        </Button>
                        <select
                          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                          value={
                            selectedPeerByStudent[student.id] ??
                            (student.assignedPeerCounselorId ? String(student.assignedPeerCounselorId) : "")
                          }
                          onChange={(e) =>
                            setSelectedPeerByStudent((prev) => ({
                              ...prev,
                              [student.id]: e.target.value,
                            }))
                          }
                          disabled={assigningStudentId !== null || peerCounselors.length === 0}
                        >
                          <option value="">Select peer counselor</option>
                          {peerCounselors.map((peer: any) => (
                            <option key={peer.id} value={String(peer.id)}>
                              {peer?.profile?.full_name || peer?.email || `Peer #${peer.id}`}
                            </option>
                          ))}
                        </select>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleAssignPeerCounselor(student)}
                          disabled={
                            assigningStudentId !== null ||
                            peerCounselors.length === 0 ||
                            student.riskLevel !== "low" ||
                            isAssignedToSelectedPeer
                          }
                        >
                          {assigningStudentId === student.id
                            ? peerAssignmentAction === "assign"
                              ? "Assigning..."
                              : "Updating..."
                            : hasAssignedPeer
                            ? isAssignedToSelectedPeer
                              ? "Assigned"
                              : "Reassign Peer"
                            : "Assign Peer"}
                        </Button>
                        {hasAssignedPeer && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleUnassignPeerCounselor(student)}
                            disabled={assigningStudentId !== null}
                          >
                            {assigningStudentId === student.id && peerAssignmentAction === "unassign"
                              ? "Removing..."
                              : "Remove Peer"}
                          </Button>
                        )}
                        {hasAssignedPeer && (
                          <span className="text-xs text-muted-foreground">
                            Peer: {peerCounselorNameById.get(Number(student.assignedPeerCounselorId)) || `#${student.assignedPeerCounselorId}`}
                          </span>
                        )}
                      </div>
                      </div>
                    );
                  })}
                  {filteredStudents.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      {students.length === 0
                        ? "No students available yet."
                        : "No students match the current search or filter."}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default CounselorStudents;
