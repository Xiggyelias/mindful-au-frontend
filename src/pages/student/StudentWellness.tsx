import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard,
  MessageSquare,
  Calendar,
  Bot,
  Video,
  History,
  Heart,
  TrendingUp,
  Smile,
  Frown,
  Meh,
  Loader2,
  Sparkles,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { toast } from "sonner";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/student/dashboard" },
  { label: "Chat", icon: MessageSquare, path: "/student/chat" },
  { label: "Appointments", icon: Calendar, path: "/student/appointments" },
  { label: "AI Support", icon: Bot, path: "/student/ai-support" },
  { label: "Video Call", icon: Video, path: "/student/video-call" },
  { label: "Past Sessions", icon: History, path: "/student/history" },
  { label: "Wellness", icon: Heart, path: "/student/wellness" },
];

const moodOptions = [
  { icon: Smile, label: "Radiant", value: "great", iconClass: "text-success", bgClass: "bg-success/10" },
  { icon: Meh, label: "Balanced", value: "okay", iconClass: "text-warning", bgClass: "bg-warning/10" },
  { icon: Frown, label: "Heaviness", value: "low", iconClass: "text-destructive", bgClass: "bg-destructive/10" },
] as const;

type StudentMood = (typeof moodOptions)[number]["value"];

const StudentWellness = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [summary, setSummary] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dailyMood, setDailyMood] = useState<StudentMood | null>(null);
  const [isRecordingMood, setIsRecordingMood] = useState(false);
  const { user } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || "Student";

  const loadSummary = useCallback(async () => {
    try {
      setIsLoading(true);
      const [summaryData, moodData] = await Promise.all([
        api.getStudentWellnessSummary(),
        api.getStudentMoodToday().catch(() => null),
      ]);
      setSummary(summaryData);
      if (moodData?.log?.mood) {
        setDailyMood(moodData.log.mood as StudentMood);
      } else {
        setDailyMood(null);
      }
    } catch (error: any) {
      console.error("Failed to load student wellness summary:", error);
      toast.error("Unable to load live wellness insights. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSummary();
    const interval = window.setInterval(() => {
      loadSummary();
    }, 60000);

    return () => window.clearInterval(interval);
  }, [loadSummary]);

  const handleMoodCheck = async (selectedMood: StudentMood) => {
    if (!user?.id) {
      toast.error("Please log in to record your mood.");
      return;
    }

    if (dailyMood) {
      const existing = moodOptions.find((item) => item.value === dailyMood)?.label ?? dailyMood;
      toast.info(`Today's mood is already locked: ${existing}.`);
      return;
    }

    try {
      setIsRecordingMood(true);
      const result = await api.recordStudentMood(selectedMood);
      const recorded = (result?.log?.mood ?? selectedMood) as StudentMood;
      setDailyMood(recorded);
      const recordedLabel = moodOptions.find((item) => item.value === recorded)?.label.toLowerCase() ?? recorded;
      toast.success(`Mood saved: ${recordedLabel}.`);
    } catch (error: any) {
      const message = error?.response?.data?.message;
      if (typeof message === "string" && message.toLowerCase().includes("already recorded")) {
        const today = await api.getStudentMoodToday().catch(() => null);
        if (today?.log?.mood) {
          setDailyMood(today.log.mood as StudentMood);
        }
        toast.info("Today's first mood is already recorded.");
        return;
      }
      toast.error(message || "Unable to save mood. Please try again.");
    } finally {
      setIsRecordingMood(false);
    }
  };

  const scores = summary?.scores ?? {};
  const labels = summary?.labels ?? {};
  const wellnessScore = typeof scores.wellness_score === "number" ? scores.wellness_score : null;
  const stressLevel = typeof scores.stress_level === "number" ? scores.stress_level : null;
  const burnoutRisk = typeof scores.burnout_risk === "number" ? scores.burnout_risk : null;
  const riskLabel = typeof labels.risk === "string" ? labels.risk : "unknown";
  const recentHistory = useMemo(() => (Array.isArray(summary?.history) ? summary.history : []), [summary]);
  const insightText =
    typeof summary?.insights === "string" && summary.insights.trim() !== ""
      ? summary.insights
      : "No live wellness insight yet. Complete a diagnostic or session to generate one.";
  const recommendationText =
    typeof summary?.recommendations === "string" && summary.recommendations.trim() !== ""
      ? summary.recommendations
      : "No live recommendation yet.";

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar
        items={navItems}
        userType="student"
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-72">
        <div className="flex items-center justify-between">
          <DashboardHeader title="Wellness Tracker" onMenuClick={() => setSidebarOpen(true)} />
          <Button
            variant="outline"
            size="sm"
            onClick={loadSummary}
            disabled={isLoading}
            className="hidden lg:inline-flex"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Refreshing
              </>
            ) : (
              "Refresh insights"
            )}
          </Button>
        </div>

        <main className="p-4 lg:p-6 space-y-8 max-w-6xl mx-auto">
          <Card className="border-none shadow-xl shadow-primary/5 rounded-[2.5rem] bg-gradient-to-br from-primary/5 to-transparent overflow-hidden">
            <CardHeader className="pt-8 text-center">
              <CardTitle className="text-2xl font-bold">How&apos;s your heart feeling today, {userName}?</CardTitle>
              <p className="text-muted-foreground">Check in and keep your wellness trends current.</p>
            </CardHeader>
            <CardContent className="pb-8">
              <div className="flex flex-wrap justify-center gap-6">
                {moodOptions.map((option) => (
                  <Button
                    key={option.value}
                    variant="ghost"
                    className={`flex-col h-auto py-6 px-8 gap-4 rounded-3xl transition-all duration-300 ${
                      dailyMood === option.value
                        ? "scale-105 shadow-lg border-2 border-primary/20 bg-secondary/40"
                        : "hover:bg-secondary/50"
                    }`}
                    onClick={() => handleMoodCheck(option.value)}
                    disabled={Boolean(dailyMood) || isRecordingMood}
                  >
                    <div className={`p-4 rounded-2xl ${option.bgClass}`}>
                      <option.icon className={`h-12 w-12 ${option.iconClass}`} />
                    </div>
                    <span className="font-bold text-lg">{option.label}</span>
                  </Button>
                ))}
              </div>
              {dailyMood && (
                <p className="mt-5 text-center text-sm text-muted-foreground">
                  Mood recorded for today: {moodOptions.find((item) => item.value === dailyMood)?.label ?? dailyMood}. New selection unlocks tomorrow.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-8 md:grid-cols-2">
            <Card className="border-none shadow-xl shadow-primary/5 rounded-[2.5rem] bg-background relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-primary/40 to-info/40" />
              <CardHeader className="pt-8">
                <CardTitle className="text-xl font-bold flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-primary/10">
                    <TrendingUp className="h-5 w-5 text-primary" />
                  </div>
                  Overall Wellness Score
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-8 pb-8">
                {isLoading ? (
                  <div className="flex flex-col items-center justify-center h-64 gap-4">
                    <Loader2 className="h-10 w-10 animate-spin text-primary/40" />
                    <p className="text-sm text-muted-foreground">Loading live score...</p>
                  </div>
                ) : wellnessScore !== null ? (
                  <>
                    <div className="relative flex flex-col items-center justify-center py-4">
                      <div className="text-center z-10">
                        <span className="text-7xl font-black text-primary tracking-tighter">{wellnessScore}</span>
                        <span className="text-2xl font-bold text-muted-foreground ml-1">%</span>
                      </div>
                      <div className="absolute h-32 w-32 rounded-full border-[10px] border-primary/5 -z-0" />
                    </div>

                    <div className="space-y-6">
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm font-bold uppercase tracking-wider text-muted-foreground">
                          <span>Vitality Level</span>
                          <span>{wellnessScore}%</span>
                        </div>
                        <Progress value={wellnessScore} className="h-4 rounded-full bg-secondary/50" />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 rounded-2xl bg-secondary/30 border border-border/50">
                          <p className="text-xs font-bold text-muted-foreground uppercase mb-1">Stress</p>
                          <p className="text-lg font-bold text-foreground">{stressLevel ?? "--"}%</p>
                        </div>
                        <div className="p-4 rounded-2xl bg-secondary/30 border border-border/50">
                          <p className="text-xs font-bold text-muted-foreground uppercase mb-1">Burnout</p>
                          <p className="text-lg font-bold text-foreground">{burnoutRisk ?? "--"}%</p>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-64 text-center px-6">
                    <div className="h-20 w-20 rounded-full bg-secondary/30 flex items-center justify-center mb-4">
                      <Heart className="h-10 w-10 text-muted-foreground" />
                    </div>
                    <p className="text-muted-foreground">
                      No live wellness score yet. Complete diagnostics or counseling sessions to generate insights.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-none shadow-xl shadow-primary/5 rounded-[2.5rem] bg-background relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-info/40 to-success/40" />
              <CardHeader className="pt-8">
                <CardTitle className="text-xl font-bold flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-info/10">
                    <Bot className="h-5 w-5 text-info" />
                  </div>
                  Live Insights
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-8">
                {isLoading ? (
                  <div className="flex flex-col items-center justify-center h-64 gap-4">
                    <Loader2 className="h-10 w-10 animate-spin text-primary/40" />
                    <p className="text-sm text-muted-foreground">Generating live insight...</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="p-5 rounded-2xl bg-info/5 border border-info/10 relative">
                      <Sparkles className="absolute -top-2 -right-2 h-6 w-6 text-info/40" />
                      <p className="text-sm font-bold text-info uppercase mb-3">Wellness Insight</p>
                      <p className="text-base text-foreground leading-relaxed">{insightText}</p>
                    </div>

                    <div className="p-5 rounded-2xl bg-success/5 border border-success/10">
                      <p className="text-sm font-bold text-success uppercase mb-3">Recommended Actions</p>
                      <p className="text-base text-foreground leading-relaxed">{recommendationText}</p>
                    </div>

                    <div className="flex items-center justify-between p-4 rounded-2xl bg-secondary/20">
                      <span className="text-sm font-bold text-muted-foreground uppercase">Current Risk Status</span>
                      <span
                        className={`px-4 py-1 rounded-full text-xs font-black uppercase tracking-widest ${
                          riskLabel === "high" || riskLabel === "critical"
                            ? "bg-destructive text-destructive-foreground shadow-lg shadow-destructive/20"
                            : riskLabel === "medium"
                            ? "bg-warning text-warning-foreground"
                            : "bg-success text-success-foreground"
                        }`}
                      >
                        {riskLabel}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {recentHistory.length > 0 && (
            <Card className="border-none shadow-xl shadow-primary/5 rounded-[2.5rem] bg-background">
              <CardHeader className="pt-8">
                <CardTitle className="text-xl font-bold">Wellness Journey</CardTitle>
              </CardHeader>
              <CardContent className="pb-8">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {recentHistory.map((entry: any) => (
                    <div
                      key={entry.id}
                      className="group p-5 rounded-3xl border border-border/50 bg-secondary/10 hover:bg-secondary/20 transition-all duration-300"
                    >
                      <div className="flex justify-between items-center mb-4">
                        <p className="text-sm font-bold text-foreground">
                          {entry.created_at
                            ? new Date(entry.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })
                            : "--"}
                        </p>
                        <div
                          className={`h-2 w-2 rounded-full ${
                            entry.risk_level === "high" || entry.risk_level === "critical"
                              ? "bg-destructive shadow-[0_0_10px_rgba(239,68,68,0.5)]"
                              : "bg-success"
                          }`}
                        />
                      </div>
                      <div className="flex items-end justify-between">
                        <div className="space-y-1">
                          <p className="text-xs font-bold text-muted-foreground uppercase">Wellness</p>
                          <p className="text-2xl font-black text-primary">{entry.wellness_score ?? "--"}%</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-bold text-muted-foreground uppercase">Risk</p>
                          <p className="font-bold text-foreground">{entry.risk_level ?? "--"}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </main>
      </div>
    </div>
  );
};

export default StudentWellness;
