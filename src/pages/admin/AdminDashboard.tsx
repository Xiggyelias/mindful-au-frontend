import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  UserCheck,
  BarChart3,
  Brain,
  AlertTriangle,
  FileText,
  Settings,
  Shield,
  TrendingUp,
  Activity,
  RefreshCcw,
  Loader2,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { StatsCard } from "@/components/StatsCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
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

const formatDateTime = (value?: string | null) => {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Never" : date.toLocaleString();
};

const DASHBOARD_COUNSELOR_PAGE_SIZE = 80;
const DASHBOARD_APPOINTMENT_PAGE_SIZE = 120;
const DASHBOARD_SESSION_PAGE_SIZE = 160;
const DASHBOARD_SESSION_RETRY_PAGE_SIZE = 80;
const DASHBOARD_SESSION_TIMEOUT_MS = 20000;
const DASHBOARD_SESSION_RETRY_TIMEOUT_MS = 45000;

const toList = <T,>(payload: unknown): T[] => {
  if (Array.isArray(payload)) {
    return payload as T[];
  }
  if (payload && typeof payload === "object" && Array.isArray((payload as any).data)) {
    return (payload as any).data as T[];
  }
  return [];
};

const toMetaTotal = (payload: unknown, fallback: number): number => {
  if (!payload || typeof payload !== "object") return fallback;
  const total = Number((payload as any)?.meta?.total);
  return Number.isFinite(total) && total >= 0 ? Math.floor(total) : fallback;
};

const AdminDashboard = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || "Admin";

  const [stats, setStats] = useState({ students: 0, counselors: 0, sessions: 0, alerts: 0 });
  const [activeCounselors, setActiveCounselors] = useState<any[]>([]);
  const [counselorStatusSummary, setCounselorStatusSummary] = useState({ total: 0, available: 0 });
  const [appointments, setAppointments] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [confirmingAppointmentId, setConfirmingAppointmentId] = useState<number | null>(null);
  const loadRequestRef = useRef(0);

  const loadDashboardData = useCallback(async () => {
    const requestId = ++loadRequestRef.current;

    const applyIfCurrent = (callback: () => void) => {
      if (loadRequestRef.current !== requestId) return;
      callback();
    };

    try {
      setIsLoading(true);
      const loadSessionSnapshot = async () => {
        try {
          return await api.getSessions({
            lightweight: true,
            open_only: true,
            page: 1,
            per_page: DASHBOARD_SESSION_PAGE_SIZE,
            timeout_ms: DASHBOARD_SESSION_TIMEOUT_MS,
          });
        } catch (err) {
          const isTimeout = (err as { code?: string })?.code === "ECONNABORTED";
          if (!isTimeout) {
            throw err;
          }

          return api.getSessions({
            lightweight: true,
            open_only: true,
            page: 1,
            per_page: DASHBOARD_SESSION_RETRY_PAGE_SIZE,
            timeout_ms: DASHBOARD_SESSION_RETRY_TIMEOUT_MS,
          });
        }
      };

      const [analyticsResult, counselorsResult, appointmentsResult, sessionsResult] = await Promise.allSettled([
        api.getAnalytics(),
        api.getCounselors({
          lightweight: true,
          page: 1,
          per_page: DASHBOARD_COUNSELOR_PAGE_SIZE,
          timeout_ms: 15000,
        }),
        api.getAppointments({
          page: 1,
          per_page: DASHBOARD_APPOINTMENT_PAGE_SIZE,
          timeout_ms: 15000,
        }),
        loadSessionSnapshot(),
      ]);

      if (loadRequestRef.current !== requestId) {
        return;
      }

      const analyticsRes = analyticsResult.status === "fulfilled" ? analyticsResult.value : null;
      const counselorPayload = counselorsResult.status === "fulfilled" ? counselorsResult.value : [];
      const appointmentPayload = appointmentsResult.status === "fulfilled" ? appointmentsResult.value : [];
      const sessionPayload = sessionsResult.status === "fulfilled" ? sessionsResult.value : [];
      const counselors = toList<any>(counselorPayload);
      const appointmentsRes = toList<any>(appointmentPayload);
      const sessionsRes = toList<any>(sessionPayload);

      const hasStageOneData =
        analyticsRes !== null ||
        counselors.length > 0 ||
        appointmentsRes.length > 0 ||
        sessionsRes.length > 0;
      if (!hasStageOneData) {
        throw new Error("Unable to load dashboard data");
      }

      const today = new Date().toDateString();
      const studentCount = Number(analyticsRes?.overview?.total_students ?? 0);
      const counselorCountFromAnalytics = Number(analyticsRes?.overview?.total_counselors);
      const counselorCount =
        Number.isFinite(counselorCountFromAnalytics) && counselorCountFromAnalytics >= 0
          ? Math.floor(counselorCountFromAnalytics)
          : toMetaTotal(counselorPayload, counselors.length);
      const sessionsTodayFromAnalytics = Number(analyticsRes?.appointments?.appointments_today);
      const sessionsTodayFallback = appointmentsRes.filter((apt: any) => {
        const aptDate = new Date(apt.scheduled_at).toDateString();
        return aptDate === today;
      }).length;
      const todaysSessions =
        Number.isFinite(sessionsTodayFromAnalytics) && sessionsTodayFromAnalytics >= 0
          ? Math.floor(sessionsTodayFromAnalytics)
          : sessionsTodayFallback;
      const stageOneHighRiskAlerts = Number(analyticsRes?.ai_diagnostics?.high_risk_alerts ?? 0);

      const counselorData = counselors.map((counselor: any) => {
        const todayAppointments = appointmentsRes.filter((apt: any) => {
          const aptDate = new Date(apt.scheduled_at).toDateString();
          const isToday = aptDate === today;
          return isToday && apt.counselor_id === counselor.id;
        }).length;

        const activeSession = sessionsRes.find(
          (session: any) => session.counselor_id === counselor.id && session.status === "active"
        );

        let status = "Offline";
        if (counselor.is_online) {
          status = activeSession ? "In Session" : "Available";
        }

        return {
          id: counselor.id,
          name: counselor.profile?.full_name || counselor.email?.split("@")[0] || "Unknown",
          status,
          sessions: todayAppointments,
        };
      });

      applyIfCurrent(() => {
        setStats({
          students: studentCount,
          counselors: counselorCount,
          sessions: todaysSessions,
          alerts:
            Number.isFinite(stageOneHighRiskAlerts) && stageOneHighRiskAlerts >= 0
              ? Math.floor(stageOneHighRiskAlerts)
              : 0,
        });
        setCounselorStatusSummary({
          total: counselorData.length,
          available: counselorData.filter((c) => c.status === "Available").length,
        });
        setActiveCounselors(counselorData.slice(0, 5));
        setAppointments(appointmentsRes);
        if (analyticsRes !== null) {
          setAnalytics(analyticsRes);
        }
        setLastSyncedAt(new Date().toISOString());
      });

      // Stage 2: load alert enrichment without blocking first paint.
      void (async () => {
        const [panicLogsResult, diagnosticsSummaryResult] = await Promise.allSettled([
          api.getPanicLogs(),
          api.getAIDiagnosticsSummary({ days: 30 }),
        ]);

        if (loadRequestRef.current !== requestId) {
          return;
        }

        const panicLogs =
          panicLogsResult.status === "fulfilled" && Array.isArray(panicLogsResult.value)
            ? panicLogsResult.value
            : [];
        const diagnosticsSummary =
          diagnosticsSummaryResult.status === "fulfilled" ? diagnosticsSummaryResult.value : null;
        const activePanicAlerts = panicLogs.filter((log: any) => !log.resolved).length;
        const highRiskAlerts = Number(
          diagnosticsSummary?.high_or_critical ?? analyticsRes?.ai_diagnostics?.high_risk_alerts ?? 0
        );

        setStats((prev) => ({
          ...prev,
          alerts:
            activePanicAlerts +
            (Number.isFinite(highRiskAlerts) && highRiskAlerts >= 0 ? Math.floor(highRiskAlerts) : 0),
        }));
      })();
    } catch (error) {
      console.error("Failed to load admin dashboard:", error);
      if (loadRequestRef.current === requestId) {
        toast.error("Failed to load dashboard data");
      }
    } finally {
      if (loadRequestRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (user) {
      void loadDashboardData();
    }
  }, [user, loadDashboardData]);

  const pendingAppointments = useMemo(() => {
    return appointments
      .filter((apt: any) => apt.status === "scheduled")
      .sort(
        (a: any, b: any) =>
          new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
      );
  }, [appointments]);

  const studentActivity = (() => {
    const totalStudents = analytics?.overview?.total_students || 0;
    const sessionsThisWeek = analytics?.sessions?.sessions_this_week || 0;
    if (totalStudents === 0) return 0;
    return Math.min(100, Math.round((sessionsThisWeek / totalStudents) * 100));
  })();

  const counselorAvailability = (() => {
    const totalCounselors = counselorStatusSummary.total || analytics?.overview?.total_counselors || 0;
    const available = counselorStatusSummary.available;
    if (totalCounselors === 0) return 0;
    return Math.min(100, Math.round((available / totalCounselors) * 100));
  })();

  const sessionCompletion = (() => {
    const totalSessions = analytics?.sessions?.total_sessions || 0;
    const completed = analytics?.sessions?.sessions_by_status?.completed || 0;
    if (totalSessions === 0) return 0;
    return Math.min(100, Math.round((completed / totalSessions) * 100));
  })();

  const pendingAppointmentsPercent = (() => {
    const total = analytics?.appointments?.total_appointments || 0;
    const pending = analytics?.overview?.pending_appointments || 0;
    if (total === 0) return 0;
    return Math.min(100, Math.round((pending / total) * 100));
  })();

  const diagnosticsCoverage = (() => {
    const totalStudents = analytics?.overview?.total_students || 0;
    const diagnostics = analytics?.ai_diagnostics?.diagnostics_this_month || 0;
    if (totalStudents === 0) return 0;
    return Math.min(100, Math.round((diagnostics / totalStudents) * 100));
  })();

  const handleConfirmAppointment = async (appointmentId: number) => {
    try {
      setConfirmingAppointmentId(appointmentId);
      await api.updateAppointment(String(appointmentId), { status: "confirmed" });
      toast.success("Appointment confirmed");
      await loadDashboardData();
    } catch (error: any) {
      const message = error?.response?.data?.message || "Failed to confirm appointment";
      toast.error(message);
    } finally {
      setConfirmingAppointmentId(null);
    }
  };

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
          title="Admin Dashboard"
          onMenuClick={() => setSidebarOpen(true)}
        />

        <main className="p-4 lg:p-6 space-y-6">
          <div className="glass-card bg-gradient-to-br from-purple-500/20 to-purple-500/5 border-purple-500/20">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-success/20">
                  <Activity className="h-6 w-6 text-success" />
                </div>
                <div>
                  <h2 className="text-xl font-display font-bold text-foreground">
                    System Status: Operational
                  </h2>
                  <p className="text-muted-foreground">
                    Live sync from backend. Last refresh: {formatDateTime(lastSyncedAt)}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="gap-2" onClick={() => navigate("/admin/logs")}>
                  <Shield className="h-4 w-4" />
                  Security Logs
                </Button>
                <Button variant="outline" className="gap-2" onClick={() => void loadDashboardData()} disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Refreshing
                    </>
                  ) : (
                    <>
                      <RefreshCcw className="h-4 w-4" />
                      Refresh
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <StatsCard
              title="Total Students"
              value={stats.students}
              change={`${stats.students} registered`}
              trend="neutral"
              icon={Users}
            />
            <StatsCard
              title="Counselors"
              value={stats.counselors}
              change="Approved and pending"
              trend="neutral"
              icon={UserCheck}
            />
            <StatsCard
              title="Sessions Today"
              value={stats.sessions}
              change="Scheduled today"
              trend="neutral"
              icon={Activity}
            />
            <StatsCard
              title="Open Alerts"
              value={stats.alerts}
              change="Panic + high risk"
              trend="neutral"
              icon={AlertTriangle}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card variant="glass" className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  System Analytics Overview
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between text-sm mb-2">
                        <span className="text-muted-foreground">Student Activity</span>
                        <span className="text-foreground font-medium">{studentActivity}%</span>
                      </div>
                      <Progress value={studentActivity} className="h-2" />
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-2">
                        <span className="text-muted-foreground">Counselor Availability</span>
                        <span className="text-foreground font-medium">{counselorAvailability}%</span>
                      </div>
                      <Progress value={counselorAvailability} className="h-2" />
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-2">
                        <span className="text-muted-foreground">Session Completion</span>
                        <span className="text-foreground font-medium">{sessionCompletion}%</span>
                      </div>
                      <Progress value={sessionCompletion} className="h-2" />
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between text-sm mb-2">
                        <span className="text-muted-foreground">AI Coverage</span>
                        <span className="text-foreground font-medium">{diagnosticsCoverage}%</span>
                      </div>
                      <Progress value={diagnosticsCoverage} className="h-2" />
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-2">
                        <span className="text-muted-foreground">Pending Appointments Ratio</span>
                        <span className="text-foreground font-medium">{pendingAppointmentsPercent}%</span>
                      </div>
                      <Progress value={pendingAppointmentsPercent} className="h-2" />
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-2">
                        <span className="text-muted-foreground">Active Sessions</span>
                        <span className="text-foreground font-medium">{analytics?.overview?.active_sessions ?? 0}</span>
                      </div>
                      <Progress value={Math.min(100, Number(analytics?.overview?.active_sessions ?? 0) * 10)} className="h-2" />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card variant="glass" className="border-purple-500/20">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Brain className="h-5 w-5 text-purple-400" />
                  AI Daily Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-3 rounded-xl bg-secondary/30">
                  <p className="text-sm text-foreground font-medium mb-1">Emotional Heatmap</p>
                  <p className="text-xs text-muted-foreground">
                    {analytics?.ai_diagnostics?.high_risk_alerts
                      ? `${analytics.ai_diagnostics.high_risk_alerts} high/critical diagnostics detected`
                      : "No high-risk diagnostics detected today"}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-secondary/30">
                  <p className="text-sm text-foreground font-medium mb-1">Counselor Workload</p>
                  <p className="text-xs text-muted-foreground">
                    {analytics?.overview?.active_sessions
                      ? `${analytics.overview.active_sessions} counselor(s) in active sessions`
                      : "No active sessions right now"}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-secondary/30">
                  <p className="text-sm text-foreground font-medium mb-1">7-Day Forecast</p>
                  <p className="text-xs text-muted-foreground">
                    {analytics?.appointments?.appointments_this_week
                      ? `${analytics.appointments.appointments_this_week} appointments scheduled this week`
                      : "No appointments scheduled this week"}
                  </p>
                </div>
                <Button variant="outline" className="w-full" size="sm" onClick={() => navigate("/admin/ai-reports")}>
                  View Full Report
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card variant="glass">
              <CardHeader>
                <CardTitle className="text-lg">Pending Actions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {isLoading ? (
                    <p className="text-sm text-muted-foreground">Loading pending items...</p>
                  ) : (
                    pendingAppointments.slice(0, 5).map((apt: any) => (
                      <div
                        key={apt.id}
                        className="flex items-center justify-between p-4 rounded-xl bg-secondary/30"
                      >
                        <div>
                          <p className="font-medium text-foreground">
                            {apt.student?.profile?.full_name || `Student #${apt.student_id}`} with{" "}
                            {apt.counselor?.profile?.full_name || `Counselor #${apt.counselor_id}`}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {new Date(apt.scheduled_at).toLocaleString()}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void handleConfirmAppointment(Number(apt.id))}
                          disabled={confirmingAppointmentId === Number(apt.id)}
                        >
                          {confirmingAppointmentId === Number(apt.id) ? "Confirming..." : "Confirm"}
                        </Button>
                      </div>
                    ))
                  )}

                  {!isLoading && pendingAppointments.length === 0 && (
                    <p className="text-sm text-muted-foreground">No pending appointments</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card variant="glass">
              <CardHeader>
                <CardTitle className="text-lg">Counselor Presence</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {isLoading ? (
                    <p className="text-sm text-muted-foreground">Loading counselors...</p>
                  ) : activeCounselors.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No counselors available</p>
                  ) : (
                    activeCounselors.map((counselor) => (
                      <div
                        key={counselor.id}
                        className="flex items-center gap-4 p-4 rounded-xl bg-secondary/30"
                      >
                        <div className="h-10 w-10 rounded-full bg-info/20 flex items-center justify-center">
                          <span className="text-info font-medium">
                            {counselor.name
                              .split(" ")
                              .map((n: string) => n[0])
                              .join("")
                              .slice(0, 2)
                              .toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-foreground">{counselor.name}</p>
                          <p className="text-sm text-muted-foreground">{counselor.sessions} sessions today</p>
                        </div>
                        <span
                          className={`px-2 py-1 rounded-full text-xs ${
                            counselor.status === "Available"
                              ? "bg-success/20 text-success"
                              : counselor.status === "In Session"
                              ? "bg-warning/20 text-warning"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {counselor.status}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
};

export default AdminDashboard;
