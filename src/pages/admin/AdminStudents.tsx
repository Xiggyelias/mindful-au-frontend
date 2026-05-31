import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Search,
  Filter,
  FilterX,
  RefreshCcw,
  Loader2,
  AlertTriangle,
  FileSpreadsheet,
  User as UserIcon,
  Users,
  UserCheck,
  HeartHandshake,
  Clock,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AnonymousModeIndicator } from "@/components/privacy/AnonymousModeIndicator";
import { adminNavItems } from "@/config/adminNavItems";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { buildStudentRosterRows, type StudentRosterRow } from "@/lib/studentRoster";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | "active" | "pending";
type RiskFilter = "all" | "high" | "medium" | "low";
type PeerFilter = "all" | "assigned" | "unassigned";

const readArrayResult = (result: PromiseSettledResult<unknown>) =>
  result.status === "fulfilled" && Array.isArray(result.value) ? result.value : [];

const readChatListResult = (result: PromiseSettledResult<unknown>) => {
  if (result.status !== "fulfilled") return [];
  const value = result.value as { data?: unknown[] } | unknown[];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  return [];
};

const AdminStudents = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || "Admin";

  const [searchParams, setSearchParams] = useSearchParams();
  const [students, setStudents] = useState<StudentRosterRow[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [peerCounselors, setPeerCounselors] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [peerFilter, setPeerFilter] = useState<PeerFilter>("all");
  const [reloadToken, setReloadToken] = useState(0);

  const [selectedPeerByStudent, setSelectedPeerByStudent] = useState<Record<number, string>>({});
  const [assigningStudentId, setAssigningStudentId] = useState<number | null>(null);
  const [assigningAssessmentStudentId, setAssigningAssessmentStudentId] = useState<number | null>(null);
  const [peerAssignmentAction, setPeerAssignmentAction] = useState<"assign" | "unassign" | null>(null);

  const [selectedStudent, setSelectedStudent] = useState<StudentRosterRow | null>(null);
  const [studentSummary, setStudentSummary] = useState<any | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [highlightedStudentId, setHighlightedStudentId] = useState<number | null>(null);

  const loadStudents = useCallback(async () => {
    try {
      setIsLoading(true);
      const [studentsResult, sessionsResult, peerCounselorsResult] = await Promise.allSettled([
        api.getStudents({ limit: 500 }),
        api.getSessions({ lightweight: true, limit: 400, open_only: true }),
        api.getPeerCounselors(),
      ]);

      if (studentsResult.status === "rejected") {
        throw studentsResult.reason;
      }

      const studentData = readArrayResult(studentsResult);
      const sessionsData = readArrayResult(sessionsResult);
      const peerCounselorsData = readArrayResult(peerCounselorsResult);

      const stageOneRows = buildStudentRosterRows({
        studentData,
        appointmentData: [],
        diagnosticsData: [],
        sessionsData,
        chatSessionsData: sessionsData,
        maskAnonymous: false,
      });

      setStudents(stageOneRows);
      setSessions(sessionsData);
      setPeerCounselors(peerCounselorsData);

      const [appointmentsResult, diagnosticsResult] = await Promise.allSettled([
        api.getAppointments({ limit: 300 }),
        api.getAIDiagnostics(),
      ]);

      const enrichedRows = buildStudentRosterRows({
        studentData,
        appointmentData: readArrayResult(appointmentsResult),
        diagnosticsData: readArrayResult(diagnosticsResult),
        sessionsData,
        chatSessionsData: sessionsData,
        maskAnonymous: false,
      });

      setStudents(enrichedRows);
    } catch (error: any) {
      const message = error?.response?.data?.message || "Failed to load students";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      void loadStudents();
    }
  }, [user, loadStudents, reloadToken]);

  const peerCounselorNameById = useMemo(() => {
    const map = new Map<number, string>();
    peerCounselors.forEach((peer: any) => {
      const label = peer?.profile?.full_name || peer?.email || `Peer #${peer.id}`;
      map.set(Number(peer.id), label);
    });
    return map;
  }, [peerCounselors]);

  const stats = useMemo(() => {
    const total = students.length;
    const active = students.filter((s) => s.accountStatus === "active").length;
    const pending = total - active;
    const atRisk = students.filter((s) => s.riskLevel === "high").length;
    const peerAssigned = students.filter((s) => Number(s.assignedPeerCounselorId) > 0).length;
    return { total, active, pending, atRisk, peerAssigned };
  }, [students]);

  const filteredStudents = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();

    return students.filter((student) => {
      const peerName =
        student.assignedPeerCounselorId != null
          ? (peerCounselorNameById.get(student.assignedPeerCounselorId) || "").toLowerCase()
          : "";

      const matchesSearch =
        search.length === 0 ||
        student.name.toLowerCase().includes(search) ||
        student.email.toLowerCase().includes(search) ||
        String(student.id).includes(search) ||
        peerName.includes(search);

      const matchesStatus = statusFilter === "all" || statusFilter === student.accountStatus;
      const matchesRisk = riskFilter === "all" || riskFilter === student.riskLevel;
      const hasPeer = Number(student.assignedPeerCounselorId) > 0;
      const matchesPeer =
        peerFilter === "all" ||
        (peerFilter === "assigned" && hasPeer) ||
        (peerFilter === "unassigned" && !hasPeer);

      return matchesSearch && matchesStatus && matchesRisk && matchesPeer;
    });
  }, [students, searchQuery, statusFilter, riskFilter, peerFilter, peerCounselorNameById]);

  const openStudentDetails = useCallback(async (student: StudentRosterRow) => {
    setSelectedStudent(student);
    setStudentSummary(null);
    setIsDetailsOpen(true);

    try {
      setIsSummaryLoading(true);
      const summary = await api.getStudentWellnessSummary(student.id);
      setStudentSummary(summary || null);
    } catch (error: any) {
      const message = error?.response?.data?.message || "Failed to load student details";
      toast.error(message);
    } finally {
      setIsSummaryLoading(false);
    }
  }, []);

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

    const match = students.find((s) => Number(s.id) === openId);
    if (!match) {
      setSearchQuery(String(openId));
      toast.error("Student not found in the current roster.");
      return;
    }

    setHighlightedStudentId(openId);
    void openStudentDetails(match);
    window.setTimeout(() => setHighlightedStudentId(null), 6000);
  }, [isLoading, openStudentDetails, searchParams, setSearchParams, students, user]);

  const resolveSessionForPeerAction = (student: StudentRosterRow) => {
    if (student.peerChatSessionId) {
      const peerById = sessions.find((s: any) => Number(s.id) === Number(student.peerChatSessionId));
      if (peerById && peerById.status !== "completed" && peerById.status !== "cancelled") {
        return peerById;
      }
    }

    const peerSession = sessions.find(
      (session: any) =>
        Number(session.student_id) === Number(student.id) &&
        session.session_type === "chat" &&
        session.assigned_role === "peer_counselor" &&
        Number(session.peer_counselor_id) > 0 &&
        session.status !== "completed" &&
        session.status !== "cancelled"
    );
    if (peerSession) return peerSession;

    const counselorSession = sessions.find(
      (session: any) =>
        Number(session.student_id) === Number(student.id) &&
        session.session_type === "chat" &&
        session.assigned_role !== "peer_counselor" &&
        session.status !== "completed" &&
        session.status !== "cancelled"
    );
    if (counselorSession) return counselorSession;

    if (student.activeChatSessionId) {
      return sessions.find((s: any) => Number(s.id) === Number(student.activeChatSessionId)) || null;
    }

    return null;
  };

  const handleAssignPeerCounselor = async (student: StudentRosterRow) => {
    const selectedPeerId = Number(selectedPeerByStudent[student.id] || 0);
    if (!selectedPeerId) {
      toast.error("Select a peer counselor first.");
      return;
    }
    if (student.riskLevel !== "low") {
      toast.error("Only low-risk students can be assigned to peer counselors.");
      return;
    }
    if (selectedPeerId === Number(student.assignedPeerCounselorId)) {
      toast.info("This student is already assigned to that peer counselor.");
      return;
    }

    const session = resolveSessionForPeerAction(student);
    const sessionId = Number(session?.id || 0);
    if (!sessionId) {
      toast.error("No active chat case found. A counselor must open a chat with this student first.");
      return;
    }

    try {
      setAssigningStudentId(student.id);
      setPeerAssignmentAction("assign");
      const assignedSession = await api.assignPeerCounselor(sessionId, selectedPeerId);
      const label = peerCounselorNameById.get(selectedPeerId) || `Peer #${selectedPeerId}`;
      toast.success(`Assigned to ${label}.`);

      setStudents((prev) =>
        prev.map((row) =>
          Number(row.id) === Number(student.id)
            ? {
                ...row,
                peerChatSessionId: Number(assignedSession?.id || sessionId),
                assignedPeerCounselorId: selectedPeerId,
              }
            : row
        )
      );
      setReloadToken((t) => t + 1);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to assign peer counselor.");
    } finally {
      setAssigningStudentId(null);
      setPeerAssignmentAction(null);
    }
  };

  const handleUnassignPeerCounselor = async (student: StudentRosterRow) => {
    const session = resolveSessionForPeerAction(student);
    const sessionId = Number(session?.id || 0);
    if (!sessionId || Number(student.assignedPeerCounselorId) <= 0) {
      toast.error("No active peer assignment found for this student.");
      return;
    }

    try {
      setAssigningStudentId(student.id);
      setPeerAssignmentAction("unassign");
      await api.unassignPeerCounselor(sessionId);
      toast.success("Peer counselor assignment removed.");
      setStudents((prev) =>
        prev.map((row) =>
          Number(row.id) === Number(student.id)
            ? {
                ...row,
                peerChatSessionId: null,
                assignedPeerCounselorId: null,
              }
            : row
        )
      );
      setReloadToken((t) => t + 1);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to remove peer assignment.");
    } finally {
      setAssigningStudentId(null);
      setPeerAssignmentAction(null);
    }
  };

  const handleAssignAssessment = async (studentId: number, studentName: string) => {
    try {
      setAssigningAssessmentStudentId(studentId);
      await api.assignNewAssessment(studentId);
      toast.success(`Wellness check-in assigned to ${studentName}.`);
      setStudents((prev) =>
        prev.map((row) => (Number(row.id) === studentId ? { ...row, needsAssessment: true } : row))
      );
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to assign assessment.");
    } finally {
      setAssigningAssessmentStudentId(null);
    }
  };

  const riskBadgeClass = (risk: string) => {
    if (risk === "high") return "border-destructive/40 bg-destructive/15 text-destructive";
    if (risk === "medium") return "border-warning/40 bg-warning/15 text-warning";
    return "border-success/40 bg-success/15 text-success";
  };

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar
        items={[...adminNavItems]}
        userType="admin"
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-72 pl-0">
        <DashboardHeader title="Students Management" onMenuClick={() => setSidebarOpen(true)} />

        <main className="p-4 lg:p-6 space-y-6">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => void loadStudents()} disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Refreshing
                </>
              ) : (
                <>
                  <RefreshCcw className="h-4 w-4 mr-2" />
                  Refresh
                </>
              )}
            </Button>
          </div>

          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
            {/* Card 1: Total Students */}
            <div className="h-full rounded-2xl border border-border bg-card p-5 shadow-sm hover:shadow-md transition-all duration-300 flex flex-col justify-between relative overflow-hidden bg-gradient-to-br from-red-50/20 to-transparent dark:from-red-950/5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total Students</p>
                  <p className="text-3xl font-bold mt-2 text-red-600 dark:text-red-400 font-display">{stats.total}</p>
                </div>
                <div className="p-3 rounded-xl bg-red-100/50 dark:bg-red-950/30 text-red-600 dark:text-red-400 shrink-0">
                  <Users className="h-5 w-5" />
                </div>
              </div>
            </div>
            {/* Card 2: Active */}
            <div className="h-full rounded-2xl border border-border bg-card p-5 shadow-sm hover:shadow-md transition-all duration-300 flex flex-col justify-between relative overflow-hidden bg-gradient-to-br from-green-50/20 to-transparent dark:from-green-950/5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Active</p>
                  <p className="text-3xl font-bold mt-2 text-green-600 dark:text-green-400 font-display">{stats.active}</p>
                </div>
                <div className="p-3 rounded-xl bg-green-100/50 dark:bg-green-950/30 text-green-600 dark:text-green-400 shrink-0">
                  <UserCheck className="h-5 w-5" />
                </div>
              </div>
            </div>
            {/* Card 3: High Risk */}
            <div className="h-full rounded-2xl border border-border bg-card p-5 shadow-sm hover:shadow-md transition-all duration-300 flex flex-col justify-between relative overflow-hidden bg-gradient-to-br from-orange-50/20 to-transparent dark:from-orange-950/5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">High Risk</p>
                  <p className="text-3xl font-bold mt-2 text-orange-600 dark:text-orange-400 font-display">{stats.atRisk}</p>
                </div>
                <div className="p-3 rounded-xl bg-orange-100/50 dark:bg-orange-950/30 text-orange-600 dark:text-orange-400 shrink-0">
                  <AlertTriangle className="h-5 w-5" />
                </div>
              </div>
            </div>
            {/* Card 4: Peer Supervised */}
            <div className="h-full rounded-2xl border border-border bg-card p-5 shadow-sm hover:shadow-md transition-all duration-300 flex flex-col justify-between relative overflow-hidden bg-gradient-to-br from-blue-50/20 to-transparent dark:from-blue-950/5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Peer Supervised</p>
                  <p className="text-3xl font-bold mt-2 text-blue-600 dark:text-blue-400 font-display">{stats.peerAssigned}</p>
                </div>
                <div className="p-3 rounded-xl bg-blue-100/50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 shrink-0">
                  <HeartHandshake className="h-5 w-5" />
                </div>
              </div>
            </div>
            {/* Card 5: Pending Approval */}
            <div className="h-full rounded-2xl border border-border bg-card p-5 shadow-sm hover:shadow-md transition-all duration-300 flex flex-col justify-between relative overflow-hidden bg-gradient-to-br from-gray-50/20 to-transparent dark:from-gray-950/5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Pending Approval</p>
                  <p className="text-3xl font-bold mt-2 text-muted-foreground font-display">{stats.pending}</p>
                </div>
                <div className="p-3 rounded-xl bg-gray-100/50 dark:bg-gray-950/30 text-muted-foreground shrink-0">
                  <Clock className="h-5 w-5" />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border shadow-sm rounded-2xl p-4 flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-4 w-full">
            {/* 1. Search Bar */}
            <div className="relative flex-1 min-w-[280px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, email, ID, or peer counselor..."
                className="pl-9 bg-background h-10 border-border/80 focus:border-primary/50 focus:ring-primary/20 rounded-xl"
              />
            </div>

            {/* Filter Groups Container */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
              {/* 2. Status Filter Group */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status:</span>
                <div className="flex items-center bg-secondary/50 p-1 rounded-xl border border-border/40">
                  <Button
                    size="sm"
                    variant={statusFilter === "all" ? "default" : "ghost"}
                    onClick={() => setStatusFilter("all")}
                    className={cn(
                      "h-8 text-xs rounded-lg px-3 transition-all",
                      statusFilter === "all" ? "bg-primary text-primary-foreground shadow-sm font-semibold hover:bg-primary/95" : "hover:bg-background/50 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    All
                  </Button>
                  <Button
                    size="sm"
                    variant={statusFilter === "active" ? "default" : "ghost"}
                    onClick={() => setStatusFilter("active")}
                    className={cn(
                      "h-8 text-xs rounded-lg px-3 transition-all",
                      statusFilter === "active" ? "bg-primary text-primary-foreground shadow-sm font-semibold hover:bg-primary/95" : "hover:bg-background/50 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Active
                  </Button>
                  <Button
                    size="sm"
                    variant={statusFilter === "pending" ? "default" : "ghost"}
                    onClick={() => setStatusFilter("pending")}
                    className={cn(
                      "h-8 text-xs rounded-lg px-3 transition-all",
                      statusFilter === "pending" ? "bg-primary text-primary-foreground shadow-sm font-semibold hover:bg-primary/95" : "hover:bg-background/50 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Pending
                  </Button>
                </div>
              </div>

              {/* 3. Risk Filter Group */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Risk:</span>
                <div className="flex items-center bg-secondary/50 p-1 rounded-xl border border-border/40">
                  <Button
                    size="sm"
                    variant={riskFilter === "all" ? "default" : "ghost"}
                    onClick={() => setRiskFilter("all")}
                    className={cn(
                      "h-8 text-xs rounded-lg px-3 transition-all",
                      riskFilter === "all" ? "bg-primary text-primary-foreground shadow-sm font-semibold hover:bg-primary/95" : "hover:bg-background/50 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    All
                  </Button>
                  <Button
                    size="sm"
                    variant={riskFilter === "high" ? "default" : "ghost"}
                    onClick={() => setRiskFilter("high")}
                    className={cn(
                      "h-8 text-xs rounded-lg px-3 transition-all",
                      riskFilter === "high" ? "bg-primary text-primary-foreground shadow-sm font-semibold hover:bg-primary/95" : "hover:bg-background/50 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    High
                  </Button>
                  <Button
                    size="sm"
                    variant={riskFilter === "medium" ? "default" : "ghost"}
                    onClick={() => setRiskFilter("medium")}
                    className={cn(
                      "h-8 text-xs rounded-lg px-3 transition-all",
                      riskFilter === "medium" ? "bg-primary text-primary-foreground shadow-sm font-semibold hover:bg-primary/95" : "hover:bg-background/50 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Med
                  </Button>
                  <Button
                    size="sm"
                    variant={riskFilter === "low" ? "default" : "ghost"}
                    onClick={() => setRiskFilter("low")}
                    className={cn(
                      "h-8 text-xs rounded-lg px-3 transition-all",
                      riskFilter === "low" ? "bg-primary text-primary-foreground shadow-sm font-semibold hover:bg-primary/95" : "hover:bg-background/50 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Low
                  </Button>
                </div>
              </div>

              {/* 4. Peer Filter Group */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Peer:</span>
                <div className="flex items-center bg-secondary/50 p-1 rounded-xl border border-border/40">
                  <Button
                    size="sm"
                    variant={peerFilter === "all" ? "default" : "ghost"}
                    onClick={() => setPeerFilter("all")}
                    className={cn(
                      "h-8 text-xs rounded-lg px-3 transition-all",
                      peerFilter === "all" ? "bg-primary text-primary-foreground shadow-sm font-semibold hover:bg-primary/95" : "hover:bg-background/50 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    All
                  </Button>
                  <Button
                    size="sm"
                    variant={peerFilter === "assigned" ? "default" : "ghost"}
                    onClick={() => setPeerFilter("assigned")}
                    className={cn(
                      "h-8 text-xs rounded-lg px-3 transition-all",
                      peerFilter === "assigned" ? "bg-primary text-primary-foreground shadow-sm font-semibold hover:bg-primary/95" : "hover:bg-background/50 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Assigned
                  </Button>
                  <Button
                    size="sm"
                    variant={peerFilter === "unassigned" ? "default" : "ghost"}
                    onClick={() => setPeerFilter("unassigned")}
                    className={cn(
                      "h-8 text-xs rounded-lg px-3 transition-all",
                      peerFilter === "unassigned" ? "bg-primary text-primary-foreground shadow-sm font-semibold hover:bg-primary/95" : "hover:bg-background/50 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Unassigned
                  </Button>
                </div>
              </div>

              {/* Clear Filters Button */}
              {(statusFilter !== "all" ||
                riskFilter !== "all" ||
                peerFilter !== "all" ||
                searchQuery.trim().length > 0) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-9 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-xl px-3"
                  onClick={() => {
                    setSearchQuery("");
                    setStatusFilter("all");
                    setRiskFilter("all");
                    setPeerFilter("all");
                  }}
                >
                  <FilterX className="h-4 w-4 mr-1.5" />
                  Clear Filters
                </Button>
              )}
            </div>
          </div>

          <Card className="border border-border/80 shadow-sm rounded-2xl overflow-hidden bg-card">
            <CardHeader className="pb-3 border-b border-border/40 bg-muted/20 px-6 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg font-bold text-foreground">Student roster</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">Manage, screen, and assign peer supervision</p>
                </div>
                <p className="text-sm font-semibold bg-secondary/80 px-3 py-1 rounded-lg border border-border/30 text-muted-foreground">
                  {filteredStudents.length} of {students.length} students
                </p>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-12 text-center text-sm text-muted-foreground flex flex-col items-center justify-center gap-3">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <span>Loading student roster...</span>
                </div>
              ) : filteredStudents.length === 0 ? (
                <p className="p-12 text-center text-sm text-muted-foreground">No students match the current filters.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table className="w-full">
                    <TableHeader className="bg-muted/10">
                      <TableRow className="hover:bg-transparent border-b border-border/40">
                        <TableHead className="min-w-[200px] text-xs font-semibold uppercase tracking-wider py-3.5 pl-6 text-foreground">Student</TableHead>
                        <TableHead className="text-xs font-semibold uppercase tracking-wider py-3.5 text-foreground">Status</TableHead>
                        <TableHead className="text-xs font-semibold uppercase tracking-wider py-3.5 text-foreground">Risk</TableHead>
                        <TableHead className="min-w-[240px] text-xs font-semibold uppercase tracking-wider py-3.5 text-foreground">Peer Counselor</TableHead>
                        <TableHead className="hidden lg:table-cell text-xs font-semibold uppercase tracking-wider py-3.5 text-foreground">Sessions</TableHead>
                        <TableHead className="hidden md:table-cell text-xs font-semibold uppercase tracking-wider py-3.5 text-foreground">Last Active</TableHead>
                        <TableHead className="text-right min-w-[200px] text-xs font-semibold uppercase tracking-wider py-3.5 pr-6 text-foreground">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="divide-y divide-border/30">
                      {filteredStudents.map((student) => {
                        const hasPeer = Number(student.assignedPeerCounselorId) > 0;
                        const selectedPeerId = Number(
                          selectedPeerByStudent[student.id] ??
                            (student.assignedPeerCounselorId
                              ? String(student.assignedPeerCounselorId)
                              : "")
                        );
                        const showPeerControls =
                          student.riskLevel === "low" || hasPeer;
                        const isHighlighted = highlightedStudentId === student.id;
                        const supervisingCounselorId = Number(
                          sessions.find(
                            (session: any) =>
                              Number(session.student_id) === Number(student.id) &&
                              session.session_type === "chat" &&
                              session.assigned_role !== "peer_counselor" &&
                              session.status !== "completed" &&
                              session.status !== "cancelled"
                          )?.counselor_id || 0
                        );
                        const peerOptions = peerCounselors.filter((peer: any) => {
                          const peerId = Number(peer?.id || 0);
                          return (
                            peerId > 0 &&
                            peerId !== Number(student.id) &&
                            (!supervisingCounselorId || peerId !== supervisingCounselorId)
                          );
                        });

                        const initials = student.name
                          ? student.name
                              .split(" ")
                              .filter(Boolean)
                              .map((n) => n[0])
                              .join("")
                              .substring(0, 2)
                              .toUpperCase()
                          : "ST";

                        return (
                          <TableRow
                            key={student.id}
                            className={cn(
                              "transition-colors hover:bg-muted/30 border-b border-border/30",
                              isHighlighted && "bg-primary/5 hover:bg-primary/10"
                            )}
                          >
                            <TableCell className="py-3 pl-6">
                              <div className="flex items-center gap-3">
                                <div className="h-9 w-9 rounded-full bg-secondary flex items-center justify-center font-bold text-xs text-muted-foreground uppercase shadow-inner shrink-0 select-none border border-border/50">
                                  {initials}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="font-semibold text-sm text-foreground truncate">{student.name}</p>
                                    {student.isAnonymous && (
                                      <AnonymousModeIndicator variant="inline" audience="counselor" />
                                    )}
                                    {student.needsAssessment && (
                                      <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 font-normal bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/30">
                                        Check-in due
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted-foreground truncate mt-0.5">{student.email}</p>
                                  <p className="text-[10px] text-muted-foreground/85 mt-0.5 font-mono">ID {student.id}</p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="py-3">
                              <div className="flex flex-col items-start gap-1">
                                <Badge
                                  variant="secondary"
                                  className={cn(
                                    "text-[11px] font-medium py-0 px-2 rounded-md border",
                                    student.accountStatus === "active"
                                      ? "border-success/40 bg-success/15 text-success"
                                      : "border-warning/40 bg-warning/15 text-warning"
                                  )}
                                >
                                  {student.accountStatus}
                                </Badge>
                                <span className={cn(
                                  "text-[10px] pl-1 font-medium",
                                  student.isOnline ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
                                )}>
                                  ● {student.isOnline ? "Online" : "Offline"}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="py-3">
                              <Badge
                                variant="secondary"
                                className={cn(
                                  "capitalize text-[11px] font-medium py-0 px-2 rounded-md border flex items-center w-fit",
                                  riskBadgeClass(student.riskLevel)
                                )}
                              >
                                {student.riskLevel === "high" && (
                                  <AlertTriangle className="h-3.5 w-3.5 mr-1 text-destructive shrink-0 animate-pulse" />
                                )}
                                {student.riskLevel}
                              </Badge>
                            </TableCell>
                            <TableCell className="py-3">
                              {showPeerControls && (peerOptions.length > 0 || hasPeer) ? (
                                <div className="flex flex-col gap-1.5 max-w-[240px]">
                                  {hasPeer ? (
                                    <div className="flex items-center gap-1.5">
                                      <span className="inline-flex items-center text-xs font-semibold bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 px-2 py-0.5 rounded-md border border-blue-100 dark:border-blue-900/30 truncate max-w-[180px]">
                                        {peerCounselorNameById.get(Number(student.assignedPeerCounselorId)) ||
                                          `#${student.assignedPeerCounselorId}`}
                                      </span>
                                      {student.riskLevel !== "low" && (
                                        <span className="text-[10px] text-amber-500 font-bold" title="Risk has elevated! Review peer supervisor assignment!">⚠️</span>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-xs text-muted-foreground italic pl-1">Unassigned</span>
                                  )}
                                  <div className="flex items-center gap-1.5">
                                    <select
                                      className="h-7 w-28 rounded-lg border border-border/80 bg-background px-1.5 text-[11px] font-medium text-foreground focus:ring-1 focus:ring-primary/20 focus:border-primary/50"
                                      value={String(selectedPeerId || "")}
                                      onChange={(e) =>
                                        setSelectedPeerByStudent((prev) => ({
                                          ...prev,
                                          [student.id]: e.target.value,
                                        }))
                                      }
                                      disabled={assigningStudentId !== null}
                                    >
                                      <option value="">Select peer</option>
                                      {peerOptions.map((peer: any) => (
                                        <option key={peer.id} value={String(peer.id)}>
                                          {peer?.profile?.full_name || peer?.email || `Peer #${peer.id}`}
                                        </option>
                                      ))}
                                    </select>
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      className="h-7 text-[10px] px-2 rounded-lg font-medium hover:bg-secondary-foreground/10 transition-colors shrink-0"
                                      disabled={
                                        assigningStudentId !== null ||
                                        student.riskLevel !== "low" ||
                                        !selectedPeerId ||
                                        selectedPeerId === Number(student.assignedPeerCounselorId)
                                      }
                                      onClick={() => void handleAssignPeerCounselor(student)}
                                    >
                                      {assigningStudentId === student.id &&
                                      peerAssignmentAction === "assign"
                                        ? "…"
                                        : hasPeer
                                        ? "Reassign"
                                        : "Assign"}
                                    </Button>
                                    {hasPeer && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 text-[10px] px-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                                        disabled={assigningStudentId !== null}
                                        onClick={() => void handleUnassignPeerCounselor(student)}
                                      >
                                        {assigningStudentId === student.id &&
                                        peerAssignmentAction === "unassign"
                                          ? "…"
                                          : "Remove"}
                                      </Button>
                                    )}
                                  </div>
                                  {student.riskLevel !== "low" && hasPeer && (
                                    <p className="text-[9px] font-semibold text-amber-600 dark:text-amber-400 leading-none">
                                      ⚠️ Risk elevated - professional follow-up advised
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground bg-secondary/35 px-2.5 py-1 rounded-md border border-border/30 inline-block font-medium">
                                  {student.riskLevel === "low" ? "No peers available" : "Counselor only"}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="hidden lg:table-cell text-sm font-medium text-muted-foreground py-3">
                              {student.sessions}
                            </TableCell>
                            <TableCell className="hidden md:table-cell text-xs text-muted-foreground whitespace-nowrap py-3">
                              {student.lastSession}
                            </TableCell>
                            <TableCell className="text-right py-3 pr-6">
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="default"
                                  className="h-8 text-xs px-3 bg-primary text-primary-foreground hover:bg-primary/95 transition-all shadow-sm flex items-center justify-center min-w-[70px] rounded-xl font-semibold"
                                  onClick={() => void openStudentDetails(student)}
                                >
                                  <UserIcon className="h-3.5 w-3.5 mr-1" />
                                  View
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 text-xs px-3 border-border/80 text-foreground hover:bg-secondary transition-all flex items-center justify-center min-w-[90px] rounded-xl font-semibold bg-background"
                                  disabled={assigningAssessmentStudentId === student.id}
                                  onClick={() =>
                                    void handleAssignAssessment(
                                      student.id,
                                      student.name || `Student #${student.id}`
                                    )
                                  }
                                >
                                  <FileSpreadsheet className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
                                  {assigningAssessmentStudentId === student.id
                                    ? "…"
                                    : "Check-in"}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </main>
      </div>

      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Student details</DialogTitle>
            <DialogDescription>
              Wellness summary and account overview for supervision.
            </DialogDescription>
          </DialogHeader>

          {selectedStudent && (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="p-3 rounded-lg bg-secondary/30">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Name</p>
                  <p className="text-sm font-medium mt-1">{selectedStudent.name}</p>
                </div>
                <div className="p-3 rounded-lg bg-secondary/30">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Email</p>
                  <p className="text-sm font-medium mt-1">{selectedStudent.email}</p>
                </div>
                <div className="p-3 rounded-lg bg-secondary/30">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Risk</p>
                  <p className="text-sm font-medium mt-1 capitalize">{selectedStudent.riskLevel}</p>
                </div>
                <div className="p-3 rounded-lg bg-secondary/30">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Peer counselor</p>
                  <p className="text-sm font-medium mt-1">
                    {selectedStudent.assignedPeerCounselorId
                      ? peerCounselorNameById.get(Number(selectedStudent.assignedPeerCounselorId)) ||
                        `#${selectedStudent.assignedPeerCounselorId}`
                      : "Not assigned"}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-secondary/30">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Last active</p>
                  <p className="text-sm font-medium mt-1">{selectedStudent.lastSession}</p>
                </div>
                <div className="p-3 rounded-lg bg-secondary/30">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Wellness check-in</p>
                  <p className="text-sm font-medium mt-1">
                    {selectedStudent.needsAssessment ? "Due" : "Up to date"}
                  </p>
                </div>
              </div>

              {isSummaryLoading ? (
                <p className="text-sm text-muted-foreground">Loading wellness summary…</p>
              ) : studentSummary ? (
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="p-3 rounded-lg bg-secondary/30">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Wellness</p>
                    <p className="text-xl font-semibold mt-1">
                      {studentSummary?.scores?.wellness_score ?? "—"}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-secondary/30">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Stress</p>
                    <p className="text-xl font-semibold mt-1">
                      {studentSummary?.scores?.stress_level ?? "—"}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-secondary/30">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Burnout</p>
                    <p className="text-xl font-semibold mt-1">
                      {studentSummary?.scores?.burnout_risk ?? "—"}
                    </p>
                  </div>
                  {studentSummary?.mood?.recorded_at && (
                    <div className="md:col-span-3 p-3 rounded-lg bg-secondary/30 text-xs text-muted-foreground">
                      Last mood logged{" "}
                      {formatDistanceToNow(new Date(studentSummary.mood.recorded_at), {
                        addSuffix: true,
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No live summary available yet.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminStudents;
