import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  UserCheck,
  BarChart3,
  Brain,
  AlertTriangle,
  FileText,
  Settings,
  Search,
  Filter,
  FilterX,
  RefreshCcw,
  Loader2,
} from "lucide-react";
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
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { toast } from "sonner";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/admin/dashboard" },
  { label: "Students", icon: Users, path: "/admin/students" },
  { label: "Counselors", icon: UserCheck, path: "/admin/counselors" },
  { label: "Analytics", icon: BarChart3, path: "/admin/analytics" },
  { label: "AI Reports", icon: Brain, path: "/admin/ai-reports" },
  { label: "Alerts", icon: AlertTriangle, path: "/admin/alerts" },
  { label: "Logs", icon: FileText, path: "/admin/logs" },
  { label: "Settings", icon: Settings, path: "/admin/settings" },
];

type StatusFilter = "all" | "active" | "pending";

const AdminStudents = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || "Admin";

  const [searchParams, setSearchParams] = useSearchParams();
  const [diagnostics, setDiagnostics] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [selectedStudent, setSelectedStudent] = useState<any | null>(null);
  const [studentSummary, setStudentSummary] = useState<any | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);

  const loadStudents = useCallback(async () => {
    try {
      setIsLoading(true);
      const [studentData, diagnosticData] = await Promise.all([
        api.getStudents(),
        api.getAIDiagnostics().catch(() => []),
      ]);

      const studentList = Array.isArray(studentData)
        ? studentData
        : Array.isArray((studentData as any)?.data)
        ? (studentData as any).data
        : [];

      const diagnosticList = Array.isArray(diagnosticData)
        ? diagnosticData
        : Array.isArray((diagnosticData as any)?.data)
        ? (diagnosticData as any).data
        : [];

      setStudents(studentList);
      setDiagnostics(diagnosticList);
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
  }, [user, loadStudents]);

  useEffect(() => {
    if (!user) {
      return;
    }
    const rawOpen = searchParams.get("open");
    const openId = rawOpen ? Number(rawOpen) : NaN;
    if (!Number.isFinite(openId) || openId <= 0 || students.length === 0 || isLoading) {
      return;
    }

    const match = students.find((s) => Number(s.id) === openId);

    const next = new URLSearchParams(searchParams);
    if (!match) {
      next.delete("open");
      setSearchParams(next, { replace: true });
      return;
    }

    next.delete("open");
    setSearchParams(next, { replace: true });

    setSelectedStudent(match);
    setStudentSummary(null);
    setIsDetailsOpen(true);

    void (async () => {
      try {
        setIsSummaryLoading(true);
        const summary = await api.getStudentWellnessSummary(openId);
        setStudentSummary(summary || null);
      } catch (error: any) {
        const message = error?.response?.data?.message || "Failed to load student details";
        toast.error(message);
      } finally {
        setIsSummaryLoading(false);
      }
    })();
  }, [students, isLoading, searchParams, setSearchParams, user]);

  const latestDiagnosticByStudent = useMemo(() => {
    const map = new Map<number, any>();

    for (const diagnostic of diagnostics) {
      const studentId = Number(diagnostic?.student_id);
      if (!studentId) continue;

      const existing = map.get(studentId);
      if (!existing) {
        map.set(studentId, diagnostic);
        continue;
      }

      const existingTime = new Date(existing.created_at || 0).getTime();
      const nextTime = new Date(diagnostic.created_at || 0).getTime();
      if (nextTime > existingTime) {
        map.set(studentId, diagnostic);
      }
    }

    return map;
  }, [diagnostics]);

  const stats = useMemo(() => {
    const total = students.length;
    const active = students.filter((s) => s.roles?.some((r: any) => r.role === "student" && r.approved)).length;
    const pending = total - active;
    const atRisk = students.filter((student) => {
      const diagnostic = latestDiagnosticByStudent.get(Number(student.id));
      const level = String(diagnostic?.risk_level || "").toLowerCase();
      return level === "high" || level === "critical";
    }).length;

    return {
      total,
      active,
      pending,
      atRisk,
    };
  }, [students, latestDiagnosticByStudent]);

  const filteredStudents = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();

    return students.filter((student) => {
      const name = String(student.profile?.full_name || student.name || "").toLowerCase();
      const email = String(student.email || "").toLowerCase();
      const idText = String(student.id || "");
      const isActive = student.roles?.some((r: any) => r.role === "student" && r.approved);
      const status = isActive ? "active" : "pending";

      const matchesSearch =
        search.length === 0 ||
        name.includes(search) ||
        email.includes(search) ||
        idText.includes(search);

      const matchesStatus = statusFilter === "all" || statusFilter === status;

      return matchesSearch && matchesStatus;
    });
  }, [students, searchQuery, statusFilter]);

  const handleViewStudent = async (student: any) => {
    setSelectedStudent(student);
    setStudentSummary(null);
    setIsDetailsOpen(true);

    try {
      setIsSummaryLoading(true);
      const summary = await api.getStudentWellnessSummary(Number(student.id));
      setStudentSummary(summary || null);
    } catch (error: any) {
      const message = error?.response?.data?.message || "Failed to load student details";
      toast.error(message);
    } finally {
      setIsSummaryLoading(false);
    }
  };

  const selectedStudentRisk = selectedStudent
    ? String(latestDiagnosticByStudent.get(Number(selectedStudent.id))?.risk_level || "unknown").toLowerCase()
    : "unknown";

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar
        items={navItems}
        userType="admin"
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-72">
        <DashboardHeader
          title="Students Management"
          onMenuClick={() => setSidebarOpen(true)}
        />

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

          <div className="grid gap-4 md:grid-cols-4">
            <Card variant="glass" className="text-center">
              <CardContent className="pt-6">
                <p className="text-4xl font-bold text-primary">{stats.total}</p>
                <p className="text-muted-foreground">Total Students</p>
              </CardContent>
            </Card>
            <Card variant="glass" className="text-center">
              <CardContent className="pt-6">
                <p className="text-4xl font-bold text-success">{stats.active}</p>
                <p className="text-muted-foreground">Active</p>
              </CardContent>
            </Card>
            <Card variant="glass" className="text-center">
              <CardContent className="pt-6">
                <p className="text-4xl font-bold text-warning">{stats.atRisk}</p>
                <p className="text-muted-foreground">At Risk</p>
              </CardContent>
            </Card>
            <Card variant="glass" className="text-center">
              <CardContent className="pt-6">
                <p className="text-4xl font-bold text-info">{stats.pending}</p>
                <p className="text-muted-foreground">Pending Approval</p>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col md:flex-row md:flex-wrap gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search students by name, email, or ID..."
                className="pl-9"
              />
            </div>
            <Button
              variant={statusFilter === "all" ? "default" : "outline"}
              className="gap-2"
              onClick={() => setStatusFilter("all")}
            >
              <Filter className="h-4 w-4" />
              All
            </Button>
            <Button
              variant={statusFilter === "active" ? "default" : "outline"}
              className="gap-2"
              onClick={() => setStatusFilter("active")}
            >
              Active
            </Button>
            <Button
              variant={statusFilter === "pending" ? "default" : "outline"}
              className="gap-2"
              onClick={() => setStatusFilter("pending")}
            >
              Pending
            </Button>
            {(statusFilter !== "all" || searchQuery.trim().length > 0) && (
              <Button
                variant="ghost"
                className="gap-2"
                onClick={() => {
                  setSearchQuery("");
                  setStatusFilter("all");
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
              <CardTitle className="text-lg">All Students</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-muted-foreground text-sm">Loading students...</p>
              ) : (
                <div className="space-y-4">
                  {filteredStudents.map((student) => {
                    const name = student.profile?.full_name || student.name || "Anonymous";
                    const email = student.email || "N/A";
                    const status = student.roles?.some((r: any) => r.role === "student" && r.approved) ? "active" : "pending";
                    const risk = String(latestDiagnosticByStudent.get(Number(student.id))?.risk_level || "unknown").toLowerCase();

                    return (
                      <div
                        key={student.id}
                        className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl bg-secondary/30"
                      >
                        <div className="flex items-center gap-4">
                          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                            <span className="text-primary font-medium">
                              {String(student.id).slice(-2)}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{name}</p>
                            <p className="text-sm text-muted-foreground">{email}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-sm text-muted-foreground">ID: {student.id}</span>
                          <Badge
                            variant="secondary"
                            className={
                              status === "active"
                                ? "capitalize border-success/40 bg-success/15 text-success"
                                : "capitalize border-warning/40 bg-warning/15 text-warning"
                            }
                          >
                            {status}
                          </Badge>
                          <Badge
                            variant="secondary"
                            className={
                              risk === "critical"
                                ? "capitalize border-destructive/40 bg-destructive/15 text-destructive"
                                : risk === "high"
                                ? "capitalize border-warning/40 bg-warning/15 text-warning"
                                : "capitalize border-muted bg-muted/60 text-muted-foreground"
                            }
                          >
                            {risk}
                          </Badge>
                          <Button size="sm" variant="outline" onClick={() => void handleViewStudent(student)}>
                            View
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  {filteredStudents.length === 0 && (
                    <p className="text-muted-foreground text-sm">
                      No students match the current search or filter.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </main>
      </div>

      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Student Details</DialogTitle>
          </DialogHeader>

          {selectedStudent && (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="p-3 rounded-lg bg-secondary/30">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Name</p>
                  <p className="text-sm font-medium text-foreground mt-1">
                    {selectedStudent.profile?.full_name || selectedStudent.name || "N/A"}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-secondary/30">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Email</p>
                  <p className="text-sm font-medium text-foreground mt-1">{selectedStudent.email || "N/A"}</p>
                </div>
                <div className="p-3 rounded-lg bg-secondary/30">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Student ID</p>
                  <p className="text-sm font-medium text-foreground mt-1">{selectedStudent.id}</p>
                </div>
                <div className="p-3 rounded-lg bg-secondary/30">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Latest Risk</p>
                  <p className="text-sm font-medium text-foreground mt-1 capitalize">{selectedStudentRisk}</p>
                </div>
              </div>

              {isSummaryLoading ? (
                <p className="text-sm text-muted-foreground">Loading live wellness summary...</p>
              ) : studentSummary ? (
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="p-3 rounded-lg bg-secondary/30">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Wellness</p>
                    <p className="text-xl font-semibold text-foreground mt-1">
                      {studentSummary?.scores?.wellness_score ?? "--"}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-secondary/30">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Stress</p>
                    <p className="text-xl font-semibold text-foreground mt-1">
                      {studentSummary?.scores?.stress_level ?? "--"}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-secondary/30">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Burnout</p>
                    <p className="text-xl font-semibold text-foreground mt-1">
                      {studentSummary?.scores?.burnout_risk ?? "--"}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No live summary available for this student yet.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminStudents;
