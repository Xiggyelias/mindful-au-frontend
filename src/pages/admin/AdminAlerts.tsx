import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  UserCheck,
  BarChart3,
  Brain,
  ArrowRightLeft,
  AlertTriangle,
  FileText,
  Settings,
  Check,
  Clock,
  RefreshCcw,
  Loader2,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { toast } from "sonner";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/admin/dashboard" },
  { label: "Students", icon: Users, path: "/admin/students" },
  { label: "Counselors", icon: UserCheck, path: "/admin/counselors" },
  { label: "Analytics", icon: BarChart3, path: "/admin/analytics" },
  { label: "Referrals", icon: ArrowRightLeft, path: "/admin/referrals" },
  { label: "AI Reports", icon: Brain, path: "/admin/ai-reports" },
  { label: "Alerts", icon: AlertTriangle, path: "/admin/alerts" },
  { label: "Logs", icon: FileText, path: "/admin/logs" },
  { label: "Settings", icon: Settings, path: "/admin/settings" },
];

type PanicAlert = {
  id: number;
  type: "panic";
  title: string;
  message: string;
  created_at: string;
  resolved_at?: string | null;
  status: "active" | "resolved";
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

      const [panicLogs, diagnostics] = await Promise.all([
        api.getPanicLogs(),
        api.getAIDiagnostics().catch(() => []),
      ]);

      const mappedPanic: PanicAlert[] = (panicLogs || []).map((log: any) => {
        const studentName = log.student?.profile?.full_name || `Student #${log.student_id ?? "N/A"}`;

        return {
          id: Number(log.id),
          type: "panic",
          title: "Panic Button Triggered",
          message: `${studentName} triggered panic button`,
          created_at: log.created_at,
          resolved_at: log.resolved_at,
          status: log.resolved ? "resolved" : "active",
        };
      });

      const latestRiskByStudent = new Map<string, any>();
      for (const diagnostic of diagnostics || []) {
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
    if (user) {
      void loadAlerts();
    }
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
        items={navItems}
        userType="admin"
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-72">
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
