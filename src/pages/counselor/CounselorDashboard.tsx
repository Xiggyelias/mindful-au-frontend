import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Appointment } from "@/hooks/useChatSession";
import {
  LayoutDashboard,
  MessageSquare,
  Calendar,
  Users,
  Brain,
  Video,
  FileText,
  Heart,
  Bell,
  TrendingUp,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { StatsCard } from "@/components/StatsCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/useAuth";
import { api, getApiErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle } from "lucide-react";

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

const DASHBOARD_APPOINTMENT_PAGE_SIZE = 120;
const DASHBOARD_SESSION_PAGE_SIZE = 200;
const DASHBOARD_SESSION_RETRY_PAGE_SIZE = 100;
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

const CounselorDashboard = () => {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [counselorWellness, setCounselorWellness] = useState<any>(null);
  const [diagnosticsSummary, setDiagnosticsSummary] = useState<any>(null);
  const [activeSessionStudentIds, setActiveSessionStudentIds] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const loadRequestRef = useRef(0);
  const { user } = useAuth();
  const { toast } = useToast();
  const userName = user?.profile?.full_name || user?.email?.split('@')[0] || "Counselor";
  const isApprovedCounselor = user?.roles?.some((r: { role: string; approved: boolean }) => r.role === "counselor" && r.approved);

  const loadDashboardData = useCallback(async () => {
    const requestId = ++loadRequestRef.current;

    if (!isApprovedCounselor) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const appointmentsPayload = await api.getAppointments({
        page: 1,
        per_page: DASHBOARD_APPOINTMENT_PAGE_SIZE,
        timeout_ms: 15000,
      });

      if (loadRequestRef.current !== requestId) {
        return;
      }

      const appointmentRows = toList<Appointment>(appointmentsPayload);
      setAppointments(appointmentRows);
      setIsLoading(false);

      // Stage 2: enrich with wellness, diagnostics summary, and active session students.
      void (async () => {
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

        const [wellnessResult, summaryResult, sessionsResult] = await Promise.allSettled([
          api.getCounselorWellnessSummary(),
          api.getAIDiagnosticsSummary({ days: 30 }),
          loadSessionSnapshot(),
        ]);

        if (loadRequestRef.current !== requestId) {
          return;
        }

        if (wellnessResult.status === "fulfilled") {
          setCounselorWellness(wellnessResult.value || null);
        }

        if (summaryResult.status === "fulfilled") {
          setDiagnosticsSummary(summaryResult.value || null);
        }

        const sessionRows = sessionsResult.status === "fulfilled" ? toList<any>(sessionsResult.value) : [];
        const uniqueStudentIds = Array.from(
          new Set(
            sessionRows
              .map((session) => Number(session?.student_id))
              .filter((id) => Number.isInteger(id) && id > 0)
          )
        );
        setActiveSessionStudentIds(uniqueStudentIds);
      })();
    } catch (err: unknown) {
      if (import.meta.env.DEV) {
        console.error("Failed to load counselor dashboard data", err);
      }
      if (loadRequestRef.current === requestId) {
        toast({
          title: "Could not load dashboard data",
          description: getApiErrorMessage(err, "Please try again."),
          variant: "destructive",
        });
      }
    } finally {
      if (loadRequestRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [isApprovedCounselor, toast, getApiErrorMessage]);

  useEffect(() => {
    if (!user?.id) {
      setIsLoading(false);
      return;
    }
    void loadDashboardData();
  }, [loadDashboardData, user?.id]);

  const today = useMemo(() => new Date(), []);
  const isSameDay = useCallback((dateStr?: string) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return (
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    );
  }, [today]);

  const todaysAppointments = useMemo(
    () => appointments.filter((a) => isSameDay(a.scheduled_at)),
    [appointments, isSameDay]
  );

  const completedToday = todaysAppointments.filter((a) => a.status === "completed").length;
  const pendingToday = todaysAppointments.filter(
    (a) => a.status === "scheduled" || a.status === "confirmed"
  ).length;

  const activeStudents = useMemo(() => {
    const ids = new Set<number>();
    appointments
      .map((appointment) => Number(appointment?.student_id))
      .filter((id) => Number.isInteger(id) && id > 0)
      .forEach((id) => ids.add(id));
    activeSessionStudentIds.forEach((id) => ids.add(id));
    return ids.size;
  }, [activeSessionStudentIds, appointments]);

  const aiAlertsCount = useMemo(
    () => Number(diagnosticsSummary?.high_or_critical || 0),
    [diagnosticsSummary]
  );

  const stats = [
    {
      title: "Today's Sessions",
      value: todaysAppointments.length,
      change: `${completedToday} completed, ${pendingToday} pending`,
      trend: "neutral" as const,
      icon: Calendar,
    },
    {
      title: "Active Students",
      value: activeStudents,
      change: "",
      trend: "neutral" as const,
      icon: Users,
    },
    {
      title: "Active Chats",
      value: activeSessionStudentIds.length,
      change: "Open chat sessions",
      trend: "neutral" as const,
      icon: MessageSquare,
    },
    {
      title: "AI Alerts",
      value: aiAlertsCount,
      change: "",
      trend: "neutral" as const,
      icon: Brain,
    },
  ];

  const handleViewAll = () => {
    navigate("/counselor/appointments");
  };

  const handleJoinSession = (apt: Appointment) => {
    if (apt.notes?.includes("Physical")) {
      navigate("/counselor/appointments");
    } else {
      navigate("/counselor/video");
    }
  };

  const handleViewAlerts = () => {
    navigate("/counselor/ai-insights");
  };

  const handleViewStudents = () => {
    navigate("/counselor/students");
  };

  // Block dashboard access until admin approval
  if (user && !isApprovedCounselor) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="max-w-lg w-full">
          <CardHeader className="flex flex-row items-center gap-3">
            <AlertTriangle className="h-6 w-6 text-warning" />
            <CardTitle>Counselor account pending approval</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>Your counselor account is awaiting admin approval. You will gain access to the dashboard once approved.</p>
            <p>If this seems like an error, please contact an administrator.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar
        items={navItems}
        userType="counselor"
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-72">
        <DashboardHeader
          title="Counselor Dashboard"
          onMenuClick={() => setSidebarOpen(true)}
        />

        <main className="p-4 lg:p-6 space-y-6">
          {/* Welcome Section */}
          <div className="glass-card bg-gradient-to-br from-info/20 to-info/5 border-info/20">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h2 className="text-2xl font-display font-bold text-foreground mb-2">
                  Welcome back, {userName}!
                </h2>
                <p className="text-muted-foreground">
                  Here are your latest sessions and students.
                </p>
              </div>
              <Button variant="hero" className="gap-2" onClick={handleViewAlerts}>
                <Bell className="h-4 w-4" />
                View Alerts
              </Button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {stats.map((s, idx) => (
              <StatsCard
                key={idx}
                title={s.title}
                value={s.value}
                change={s.change}
                trend={s.trend}
                icon={s.icon}
              />
            ))}
          </div>


          <div className="grid gap-6 lg:grid-cols-3">
            {/* Today's Schedule */}
            <Card variant="glass" className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-lg flex items-center justify-between">
                  Today's Schedule
                  <Button variant="ghost" size="sm" onClick={handleViewAll}>
                    View All
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {isLoading ? (
                    <p className="text-muted-foreground text-sm">Loading today&apos;s schedule...</p>
                  ) : todaysAppointments.length === 0 ? (
                    <p className="text-muted-foreground text-sm">No sessions scheduled for today.</p>
                  ) : (
                    todaysAppointments.map((apt) => (
                      <div
                        key={apt.id}
                        className="flex items-center gap-4 p-4 rounded-xl bg-secondary/30"
                      >
                        <div className="text-center min-w-[90px]">
                          <p className="text-sm font-medium text-foreground">
                            {apt.scheduled_at
                              ? new Date(apt.scheduled_at).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : ""}
                          </p>
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-foreground">
                            {apt.student?.profile?.full_name || apt.student?.email || "Student"}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {apt.notes?.includes("Physical") ? "Physical" : "Online"}
                          </p>
                        </div>
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-medium ${
                            apt.status === "completed"
                              ? "bg-success/20 text-success"
                              : "bg-warning/20 text-warning"
                          }`}
                        >
                          {apt.status}
                        </span>
                        {apt.status === "scheduled" && (
                          <Button 
                            size="sm" 
                            onClick={() => handleJoinSession(apt)}
                          >
                            {apt.notes?.includes("Physical") ? "Details" : "Join"}
                          </Button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            {/* AI Wellness Check */}
            <Card variant="glass" className="border-info/20">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Heart className="h-5 w-5 text-info" />
                  Your Wellness
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-muted-foreground">Stress Level</span>
                    <span className="text-foreground font-medium">
                      {counselorWellness?.labels?.stress ?? "--"}
                    </span>
                  </div>
                  <Progress
                    value={typeof counselorWellness?.scores?.stress_level === "number" ? counselorWellness.scores.stress_level : 0}
                    className="h-2"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-muted-foreground">Burnout Risk</span>
                    <span className="text-foreground font-medium">
                      {counselorWellness?.labels?.burnout ?? "--"}
                    </span>
                  </div>
                  <Progress
                    value={typeof counselorWellness?.scores?.burnout_index === "number" ? counselorWellness.scores.burnout_index : 0}
                    className="h-2"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-muted-foreground">Workload</span>
                    <span className="text-foreground font-medium">
                      {typeof counselorWellness?.metrics?.workload_index === "number"
                        ? `${counselorWellness.metrics.workload_index}%`
                        : "--"}
                    </span>
                  </div>
                  <Progress
                    value={typeof counselorWellness?.metrics?.workload_index === "number" ? counselorWellness.metrics.workload_index : 0}
                    className="h-2"
                  />
                </div>
                {counselorWellness?.recommendations && (
                  <div className="pt-2 text-sm text-muted-foreground">
                    <p>Live recommendation: {counselorWellness.recommendations}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Student Emotional Trends */}
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                Student Risk Trends
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-4">
                {(() => {
                  const byRisk = diagnosticsSummary?.by_risk_level || {};

                  return [
                    { label: "Low", count: Number(byRisk.low || 0), color: "bg-success/20 text-success" },
                    { label: "Medium", count: Number(byRisk.medium || 0), color: "bg-warning/20 text-warning" },
                    { label: "High", count: Number(byRisk.high || 0), color: "bg-info/20 text-info" },
                    { label: "Critical", count: Number(byRisk.critical || 0), color: "bg-primary/20 text-primary" },
                  ].map((item, i) => (
                    <Button
                      key={i}
                      variant="ghost"
                      className="h-auto p-4 rounded-xl bg-secondary/30 hover:bg-secondary/50 flex-col gap-2"
                      onClick={handleViewStudents}
                    >
                      <div
                        className={`inline-flex items-center justify-center h-12 w-12 rounded-full ${item.color}`}
                      >
                        <span className="text-xl font-bold">{item.count}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{item.label}</p>
                    </Button>
                  ));
                })()}
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default CounselorDashboard;
