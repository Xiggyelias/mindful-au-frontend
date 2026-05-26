import { useCallback, useEffect, useMemo, useState } from "react";
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
  AlertTriangle,
  TrendingDown,
  Bell,
  RefreshCcw,
  Loader2,
  CheckCheck,
  Clock,
  ChevronRight,
  ShieldAlert,
  Activity,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  anonymousLabelForCounselor,
  isAnonymousIdentityMaskedFromViewer,
} from "@/lib/anonymousMode";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/counselor/dashboard" },
  { label: "Messages", icon: MessageSquare, path: "/counselor/messages" },
  { label: "Appointments", icon: Calendar, path: "/counselor/appointments" },
  { label: "Students", icon: Users, path: "/counselor/students" },
  { label: "AI Insights", icon: Brain, path: "/counselor/ai-insights" },
  { label: "Video Sessions", icon: Video, path: "/counselor/video" },
  { label: "Session Notes", icon: FileText, path: "/counselor/notes" },
  { label: "Wellness", icon: Heart, path: "/counselor/wellness" },
  { label: "Alerts", icon: AlertTriangle, path: "/counselor/alerts" },
];

type RiskLevel = "low" | "medium" | "high" | "critical";

interface RiskStudent {
  student_id: number;
  student: { id: number; name: string; email: string };
  risk_level: RiskLevel;
  risk_score: number;
  confidence: number;
  trend: { label: string; delta: number };
  reasons: string[];
  recommended_action: string;
}

interface AppNotification {
  id: number;
  title: string;
  message: string;
  type: string;
  read: boolean;
  created_at: string;
}

type PanicAlert = {
  id: number;
  title: string;
  message: string;
  created_at: string;
  resolved_at?: string | null;
  status: "active" | "resolved";
  raw_location?: string | null;
  map_query?: string | null;
  student_id?: number;
  student_detail_line?: string;
};

function normalizeRiskLevel(level: unknown): RiskLevel {
  const s = String(level ?? "").toLowerCase();
  if (s === "high" || s === "critical" || s === "medium" || s === "low") return s;
  return "low";
}

function clamp(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

function formatTimeAgo(dateString?: string): string {
  if (!dateString) return "unknown time";
  const diffMs = Date.now() - new Date(dateString).getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins} min ago`;
  const hours = Math.floor(diffMins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function extractLatLngFromLocation(raw: string | null | undefined): string | null {
  if (raw == null || typeof raw !== "string") return null;
  const match = raw.match(/-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?/);
  if (!match?.[0]) return null;
  return match[0].replace(/\s*,\s*/, ", ");
}

function buildPanicStudentSummary(log: {
  student_id?: unknown;
  student?: {
    email?: string | null;
    profile?: { full_name?: string | null; id_number?: string | null } | null;
  } | null;
}): {
  studentId: number;
  displayName: string;
  detailLine: string;
} {
  const studentId = Number(log.student_id);
  const profile = log.student?.profile;
  const fullName = typeof profile?.full_name === "string" ? profile.full_name.trim() : "";
  const email =
    typeof log.student?.email === "string" && log.student.email.trim() !== ""
      ? log.student.email.trim()
      : undefined;
  const idNumber =
    profile?.id_number != null && String(profile.id_number).trim() !== ""
      ? String(profile.id_number).trim()
      : undefined;

  const displayName =
    fullName ||
    (email ? email.split("@")[0] : "") ||
    email ||
    (Number.isFinite(studentId) && studentId > 0 ? `Student #${studentId}` : "Unknown student");

  const parts: string[] = [];
  if (Number.isFinite(studentId) && studentId > 0) {
    parts.push(`User ID ${studentId}`);
  }
  if (email) {
    parts.push(email);
  }
  if (idNumber) {
    parts.push(`Institution ID ${idNumber}`);
  }

  return {
    studentId: Number.isFinite(studentId) ? studentId : 0,
    displayName,
    detailLine: parts.join(" - "),
  };
}

const RISK_BADGE_CLASS: Record<RiskLevel, string> = {
  critical: "bg-destructive/20 text-destructive border-destructive/30",
  high: "bg-orange-500/20 text-orange-600 border-orange-500/30",
  medium: "bg-yellow-500/20 text-yellow-600 border-yellow-500/30",
  low: "bg-green-500/20 text-green-600 border-green-500/30",
};

const RISK_BORDER_CLASS: Record<RiskLevel, string> = {
  critical: "border-l-destructive bg-destructive/5",
  high: "border-l-orange-500 bg-orange-500/5",
  medium: "border-l-yellow-500 bg-yellow-500/5",
  low: "border-l-green-500 bg-green-500/5",
};

function TrendBadge({ trend }: { trend: { label: string; delta: number } }) {
  if (trend.label === "worsening") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
        <TrendingDown className="h-3 w-3" />
        Worsening{trend.delta !== 0 ? ` (${trend.delta > 0 ? "+" : ""}${trend.delta})` : ""}
      </span>
    );
  }
  if (trend.label === "improving") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600">
        <Activity className="h-3 w-3" />
        Improving
      </span>
    );
  }
  if (trend.label === "stable") {
    return (
      <span className="text-xs font-medium text-muted-foreground">Stable</span>
    );
  }
  return (
    <span className="text-xs text-muted-foreground">Insufficient data</span>
  );
}

const CounselorAlerts = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || "Counselor";

  const [riskStudents, setRiskStudents] = useState<RiskStudent[]>([]);
  const [worseningStudents, setWorseningStudents] = useState<RiskStudent[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [panicAlerts, setPanicAlerts] = useState<PanicAlert[]>([]);
  const [summary, setSummary] = useState({ high_or_critical: 0, worsening_trend: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [markingId, setMarkingId] = useState<number | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [resolvingPanicId, setResolvingPanicId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadAlerts = useCallback(async (showRefreshSpinner = false) => {
    try {
      if (showRefreshSpinner) setIsRefreshing(true);
      setLoadError(null);

      const [dashData, notifData, panicData] = await Promise.all([
        api.getCounselorDiagnosticDashboard().catch(() => null),
        api.getNotifications({ limit: 60 }).catch(() => []),
        api.getPanicLogs().catch(() => []),
      ]);

      // ── Risk students from diagnostic dashboard ────────────────────────────
      const mapObservation = (raw: Record<string, unknown>): RiskStudent => {
        const studentRaw = (raw.student as RiskStudent["student"]) || { id: 0, name: "Student", email: "" };
        const isMasked = isAnonymousIdentityMaskedFromViewer(raw as any);
        const trendRaw = raw.trend as { label?: string; delta?: unknown } | undefined;
        return {
          student_id: Number(raw.student_id) || 0,
          student: {
            id: Number(studentRaw.id) || 0,
            name: isMasked ? anonymousLabelForCounselor() : String(studentRaw.name || "Student"),
            email: isMasked ? "" : String(studentRaw.email || ""),
          },
          risk_level: normalizeRiskLevel(raw.risk_level),
          risk_score: clamp(raw.risk_score),
          confidence: clamp(raw.confidence),
          trend: {
            label:
              trendRaw?.label === "improving" ||
              trendRaw?.label === "stable" ||
              trendRaw?.label === "worsening" ||
              trendRaw?.label === "insufficient_data"
                ? trendRaw.label
                : "insufficient_data",
            delta: Number.isFinite(Number(trendRaw?.delta)) ? Number(trendRaw?.delta) : 0,
          },
          reasons: Array.isArray(raw.reasons)
            ? (raw.reasons as unknown[]).filter((r): r is string => typeof r === "string")
            : [],
          recommended_action: String(raw.recommended_action || "Continue routine monitoring."),
        };
      };

      if (dashData) {
        const highRaw: Record<string, unknown>[] = Array.isArray(dashData.high_risk_students)
          ? dashData.high_risk_students
          : [];
        setRiskStudents(highRaw.map(mapObservation));

        const allObs: Record<string, unknown>[] = Array.isArray(dashData.student_observations)
          ? dashData.student_observations
          : [];
        setWorseningStudents(
          allObs.map(mapObservation).filter((o) => o.trend.label === "worsening")
        );

        setSummary({
          high_or_critical: Number(dashData.summary?.high_or_critical) || 0,
          worsening_trend: Number(dashData.summary?.worsening_trend) || 0,
        });
      }

      // ── Notifications ──────────────────────────────────────────────────────
      const rawNotifs: AppNotification[] = (
        Array.isArray(notifData) ? notifData : Array.isArray(notifData?.data) ? notifData.data : []
      ).map((n: any) => ({
        id: Number(n.id),
        title: String(n.title || ""),
        message: String(n.message || ""),
        type: String(n.type || "info"),
        read: Boolean(n.read),
        created_at: String(n.created_at || ""),
      }));
      setNotifications(rawNotifs);

      const panicLogs: any[] = Array.isArray(panicData)
        ? panicData
        : Array.isArray((panicData as any)?.data)
        ? (panicData as any).data
        : [];

      const mappedPanic: PanicAlert[] = panicLogs.map((log: any) => {
        const student = buildPanicStudentSummary(log);
        const mapCoords = extractLatLngFromLocation(log.location);
        const locationSuffix = log.location ? ` (at ${mapCoords ?? log.location})` : "";

        return {
          id: Number(log.id),
          title: "Student Needs Help",
          message: `${student.displayName} clicked I Need Help Now${locationSuffix}`,
          created_at: String(log.created_at || ""),
          resolved_at: log.resolved_at ? String(log.resolved_at) : null,
          status: log.resolved ? "resolved" : "active",
          raw_location: typeof log.location === "string" ? log.location : null,
          map_query: mapCoords,
          student_id: student.studentId > 0 ? student.studentId : undefined,
          student_detail_line: student.detailLine || undefined,
        };
      });
      setPanicAlerts(mappedPanic);
    } catch (err: any) {
      const msg = err?.response?.data?.message || "Failed to load alerts.";
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  // Initial load + visible-tab polling every 15 s
  useEffect(() => {
    if (!user?.id) return;
    void loadAlerts();

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadAlerts();
    }, 15_000);

    const onVisible = () => {
      if (document.visibilityState === "visible") void loadAlerts();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user?.id, loadAlerts]);

  const unreadAlertNotifs = useMemo(
    () => notifications.filter((n) => !n.read && (n.type === "warning" || n.type === "panic")),
    [notifications]
  );

  const activePanicAlerts = useMemo(
    () => panicAlerts.filter((alert) => alert.status === "active"),
    [panicAlerts]
  );

  const resolvedTodayPanicAlerts = useMemo(() => {
    const today = new Date().toDateString();
    return panicAlerts.filter(
      (alert) => alert.resolved_at && new Date(alert.resolved_at).toDateString() === today
    );
  }, [panicAlerts]);

  const allAlertNotifs = useMemo(
    () =>
      notifications
        .filter((n) => n.type === "warning" || n.type === "panic" || n.type === "info")
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [notifications]
  );

  const handleMarkRead = async (id: number) => {
    try {
      setMarkingId(id);
      await api.markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
    } catch {
      toast.error("Could not mark notification as read.");
    } finally {
      setMarkingId(null);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      setMarkingAll(true);
      await api.markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      toast.success("All notifications marked as read.");
    } catch {
      toast.error("Could not mark all as read.");
    } finally {
      setMarkingAll(false);
    }
  };

  const handleResolvePanic = async (alertId: number) => {
    try {
      setResolvingPanicId(alertId);
      await api.updatePanicLog(alertId, { resolved: true });
      toast.success("Emergency alert marked as resolved.");
      await loadAlerts();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Could not resolve emergency alert.");
    } finally {
      setResolvingPanicId(null);
    }
  };

  const handleViewStudent = (studentId: number) => {
    navigate(`/counselor/students?open=${encodeURIComponent(String(studentId))}`);
  };

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar
        items={navItems}
        userType="counselor"
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-72 pl-0">
        <DashboardHeader title="Alerts" onMenuClick={() => setSidebarOpen(true)} />

        <main className="p-4 lg:p-6 space-y-6">
          {/* Toolbar */}
          <div className="flex items-center justify-end gap-2">
            {unreadAlertNotifs.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleMarkAllRead()}
                disabled={markingAll}
              >
                {markingAll ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCheck className="h-4 w-4 mr-2" />
                )}
                Mark all read
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadAlerts(true)}
              disabled={isRefreshing || isLoading}
            >
              {isRefreshing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCcw className="h-4 w-4 mr-2" />
              )}
              Refresh
            </Button>
          </div>

          {/* Error banner */}
          {loadError && !isLoading && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {loadError}
            </div>
          )}

          {/* Summary cards */}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card variant="glass" className="border-destructive/30">
              <CardContent className="pt-6 text-center">
                <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-2" />
                <p className="text-3xl font-bold text-destructive">
                  {isLoading ? "..." : activePanicAlerts.length}
                </p>
                <p className="text-muted-foreground text-sm">Active Emergencies</p>
              </CardContent>
            </Card>

            <Card variant="glass" className="border-destructive/30">
              <CardContent className="pt-6 text-center">
                <ShieldAlert className="h-8 w-8 text-destructive mx-auto mb-2" />
                <p className="text-3xl font-bold text-destructive">
                  {isLoading ? "..." : summary.high_or_critical}
                </p>
                <p className="text-muted-foreground text-sm">High / Critical Risk</p>
              </CardContent>
            </Card>

            <Card variant="glass" className="border-orange-500/30">
              <CardContent className="pt-6 text-center">
                <TrendingDown className="h-8 w-8 text-orange-500 mx-auto mb-2" />
                <p className="text-3xl font-bold text-orange-500">
                  {isLoading ? "..." : summary.worsening_trend}
                </p>
                <p className="text-muted-foreground text-sm">Worsening Trend</p>
              </CardContent>
            </Card>

            <Card variant="glass" className="border-warning/30">
              <CardContent className="pt-6 text-center">
                <Bell className="h-8 w-8 text-warning mx-auto mb-2" />
                <p className="text-3xl font-bold text-warning">
                  {isLoading ? "..." : unreadAlertNotifs.length}
                </p>
                <p className="text-muted-foreground text-sm">Unread Alerts</p>
              </CardContent>
            </Card>
          </div>

          {/* Emergency help requests */}
          <Card variant="glass">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Emergency Help Requests
                {!isLoading && activePanicAlerts.length > 0 && (
                  <Badge variant="outline" className="ml-1 bg-destructive/20 text-destructive border-destructive/30 text-xs">
                    {activePanicAlerts.length} active
                  </Badge>
                )}
              </CardTitle>
              {!isLoading && resolvedTodayPanicAlerts.length > 0 && (
                <Badge variant="outline" className="bg-success/20 text-success border-success/30 text-xs">
                  {resolvedTodayPanicAlerts.length} resolved today
                </Badge>
              )}
            </CardHeader>
            <CardContent>
              {isLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading...
                </div>
              )}
              {!isLoading && panicAlerts.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No student help requests have been logged yet.
                </p>
              )}
              <div className="space-y-3">
                {!isLoading &&
                  panicAlerts.map((alert) => (
                    <div
                      key={alert.id}
                      className={`rounded-xl border-l-4 p-4 ${
                        alert.status === "active"
                          ? "border-l-destructive bg-destructive/10"
                          : "border-l-muted bg-secondary/20 opacity-70"
                      }`}
                    >
                      <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium text-foreground text-sm">{alert.title}</p>
                            <Badge
                              variant="outline"
                              className={
                                alert.status === "active"
                                  ? "bg-destructive/20 text-destructive border-destructive/30 text-xs"
                                  : "bg-success/20 text-success border-success/30 text-xs"
                              }
                            >
                              {alert.status}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{alert.message}</p>
                          {alert.student_detail_line && (
                            <p className="text-xs text-foreground/90 mt-1 font-mono bg-secondary/40 rounded-md px-2 py-1 inline-block max-w-full break-all">
                              {alert.student_detail_line}
                            </p>
                          )}
                          <p className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                            <Clock className="h-3 w-3" />
                            {formatTimeAgo(alert.created_at)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                          {alert.student_id ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs h-7"
                              onClick={() => handleViewStudent(alert.student_id!)}
                            >
                              Student profile
                            </Button>
                          ) : null}
                          {(alert.map_query || extractLatLngFromLocation(alert.raw_location)) && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs h-7"
                              onClick={() => {
                                const q = alert.map_query ?? extractLatLngFromLocation(alert.raw_location) ?? "";
                                window.open(
                                  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`,
                                  "_blank",
                                );
                              }}
                            >
                              View on Maps
                            </Button>
                          )}
                          {alert.status === "active" && (
                            <Button
                              size="sm"
                              variant="default"
                              className="text-xs h-7"
                              onClick={() => void handleResolvePanic(alert.id)}
                              disabled={resolvingPanicId === alert.id}
                            >
                              {resolvingPanicId === alert.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                "Mark resolved"
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>

          {/* High-risk students */}
          <Card variant="glass">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-destructive" />
                High &amp; Critical Risk Students
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs gap-1"
                onClick={() => navigate("/counselor/ai-insights")}
              >
                AI Insights
                <ChevronRight className="h-3 w-3" />
              </Button>
            </CardHeader>
            <CardContent>
              {isLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading…
                </div>
              )}
              {!isLoading && riskStudents.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No high or critical risk students at this time.
                </p>
              )}
              <div className="space-y-3">
                {!isLoading &&
                  riskStudents.map((s) => (
                    <div
                      key={s.student_id}
                      className={`rounded-xl border-l-4 p-4 ${RISK_BORDER_CLASS[s.risk_level]}`}
                    >
                      <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium text-foreground truncate">{s.student.name}</p>
                            <Badge
                              variant="outline"
                              className={`text-xs capitalize ${RISK_BADGE_CLASS[s.risk_level]}`}
                            >
                              {s.risk_level}
                            </Badge>
                            <TrendBadge trend={s.trend} />
                          </div>
                          {s.student.email && (
                            <p className="text-xs text-muted-foreground">{s.student.email}</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {s.recommended_action}
                          </p>
                          {s.reasons.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {s.reasons.slice(0, 3).map((r) => (
                                <span
                                  key={r}
                                  className="inline-block rounded-full bg-secondary/60 px-2 py-0.5 text-xs text-foreground/70"
                                >
                                  {r}
                                </span>
                              ))}
                              {s.reasons.length > 3 && (
                                <span className="text-xs text-muted-foreground">
                                  +{s.reasons.length - 3} more
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {s.student_id > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs h-7"
                              onClick={() => handleViewStudent(s.student_id)}
                            >
                              Profile
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="default"
                            className="text-xs h-7"
                            onClick={() => navigate("/counselor/ai-insights")}
                          >
                            View Insights
                          </Button>
                        </div>
                      </div>
                      {/* Risk score bar */}
                      <div className="mt-3 flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              s.risk_level === "critical"
                                ? "bg-destructive"
                                : s.risk_level === "high"
                                ? "bg-orange-500"
                                : s.risk_level === "medium"
                                ? "bg-yellow-500"
                                : "bg-green-500"
                            }`}
                            style={{ width: `${s.risk_score}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-14 text-right shrink-0">
                          Score {s.risk_score}%
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>

          {/* Worsening trend students (excluding those already shown above) */}
          {!isLoading && worseningStudents.length > 0 && (
            <Card variant="glass">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingDown className="h-5 w-5 text-orange-500" />
                  Worsening Trend Students
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {worseningStudents.map((s) => (
                    <div
                      key={s.student_id}
                      className="rounded-xl border-l-4 border-l-orange-500 bg-orange-500/5 p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium text-foreground truncate">{s.student.name}</p>
                            <Badge
                              variant="outline"
                              className={`text-xs capitalize ${RISK_BADGE_CLASS[s.risk_level]}`}
                            >
                              {s.risk_level}
                            </Badge>
                            <TrendBadge trend={s.trend} />
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-1">
                            {s.recommended_action}
                          </p>
                        </div>
                        {s.student_id > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-7 shrink-0"
                            onClick={() => handleViewStudent(s.student_id)}
                          >
                            Profile
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* System notifications */}
          <Card variant="glass">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Bell className="h-5 w-5 text-warning" />
                System Notifications
                {unreadAlertNotifs.length > 0 && (
                  <Badge variant="outline" className="ml-1 bg-warning/20 text-warning border-warning/30 text-xs">
                    {unreadAlertNotifs.length} unread
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading…
                </div>
              )}
              {!isLoading && allAlertNotifs.length === 0 && (
                <p className="text-sm text-muted-foreground">No notifications.</p>
              )}
              <div className="space-y-3">
                {!isLoading &&
                  allAlertNotifs.map((notif) => (
                    <div
                      key={notif.id}
                      className={`rounded-xl border-l-4 p-4 transition-opacity ${
                        notif.type === "warning" || notif.type === "panic"
                          ? "border-l-warning bg-warning/5"
                          : "border-l-muted bg-secondary/20"
                      } ${notif.read ? "opacity-60" : ""}`}
                    >
                      <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium text-foreground text-sm">{notif.title}</p>
                            {!notif.read && (
                              <span className="inline-block h-2 w-2 rounded-full bg-warning shrink-0" />
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">{notif.message}</p>
                          <p className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                            <Clock className="h-3 w-3" />
                            {formatTimeAgo(notif.created_at)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {!notif.read && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs h-7"
                              disabled={markingId === notif.id}
                              onClick={() => void handleMarkRead(notif.id)}
                            >
                              {markingId === notif.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                "Mark read"
                              )}
                            </Button>
                          )}
                          {(notif.type === "warning" ||
                            notif.title.toLowerCase().includes("risk")) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-xs h-7"
                              onClick={() => navigate("/counselor/ai-insights")}
                            >
                              AI Insights
                              <ChevronRight className="h-3 w-3 ml-1" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default CounselorAlerts;
