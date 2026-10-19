import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Coffee,
  Heart,
  Sun,
  Loader2,
  CheckCircle2,
  Moon,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { counselorNavItems } from "@/config/counselorNavItems";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { api, getApiErrorMessage } from "@/lib/api";
import { toast } from "sonner";
import { CounselorClockOutModal } from "@/components/counselor/CounselorClockOutModal";

const scaleOptions = [
  { value: 0, label: "Never" },
  { value: 1, label: "Rarely" },
  { value: 2, label: "Sometimes" },
  { value: 3, label: "Often" },
  { value: 4, label: "Almost always" },
] as const;

const checkInQuestions = [
  { key: "emotional_drain", label: "I felt emotionally drained by counseling work today.", category: "Compassion Fatigue" },
  { key: "disconnect_difficulty", label: "I found it hard to disconnect from work after sessions.", category: "Boundary Separation" },
  { key: "calm_control", label: "I felt calm and in control during difficult moments.", category: "Clinical Presence" },
  { key: "energy_level", label: "I had enough energy to support students effectively.", category: "Energy & Vitality" },
  { key: "break_quality", label: "I took meaningful breaks between sessions.", category: "Restorative Pacing" },
  { key: "support_level", label: "I felt supported by peers or supervisors today.", category: "Support Network" },
  { key: "sleep_quality", label: "My sleep quality in the last 24 hours was restorative.", category: "Somatic Recovery" },
  { key: "burnout_worry", label: "I worry I may burn out if this pace continues.", category: "Burnout Resiliency" },
] as const;

type CheckInKey = (typeof checkInQuestions)[number]["key"];
type CheckInAnswers = Record<CheckInKey, number | null>;

const createEmptyAnswers = (): CheckInAnswers => ({
  emotional_drain: null,
  disconnect_difficulty: null,
  calm_control: null,
  energy_level: null,
  break_quality: null,
  support_level: null,
  sleep_quality: null,
  burnout_worry: null,
});

const calculateCheckInScores = (answers: Record<CheckInKey, number>) => {
  const inverseCalm = 4 - answers.calm_control;
  const inverseBreaks = 4 - answers.break_quality;
  const inverseEnergy = 4 - answers.energy_level;
  const inverseSleep = 4 - answers.sleep_quality;

  const stressRaw =
    (answers.emotional_drain +
      answers.disconnect_difficulty +
      inverseCalm +
      inverseBreaks +
      answers.burnout_worry) /
    5;
  const burnoutRaw =
    (answers.emotional_drain +
      answers.disconnect_difficulty +
      answers.burnout_worry +
      inverseEnergy +
      inverseSleep) /
    5;
  const moodRaw =
    (answers.calm_control +
      answers.energy_level +
      answers.break_quality +
      answers.support_level +
      answers.sleep_quality) /
    5;

  return {
    stress_level: Math.round(stressRaw * 25),
    burnout_index: Math.round(burnoutRaw * 25),
    mood_score: Math.round(moodRaw * 25),
  };
};

const CounselorWellness = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [wellnessLogs, setWellnessLogs] = useState<any[]>([]);
  const [wellnessSummary, setWellnessSummary] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunningCheck, setIsRunningCheck] = useState(false);
  const [isSubmittingCheckIn, setIsSubmittingCheckIn] = useState(false);
  const [clockOutModalOpen, setClockOutModalOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [checkInAnswers, setCheckInAnswers] = useState<CheckInAnswers>(createEmptyAnswers());
  const [showOverrideCheckIn, setShowOverrideCheckIn] = useState(false);
  const { user } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || "Counselor";

  const todayCheckInLog = useMemo(() => {
    return wellnessLogs.find((log) => {
      // Matches any check-in that contains validated self answers or check_in_version
      if (!log.check_in_answers && log.check_in_version !== "v1" && log.check_in_version !== "v2") return false;
      const logDate = new Date(log.created_at);
      const today = new Date();
      return (
        logDate.getFullYear() === today.getFullYear() &&
        logDate.getMonth() === today.getMonth() &&
        logDate.getDate() === today.getDate()
      );
    });
  }, [wellnessLogs]);

  const hasCheckedInToday = Boolean(todayCheckInLog);

  const loadWellnessData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [logsResult, summaryResult] = await Promise.allSettled([
        api.getCounselorWellness(),
        api.getCounselorWellnessSummary(),
      ]);

      if (logsResult.status === "fulfilled") {
        setWellnessLogs(logsResult.value);
      }

      if (summaryResult.status === "fulfilled") {
        setWellnessSummary(summaryResult.value);
      }

      if (logsResult.status === "rejected" && summaryResult.status === "rejected") {
        throw logsResult.reason ?? summaryResult.reason;
      }
    } catch (error: any) {
      if (import.meta.env.DEV) console.error("Failed to load wellness logs:", error);
      toast.error("Failed to load wellness data");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    void loadWellnessData();
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadWellnessData();
    }, 60000);

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void loadWellnessData();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadWellnessData]);

  const answeredCount = useMemo(
    () => Object.values(checkInAnswers).filter((value) => typeof value === "number").length,
    [checkInAnswers]
  );

  const isCheckInComplete = answeredCount === checkInQuestions.length;

  const checkInPreview = useMemo(() => {
    if (!isCheckInComplete) return null;

    const normalized = Object.fromEntries(
      Object.entries(checkInAnswers).map(([key, value]) => [key, value ?? 0])
    ) as Record<CheckInKey, number>;

    return calculateCheckInScores(normalized);
  }, [checkInAnswers, isCheckInComplete]);

  const handleHealthCheck = async () => {
    try {
      setIsRunningCheck(true);
      const result = await api.runCounselorHealthCheck();
      if (result?.persisted === false) {
        toast.info(result?.message || "No live activity is available for a health check yet.");
      } else {
        toast.success("Live health check completed");
      }
      await loadWellnessData();
    } catch (error: any) {
      toast.error(getApiErrorMessage(error, "Failed to run health check"));
    } finally {
      setIsRunningCheck(false);
    }
  };

  const handleSelectAnswer = (question: CheckInKey, value: number) => {
    setCheckInAnswers((prev) => ({
      ...prev,
      [question]: value,
    }));
  };

  const handleSubmitCheckIn = async () => {
    if (!isCheckInComplete) {
      toast.error("Please answer every check-in question.");
      return;
    }

    const payload = Object.fromEntries(
      Object.entries(checkInAnswers).map(([key, value]) => [key, value ?? 0])
    ) as Record<CheckInKey, number>;

    try {
      setIsSubmittingCheckIn(true);
      await api.createCounselorWellness({
        check_in: payload,
        notes: notes.trim() || undefined,
      });
      toast.success("Wellness check-in saved");
      await loadWellnessData();
      setCheckInAnswers(createEmptyAnswers());
      setNotes("");
      setShowOverrideCheckIn(false);
    } catch (error: any) {
      toast.error(getApiErrorMessage(error, "Failed to save check-in"));
    } finally {
      setIsSubmittingCheckIn(false);
    }
  };

  const latestLog = wellnessLogs[0];
  const summaryScores = wellnessSummary?.scores ?? null;
  const moodScore = wellnessSummary
    ? typeof summaryScores?.mood_score === "number"
      ? summaryScores.mood_score
      : null
    : latestLog?.mood_score ?? null;
  const stressLevel = wellnessSummary
    ? typeof summaryScores?.stress_level === "number"
      ? summaryScores.stress_level
      : null
    : latestLog?.stress_level ?? null;
  const burnoutIndex = wellnessSummary
    ? typeof summaryScores?.burnout_index === "number"
      ? summaryScores.burnout_index
      : null
    : latestLog?.burnout_index ?? null;
  const recommendationText = wellnessSummary
    ? wellnessSummary.recommendations ?? null
    : latestLog?.recommendations ?? null;

  const getWellnessStatus = (score: number | null) => {
    if (typeof score !== "number") {
      return { label: "No data", color: "text-muted-foreground" };
    }
    if (score >= 70) return { label: "Good", color: "text-success" };
    if (score >= 50) return { label: "Moderate", color: "text-warning" };
    return { label: "Needs Attention", color: "text-destructive" };
  };

  const scoreColor = (value: number | null, lowThreshold: number, mediumThreshold: number) => {
    if (typeof value !== "number") return "text-muted-foreground";
    if (value < lowThreshold) return "text-success";
    if (value < mediumThreshold) return "text-warning";
    return "text-destructive";
  };

  const wellnessStatus = getWellnessStatus(moodScore);
  const workloadStatus =
    typeof stressLevel !== "number"
      ? "No data"
      : stressLevel < 40
      ? "Low"
      : stressLevel < 70
      ? "Moderate"
      : "High";
  const burnoutStatus =
    typeof burnoutIndex !== "number"
      ? "No data"
      : burnoutIndex < 30
      ? "Low"
      : burnoutIndex < 60
      ? "Moderate"
      : "High";

  const checkInProgress = Math.round((answeredCount / checkInQuestions.length) * 100);
  const liveSummarySource = String(wellnessSummary?.source || "");
  const liveSummaryCaption =
    liveSummarySource === "live-insufficient-data"
      ? "No live activity data is available yet."
      : liveSummarySource === "self-check-in-only"
      ? "Showing your latest validated self check-in until live workload data is available."
      : liveSummarySource === "live-computed+self-check-in"
      ? "Computed from live activity data and blended with your recent self check-in."
      : "Computed from live activity data.";

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar
        items={counselorNavItems}
        userType="counselor"
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-72 pl-0">
        <DashboardHeader title="My Wellness" onMenuClick={() => setSidebarOpen(true)} />

        <main className="p-4 lg:p-6 space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Card variant="glass">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-success/20 flex items-center justify-center">
                    <Heart className="h-6 w-6 text-success" />
                  </div>
                  <div>
                    <p className={`text-2xl font-bold ${wellnessStatus.color}`}>{wellnessStatus.label}</p>
                    <p className="text-muted-foreground">Overall Wellness ({moodScore ?? "--"}%)</p>
                  </div>
                </div>
                <Progress
                  value={typeof moodScore === "number" ? moodScore : 0}
                  className="h-2 mt-3"
                  indicatorClassName={
                    typeof moodScore !== "number" ? "" :
                    moodScore >= 70 ? "bg-emerald-500" :
                    moodScore >= 50 ? "bg-amber-400" : "bg-destructive"
                  }
                />
              </CardContent>
            </Card>
            <Card variant="glass">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-warning/20 flex items-center justify-center">
                    <Coffee className="h-6 w-6 text-warning" />
                  </div>
                  <div>
                    <p className={`text-2xl font-bold ${scoreColor(stressLevel, 40, 70)}`}>{workloadStatus}</p>
                    <p className="text-muted-foreground">Stress Level ({stressLevel ?? "--"}%)</p>
                  </div>
                </div>
                <Progress
                  value={typeof stressLevel === "number" ? stressLevel : 0}
                  className="h-2 mt-3"
                  indicatorClassName={
                    typeof stressLevel !== "number" ? "" :
                    stressLevel < 40 ? "bg-emerald-500" :
                    stressLevel < 70 ? "bg-amber-400" : "bg-destructive"
                  }
                />
              </CardContent>
            </Card>
            <Card variant="glass">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-info/20 flex items-center justify-center">
                    <Sun className="h-6 w-6 text-info" />
                  </div>
                  <div>
                    <p className={`text-2xl font-bold ${scoreColor(burnoutIndex, 30, 60)}`}>{burnoutStatus}</p>
                    <p className="text-muted-foreground">Burnout Risk ({burnoutIndex ?? "--"}%)</p>
                  </div>
                </div>
                <Progress
                  value={typeof burnoutIndex === "number" ? burnoutIndex : 0}
                  className="h-2 mt-3"
                  indicatorClassName={
                    typeof burnoutIndex !== "number" ? "" :
                    burnoutIndex < 30 ? "bg-emerald-500" :
                    burnoutIndex < 60 ? "bg-amber-400" : "bg-destructive"
                  }
                />
              </CardContent>
            </Card>
          </div>

          {/* Daily Shift Assessment & Clock-Out Banner */}
          <div className="rounded-3xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-5 backdrop-blur-md shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/20 text-primary shadow-inner">
                  <Moon className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-bold text-foreground text-sm sm:text-base">
                    Daily Shift Evaluation & Boundary Clock-Out
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Assess cognitive load, emotional boundaries, and secondary trauma before officially clocking out for the day.
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => setClockOutModalOpen(true)}
                className="rounded-xl gap-2 text-xs font-semibold shadow-md bg-primary text-primary-foreground shadow-primary/20 shrink-0"
              >
                <Moon className="h-4 w-4" />
                Begin Shift Assessment
              </Button>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card variant="glass">
              <CardHeader>
                <CardTitle className="text-lg">Live Health Check</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button onClick={handleHealthCheck} disabled={isRunningCheck} className="w-full">
                  {isRunningCheck ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Running analysis...
                    </>
                  ) : (
                    <>
                      <Activity className="mr-2 h-4 w-4" />
                      Run Workload Health Check
                    </>
                  )}
                </Button>
                <p className="text-sm text-muted-foreground">
                  Uses your real session load, upcoming appointments, and recent risk exposure to estimate stress and burnout.
                </p>
                {wellnessSummary?.metrics && (
                  <div className="p-3 rounded-lg bg-secondary/40 border border-border/60 text-xs text-muted-foreground">
                    {liveSummaryCaption}{" "}
                    Last 7 days: {wellnessSummary.metrics.sessions_7d} sessions,{" "}
                    {wellnessSummary.metrics.upcoming_appointments_7d} upcoming appointments.
                    {wellnessSummary.metrics.live_data_points != null && (
                      <> Live data points: {wellnessSummary.metrics.live_data_points}.</>
                    )}
                  </div>
                )}
                {recommendationText && (
                  <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                    <p className="text-sm font-semibold mb-1">Latest recommendations</p>
                    <p className="text-sm text-muted-foreground">{recommendationText}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card variant="glass">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-emerald-500" />
                    <CardTitle className="text-lg">Validated Self-Care Assessment</CardTitle>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Standardized daily clinical resiliency, compassion fatigue & boundaries self-check
                  </p>
                </div>
                {hasCheckedInToday && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40">
                    <CheckCircle2 className="h-3 w-3" /> Validated Today
                  </span>
                )}
              </CardHeader>
              <CardContent className="space-y-4 pt-2">
              {hasCheckedInToday && !showOverrideCheckIn ? (
                <div className="space-y-5 flex flex-col items-center justify-center py-4 text-center">
                  <div className="relative flex items-center justify-center h-16 w-16 rounded-full bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/30 text-emerald-600 dark:text-emerald-400">
                    <ShieldCheck className="h-9 w-9 text-emerald-600 dark:text-emerald-400" />
                    <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-20 animate-ping" />
                  </div>

                  <div className="space-y-1">
                    <h3 className="text-xl font-bold tracking-tight text-foreground">
                      Self-Validation Active
                    </h3>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                      Your clinical wellness self-check for today is officially logged and factored into your live readiness index.
                    </p>
                  </div>

                  <div className="w-full border-t border-border/60 pt-4 space-y-3 text-left">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Today's Validated Metrics
                      </h4>
                      <span className="text-[11px] text-muted-foreground">
                        {todayCheckInLog?.created_at ? new Date(todayCheckInLog.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ""}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="p-3 rounded-lg bg-secondary/30 border border-border/50 text-center">
                        <span className="block text-[10px] text-muted-foreground font-medium uppercase mb-1">Mood & Vitality</span>
                        <span className={`text-lg font-bold ${getWellnessStatus(todayCheckInLog?.mood_score ?? null).color}`}>
                          {todayCheckInLog?.mood_score != null ? `${todayCheckInLog.mood_score}%` : "—"}
                        </span>
                      </div>
                      <div className="p-3 rounded-lg bg-secondary/30 border border-border/50 text-center">
                        <span className="block text-[10px] text-muted-foreground font-medium uppercase mb-1">Perceived Stress</span>
                        <span className={`text-lg font-bold ${scoreColor(todayCheckInLog?.stress_level, 40, 70)}`}>
                          {todayCheckInLog?.stress_level != null ? `${todayCheckInLog.stress_level}%` : "—"}
                        </span>
                      </div>
                      <div className="p-3 rounded-lg bg-secondary/30 border border-border/50 text-center">
                        <span className="block text-[10px] text-muted-foreground font-medium uppercase mb-1">Burnout Resiliency</span>
                        <span className={`text-lg font-bold ${scoreColor(todayCheckInLog?.burnout_index, 30, 60)}`}>
                          {todayCheckInLog?.burnout_index != null ? `${todayCheckInLog.burnout_index}%` : "—"}
                        </span>
                      </div>
                    </div>

                    {(todayCheckInLog?.recommendations || (wellnessSummary?.recommendations && wellnessSummary.recommendations.length > 0)) && (
                      <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-foreground flex items-start gap-2">
                        <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                        <div className="space-y-1">
                          <span className="font-semibold text-emerald-700 dark:text-emerald-300">Clinical Recommendation:</span>
                          <p className="text-muted-foreground">
                            {todayCheckInLog?.recommendations || wellnessSummary?.recommendations?.[0] || "Maintain regular hydration and scheduled inter-session pacing."}
                          </p>
                        </div>
                      </div>
                    )}

                    {todayCheckInLog?.notes && (
                      <div className="p-3 rounded-lg bg-secondary/15 border border-border/40 text-xs italic text-muted-foreground">
                        “{todayCheckInLog.notes}”
                      </div>
                    )}
                  </div>

                  <div className="w-full space-y-2 pt-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        // Pre-populate existing answers for editing
                        if (todayCheckInLog?.check_in_answers) {
                          setCheckInAnswers(todayCheckInLog.check_in_answers);
                        }
                        if (todayCheckInLog?.notes) {
                          setNotes(todayCheckInLog.notes);
                        }
                        setShowOverrideCheckIn(true);
                      }}
                      className="w-full text-xs font-medium"
                    >
                      Update Self-Validation Assessment
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>Completion</span>
                      <span>
                        {answeredCount}/{checkInQuestions.length}
                      </span>
                    </div>
                    <Progress value={checkInProgress} className="h-2" />
                  </div>

                  <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                    {checkInQuestions.map((question) => (
                      <div key={question.key} className="p-3 rounded-lg border bg-card space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium">{question.label}</p>
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-secondary text-muted-foreground shrink-0">
                            {question.category}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {scaleOptions.map((option) => (
                            <Button
                              key={option.value}
                              size="sm"
                              variant={checkInAnswers[question.key] === option.value ? "default" : "outline"}
                              className="text-xs h-8 px-2.5"
                              onClick={() => handleSelectAnswer(question.key, option.value)}
                            >
                              {option.label}
                            </Button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  <Textarea
                    placeholder="Optional note: what made today easier or harder?"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    maxLength={2000}
                  />

                  {checkInPreview && (
                    <div className="p-3 rounded-lg border bg-secondary/20">
                      <p className="text-sm font-semibold mb-2">Score preview</p>
                      <div className="flex flex-wrap gap-3 text-sm font-medium">
                        <span className={checkInPreview.mood_score >= 70 ? "text-success" : checkInPreview.mood_score >= 50 ? "text-warning" : "text-destructive"}>
                          Mood: {checkInPreview.mood_score}%
                        </span>
                        <span className={checkInPreview.stress_level < 40 ? "text-success" : checkInPreview.stress_level < 70 ? "text-warning" : "text-destructive"}>
                          Stress: {checkInPreview.stress_level}%
                        </span>
                        <span className={checkInPreview.burnout_index < 30 ? "text-success" : checkInPreview.burnout_index < 60 ? "text-warning" : "text-destructive"}>
                          Burnout: {checkInPreview.burnout_index}%
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2">
                    {showOverrideCheckIn && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setCheckInAnswers(createEmptyAnswers());
                          setNotes("");
                          setShowOverrideCheckIn(false);
                        }}
                        className="flex-1"
                      >
                        Cancel
                      </Button>
                    )}
                    <Button
                      onClick={handleSubmitCheckIn}
                      disabled={!isCheckInComplete || isSubmittingCheckIn}
                      className={showOverrideCheckIn ? "flex-1" : "w-full"}
                    >
                      {isSubmittingCheckIn ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                          Save Check-In
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}
              </CardContent>
            </Card>
          </div>

          <Card variant="glass">
            <CardHeader>
              <CardTitle className="text-lg">Wellness History</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading wellness history...</p>
              ) : wellnessLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No wellness entries yet.</p>
              ) : (
                <div className="space-y-3">
                  {wellnessLogs.slice(0, 10).map((log: any) => {
                    const source =
                      log.check_in_version === "v1"
                        ? "Self check-in"
                        : log.check_in_version === "ai-v1"
                        ? "Workload health check"
                        : log.check_in_version === "auto-v2" || log.check_in_version === "auto-v3"
                        ? "Live health check"
                        : "Manual entry";

                    return (
                      <div key={log.id} className="p-3 rounded-lg border bg-card">
                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <p className="text-sm font-medium">
                            {new Date(log.created_at).toLocaleDateString()} - {source}
                          </p>
                          <div className="flex gap-3 text-xs">
                            <span className={getWellnessStatus(log.mood_score ?? null).color}>Mood: {log.mood_score ?? "--"}%</span>
                            <span className={scoreColor(log.stress_level ?? null, 40, 70)}>Stress: {log.stress_level ?? "--"}%</span>
                            <span className={scoreColor(log.burnout_index ?? null, 30, 60)}>Burnout: {log.burnout_index ?? "--"}%</span>
                          </div>
                        </div>
                        {log.notes && <p className="text-sm text-muted-foreground mt-2">{log.notes}</p>}
                        {log.recommendations && (
                          <p className="text-xs text-primary mt-2">
                            <strong>Recommendations:</strong> {log.recommendations}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </main>
      </div>

      <CounselorClockOutModal
        open={clockOutModalOpen}
        onOpenChange={setClockOutModalOpen}
        onClockedOut={() => void loadWellnessData()}
      />
    </div>
  );
};

export default CounselorWellness;
