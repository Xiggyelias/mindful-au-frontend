import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  Calendar,
  Plus,
  Trash2,
  Eye,
  RefreshCcw,
  Loader2,
  FileText,
} from "lucide-react";
import { adminNavItems } from "@/config/adminNavItems";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";

type ReportType = "weekly_heatmap" | "monthly_trend" | "risk_assessment" | "counselor_burnout";

const reportTypeLabel: Record<ReportType, string> = {
  weekly_heatmap: "Weekly Heatmap",
  monthly_trend: "Monthly Trend",
  risk_assessment: "Risk Assessment",
  counselor_burnout: "Counselor Burnout",
};

const reportButtons: Array<{ type: ReportType; label: string }> = [
  { type: "weekly_heatmap", label: "Weekly" },
  { type: "monthly_trend", label: "Monthly" },
  { type: "risk_assessment", label: "Risk" },
  { type: "counselor_burnout", label: "Burnout" },
];

const formatTimestamp = (value?: string | null): string => {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--" : date.toLocaleString();
};

const AdminAIReports = () => {
  const { confirm } = useConfirm();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || "Admin";

  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [selectedReport, setSelectedReport] = useState<any | null>(null);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false);
  const [isLoadingReports, setIsLoadingReports] = useState(false);
  const [generatingType, setGeneratingType] = useState<ReportType | null>(null);
  const [deletingReportId, setDeletingReportId] = useState<number | null>(null);
  const [loadingReportId, setLoadingReportId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadAnalytics = useCallback(async () => {
    try {
      setIsLoadingAnalytics(true);
      const data = await api.getAnalytics();
      setAnalyticsData(data || {});
      return data;
    } catch (error: any) {
      const message = error?.response?.data?.message || "Failed to load analytics";
      setErrorMessage(message);
      toast.error(message);
      return null;
    } finally {
      setIsLoadingAnalytics(false);
    }
  }, []);

  const loadReports = useCallback(async () => {
    try {
      setIsLoadingReports(true);
      const data = await api.getAIReports();
      setReports(Array.isArray(data) ? data : []);
      return Array.isArray(data) ? data : [];
    } catch (error: any) {
      const message = error?.response?.data?.message || "Failed to load reports";
      setErrorMessage(message);
      toast.error(message);
      return [];
    } finally {
      setIsLoadingReports(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setErrorMessage(null);
    await Promise.all([loadAnalytics(), loadReports()]);
  }, [loadAnalytics, loadReports]);

  useEffect(() => {
    if (user) {
      refreshAll();
    }
  }, [user, refreshAll]);

  const handleGenerateReport = async (type: ReportType) => {
    try {
      setGeneratingType(type);
      setErrorMessage(null);
      const report = await api.generateAIReport(type);
      setSelectedReport(report);
      toast.success(`${reportTypeLabel[type]} report generated`);
      await Promise.all([loadReports(), loadAnalytics()]);
    } catch (error: any) {
      const message = error?.response?.data?.message || "Failed to generate report";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setGeneratingType(null);
    }
  };

  const handleViewReport = async (id: number) => {
    try {
      setLoadingReportId(id);
      const report = await api.getAIReport(String(id));
      setSelectedReport(report);
    } catch (error: any) {
      const message = error?.response?.data?.message || "Failed to load report details";
      toast.error(message);
    } finally {
      setLoadingReportId(null);
    }
  };

  const handleDownloadReport = async (report: any) => {
    try {
      let data = report;
      if (!data?.data || !data?.summary) {
        data = await api.getAIReport(String(report.id));
      }

      const filenameType = String(data?.type || "report").replace(/[^a-z0-9_-]/gi, "_");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${filenameType}-${data.id}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success("Report downloaded");
    } catch (error: any) {
      const message = error?.response?.data?.message || "Failed to download report";
      toast.error(message);
    }
  };

  const handleDeleteReport = async (id: number) => {
    const ok = await confirm({
      title: "Delete report?",
      description: "This action cannot be undone.",
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;

    try {
      setDeletingReportId(id);
      await api.deleteAIReport(String(id));
      toast.success("Report deleted");
      if (selectedReport?.id === id) {
        setSelectedReport(null);
      }
      await Promise.all([loadReports(), loadAnalytics()]);
    } catch (error: any) {
      const message = error?.response?.data?.message || "Failed to delete report";
      toast.error(message);
    } finally {
      setDeletingReportId(null);
    }
  };

  const riskDistribution = useMemo(() => {
    const distribution = analyticsData?.ai_diagnostics?.risk_level_distribution || {};
    const orderedLevels: Array<"low" | "medium" | "high" | "critical"> = ["low", "medium", "high", "critical"];
    const total = orderedLevels.reduce((sum, level) => sum + Number(distribution[level] || 0), 0);

    return orderedLevels.map((level) => {
      const count = Number(distribution[level] || 0);
      const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
      return { level, count, percentage, total };
    });
  }, [analyticsData]);

  const summaryStats = useMemo(() => {
    const totalStudents = Number(analyticsData?.overview?.total_students || 0);
    const studentsAssessed = Number(analyticsData?.ai_diagnostics?.students_assessed || 0);
    const coverage =
      totalStudents > 0
        ? Math.round((studentsAssessed / totalStudents) * 100)
        : 0;
    const sessionsAnalyzed = Number(analyticsData?.sessions?.total_sessions || 0);
    const highRiskAlerts = Number(analyticsData?.ai_diagnostics?.high_risk_alerts || 0);
    const reportsGenerated = reports.length;

    return {
      coverage,
      sessionsAnalyzed,
      highRiskAlerts,
      reportsGenerated,
      studentsAssessed,
      totalStudents,
    };
  }, [analyticsData, reports]);

  const selectedReportHighlights = useMemo(() => {
    const report = selectedReport;
    if (!report?.data) return [];

    const data = report.data;
    switch (report.type as ReportType) {
      case "weekly_heatmap":
        return [
          { label: "Total Diagnostics", value: data.total_diagnostics ?? 0 },
          { label: "High Risk %", value: `${data.high_risk_percentage ?? 0}%` },
          { label: "From", value: data.start_date ?? "-" },
          { label: "To", value: data.end_date ?? "-" },
        ];
      case "monthly_trend":
        return [
          { label: "Diagnostics", value: data.total_diagnostics ?? 0 },
          { label: "Sessions", value: data.total_sessions ?? 0 },
          { label: "Avg Stress", value: data.average_stress_level ?? 0 },
          { label: "Avg Anxiety", value: data.average_anxiety_level ?? 0 },
          { label: "Avg Depression", value: data.average_depression_level ?? 0 },
        ];
      case "risk_assessment":
        return [
          { label: "Students", value: data.total_students ?? 0 },
          { label: "Assessed", value: data.students_assessed ?? 0 },
          { label: "High Risk", value: data.high_risk_count ?? 0 },
        ];
      case "counselor_burnout":
        return [
          { label: "Counselors", value: data.total_counselors ?? 0 },
          { label: "Avg Sessions", value: data.average_sessions_per_counselor ?? 0 },
          { label: "Overloaded", value: data.overloaded_counselors_count ?? 0 },
          { label: "Max Sessions", value: data.max_sessions ?? 0 },
        ];
      default:
        return [];
    }
  }, [selectedReport]);

  const isPageLoading = isLoadingAnalytics || isLoadingReports;

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
        <DashboardHeader title="AI Reports" onMenuClick={() => setSidebarOpen(true)} />

        <main className="p-4 lg:p-6 space-y-6">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={refreshAll} disabled={isPageLoading}>
              {isPageLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Refreshing
                </>
              ) : (
                <>
                  <RefreshCcw className="h-4 w-4 mr-2" />
                  Refresh Data
                </>
              )}
            </Button>
          </div>

          {errorMessage && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {errorMessage}
            </div>
          )}

          <Card variant="glass">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Brain className="h-5 w-5 text-primary" />
                AI System Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-4">
                <div className="text-center">
                  <p className="text-3xl font-bold text-foreground">{summaryStats.coverage}%</p>
                  <p className="text-sm text-muted-foreground">Student Coverage</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold text-foreground">{summaryStats.sessionsAnalyzed}</p>
                  <p className="text-sm text-muted-foreground">Sessions Analyzed</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold text-foreground">{summaryStats.highRiskAlerts}</p>
                  <p className="text-sm text-muted-foreground">High-Risk Alerts</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold text-foreground">{summaryStats.reportsGenerated}</p>
                  <p className="text-sm text-muted-foreground">Reports Generated</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card variant="glass">
              <CardHeader>
                <CardTitle className="text-lg">Campus Emotional Overview</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {riskDistribution.some((item) => item.count > 0) ? (
                  riskDistribution.map((item) => (
                    <div key={item.level}>
                      <div className="flex justify-between text-sm mb-2">
                        <span className="text-muted-foreground capitalize">{item.level} Risk</span>
                        <span className="text-foreground font-medium">
                          {item.percentage}% ({item.count})
                        </span>
                      </div>
                      <Progress value={item.percentage} className="h-2" />
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No diagnostics data available yet.</p>
                )}
              </CardContent>
            </Card>

            <Card variant="glass">
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-lg">Generated Reports</CardTitle>
                  <div className="flex flex-wrap gap-2">
                    {reportButtons.map((button) => (
                      <Button
                        key={button.type}
                        size="sm"
                        variant="outline"
                        onClick={() => handleGenerateReport(button.type)}
                        disabled={Boolean(generatingType)}
                      >
                        {generatingType === button.type ? (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <Plus className="h-4 w-4 mr-1" />
                        )}
                        {button.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {isLoadingReports ? (
                    <p className="text-sm text-muted-foreground">Loading reports...</p>
                  ) : reports.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No reports generated yet. Use the buttons above to generate one.
                    </p>
                  ) : (
                    reports.map((report) => {
                      const reportId = Number(report.id);
                      const date = formatTimestamp(report.generated_at || report.created_at || null);
                      const isDeleting = deletingReportId === reportId;
                      const isViewing = loadingReportId === reportId;

                      return (
                        <div key={report.id} className="flex items-start justify-between p-3 rounded-xl bg-secondary/30">
                          <div className="flex items-start gap-3 flex-1 pr-3">
                            <FileText className="h-5 w-5 text-primary mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-foreground truncate">{report.name}</p>
                              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                                <Calendar className="h-3 w-3" />
                                {date}
                              </p>
                              <p className="text-xs text-muted-foreground mt-1">
                                Type: {reportTypeLabel[report.type as ReportType] || report.type}
                              </p>
                              {report.summary && <p className="text-xs text-muted-foreground mt-1">{report.summary}</p>}
                            </div>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <Button size="icon" variant="outline" onClick={() => handleViewReport(reportId)} disabled={isViewing}>
                              {isViewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                            </Button>
                            <Button size="icon" variant="outline" onClick={() => handleDownloadReport(report)}>
                              <Download className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => handleDeleteReport(reportId)} disabled={isDeleting}>
                              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-destructive" />}
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {selectedReport && (
            <Card variant="glass">
              <CardHeader>
                <CardTitle className="text-lg">Report Details: {selectedReport.name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {selectedReport.summary || "No summary available for this report."}
                </p>
                {selectedReportHighlights.length > 0 ? (
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {selectedReportHighlights.map((item) => (
                      <div key={item.label} className="p-3 rounded-lg bg-secondary/30 border border-border/50">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">{item.label}</p>
                        <p className="text-xl font-semibold text-foreground mt-1">{item.value}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No structured metrics for this report type.</p>
                )}
              </CardContent>
            </Card>
          )}

          <Card variant="glass">
            <CardHeader>
              <CardTitle className="text-lg">AI Insights & Predictions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="p-4 rounded-xl bg-secondary/30">
                  <p className="font-medium text-foreground mb-2">Total Students</p>
                  <p className="text-sm text-muted-foreground">
                    {summaryStats.totalStudents} students registered in the system
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-secondary/30">
                  <p className="font-medium text-foreground mb-2">Students Assessed</p>
                  <p className="text-sm text-muted-foreground">
                    {summaryStats.studentsAssessed} students assessed by AI diagnostics ({summaryStats.coverage}% coverage)
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-secondary/30">
                  <p className="font-medium text-foreground mb-2">Active Sessions</p>
                  <p className="text-sm text-muted-foreground">
                    {analyticsData?.overview?.active_sessions ?? 0} counseling sessions currently active
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-secondary/30">
                  <p className="font-medium text-foreground mb-2">Pending Appointments</p>
                  <p className="text-sm text-muted-foreground">
                    {analyticsData?.overview?.pending_appointments ?? 0} appointments awaiting confirmation
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-secondary/30">
                  <p className="font-medium text-foreground mb-2">Diagnostics This Month</p>
                  <p className="text-sm text-muted-foreground">
                    {analyticsData?.ai_diagnostics?.diagnostics_this_month ?? 0} AI diagnostics completed this month
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-secondary/30">
                  <p className="font-medium text-foreground mb-2">Reports Generated</p>
                  <p className="text-sm text-muted-foreground">{reports.length} reports currently available</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default AdminAIReports;
