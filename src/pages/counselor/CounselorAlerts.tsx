import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  TrendingDown,
  Bell,
  RefreshCcw,
  Loader2,
  CheckCheck,
  Clock,
  ShieldAlert,
} from "lucide-react";
import { counselorNavItems } from "@/config/counselorNavItems";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { toast } from "sonner";

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

type EmergencyRequestAlert = {
  id: number;
  title: string;
  message: string;
  requested_at: string;
  created_at: string;
  status: "queued" | "assigned" | "resolved" | "cancelled";
  reason?: string | null;
  student_id?: number;
  student_detail_line?: string;
  assigned_to?: number | null;
  counselor_slot_id?: number | null;
  assignee_name?: string | null;
};

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

const CounselorAlerts = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || "Counselor";

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [panicAlerts, setPanicAlerts] = useState<PanicAlert[]>([]);
  const [emergencyRequests, setEmergencyRequests] = useState<EmergencyRequestAlert[]>([]);
  const [summary, setSummary] = useState({ high_or_critical: 0, worsening_trend: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [markingId, setMarkingId] = useState<number | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [resolvingPanicId, setResolvingPanicId] = useState<number | null>(null);
  const [updatingEmergencyId, setUpdatingEmergencyId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const highlightedEmergencyId = Number(searchParams.get("emergency") || 0);

  const loadAlerts = useCallback(async (showRefreshSpinner = false) => {
    try {
      if (showRefreshSpinner) setIsRefreshing(true);
      setLoadError(null);

      const [dashData, notifData, panicData, emergencyData] = await Promise.all([
        api.getCounselorDiagnosticDashboard().catch(() => null),
        api.getNotifications({ limit: 60 }).catch(() => []),
        api.getPanicLogs().catch(() => []),
        api.getEmergencyRequests().catch(() => []),
      ]);

      if (dashData) {
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

      const emergencyRows: any[] = Array.isArray(emergencyData)
        ? emergencyData
        : Array.isArray((emergencyData as any)?.data)
        ? (emergencyData as any).data
        : [];

      const mappedEmergency: EmergencyRequestAlert[] = emergencyRows.map((row: any) => {
        const student = buildPanicStudentSummary(row);
        const requestedAt = String(row.requested_at || row.created_at || "");
        const assigneeName =
          row.assignee?.profile?.full_name ||
          row.assignee?.email ||
          null;

        return {
          id: Number(row.id),
          title: row.status === "assigned" ? "Emergency Request Assigned" : "Emergency Support Request",
          message: `${student.displayName} requested emergency support for ${
            requestedAt ? new Date(requestedAt).toLocaleString() : "now"
          }.`,
          requested_at: requestedAt,
          created_at: String(row.created_at || requestedAt),
          status: String(row.status || "queued") as EmergencyRequestAlert["status"],
          reason: typeof row.reason === "string" ? row.reason : null,
          student_id: student.studentId > 0 ? student.studentId : undefined,
          student_detail_line: student.detailLine || undefined,
          assigned_to: row.assigned_to ? Number(row.assigned_to) : null,
          counselor_slot_id: row.counselor_slot_id ? Number(row.counselor_slot_id) : null,
          assignee_name: assigneeName,
        };
      });
      setEmergencyRequests(mappedEmergency);
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

  const activeEmergencyRequests = useMemo(
    () => emergencyRequests.filter((alert) => alert.status === "queued" || alert.status === "assigned"),
    [emergencyRequests]
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

  const handleTakeEmergency = async (alertId: number) => {
    try {
      setUpdatingEmergencyId(alertId);
      await api.updateEmergencyRequest(alertId, { status: "assigned" });
      toast.success("Emergency request assigned to you.");
      await loadAlerts();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Could not assign emergency request.");
    } finally {
      setUpdatingEmergencyId(null);
    }
  };

  const handleResolveEmergency = async (alertId: number) => {
    try {
      setUpdatingEmergencyId(alertId);
      await api.updateEmergencyRequest(alertId, { status: "resolved" });
      toast.success("Emergency request marked as resolved.");
      await loadAlerts();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Could not resolve emergency request.");
    } finally {
      setUpdatingEmergencyId(null);
    }
  };

  const handleViewStudent = (studentId: number) => {
    navigate(`/counselor/students?open=${encodeURIComponent(String(studentId))}`);
  };

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
                  {isLoading ? "..." : activePanicAlerts.length + activeEmergencyRequests.length}
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

          {/* Emergency support requests */}
          <Card variant="glass">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-destructive" />
                Emergency Support Requests
                {!isLoading && activeEmergencyRequests.length > 0 && (
                  <Badge variant="outline" className="ml-1 bg-destructive/20 text-destructive border-destructive/30 text-xs">
                    {activeEmergencyRequests.length} active
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading...
                </div>
              )}
              {!isLoading && emergencyRequests.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No after-hours emergency support requests are queued.
                </p>
              )}
              <div className="space-y-3">
                {!isLoading &&
                  emergencyRequests.map((alert) => {
                    const isActive = alert.status === "queued" || alert.status === "assigned";
                    const isHighlighted = highlightedEmergencyId === alert.id;
                    const isAssignedWithoutSlot =
                      alert.status === "assigned" &&
                      !alert.counselor_slot_id &&
                      (!alert.assigned_to || Number(alert.assigned_to) === Number(user?.id));

                    return (
                      <div
                        key={alert.id}
                        className={`rounded-xl border-l-4 p-4 ${
                          isActive
                            ? "border-l-destructive bg-destructive/10"
                            : "border-l-muted bg-secondary/20 opacity-70"
                        } ${isHighlighted ? "ring-2 ring-destructive/50" : ""}`}
                      >
                        <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-foreground text-sm">{alert.title}</p>
                              <Badge
                                variant="outline"
                                className={
                                  isActive
                                    ? "bg-destructive/20 text-destructive border-destructive/30 text-xs"
                                    : "bg-success/20 text-success border-success/30 text-xs"
                                }
                              >
                                {alert.status}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">{alert.message}</p>
                            {alert.reason && (
                              <p className="text-sm text-foreground/90">Reason: {alert.reason}</p>
                            )}
                            {alert.assignee_name && (
                              <p className="text-xs text-muted-foreground">Assigned to {alert.assignee_name}</p>
                            )}
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
                                Student Profile
                              </Button>
                            ) : null}
                            {alert.status === "queued" && (
                              <Button
                                size="sm"
                                variant="default"
                                className="text-xs h-7"
                                onClick={() => void handleTakeEmergency(alert.id)}
                                disabled={updatingEmergencyId === alert.id}
                              >
                                {updatingEmergencyId === alert.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Take Case"}
                              </Button>
                            )}
                            {isAssignedWithoutSlot && (
                              <Button
                                size="sm"
                                variant="default"
                                className="text-xs h-7"
                                onClick={() => void handleTakeEmergency(alert.id)}
                                disabled={updatingEmergencyId === alert.id}
                              >
                                {updatingEmergencyId === alert.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Prepare Slot"}
                              </Button>
                            )}
                            {isActive && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs h-7"
                                onClick={() => void handleResolveEmergency(alert.id)}
                                disabled={updatingEmergencyId === alert.id}
                              >
                                {updatingEmergencyId === alert.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Mark Resolved"}
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </CardContent>
          </Card>

          {/* Panic button help requests */}
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
                              Student Profile
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
                                "Mark Resolved"
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

          {/* Recent Alert Notifications */}
          <Card variant="glass">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Bell className="h-5 w-5 text-warning" />
                Recent Alert Notifications
                {!isLoading && unreadAlertNotifs.length > 0 && (
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
                  Loading...
                </div>
              )}
              {!isLoading && allAlertNotifs.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No alert notifications yet.
                </p>
              )}
              <div className="space-y-3">
                {!isLoading &&
                  allAlertNotifs.map((notif) => {
                    const isPanic = notif.type === "panic";
                    const isWarning = notif.type === "warning";
                    return (
                      <div
                        key={notif.id}
                        className={`rounded-xl border-l-4 p-4 ${
                          isPanic
                            ? "border-l-destructive bg-destructive/10"
                            : isWarning
                            ? "border-l-orange-500 bg-orange-500/10"
                            : "border-l-muted bg-secondary/20"
                        } ${notif.read ? "opacity-70" : ""}`}
                      >
                        <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-foreground text-sm">{notif.title}</p>
                              {!notif.read && (
                                <Badge
                                  variant="outline"
                                  className={
                                    isPanic
                                      ? "bg-destructive/20 text-destructive border-destructive/30 text-xs"
                                      : isWarning
                                      ? "bg-orange-500/20 text-orange-500 border-orange-500/30 text-xs"
                                      : "bg-primary/20 text-primary border-primary/30 text-xs"
                                  }
                                >
                                  {isPanic ? "urgent" : isWarning ? "warning" : "new"}
                                </Badge>
                              )}
                              {notif.read && (
                                <Badge variant="outline" className="bg-muted/20 text-muted-foreground border-muted/30 text-xs">
                                  read
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground break-words">{notif.message}</p>
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
                                onClick={() => void handleMarkRead(notif.id)}
                                disabled={markingId === notif.id}
                              >
                                {markingId === notif.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  "Mark Read"
                                )}
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </CardContent>
          </Card>

        </main>
      </div>
    </div>
  );
};

export default CounselorAlerts;
