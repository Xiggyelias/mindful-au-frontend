import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard,
  Users,
  UserCheck,
  BarChart3,
  Brain,
  AlertTriangle,
  FileText,
  Settings,
  TrendingUp,
  TrendingDown,
  Activity,
  RefreshCcw,
  Download,
  Loader2,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/useAuth";
import { api, getApiErrorMessage } from "@/lib/api";
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

type AnalyticsData = {
  overview?: {
    total_users: number;
    total_students: number;
    total_counselors: number;
    total_sessions: number;
    active_sessions: number;
    total_appointments: number;
    pending_appointments: number;
  };
  sessions?: {
    total_sessions: number;
    sessions_by_type: Record<string, number>;
    sessions_this_month: number;
    sessions_this_week: number;
    avg_session_duration: number;
  };
  appointments?: {
    total_appointments: number;
    appointments_by_status: Record<string, number>;
    appointments_today: number;
    appointments_this_week: number;
  };
  ai_diagnostics?: {
    total_diagnostics: number;
    diagnostics_this_month: number;
    risk_level_distribution: Record<string, number>;
  };
  ml_intelligence?: {
    model_version?: string;
    students_needing_follow_up?: number;
    rising_risk_students?: number;
    chat_support_utilization_30d?: number;
    proactive_follow_up_coverage?: number;
    risk_forecast_distribution?: Record<string, number>;
    top_actions?: string[];
    validation?: {
      diagnostic_agreement_rate?: number;
      fairness_gap?: number;
      fairness_status?: string;
      inference_mode?: string;
      response_time_budget_ms?: number;
    };
    ethics?: {
      privacy?: string;
      human_review_required?: boolean;
      low_bandwidth_mode?: boolean;
      auditability?: string;
    };
  };
};

const AdminAnalytics = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split('@')[0] || "Admin";
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [reportType, setReportType] = useState<"overview" | "risk_trends" | "counselor_utilization" | "faculty_summary">("overview");
  const [exportFormat, setExportFormat] = useState<"csv" | "xlsx" | "pdf">("xlsx");
  const [exportDays, setExportDays] = useState("180");
  const [isExporting, setIsExporting] = useState(false);

  const loadAnalytics = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await api.getAnalytics();
      setData(response || {});
    } catch (error) {
      console.error("Failed to load analytics:", error);
      toast.error("Failed to load analytics");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) void loadAnalytics();
  }, [user, loadAnalytics]);

  const sessionTypes = useMemo(() => {
    const types = data?.sessions?.sessions_by_type || {};
    const total = Object.values(types).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(types).map(([label, count]) => ({
      label,
      value: Math.round((count / total) * 100),
    }));
  }, [data]);

  const mlRiskDistribution = useMemo(() => {
    const distribution = data?.ml_intelligence?.risk_forecast_distribution || {};
    const total = Object.values(distribution).reduce((sum, value) => sum + Number(value || 0), 0) || 1;

    return Object.entries(distribution).map(([label, count]) => ({
      label,
      count: Number(count || 0),
      value: Math.round((Number(count || 0) / total) * 100),
    }));
  }, [data]);

  const handleExport = useCallback(async () => {
    const parsedDays = Number(exportDays);
    const days =
      Number.isFinite(parsedDays) && parsedDays >= 7 && parsedDays <= 365
        ? Math.floor(parsedDays)
        : 180;

    try {
      setIsExporting(true);
      await api.exportAnalyticsReport({
        report: reportType,
        format: exportFormat,
        days,
      });
      toast.success("Analytics export generated");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to export analytics report"));
    } finally {
      setIsExporting(false);
    }
  }, [exportDays, exportFormat, reportType]);

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
          title="Analytics"
          onMenuClick={() => setSidebarOpen(true)}
        />

        <main className="p-4 lg:p-6 space-y-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
              <label className="text-xs text-muted-foreground">
                Report
                <select
                  className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm"
                  value={reportType}
                  onChange={(event) => setReportType(event.target.value as typeof reportType)}
                  disabled={isExporting}
                >
                  <option value="overview">Overview</option>
                  <option value="risk_trends">Risk Trends</option>
                  <option value="counselor_utilization">Counselor Utilization</option>
                  <option value="faculty_summary">Faculty Summary</option>
                </select>
              </label>
              <label className="text-xs text-muted-foreground">
                Format
                <select
                  className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm"
                  value={exportFormat}
                  onChange={(event) => setExportFormat(event.target.value as typeof exportFormat)}
                  disabled={isExporting}
                >
                  <option value="xlsx">Excel (.xlsx)</option>
                  <option value="csv">CSV</option>
                  <option value="pdf">PDF</option>
                </select>
              </label>
              <label className="text-xs text-muted-foreground">
                Days
                <Input
                  type="number"
                  min={7}
                  max={365}
                  value={exportDays}
                  onChange={(event) => setExportDays(event.target.value)}
                  disabled={isExporting}
                  className="mt-1"
                />
              </label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleExport()}
                disabled={isExporting}
                className="self-end"
              >
                {isExporting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Exporting
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Export
                  </>
                )}
              </Button>
            </div>
            <Button variant="outline" size="sm" onClick={() => void loadAnalytics()} disabled={isLoading}>
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

          {isLoading && (
            <p className="text-sm text-muted-foreground">Loading analytics...</p>
          )}

          {/* Key Metrics */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card variant="glass">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Sessions</p>
                    <p className="text-3xl font-bold text-foreground">
                      {data?.sessions?.total_sessions ?? 0}
                    </p>
                  </div>
                  <div className="flex items-center text-success">
                    <TrendingUp className="h-4 w-4 mr-1" />
                    <span className="text-sm">vs week</span>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card variant="glass">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Avg Session Duration</p>
                    <p className="text-3xl font-bold text-foreground">
                      {Math.round(data?.sessions?.avg_session_duration ?? 0)} min
                    </p>
                  </div>
                  <div className="flex items-center text-success">
                    <TrendingUp className="h-4 w-4 mr-1" />
                    <span className="text-sm">trend</span>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card variant="glass">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Pending Appointments</p>
                    <p className="text-3xl font-bold text-foreground">
                      {data?.overview?.pending_appointments ?? 0}
                    </p>
                  </div>
                  <div className="flex items-center text-warning">
                    <TrendingDown className="h-4 w-4 mr-1" />
                    <span className="text-sm">action</span>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card variant="glass">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Diagnostics This Month</p>
                    <p className="text-3xl font-bold text-foreground">
                      {data?.ai_diagnostics?.diagnostics_this_month ?? 0}
                    </p>
                  </div>
                  <div className="flex items-center text-primary">
                    <TrendingUp className="h-4 w-4 mr-1" />
                    <span className="text-sm">AI</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card variant="glass">
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Students Needing Follow-Up</p>
                <p className="mt-2 text-3xl font-bold text-foreground">
                  {data?.ml_intelligence?.students_needing_follow_up ?? 0}
                </p>
                <p className="text-xs text-muted-foreground">Forecasted high-support queue</p>
              </CardContent>
            </Card>
            <Card variant="glass">
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Rising Risk Students</p>
                <p className="mt-2 text-3xl font-bold text-foreground">
                  {data?.ml_intelligence?.rising_risk_students ?? 0}
                </p>
                <p className="text-xs text-muted-foreground">Students with worsening trend</p>
              </CardContent>
            </Card>
            <Card variant="glass">
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Chat Support Utilization</p>
                <p className="mt-2 text-3xl font-bold text-foreground">
                  {data?.ml_intelligence?.chat_support_utilization_30d ?? 0}
                </p>
                <p className="text-xs text-muted-foreground">Students using AI support in 30 days</p>
              </CardContent>
            </Card>
            <Card variant="glass">
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Follow-Up Coverage</p>
                <p className="mt-2 text-3xl font-bold text-foreground">
                  {Math.round(Number(data?.ml_intelligence?.proactive_follow_up_coverage ?? 0))}%
                </p>
                <p className="text-xs text-muted-foreground">High-risk students with upcoming appointments</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Session Types */}
            <Card variant="glass">
              <CardHeader>
                <CardTitle className="text-lg">Session Types Distribution</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {sessionTypes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No session data available.</p>
                ) : (
                  sessionTypes.map((type) => (
                    <div key={type.label}>
                      <div className="flex justify-between text-sm mb-2">
                        <span className="text-muted-foreground capitalize">{type.label || "Unknown"}</span>
                        <span className="text-foreground font-medium">{type.value}%</span>
                      </div>
                      <Progress value={type.value} className="h-2" />
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Risk Levels */}
            <Card variant="glass">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Activity className="h-5 w-5 text-primary" />
                  Risk Level Distribution
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data?.ai_diagnostics?.risk_level_distribution ? (
                  Object.entries(data.ai_diagnostics.risk_level_distribution).map(([level, count]) => (
                    <div key={level}>
                      <div className="flex justify-between text-sm mb-2">
                        <span className="text-muted-foreground capitalize">{level}</span>
                        <span className="text-foreground font-medium">{count}</span>
                      </div>
                      <Progress value={Math.min(100, Number(count))} className="h-2" />
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No diagnostics data available.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card variant="glass">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Brain className="h-5 w-5 text-primary" />
                  ML Forecast Distribution
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {mlRiskDistribution.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No ML forecast data available.</p>
                ) : (
                  mlRiskDistribution.map((item) => (
                    <div key={item.label}>
                      <div className="mb-2 flex justify-between text-sm">
                        <span className="capitalize text-muted-foreground">{item.label}</span>
                        <span className="font-medium text-foreground">
                          {item.count} ({item.value}%)
                        </span>
                      </div>
                      <Progress value={item.value} className="h-2" />
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card variant="glass">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-primary" />
                  Model Validation
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl bg-secondary/30 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Agreement</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">
                    {Math.round(Number(data?.ml_intelligence?.validation?.diagnostic_agreement_rate ?? 0))}%
                  </p>
                  <p className="text-xs text-muted-foreground">Diagnostic agreement rate</p>
                </div>
                <div className="rounded-xl bg-secondary/30 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Fairness Gap</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">
                    {Number(data?.ml_intelligence?.validation?.fairness_gap ?? 0).toFixed(1)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Status {data?.ml_intelligence?.validation?.fairness_status || "stable"}
                  </p>
                </div>
                <div className="rounded-xl bg-secondary/30 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Inference Mode</p>
                  <p className="mt-2 text-sm font-semibold text-foreground">
                    {data?.ml_intelligence?.validation?.inference_mode || "lightweight_local_first"}
                  </p>
                </div>
                <div className="rounded-xl bg-secondary/30 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Latency Budget</p>
                  <p className="mt-2 text-sm font-semibold text-foreground">
                    {data?.ml_intelligence?.validation?.response_time_budget_ms ?? 0} ms
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Summary Stats */}
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="text-lg">Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="p-3 rounded-xl bg-secondary/30">
                  <p className="text-sm text-muted-foreground">Students</p>
                  <p className="text-2xl font-bold text-foreground">{data?.overview?.total_students ?? 0}</p>
                </div>
                <div className="p-3 rounded-xl bg-secondary/30">
                  <p className="text-sm text-muted-foreground">Counselors</p>
                  <p className="text-2xl font-bold text-foreground">{data?.overview?.total_counselors ?? 0}</p>
                </div>
                <div className="p-3 rounded-xl bg-secondary/30">
                  <p className="text-sm text-muted-foreground">Appointments</p>
                  <p className="text-2xl font-bold text-foreground">{data?.overview?.total_appointments ?? 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card variant="glass">
            <CardHeader>
              <CardTitle className="text-lg">ML Priority Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3">
                {(data?.ml_intelligence?.top_actions || []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No ML action items available.</p>
                ) : (
                  (data?.ml_intelligence?.top_actions || []).map((action, index) => (
                    <div key={`${action}-${index}`} className="rounded-xl bg-secondary/30 p-4 text-sm text-foreground">
                      {action}
                    </div>
                  ))
                )}
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-border/60 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Privacy</p>
                  <p className="mt-2 text-sm text-foreground">
                    {data?.ml_intelligence?.ethics?.privacy || "Aggregated features only."}
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Human Review</p>
                  <p className="mt-2 text-sm text-foreground">
                    {data?.ml_intelligence?.ethics?.human_review_required ? "Required" : "Optional"}
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Auditability</p>
                  <p className="mt-2 text-sm text-foreground">
                    {data?.ml_intelligence?.ethics?.auditability || "Explainable feature thresholds."}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default AdminAnalytics;
