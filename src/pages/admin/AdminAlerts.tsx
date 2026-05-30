import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Clock, RefreshCcw, Loader2, AlertTriangle, Brain } from "lucide-react";
import { adminNavItems } from "@/config/adminNavItems";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { toast } from "sonner";

type PanicAlert = {
  id: number;
  type: "panic";
  title: string;
  message: string;
  created_at: string;
  resolved_at?: string | null;
  status: "active" | "resolved";
  /** Full stored location string from API */
  raw_location?: string;
  /** First lat,lng pair extracted for map links */
  map_query?: string | null;
  /** Roster user id for deep-linking */
  student_id?: number;
  /** Extra identifiers (user id, email, institution id) */
  student_detail_line?: string;
};

type RiskAlert = {
  id: string;
  type: "risk";
  title: string;
  message: string;
  created_at: string;
  status: "active";
  risk_level: "high" | "critical";
};

type AlertItem = PanicAlert | RiskAlert;

function extractLatLngFromLocation(raw: string | null | undefined): string | null {
  if (raw == null || typeof raw !== "string") return null;
  const m = raw.match(/-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?/);
  if (!m?.[0]) return null;
  return m[0].replace(/\s*,\s*/, ", ");
}

function buildPanicStudentSummary(log: {
  student_id?: unknown;
  student?: {
    email?: string;
    profile?: { full_name?: string | null; id_number?: string | null };
  };
}): {
  studentId: number;
  displayName: string;
  email?: string;
  idNumber?: string;
  detailLine: string;
} {
  const studentId = Number(log.student_id);
  const st = log.student;
  const profile = st?.profile;
  const fullName = typeof profile?.full_name === "string" ? profile.full_name.trim() : "";
  const email = typeof st?.email === "string" && st.email.trim() !== "" ? st.email.trim() : undefined;
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
    email,
    idNumber,
    detailLine: parts.join(" · "),
  };
}

const AdminAlerts = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || "Admin";

  const [alerts, setAlerts] = useState<PanicAlert[]>([]);
  const [riskAlerts, setRiskAlerts] = useState<RiskAlert[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRespondingId, setIsRespondingId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadAlerts = useCallback(async () => {
    try {
      setIsLoading(true);
      setErrorMessage(null);

      const [panicLogs, diagnosticsResponse] = await Promise.all([
        api.getPanicLogs(),
        api.getAIDiagnostics().catch(() => []),
      ]);

      // Backend returns either an array (non-paginated) or a PaginationPayload
      // ({ data, meta }) when page/per_page are passed. Normalize both shapes.
      const diagnostics: any[] = Array.isArray(diagnosticsResponse)
        ? diagnosticsResponse
        : Array.isArray((diagnosticsResponse as any)?.data)
        ? (diagnosticsResponse as any).data
        : [];

      const mappedPanic: PanicAlert[] = (panicLogs || []).map((log: any) => {
        const summary = buildPanicStudentSummary(log);
        const mapCoords = extractLatLngFromLocation(log.location);
        const locationSuffix = log.location
          ? ` (at ${mapCoords ?? log.location})`
          : "";

        return {
          id: Number(log.id),
          type: "panic",
          title: "Panic Button Triggered",
          message: `${summary.displayName} triggered panic button${locationSuffix}`,
          created_at: log.created_at,
          resolved_at: log.resolved_at,
          status: log.resolved ? "resolved" : "active",
          raw_location: log.location,
          map_query: mapCoords,
          student_id: summary.studentId > 0 ? summary.studentId : undefined,
          student_detail_line: summary.detailLine || undefined,
        };
      });

      const latestRiskByStudent = new Map<string, any>();
      for (const diagnostic of diagnostics) {
        const level = String(diagnostic?.risk_level || "").toLowerCase();
        if (level !== "high" && level !== "critical") continue;

        const key = String(diagnostic?.student_id || `diagnostic-${diagnostic?.id}`);
        const existing = latestRiskByStudent.get(key);
        if (!existing) {
          latestRiskByStudent.set(key, diagnostic);
          continue;
        }

        const existingTime = new Date(existing.created_at || 0).getTime();
        const nextTime = new Date(diagnostic.created_at || 0).getTime();
        if (nextTime > existingTime) {
          latestRiskByStudent.set(key, diagnostic);
        }
      }

      const mappedRisk: RiskAlert[] = Array.from(latestRiskByStudent.values()).map((diag: any) => {
        const level = String(diag.risk_level).toLowerCase() as "high" | "critical";
        const studentName = diag.student?.profile?.full_name || "Unknown student";

        return {
          id: `risk-${diag.id}`,
          type: "risk",
          title: level === "critical" ? "Critical Risk Alert" : "High Risk Alert",
          message: `AI flagged ${studentName} as ${level} risk`,
          created_at: diag.created_at,
          status: "active",
          risk_level: level,
        };
      });

      setAlerts(mappedPanic);
      setRiskAlerts(mappedRisk);
    } catch (error: any) {
      const message = error?.response?.data?.message || "Failed to load alerts";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;

    void loadAlerts();

    // Live refresh: panic alerts must surface promptly. Poll every 15s while
    // the tab is visible. NotificationCreated events broadcast in real-time
    // for individual user toasts; this poll keeps the list in sync regardless
    // of broadcaster availability.
    const intervalId = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      void loadAlerts();
    }, 15000);

    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void loadAlerts();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    return () => {
      window.clearInterval(intervalId);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, [user, loadAlerts]);

  const allAlerts = useMemo<AlertItem[]>(() => {
    return [...alerts, ...riskAlerts].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [alerts, riskAlerts]);

  const counts = useMemo(() => {
    const today = new Date().toDateString();
    const activeEmergencies = alerts.filter((a) => a.status === "active").length;
    const resolvedToday = alerts.filter(
      (a) => a.resolved_at && new Date(a.resolved_at).toDateString() === today
    ).length;
    const riskAlertsToday = riskAlerts.filter(
      (a) => new Date(a.created_at).toDateString() === today
    ).length;
    return { activeEmergencies, resolvedToday, riskAlertsToday };
  }, [alerts, riskAlerts]);

  const formatTimeAgo = (dateString?: string) => {
    if (!dateString) return "unknown time";

    const diffMs = Date.now() - new Date(dateString).getTime();
    const diffMinutes = Math.floor(diffMs / 60000);

    if (diffMinutes < 1) return "just now";
    if (diffMinutes < 60) return `${diffMinutes} min ago`;

    const hours = Math.floor(diffMinutes / 60);
    if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;

    const days = Math.floor(hours / 24);
    return `${days} day${days > 1 ? "s" : ""} ago`;
  };

  const getAlertIcon = (type: AlertItem["type"]) => {
    if (type === "panic") {
      return <AlertTriangle className="h-5 w-5 text-destructive" />;
    }
    return <Brain className="h-5 w-5 text-warning" />;
  };

  const handleRespond = async (alert: AlertItem) => {
    if (alert.type === "risk") {
      navigate("/admin/ai-reports");
      return;
    }

    if (alert.status !== "active") {
      return;
    }

    try {
      setIsRespondingId(alert.id);
      await api.updatePanicLog(alert.id, { resolved: true });
      toast.success("Alert marked as resolved");
      await loadAlerts();
    } catch (error: any) {
      const message = error?.response?.data?.message || "Failed to resolve alert";
      toast.error(message);
    } finally {
      setIsRespondingId(null);
    }
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
        <DashboardHeader
          title="System Alerts"
          onMenuClick={() => setSidebarOpen(true)}
        />

        <main className="p-4 lg:p-6 space-y-6">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => void loadAlerts()} disabled={isLoading}>
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

          {errorMessage && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {errorMessage}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            <Card variant="glass" className="border-destructive/30">
              <CardContent className="pt-6 text-center">
                <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-2" />
                <p className="text-3xl font-bold text-destructive">
                  {isLoading ? "..." : counts.activeEmergencies}
                </p>
                <p className="text-muted-foreground">Active Emergencies</p>
              </CardContent>
            </Card>
            <Card variant="glass" className="border-warning/30">
              <CardContent className="pt-6 text-center">
                <Brain className="h-8 w-8 text-warning mx-auto mb-2" />
                <p className="text-3xl font-bold text-warning">
                  {isLoading ? "..." : counts.riskAlertsToday}
                </p>
                <p className="text-muted-foreground">Risk Alerts Today</p>
              </CardContent>
            </Card>
            <Card variant="glass" className="border-success/30">
              <CardContent className="pt-6 text-center">
                <Check className="h-8 w-8 text-success mx-auto mb-2" />
                <p className="text-3xl font-bold text-success">
                  {isLoading ? "..." : counts.resolvedToday}
                </p>
                <p className="text-muted-foreground">Resolved Today</p>
              </CardContent>
            </Card>
          </div>

          <Card variant="glass">
            <CardHeader>
              <CardTitle className="text-lg">All Alerts</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {isLoading && (
                  <p className="text-sm text-muted-foreground">Loading alerts...</p>
                )}
                {!isLoading && allAlerts.length === 0 && (
                  <p className="text-sm text-muted-foreground">No alerts found.</p>
                )}

                {!isLoading &&
                  allAlerts.map((alert) => (
                    <div
                      key={alert.id}
                      className={`p-4 rounded-xl border-l-4 ${
                        alert.status === "active"
                          ? alert.type === "panic"
                            ? "bg-destructive/10 border-destructive"
                            : "bg-warning/10 border-warning"
                          : "bg-secondary/30 border-muted"
                      }`}
                    >
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-start gap-3">
                          {getAlertIcon(alert.type)}
                          <div>
                            <p className="font-medium text-foreground">{alert.title}</p>
                            <p className="text-sm text-muted-foreground">{alert.message}</p>
                            {alert.type === "panic" && alert.student_detail_line ? (
                              <p className="text-xs text-foreground/90 mt-1 font-mono bg-secondary/40 rounded-md px-2 py-1 inline-block max-w-full break-all">
                                {alert.student_detail_line}
                              </p>
                            ) : null}
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                              <Clock className="h-3 w-3" />
                              {formatTimeAgo(alert.created_at)}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-medium ${
                              alert.status === "active"
                                ? alert.type === "panic"
                                  ? "bg-destructive/20 text-destructive"
                                  : "bg-warning/20 text-warning"
                                : "bg-success/20 text-success"
                            }`}
                          >
                            {alert.status}
                          </span>

                          {alert.type === "panic" && alert.student_id ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs h-7"
                              onClick={() =>
                                navigate(`/admin/students?open=${encodeURIComponent(String(alert.student_id))}`)
                              }
                            >
                              Student Profile
                            </Button>
                          ) : null}

                          {alert.type === "panic" && (alert.map_query || extractLatLngFromLocation(alert.raw_location)) && (
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
                              variant={alert.type === "risk" ? "outline" : "default"}
                              onClick={() => void handleRespond(alert)}
                              disabled={alert.type === "panic" && isRespondingId === alert.id}
                            >
                              {alert.type === "risk" ? (
                                "View Reports"
                              ) : isRespondingId === alert.id ? (
                                <>
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  Resolving
                                </>
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
        </main>
      </div>
    </div>
  );
};

export default AdminAlerts;
