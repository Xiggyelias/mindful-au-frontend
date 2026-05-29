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
                activeChatSessionId: Number(assignedSession?.id || sessionId),
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

          <div className="grid gap-4 md:grid-cols-5">
            <Card variant="glass" className="bg-gradient-to-br from-red-50 to-transparent dark:from-red-950/20">
              <CardContent className="pt-6">
                <p className="text-3xl font-bold text-red-600 dark:text-red-400">{stats.total}</p>
                <p className="text-xs font-medium text-muted-foreground mt-1">Total Students</p>
              </CardContent>
            </Card>
            <Card variant="glass" className="bg-gradient-to-br from-green-50 to-transparent dark:from-green-950/20">
              <CardContent className="pt-6">
                <p className="text-3xl font-bold text-green-600 dark:text-green-400">{stats.active}</p>
                <p className="text-xs font-medium text-muted-foreground mt-1">Active</p>
              </CardContent>
            </Card>
            <Card variant="glass" className="bg-gradient-to-br from-orange-50 to-transparent dark:from-orange-950/20">
              <CardContent className="pt-6">
                <p className="text-3xl font-bold text-orange-600 dark:text-orange-400">{stats.atRisk}</p>
                <p className="text-xs font-medium text-muted-foreground mt-1">High Risk</p>
              </CardContent>
            </Card>
            <Card variant="glass" className="bg-gradient-to-br from-blue-50 to-transparent dark:from-blue-950/20">
              <CardContent className="pt-6">
                <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">{stats.peerAssigned}</p>
                <p className="text-xs font-medium text-muted-foreground mt-1">Peer Supervised</p>
              </CardContent>
            </Card>
            <Card variant="glass" className="bg-gradient-to-br from-gray-50 to-transparent dark:from-gray-950/20">
              <CardContent className="pt-6">
                <p className="text-3xl font-bold text-muted-foreground">{stats.pending}</p>
                <p className="text-xs font-medium text-muted-foreground mt-1">Pending Approval</p>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col gap-4">
            <div className="relative max-w-xl">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, email, ID, or peer counselor..."
                className="pl-9"
              />
            </div>

            <div className="flex flex-col gap-4 md:gap-3">
              {/* Status Filter Group */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase min-w-[60px]">Status:</span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={statusFilter === "all" ? "default" : "outline"}
                    onClick={() => setStatusFilter("all")}
                    className="text-xs"
                  >
                    <Filter className="h-3.5 w-3.5 mr-1" />
                    All
                  </Button>
                  <Button
                    size="sm"
                    variant={statusFilter === "active" ? "default" : "outline"}
                    onClick={() => setStatusFilter("active")}
                    className="text-xs"
                  >
                    Active
                  </Button>
                  <Button
                    size="sm"
                    variant={statusFilter === "pending" ? "default" : "outline"}
                    onClick={() => setStatusFilter("pending")}
                    className="text-xs"
                  >
                    Pending
                  </Button>
                </div>
              </div>

              {/* Risk Filter Group */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase min-w-[60px]">Risk:</span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={riskFilter === "all" ? "default" : "outline"}
                    onClick={() => setRiskFilter("all")}
                    className="text-xs"
                  >
                    All
                  </Button>
                  <Button
                    size="sm"
                    variant={riskFilter === "high" ? "default" : "outline"}
                    onClick={() => setRiskFilter("high")}
                    className="text-xs"
                  >
                    High
                  </Button>
                  <Button
                    size="sm"
                    variant={riskFilter === "medium" ? "default" : "outline"}
                    onClick={() => setRiskFilter("medium")}
                    className="text-xs"
                  >
                    Medium
                  </Button>
                  <Button
                    size="sm"
                    variant={riskFilter === "low" ? "default" : "outline"}
                    onClick={() => setRiskFilter("low")}
                    className="text-xs"
                  >
                    Low
                  </Button>
                </div>
              </div>

              {/* Peer Assignment Filter Group */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase min-w-[60px]">Peer:</span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={peerFilter === "assigned" ? "default" : "outline"}
                    onClick={() => setPeerFilter(peerFilter === "assigned" ? "all" : "assigned")}
                    className="text-xs"
                  >
                    Assigned
                  </Button>
                  <Button
                    size="sm"
                    variant={peerFilter === "unassigned" ? "default" : "outline"}
                    onClick={() => setPeerFilter(peerFilter === "unassigned" ? "all" : "unassigned")}
                    className="text-xs"
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
                <div className="pt-2 border-t border-border">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setSearchQuery("");
                      setStatusFilter("all");
                      setRiskFilter("all");
                      setPeerFilter("all");
                    }}
                  >
                    <FilterX className="h-3.5 w-3.5 mr-1" />
                    Clear all filters
                  </Button>
                </div>
              )}
            </div>
          </div>

          <Card variant="glass">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Student roster</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {filteredStudents.length} of {students.length}
                </p>
              </div>
            </CardHeader>
            <CardContent className="p-0 sm:p-6 sm:pt-0">
              {isLoading ? (
                <p className="p-6 text-sm text-muted-foreground">Loading students...</p>
              ) : filteredStudents.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">No students match the current filters.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[180px]">Student</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Risk</TableHead>
                        <TableHead className="min-w-[220px]">Peer counselor</TableHead>
                        <TableHead className="hidden lg:table-cell">Sessions</TableHead>
                        <TableHead className="hidden md:table-cell">Last active</TableHead>
                        <TableHead className="text-right min-w-[200px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
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

                        return (
                          <TableRow
                            key={student.id}
                            className={isHighlighted ? "bg-primary/5" : undefined}
                          >
                            <TableCell>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="font-medium truncate">{student.name}</p>
                                  {student.isAnonymous && (
                                    <AnonymousModeIndicator variant="inline" audience="counselor" />
                                  )}
                                  {student.needsAssessment && (
                                    <Badge variant="outline" className="text-[10px]">
                                      Check-in due
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground truncate">{student.email}</p>
                                <p className="text-[10px] text-muted-foreground">ID {student.id}</p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                <Badge
                                  variant="secondary"
                                  className={
                                    student.accountStatus === "active"
                                      ? "border-success/40 bg-success/15 text-success"
                                      : "border-warning/40 bg-warning/15 text-warning"
                                  }
                                >
                                  {student.accountStatus}
                                </Badge>
                                <p className="text-[10px] text-muted-foreground">
                                  {student.isOnline ? "Online" : "Offline"}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className={`capitalize ${riskBadgeClass(student.riskLevel)}`}>
                                {student.riskLevel === "high" && (
                                  <AlertTriangle className="h-3 w-3 mr-1" />
                                )}
                                {student.riskLevel}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {showPeerControls && peerCounselors.length > 0 ? (
                                <div className="space-y-2">
                                  {hasPeer && (
                                    <p className="text-xs font-medium text-blue-700 dark:text-blue-400 truncate">
                                      {peerCounselorNameById.get(Number(student.assignedPeerCounselorId)) ||
                                        `#${student.assignedPeerCounselorId}`}
                                    </p>
                                  )}
                                  <select
                                    className="h-8 w-full max-w-[200px] rounded-md border border-input bg-background px-2 text-xs"
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
                                    {peerCounselors.map((peer: any) => (
                                      <option key={peer.id} value={String(peer.id)}>
                                        {peer?.profile?.full_name || peer?.email || `Peer #${peer.id}`}
                                      </option>
                                    ))}
                                  </select>
                                  <div className="flex flex-wrap gap-1">
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      className="h-7 text-[10px] px-2"
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
                                        className="h-7 text-[10px] px-2 text-destructive"
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
                                    <p className="text-[10px] text-amber-600 dark:text-amber-400">
                                      Risk changed — consider professional follow-up.
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  {student.riskLevel === "low" ? "No peers available" : "Counselor only"}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                              {student.sessions}
                            </TableCell>
                            <TableCell className="hidden md:table-cell text-xs text-muted-foreground whitespace-nowrap">
                              {student.lastSession}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex flex-col items-end gap-1.5">
                                <Button
                                  size="sm"
                                  variant="default"
                                  className="h-8 text-xs w-full sm:w-auto"
                                  onClick={() => void openStudentDetails(student)}
                                >
                                  <UserIcon className="h-3.5 w-3.5 mr-1" />
                                  View
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 text-xs w-full sm:w-auto"
                                  disabled={assigningAssessmentStudentId === student.id}
                                  onClick={() =>
                                    void handleAssignAssessment(
                                      student.id,
                                      student.name || `Student #${student.id}`
                                    )
                                  }
                                >
                                  <FileSpreadsheet className="h-3.5 w-3.5 mr-1" />
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
