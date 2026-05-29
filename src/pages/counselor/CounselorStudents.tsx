import { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
  Loader2,
  Activity,
  TrendingUp,
  Clock,
  Lock,
  Mail,
  User as UserIcon,
  CalendarDays,
  FileSpreadsheet,
  Check,
} from "lucide-react";
import { counselorNavItems } from "@/config/counselorNavItems";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AnonymousModeIndicator } from "@/components/privacy/AnonymousModeIndicator";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import {
  anonymousLabelForCounselor,
  isAnonymousIdentityMaskedFromViewer
} from "@/lib/anonymousMode";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

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
  const [assigningAssessmentStudentId, setAssigningAssessmentStudentId] = useState<number | null>(null);
  const [peerAssignmentAction, setPeerAssignmentAction] = useState<"assign" | "unassign" | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [riskFilter, setRiskFilter] = useState<"all" | "high" | "medium" | "low">("all");
  const [highlightedStudentId, setHighlightedStudentId] = useState<number | null>(null);
  const [selectedStudentForProfile, setSelectedStudentForProfile] = useState<any | null>(null);
  const [profileWellnessSummary, setProfileWellnessSummary] = useState<any | null>(null);
  const [isLoadingWellness, setIsLoadingWellness] = useState(false);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

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

      const isMasked = preferredChat && isAnonymousIdentityMaskedFromViewer(preferredChat);

      return {
        id: student.id,
        name: isMasked
          ? anonymousLabelForCounselor()
          : student.profile?.full_name ||
            student.email?.split("@")[0] ||
            `Student #${String(student.id).slice(-4)}`,
        isAnonymous: Boolean(isMasked),
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
          api.getStudents({ limit: 500 }),
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
        if (import.meta.env.DEV) console.error("Failed to load students:", err);
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

  useEffect(() => {
    if (!user || isLoading || students.length === 0) {
      return;
    }

    const rawOpen = searchParams.get("open");
    const openId = rawOpen ? Number(rawOpen) : NaN;
    if (!Number.isFinite(openId) || openId <= 0) {
      return;
    }

    const next = new URLSearchParams(searchParams);
    next.delete("open");
    setSearchParams(next, { replace: true });

    const match = students.find((student) => Number(student.id) === openId);
    if (!match) {
      setSearchQuery(String(openId));
      setRiskFilter("all");
      toast.error("That student is not visible in your current roster.");
      return;
    }

    setSearchQuery(String(openId));
    setRiskFilter("all");
    setHighlightedStudentId(openId);
    toast.info("Opening the student profile from the emergency alert.");
    void handleViewStudentProfile(match);

    window.setTimeout(() => setHighlightedStudentId(null), 6000);
  }, [isLoading, searchParams, setSearchParams, students, user]);

  const handleViewStudentProfile = async (student: any) => {
    setSelectedStudentForProfile(student);
    setIsLoadingWellness(true);
    setProfileWellnessSummary(null);
    try {
      const summary = await api.getStudentWellnessSummary(student.id);
      setProfileWellnessSummary(summary);
    } catch (err: any) {
      if (err?.response?.status === 403) {
        setProfileWellnessSummary({ unauthorized: true });
      } else {
        toast.error("Failed to load student wellness summary.");
      }
    } finally {
      setIsLoadingWellness(false);
    }
  };

  const handleMessage = (studentId: number) => {
    const counselorSession = sessions.find(
      (s: any) =>
        Number(s.student_id) === Number(studentId) &&
        s.session_type === "chat" &&
        s.assigned_role !== "peer_counselor" &&
        s.status !== "completed" &&
        s.status !== "cancelled"
    );
    if (counselorSession) {
      navigate(`/counselor/messages?session=${counselorSession.id}`);
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
    const selectedPeerId = Number(selectedPeerByStudent[student.id] || 0);

    if (!selectedPeerId) {
      toast.error("Please select a peer counselor from the dropdown first.");
      return;
    }

    if (student.riskLevel !== "low") {
      toast.error("Only low-risk students can be assigned to peer counselors.");
      return;
    }

    // Prevent re-assigning to the same peer
    if (selectedPeerId === Number(student.assignedPeerCounselorId)) {
      toast.info("This student is already assigned to the selected peer counselor.");
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

  const handleAssignAssessment = async (studentId: number, studentName: string) => {
    try {
      setAssigningAssessmentStudentId(studentId);
      await api.assignNewAssessment(studentId);
      toast.success(`A new wellness assessment has been assigned to ${studentName} successfully.`);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to assign new assessment.");
    } finally {
      setAssigningAssessmentStudentId(null);
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
        items={[...counselorNavItems]}
        userType="counselor"
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-72 pl-0">
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
                <div className="space-y-3">
                  {filteredStudents.map((student) => {
                    const selectedPeerIdForStudent = Number(
                      selectedPeerByStudent[student.id] ??
                        (student.assignedPeerCounselorId ? String(student.assignedPeerCounselorId) : "")
                    );
                    const hasAssignedPeer = Number(student.assignedPeerCounselorId) > 0;
                    const isAssignedToSelectedPeer =
                      hasAssignedPeer &&
                      selectedPeerIdForStudent === Number(student.assignedPeerCounselorId);
                    const showPeerSection = student.riskLevel === "low" || hasAssignedPeer;

                    return (
                      <div
                        key={student.id}
                        className={`rounded-xl border bg-card overflow-hidden transition-all ${
                          highlightedStudentId === Number(student.id)
                            ? "ring-2 ring-destructive/70 shadow-lg shadow-destructive/10"
                            : "border-border/50 hover:border-border hover:shadow-sm"
                        }`}
                      >
                        {/* ── Header Row: Student Info + Status Badges ── */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-sm font-semibold ${
                              student.riskLevel === "high"
                                ? "bg-destructive/15 text-destructive"
                                : student.riskLevel === "medium"
                                ? "bg-warning/15 text-warning"
                                : "bg-primary/15 text-primary"
                            }`}>
                              {student.name
                                .split(" ")
                                .filter((part: string) => part.length > 0)
                                .map((part: string) => part[0])
                                .join("")
                                .slice(0, 2)
                                .toUpperCase() || "?"}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-semibold text-foreground truncate">{student.name}</p>
                                {student.isAnonymous && (
                                  <AnonymousModeIndicator variant="badge" audience="counselor" />
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {student.sessions} {student.sessions === 1 ? "session" : "sessions"} · Last active {student.lastSession}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 flex-wrap sm:justify-end">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium ${
                              student.isOnline
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                : "bg-muted text-muted-foreground"
                            }`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${student.isOnline ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                              {student.isOnline ? "Online" : "Offline"}
                            </span>
                            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium capitalize ${
                              student.riskLevel === "low"
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                : student.riskLevel === "medium"
                                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                            }`}>
                              {student.riskLevel === "high" && <AlertTriangle className="h-3 w-3" />}
                              {student.riskLevel} Risk
                            </span>
                            {hasAssignedPeer && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                                <UserIcon className="h-3 w-3" />
                                Peer Assigned
                              </span>
                            )}
                          </div>
                        </div>

                        {/* ── Actions Row ── */}
                        <div className="flex items-center gap-2 px-4 pb-3 flex-wrap">
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 text-xs"
                            onClick={() => handleViewStudentProfile(student)}
                          >
                            <UserIcon className="h-3.5 w-3.5" />
                            View Profile
                          </Button>
                          <Button
                            size="sm"
                            className="gap-1.5 text-xs"
                            onClick={() => handleMessage(student.id)}
                            disabled={messagingStudentId !== null}
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                            {messagingStudentId === student.id ? "Opening..." : "Message"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 text-xs border-indigo-200 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-900/45 dark:text-indigo-400 dark:hover:bg-indigo-950/30"
                            onClick={() => handleAssignAssessment(student.id, student.name || `Student #${student.id}`)}
                            disabled={assigningAssessmentStudentId === student.id}
                          >
                            <FileSpreadsheet className="h-3.5 w-3.5" />
                            {assigningAssessmentStudentId === student.id ? "Assigning..." : "Assign Assessment"}
                          </Button>
                        </div>

                        {/* ── Peer Counselor Section (only for low-risk or already assigned) ── */}
                        {showPeerSection && peerCounselors.length > 0 && (
                          <div className="border-t border-border/40 bg-muted/20 px-4 py-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                                Peer Counselor:
                              </span>

                              {hasAssignedPeer && (
                                <span className="text-xs font-medium text-foreground">
                                  {peerCounselorNameById.get(Number(student.assignedPeerCounselorId)) || `#${student.assignedPeerCounselorId}`}
                                </span>
                              )}

                              <select
                                className="h-8 rounded-md border border-input bg-background px-2 text-xs flex-1 min-w-[160px] max-w-[240px]"
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
                                disabled={assigningStudentId !== null}
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
                                className="h-8 text-xs gap-1"
                                onClick={() => handleAssignPeerCounselor(student)}
                                disabled={
                                  assigningStudentId !== null ||
                                  student.riskLevel !== "low" ||
                                  isAssignedToSelectedPeer ||
                                  !selectedPeerIdForStudent
                                }
                              >
                                {assigningStudentId === student.id && peerAssignmentAction === "assign"
                                  ? "Assigning..."
                                  : hasAssignedPeer
                                  ? isAssignedToSelectedPeer
                                    ? "Assigned ✓"
                                    : "Reassign"
                                  : "Assign"}
                              </Button>

                              {hasAssignedPeer && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 gap-1"
                                  onClick={() => handleUnassignPeerCounselor(student)}
                                  disabled={assigningStudentId !== null}
                                >
                                  {assigningStudentId === student.id && peerAssignmentAction === "unassign"
                                    ? "Removing..."
                                    : "Remove"}
                                </Button>
                              )}
                            </div>

                            {student.riskLevel !== "low" && hasAssignedPeer && (
                              <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5 flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                Student risk level changed since peer assignment. Consider reassigning to a professional counselor.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {filteredStudents.length === 0 && (
                    <div className="text-center py-12">
                      <Users className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
                      <p className="text-sm font-medium text-muted-foreground">
                        {students.length === 0
                          ? "No students available yet."
                          : "No students match your search or filter."}
                      </p>
                      {(riskFilter !== "all" || searchQuery.trim().length > 0) && (
                        <Button
                          variant="link"
                          size="sm"
                          className="mt-1"
                          onClick={() => { setSearchQuery(""); setRiskFilter("all"); }}
                        >
                          Clear filters
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </main>
      </div>

      {/* ───── Student Profile Dialog ───── */}
      <Dialog
        open={selectedStudentForProfile !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedStudentForProfile(null);
            setProfileWellnessSummary(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
                <span className="text-primary font-medium text-sm">
                  {(selectedStudentForProfile?.name || "?")
                    .split(" ")
                    .filter((p: string) => p.length > 0)
                    .map((p: string) => p[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
              </div>
              <div>
                <span>{selectedStudentForProfile?.name || "Student"}</span>
                {selectedStudentForProfile?.isAnonymous && (
                  <AnonymousModeIndicator variant="badge" audience="counselor" />
                )}
              </div>
            </DialogTitle>
            <DialogDescription>
              Student ID: {selectedStudentForProfile?.id} &middot; {selectedStudentForProfile?.sessions ?? 0} sessions &middot; Last active {selectedStudentForProfile?.lastSession || "N/A"}
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="overview" className="mt-4">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="wellness">Wellness</TabsTrigger>
              <TabsTrigger value="actions">Actions</TabsTrigger>
            </TabsList>

            {/* ── Overview Tab ── */}
            <TabsContent value="overview" className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-xl bg-secondary/40 p-4 space-y-1">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Activity className="h-4 w-4" />
                    Risk Level
                  </div>
                  <p className={`text-lg font-semibold capitalize ${
                    selectedStudentForProfile?.riskLevel === "high"
                      ? "text-destructive"
                      : selectedStudentForProfile?.riskLevel === "medium"
                      ? "text-warning"
                      : "text-success"
                  }`}>
                    {selectedStudentForProfile?.riskLevel || "Low"}
                  </p>
                </div>
                <div className="rounded-xl bg-secondary/40 p-4 space-y-1">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    Status
                  </div>
                  <p className={`text-lg font-semibold ${
                    selectedStudentForProfile?.isOnline ? "text-success" : "text-muted-foreground"
                  }`}>
                    {selectedStudentForProfile?.isOnline ? "Online" : "Offline"}
                  </p>
                </div>
                <div className="rounded-xl bg-secondary/40 p-4 space-y-1">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <TrendingUp className="h-4 w-4" />
                    Total Sessions
                  </div>
                  <p className="text-lg font-semibold text-foreground">
                    {selectedStudentForProfile?.sessions ?? 0}
                  </p>
                </div>
                <div className="rounded-xl bg-secondary/40 p-4 space-y-1">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CalendarDays className="h-4 w-4" />
                    Last Activity
                  </div>
                  <p className="text-lg font-semibold text-foreground">
                    {selectedStudentForProfile?.lastSession || "N/A"}
                  </p>
                </div>
              </div>

              {selectedStudentForProfile?.assignedPeerCounselorId && (
                <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 flex items-center gap-3">
                  <UserIcon className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm font-medium">Assigned Peer Counselor</p>
                    <p className="text-sm text-muted-foreground">
                      {peerCounselorNameById.get(Number(selectedStudentForProfile.assignedPeerCounselorId)) ||
                        `Peer #${selectedStudentForProfile.assignedPeerCounselorId}`}
                    </p>
                  </div>
                </div>
              )}
            </TabsContent>

            {/* ── Wellness Tab ── */}
            <TabsContent value="wellness" className="mt-4 space-y-4">
              {isLoadingWellness ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">Loading wellness data...</span>
                </div>
              ) : profileWellnessSummary?.unauthorized ? (
                <div className="rounded-xl bg-warning/10 border border-warning/30 p-6 text-center space-y-2">
                  <Lock className="h-8 w-8 text-warning mx-auto" />
                  <p className="font-medium text-warning">Access Restricted</p>
                  <p className="text-sm text-muted-foreground">
                    You need an active counseling session or appointment with this student to view their wellness data.
                    Start a session or schedule an appointment to unlock access.
                  </p>
                </div>
              ) : profileWellnessSummary ? (
                (() => {
                  const riskFactors = Array.isArray(profileWellnessSummary.risk_factors)
                    ? profileWellnessSummary.risk_factors
                    : typeof profileWellnessSummary.risk_factors === "string" && profileWellnessSummary.risk_factors.trim()
                    ? [profileWellnessSummary.risk_factors]
                    : [];

                  let recommendations: string[] = [];
                  if (Array.isArray(profileWellnessSummary.recommendations)) {
                    recommendations = profileWellnessSummary.recommendations;
                  } else if (typeof profileWellnessSummary.recommendations === "string" && profileWellnessSummary.recommendations.trim()) {
                    recommendations = [profileWellnessSummary.recommendations];
                  } else if (
                    profileWellnessSummary.recommendations &&
                    typeof profileWellnessSummary.recommendations === "object"
                  ) {
                    // Handle recommendations as object (e.g., {primary: "...", actions: [...]})
                    const rec = profileWellnessSummary.recommendations as any;
                    if (typeof rec.primary === "string" && rec.primary.trim()) {
                      recommendations = [rec.primary];
                    } else if (Array.isArray(rec.actions)) {
                      recommendations = rec.actions.filter((a: any) => typeof a === "string" && a.trim());
                    }
                  }

                  return (
                    <div className="space-y-4">
                      {profileWellnessSummary.current_status && (
                        <div className="rounded-xl bg-secondary/40 p-4 space-y-2">
                          <h4 className="font-medium flex items-center gap-2">
                            <Heart className="h-4 w-4 text-primary" />
                            Current Status
                          </h4>
                          <p className="text-sm text-muted-foreground">
                            {typeof profileWellnessSummary.current_status === "string"
                              ? profileWellnessSummary.current_status
                              : JSON.stringify(profileWellnessSummary.current_status)}
                          </p>
                        </div>
                      )}

                      {profileWellnessSummary.wellness_score != null && (
                        <div className="rounded-xl bg-secondary/40 p-4 space-y-2">
                          <h4 className="font-medium flex items-center gap-2">
                            <Activity className="h-4 w-4 text-primary" />
                            Wellness Score
                          </h4>
                          <div className="flex items-center gap-3">
                            <div className="text-3xl font-bold text-primary">
                              {profileWellnessSummary.wellness_score}
                            </div>
                            <div className="flex-1">
                              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-primary rounded-full transition-all duration-500"
                                  style={{ width: `${Math.min(100, Math.max(0, Number(profileWellnessSummary.wellness_score)))}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {riskFactors.length > 0 && (
                        <div className="rounded-xl bg-destructive/5 border border-destructive/20 p-4 space-y-2">
                          <h4 className="font-medium flex items-center gap-2 text-destructive">
                            <AlertTriangle className="h-4 w-4" />
                            Risk Factors
                          </h4>
                          <ul className="space-y-1">
                            {riskFactors.map((factor: string, idx: number) => (
                              <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-destructive/60 shrink-0" />
                                {factor}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {recommendations.length > 0 && (
                        <div className="rounded-xl bg-success/5 border border-success/20 p-4 space-y-2">
                          <h4 className="font-medium flex items-center gap-2 text-success">
                            <Check className="h-4 w-4" />
                            Recommendations
                          </h4>
                          <ul className="space-y-1">
                            {recommendations.map((rec: string, idx: number) => (
                              <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-success/60 shrink-0" />
                                {rec}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {!profileWellnessSummary.current_status &&
                        profileWellnessSummary.wellness_score == null &&
                        riskFactors.length === 0 &&
                        recommendations.length === 0 && (
                        <div className="text-center py-8 text-muted-foreground">
                          <Heart className="h-8 w-8 mx-auto mb-2 opacity-40" />
                          <p className="text-sm">No wellness data available yet for this student.</p>
                        </div>
                      )}
                    </div>
                  );
                })()
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Heart className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No wellness data available.</p>
                </div>
              )}
            </TabsContent>

            {/* ── Actions Tab ── */}
            <TabsContent value="actions" className="mt-4 space-y-3">
              <Button
                className="w-full justify-start gap-3"
                variant="outline"
                onClick={() => {
                  if (selectedStudentForProfile) {
                    handleMessage(selectedStudentForProfile.id);
                    setSelectedStudentForProfile(null);
                  }
                }}
              >
                <Mail className="h-4 w-4" />
                Send Message
              </Button>
              <Button
                className="w-full justify-start gap-3"
                variant="outline"
                onClick={() => {
                  if (selectedStudentForProfile) {
                    navigate(`/counselor/appointments?student=${selectedStudentForProfile.id}`);
                    setSelectedStudentForProfile(null);
                  }
                }}
              >
                <Calendar className="h-4 w-4" />
                Schedule Appointment
              </Button>
              <Button
                className="w-full justify-start gap-3"
                variant="outline"
                onClick={() => {
                  if (selectedStudentForProfile) {
                    handleAssignAssessment(
                      selectedStudentForProfile.id,
                      selectedStudentForProfile.name || `Student #${selectedStudentForProfile.id}`
                    );
                  }
                }}
                disabled={assigningAssessmentStudentId === selectedStudentForProfile?.id}
              >
                <FileSpreadsheet className="h-4 w-4" />
                {assigningAssessmentStudentId === selectedStudentForProfile?.id
                  ? "Assigning..."
                  : "Assign Wellness Assessment"}
              </Button>
              <Button
                className="w-full justify-start gap-3"
                variant="outline"
                onClick={() => {
                  if (selectedStudentForProfile) {
                    navigate(`/counselor/notes?student=${selectedStudentForProfile.id}`);
                    setSelectedStudentForProfile(null);
                  }
                }}
              >
                <FileText className="h-4 w-4" />
                View Session Notes
              </Button>
              <Button
                className="w-full justify-start gap-3"
                variant="outline"
                onClick={() => {
                  if (selectedStudentForProfile) {
                    navigate(`/counselor/ai-insights?student=${selectedStudentForProfile.id}`);
                    setSelectedStudentForProfile(null);
                  }
                }}
              >
                <Brain className="h-4 w-4" />
                View AI Insights
              </Button>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CounselorStudents;
