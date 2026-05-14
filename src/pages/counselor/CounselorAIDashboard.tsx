import { useState, useEffect, useCallback } from "react";
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
  TrendingUp,
  Loader2,
  CheckCircle,
  Activity,
  X,
  RefreshCw,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { format } from "date-fns";

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

interface DiagnosticData {
  id: number;
  student?: { profile?: { full_name?: string }; email?: string };
  total_score: number;
  risk_level: string;
  category_scores: Record<string, number>;
  ai_recommendations?: {
    primary?: string;
    actions?: string[];
    category_alerts?: Record<string, string>;
  };
  created_at: string;
}

interface StudentObservation {
  student_id: number;
  student: {
    id: number;
    name: string;
    email: string;
  };
  risk_level: "low" | "medium" | "high" | "critical";
  risk_score: number;
  confidence: number;
  trend: {
    label: "improving" | "stable" | "worsening" | "insufficient_data";
    delta: number;
  };
  reasons: string[];
  recommended_action: string;
}

function clampPercent(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeRiskLevel(level: unknown): "low" | "medium" | "high" | "critical" {
  const s = String(level ?? "").toLowerCase();
  if (s === "medium" || s === "high" || s === "critical" || s === "low") return s;
  return "low";
}

const CounselorAIDashboard = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || "Counselor";

  const [recentDiagnostics, setRecentDiagnostics] = useState<DiagnosticData[]>([]);
  const [studentObservations, setStudentObservations] = useState<StudentObservation[]>([]);
  const [highRiskStudents, setHighRiskStudents] = useState<StudentObservation[]>([]);
  const [riskDistribution, setRiskDistribution] = useState<Record<string, number>>({});
  const [summary, setSummary] = useState<{ students_observed: number; high_or_critical: number; worsening_trend: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedDiagnostic, setSelectedDiagnostic] = useState<DiagnosticData | null>(null);

  const loadDashboardData = useCallback(async () => {
    try {
      setLoadError(null);
      setIsLoading(true);
      const data = await api.getCounselorDiagnosticDashboard();

      const recent = Array.isArray(data?.recent) ? data.recent : [];
      setRecentDiagnostics(
        recent.map((row: DiagnosticData) => ({
          ...row,
          total_score: clampPercent(row.total_score),
          category_scores: row.category_scores && typeof row.category_scores === "object" ? row.category_scores : {},
          student: row.student ?? { profile: undefined, email: undefined },
        }))
      );
      const observationsRaw = Array.isArray(data?.student_observations) ? data.student_observations : [];
      const observations: StudentObservation[] = observationsRaw.map((raw: Record<string, unknown>) => {
        const studentRaw = (raw.student as StudentObservation["student"]) || { id: 0, name: "Student", email: "" };
        const reasons = Array.isArray(raw.reasons) ? raw.reasons : [];
        const trendRaw = raw.trend as StudentObservation["trend"] | undefined;
        return {
          student_id: Number(raw.student_id) || 0,
          student: {
            id: Number(studentRaw.id) || 0,
            name: String(studentRaw.name || "Student"),
            email: String(studentRaw.email || ""),
          },
          risk_level: normalizeRiskLevel(raw.risk_level),
          risk_score: clampPercent(raw.risk_score),
          confidence: clampPercent(raw.confidence),
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
          reasons: reasons.filter((r): r is string => typeof r === "string"),
          recommended_action: String(raw.recommended_action || "Continue routine monitoring."),
        };
      });
      setStudentObservations(observations);

      const highRiskRaw = Array.isArray(data?.high_risk_students) ? data.high_risk_students : [];
      setHighRiskStudents(
        highRiskRaw.map((raw: Record<string, unknown>) => {
          const found = observations.find((o) => o.student_id === Number(raw.student_id));
          if (found) return found;
          const studentRaw = (raw.student as StudentObservation["student"]) || { id: 0, name: "Student", email: "" };
          return {
            student_id: Number(raw.student_id) || 0,
            student: {
              id: Number(studentRaw.id) || 0,
              name: String(studentRaw.name || "Student"),
              email: String(studentRaw.email || ""),
            },
            risk_level: normalizeRiskLevel(raw.risk_level),
            risk_score: clampPercent(raw.risk_score),
            confidence: clampPercent(raw.confidence),
            trend: {
              label: "insufficient_data",
              delta: 0,
            },
            reasons: [],
            recommended_action: String(raw.recommended_action || ""),
          };
        })
      );
      setSummary(
        data.summary && typeof data.summary === "object"
          ? {
              students_observed: Number(data.summary.students_observed) || 0,
              high_or_critical: Number(data.summary.high_or_critical) || 0,
              worsening_trend: Number(data.summary.worsening_trend) || 0,
            }
          : null
      );

      const distribution: Record<string, number> = {
        low: 0,
        medium: 0,
        high: 0,
        critical: 0,
      };
      (Array.isArray(data?.risk_distribution) ? data.risk_distribution : []).forEach((item: { risk_level?: string; count?: number }) => {
        const key = normalizeRiskLevel(item?.risk_level);
        distribution[key] = Number(item?.count) || 0;
      });
      setRiskDistribution(distribution);
    } catch (error) {
      console.error("Failed to load dashboard data:", error);
      setLoadError("Could not load AI diagnostics. Check your connection and try again.");
      toast.error("Failed to load AI diagnostics dashboard");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    void loadDashboardData();
  }, [user?.id, loadDashboardData]);

  const getRiskColor = (riskLevel: string) => {
    return {
      low: "text-green-600",
      medium: "text-yellow-600",
      high: "text-orange-600",
      critical: "text-red-600",
    }[riskLevel] || "text-gray-600";
  };

  const getRiskBgColor = (riskLevel: string) => {
    return {
      low: "bg-green-100",
      medium: "bg-yellow-100",
      high: "bg-orange-100",
      critical: "bg-red-100",
    }[riskLevel] || "bg-gray-100";
  };

  const trendText = (trend: StudentObservation["trend"]) => {
    if (trend.label === "worsening") return `Worsening (${trend.delta > 0 ? "+" : ""}${trend.delta})`;
    if (trend.label === "improving") return `Improving (${trend.delta})`;
    if (trend.label === "stable") return "Stable";
    return "Need more data";
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
        <DashboardHeader title="AI Diagnostics Dashboard" onMenuClick={() => setSidebarOpen(true)} />

        <main className="p-4 lg:p-6 space-y-6">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={isLoading}
              onClick={() => void loadDashboardData()}
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {loadError && !isLoading ? (
            <Card variant="glass" className="border-destructive/40">
              <CardContent className="pt-6">
                <p className="text-sm text-destructive">{loadError}</p>
                <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => void loadDashboardData()}>
                  Try again
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {isLoading && recentDiagnostics.length === 0 && studentObservations.length === 0 ? (
            <div className="flex items-center justify-center h-96">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : !loadError || recentDiagnostics.length > 0 || studentObservations.length > 0 ? (
            <>
              <div className="grid gap-4 md:grid-cols-4">
                <Card variant="glass">
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <p className="text-4xl font-bold text-success">{riskDistribution.low || 0}</p>
                      <p className="text-sm text-muted-foreground mt-1">Low Risk</p>
                    </div>
                  </CardContent>
                </Card>
                <Card variant="glass">
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <p className="text-4xl font-bold text-warning">{riskDistribution.medium || 0}</p>
                      <p className="text-sm text-muted-foreground mt-1">Medium Risk</p>
                    </div>
                  </CardContent>
                </Card>
                <Card variant="glass">
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <p className="text-4xl font-bold text-orange-600">{riskDistribution.high || 0}</p>
                      <p className="text-sm text-muted-foreground mt-1">High Risk</p>
                    </div>
                  </CardContent>
                </Card>
                <Card variant="glass">
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <p className="text-4xl font-bold text-destructive">{riskDistribution.critical || 0}</p>
                      <p className="text-sm text-muted-foreground mt-1">Critical Risk</p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {summary && (
                <Card variant="glass">
                  <CardContent className="pt-6">
                    <div className="grid gap-4 md:grid-cols-3">
                      <div>
                        <p className="text-xs text-muted-foreground uppercase">Students observed</p>
                        <p className="text-2xl font-bold">{summary.students_observed}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase">High or critical</p>
                        <p className="text-2xl font-bold text-destructive">{summary.high_or_critical}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase">Worsening trend</p>
                        <p className="text-2xl font-bold text-warning">{summary.worsening_trend}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card variant="glass">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Activity className="h-5 w-5 text-primary" />
                    AI Student Observation Radar
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {studentObservations.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No student observation data yet. Complete sessions and assessments to build reliable AI signals.
                      </p>
                    ) : (
                      studentObservations.slice(0, 12).map((observation) => (
                        <div key={observation.student_id} className="p-4 rounded-lg border bg-card space-y-3">
                          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                            <div>
                              <p className="font-semibold text-foreground">{observation.student.name}</p>
                              <p className="text-xs text-muted-foreground">{observation.student.email}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`px-3 py-1 rounded-full text-xs font-medium ${getRiskColor(observation.risk_level)} ${getRiskBgColor(observation.risk_level)}`}>
                                {observation.risk_level.toUpperCase()}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                Score {observation.risk_score}% | Confidence {observation.confidence}%
                              </span>
                            </div>
                          </div>

                          <div className="grid gap-2 md:grid-cols-2">
                            <p className="text-sm text-muted-foreground">
                              Trend: <span className="text-foreground font-medium">{trendText(observation.trend)}</span>
                            </p>
                            <p className="text-sm text-muted-foreground">
                              Action: <span className="text-foreground font-medium">{observation.recommended_action}</span>
                            </p>
                          </div>

                          <div className="space-y-1">
                            {observation.reasons.slice(0, 2).map((reason, index) => (
                              <p key={index} className="text-xs text-muted-foreground">
                                - {reason}
                              </p>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>

              {highRiskStudents.length > 0 && (
                <Card variant="glass" className="border-destructive/50">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-destructive" />
                      High Risk Students ({highRiskStudents.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {highRiskStudents.map((observation) => (
                        <div
                          key={observation.student_id}
                          className={`p-4 rounded-lg ${getRiskBgColor(observation.risk_level)} border border-current/20`}
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <p className="font-semibold text-foreground">{observation.student.name}</p>
                              <p className="text-sm text-muted-foreground">{observation.student.email}</p>
                            </div>
                            <span className={`px-3 py-1 rounded-full text-xs font-medium ${getRiskColor(observation.risk_level)}`}>
                              {observation.risk_level.toUpperCase()} - {observation.risk_score}%
                            </span>
                          </div>

                          <p className="text-sm font-medium text-foreground mb-2">{observation.recommended_action}</p>

                          <div className="space-y-1">
                            {observation.reasons.slice(0, 2).map((reason, index) => (
                              <p key={index} className="text-xs text-muted-foreground">
                                - {reason}
                              </p>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card variant="glass">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    Recent Assessments
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {recentDiagnostics.slice(0, 10).map((diagnostic) => (
                      <div
                        key={diagnostic.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors cursor-pointer"
                        onClick={() => setSelectedDiagnostic(diagnostic)}
                      >
                        <div className="flex-1">
                          <p className="font-medium text-foreground">
                            {diagnostic.student?.profile?.full_name || diagnostic.student?.email || "Student"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(diagnostic.created_at), "MMM d, yyyy h:mm a")}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <Progress value={clampPercent(diagnostic.total_score)} className="w-24 h-2" />
                          <span
                            className={`px-2 py-1 rounded text-xs font-medium ${getRiskColor(normalizeRiskLevel(diagnostic.risk_level))}`}
                          >
                            {normalizeRiskLevel(diagnostic.risk_level)}
                          </span>
                        </div>
                      </div>
                    ))}
                    {recentDiagnostics.length === 0 && (
                      <p className="text-sm text-muted-foreground">No recent assessments yet.</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {selectedDiagnostic && (
                <Card variant="glass" className="border-primary">
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-lg">Assessment Details</CardTitle>
                    <Button variant="ghost" size="sm" onClick={() => setSelectedDiagnostic(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div>
                      <h4 className="font-semibold text-foreground mb-2">Student Information</h4>
                      <p className="text-foreground">
                        {selectedDiagnostic.student?.profile?.full_name || selectedDiagnostic.student?.email || "Student"}
                      </p>
                      <p className="text-sm text-muted-foreground">{selectedDiagnostic.student?.email ?? "—"}</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Assessment Date: {format(new Date(selectedDiagnostic.created_at), "MMM d, yyyy h:mm a")}
                      </p>
                    </div>

                    <div className={`p-4 rounded-lg ${getRiskBgColor(normalizeRiskLevel(selectedDiagnostic.risk_level))}`}>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-semibold text-foreground">Overall Risk Level</h4>
                        <span className={`text-2xl font-bold ${getRiskColor(normalizeRiskLevel(selectedDiagnostic.risk_level))}`}>
                          {clampPercent(selectedDiagnostic.total_score)}%
                        </span>
                      </div>
                      <p className="text-sm font-medium capitalize">{normalizeRiskLevel(selectedDiagnostic.risk_level)}</p>
                    </div>

                    <div className="space-y-4">
                      <h4 className="font-semibold text-foreground">Category Scores</h4>
                      {(() => {
                        const entries = Object.entries(
                          selectedDiagnostic.category_scores && typeof selectedDiagnostic.category_scores === "object"
                            ? selectedDiagnostic.category_scores
                            : {}
                        );
                        if (entries.length === 0) {
                          return (
                            <p className="text-sm text-muted-foreground">No category scores stored for this assessment.</p>
                          );
                        }
                        return entries.map(([category, score]) => (
                          <div key={category} className="space-y-2">
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground capitalize">{category}</span>
                              <span className="font-medium">{clampPercent(score)}%</span>
                            </div>
                            <Progress value={clampPercent(score)} className="h-2" />
                          </div>
                        ));
                      })()}
                    </div>

                    <div className="space-y-3 p-4 rounded-lg bg-secondary/30">
                      <h4 className="font-semibold text-foreground">AI Recommendations</h4>
                      <p className="text-foreground text-sm">{selectedDiagnostic.ai_recommendations?.primary || "No recommendation text available."}</p>
                      <div className="space-y-2">
                        {(() => {
                          const actions = Array.isArray(selectedDiagnostic.ai_recommendations?.actions)
                            ? selectedDiagnostic.ai_recommendations.actions
                            : [];
                          return actions.map((action, index) => (
                            <div key={index} className="flex items-start gap-2">
                              <CheckCircle className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                              <span className="text-sm text-muted-foreground">{action}</span>
                            </div>
                          ));
                        })()}
                      </div>
                    </div>

                    {selectedDiagnostic.ai_recommendations?.category_alerts && (
                      <div className="space-y-2 p-4 rounded-lg bg-warning/10 border border-warning/20">
                        <h4 className="font-semibold text-foreground flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4" />
                          Areas of Concern
                        </h4>
                        {Object.entries(selectedDiagnostic.ai_recommendations.category_alerts).map(([category, alert]) => (
                          <p key={category} className="text-sm text-muted-foreground">
                            <span className="font-medium capitalize">{category}:</span> {alert}
                          </p>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
};

export default CounselorAIDashboard;
