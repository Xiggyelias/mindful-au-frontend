import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  MessageSquare,
  Calendar,
  Bot,
  Video,
  History,
  Heart,
  AlertTriangle,
  Phone,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { StatsCard } from "@/components/StatsCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { format } from "date-fns";

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
  { value: "great", label: "Great", display: "\u{1F60A} Great" },
  { value: "okay", label: "Okay", display: "\u{1F610} Okay" },
  { value: "low", label: "Low", display: "\u{1F614} Low" },
  { value: "stressed", label: "Stressed", display: "\u{1F62B} Stressed" },
  { value: "tired", label: "Tired", display: "\u{1F634} Tired" },
] as const;

type StudentMood = (typeof moodOptions)[number]["value"];

const StudentDashboard = () => {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isPanicLoading, setIsPanicLoading] = useState(false);
  const [stats, setStats] = useState({ sessions: 0, appointments: 0, wellness: null as number | null, chats: 0 });
  const [upcomingAppointments, setUpcomingAppointments] = useState<any[]>([]);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [wellnessSummary, setWellnessSummary] = useState<any | null>(null);
  const [dailyTips, setDailyTips] = useState<string[]>([]);
  const [tipsLoading, setTipsLoading] = useState(false);
  const [tipsError, setTipsError] = useState<string | null>(null);
  const [dailyMood, setDailyMood] = useState<StudentMood | null>(null);
  const [isRecordingMood, setIsRecordingMood] = useState(false);
  const { user } = useAuth();

  const userName = user?.profile?.full_name || user?.email?.split('@')[0] || "Student";

  const extractTipsFromSummary = (summary: any): string[] => {
    const recommendationText =
      typeof summary?.recommendations === "string" ? summary.recommendations.trim() : "";
    const mlActions = Array.isArray(summary?.ml_insights?.recommended_actions)
      ? summary.ml_insights.recommended_actions.filter(
          (item: unknown) => typeof item === "string" && item.trim().length > 0
        )
      : [];

    const tipsFromText = recommendationText
      ? recommendationText
          .split(/[.!?]\s+/)
          .map((part: string) => part.trim())
          .filter((part: string) => part.length > 10)
      : [];

    return Array.from(new Set([...tipsFromText, ...mlActions])).slice(0, 4);
  };

  const openVideoCallRoom = (appointment: any) => {
    if (!appointment?.id) {
      navigate("/student/video-call");
      return;
    }

    const params = new URLSearchParams({
      appointment_id: String(appointment.id),
      autostart: "1",
    });

    if (appointment.counselor_id) {
      params.set("counselor_id", String(appointment.counselor_id));
    }

    navigate(`/student/video-call?${params.toString()}`);
  };

  useEffect(() => {
    const loadStats = async () => {
      try {
        setTipsLoading(true);
        setTipsError(null);

        const [sessions, appointments, summary, moodData] = await Promise.all([
          api.getSessions({ lightweight: true }),
          api.getAppointments(),
          api.getStudentWellnessSummary().catch(() => null),
          api.getStudentMoodToday().catch(() => null),
        ]);

        const sessionItems = Array.isArray(sessions)
          ? sessions
          : Array.isArray((sessions as any)?.data)
          ? (sessions as any).data
          : [];
        const appointmentItems = Array.isArray(appointments)
          ? appointments
          : Array.isArray((appointments as any)?.data)
          ? (appointments as any).data
          : [];
        
        const upcomingApts = appointmentItems
          .filter((a: any) => new Date(a.scheduled_at) > new Date())
          .slice(0, 3);
        
        const wellnessScore =
          typeof summary?.scores?.wellness_score === "number" ? summary.scores.wellness_score : null;
        const tips = extractTipsFromSummary(summary);

        setStats({
          sessions: sessionItems.length,
          appointments: appointmentItems.filter((a: any) => a.status === 'scheduled').length,
          wellness: wellnessScore,
          chats: Number(summary?.ml_insights?.feature_snapshot?.ai_chat_messages_30d ?? sessionItems.length),
        });
        setUpcomingAppointments(upcomingApts);
        setDiagnostics(summary?.latest_ai_diagnostic ?? summary?.latest_diagnostic ?? null);
        setWellnessSummary(summary);
        setDailyTips(tips);
        if (moodData?.log?.mood) {
          setDailyMood(moodData.log.mood as StudentMood);
        } else {
          setDailyMood(null);
        }
        if (tips.length === 0) {
          setTipsError("No live recommendations yet. Complete a check-in to generate them.");
        }
      } catch (error) {
        console.error('Failed to load stats:', error);
        setDailyTips([]);
        setTipsError("Live tips are unavailable right now.");
      } finally {
        setTipsLoading(false);
      }
    };
    if (user) loadStats();
  }, [user]);

  const handlePanicButton = async () => {
    if (!user?.id) {
      toast.error("Please log in to use this feature");
      return;
    }

    setIsPanicLoading(true);
    try {
      let location: string | undefined;
      
      // Try to get location
      if (navigator.geolocation) {
        try {
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
          });
          location = `${position.coords.latitude}, ${position.coords.longitude}`;
        } catch (err) {
          console.log('Could not get location:', err);
        }
      }

      await api.createPanicLog({ location });
      toast.success("Emergency alert sent! A counselor will contact you shortly.");
    } catch (error: any) {
      console.error('Panic button error:', error);
      toast.error(error.response?.data?.message || "Failed to send emergency alert. Please try again.");
    } finally {
      setIsPanicLoading(false);
    }
  };

  const handleCallNow = () => {
    // Open phone dialer with crisis hotline number
    window.location.href = 'tel:988'; // National Suicide Prevention Lifeline
    toast.info("Connecting to crisis hotline...");
  };

  const handleMoodSelection = async (mood: StudentMood) => {
    if (!user?.id) {
      toast.error("Please log in to record your mood.");
      return;
    }

    if (dailyMood) {
      const existing = moodOptions.find((item) => item.value === dailyMood)?.display ?? dailyMood;
      toast.info(`Today's mood is already locked: ${existing}.`);
      return;
    }

    try {
      setIsRecordingMood(true);
      const result = await api.recordStudentMood(mood);
      const recorded = (result?.log?.mood ?? mood) as StudentMood;
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
      } else {
        toast.error(message || "Unable to save mood. Please try again.");
      }
    } finally {
      setIsRecordingMood(false);
    }
  };

  const mlInsights = wellnessSummary?.ml_insights;

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
        <DashboardHeader
          title="Dashboard"
          onMenuClick={() => setSidebarOpen(true)}
        />

        <main className="p-4 lg:p-6 space-y-6">
          {/* Welcome Section */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary/10 via-primary/5 to-background p-8 border border-primary/10">
            <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="space-y-2">
                <h2 className="text-3xl font-display font-bold text-foreground">
                  Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, {userName}! ✨
            </h2>
                <p className="text-lg text-muted-foreground max-w-xl">
                  Take a deep breath. We're here to support your journey today. How are you feeling right now?
                </p>
                <div className="flex flex-wrap gap-2 pt-4">
                  {moodOptions.map((moodOption) => (
                    <Button
                      key={moodOption.value}
                      variant="glass"
                      size="sm"
                      className={`rounded-full transition-all duration-300 ${
                        dailyMood === moodOption.value
                          ? "bg-primary/20 border border-primary/30"
                          : "bg-background/50 hover:bg-primary/20"
                      }`}
                      onClick={() => handleMoodSelection(moodOption.value)}
                      disabled={Boolean(dailyMood) || isRecordingMood}
                    >
                      {moodOption.display}
                    </Button>
                  ))}
                </div>
                {dailyMood && (
                  <p className="text-xs text-muted-foreground">
                    Mood recorded for today: {moodOptions.find((item) => item.value === dailyMood)?.display ?? dailyMood}.
                    New selection unlocks tomorrow.
                  </p>
                )}
              </div>
              <div className="hidden md:block">
                <div className="h-32 w-32 rounded-full bg-primary/10 flex items-center justify-center animate-pulse">
                  <Heart className="h-16 w-16 text-primary fill-primary/20" />
                </div>
              </div>
            </div>
            {/* Decorative background elements */}
            <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/5 blur-3xl" />
            <div className="absolute -left-10 -bottom-10 h-40 w-40 rounded-full bg-info/5 blur-3xl" />
          </div>

          {/* Featured Services / Quick Actions */}
          <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <Card
              className="group cursor-pointer border-none bg-gradient-to-br from-primary/5 to-transparent hover:from-primary/10 transition-all duration-500 rounded-3xl"
              onClick={() => navigate("/student/chat")}
            >
              <CardContent className="p-6 flex flex-col items-center text-center gap-4">
                <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
              <MessageSquare className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <h3 className="font-bold text-lg mb-1">Talk to Someone</h3>
                  <p className="text-sm text-muted-foreground">Start a session with a professional counselor</p>
                </div>
              </CardContent>
            </Card>

            <Card
              className="group cursor-pointer border-none bg-gradient-to-br from-info/5 to-transparent hover:from-info/10 transition-all duration-500 rounded-3xl"
              onClick={() => navigate("/student/ai-support")}
            >
              <CardContent className="p-6 flex flex-col items-center text-center gap-4">
                <div className="h-16 w-16 rounded-2xl bg-info/10 flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
                  <Bot className="h-8 w-8 text-info" />
                </div>
                <div>
                  <h3 className="font-bold text-lg mb-1">AI Assistant</h3>
                  <p className="text-sm text-muted-foreground">24/7 support for coping strategies and tips</p>
                </div>
              </CardContent>
            </Card>

            <Card
              className="group cursor-pointer border-none bg-gradient-to-br from-success/5 to-transparent hover:from-success/10 transition-all duration-500 rounded-3xl"
              onClick={() => navigate("/student/wellness")}
            >
              <CardContent className="p-6 flex flex-col items-center text-center gap-4">
                <div className="h-16 w-16 rounded-2xl bg-success/10 flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
                  <Heart className="h-8 w-8 text-success" />
                </div>
                <div>
                  <h3 className="font-bold text-lg mb-1">Self-Care</h3>
                  <p className="text-sm text-muted-foreground">Explore wellness tools and check your score</p>
                </div>
              </CardContent>
            </Card>

            <Card
              className="group cursor-pointer border-none bg-gradient-to-br from-warning/5 to-transparent hover:from-warning/10 transition-all duration-500 rounded-3xl"
              onClick={() => navigate("/student/appointments")}
            >
              <CardContent className="p-6 flex flex-col items-center text-center gap-4">
                <div className="h-16 w-16 rounded-2xl bg-warning/10 flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
              <Calendar className="h-8 w-8 text-warning" />
                </div>
                <div>
                  <h3 className="font-bold text-lg mb-1">Schedule</h3>
                  <p className="text-sm text-muted-foreground">Book or manage your upcoming sessions</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Stats */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <StatsCard
              title="Sessions This Month"
              value={stats.sessions}
              change={`${stats.appointments} upcoming`}
              trend="neutral"
              icon={MessageSquare}
            />
            <StatsCard
              title="Wellness Score"
              value={stats.wellness !== null ? `${stats.wellness}%` : "--"}
              change={diagnostics?.mood || (stats.wellness !== null ? "Check in today" : "No data yet")}
              trend={stats.wellness !== null && stats.wellness >= 70 ? "up" : "neutral"}
              icon={Heart}
            />
            <StatsCard
              title="Upcoming Sessions"
              value={stats.appointments}
              change="Scheduled"
              trend="neutral"
              icon={Calendar}
            />
            <StatsCard
              title="AI Chats"
              value={stats.chats}
              change="Total sessions"
              trend="neutral"
              icon={Bot}
            />
          </div>

          <div className="grid gap-8 lg:grid-cols-2">
            {/* Upcoming Sessions */}
            <Card className="border-none shadow-xl shadow-primary/5 rounded-3xl overflow-hidden bg-background">
              <CardHeader className="bg-secondary/10 border-b border-border/50">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xl font-bold flex items-center gap-2">
                    <Calendar className="h-5 w-5 text-primary" />
                    Upcoming Sessions
                  </CardTitle>
                  <Button variant="ghost" size="sm" className="text-primary hover:text-primary/80" onClick={() => navigate("/student/appointments")}>
                    View all
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-4">
                  {upcomingAppointments.length === 0 ? (
                    <div className="text-center py-8 bg-secondary/20 rounded-2xl border-2 border-dashed border-border/50">
                      <p className="text-muted-foreground mb-4">No sessions scheduled yet</p>
                      <Button variant="outline" size="sm" onClick={() => navigate("/student/appointments")}>
                        Book your first session
                      </Button>
                    </div>
                  ) : (
                    upcomingAppointments.map((apt) => (
                      <div key={apt.id} className="group flex items-center gap-4 p-4 rounded-2xl bg-secondary/40 hover:bg-secondary/60 transition-colors duration-300">
                        <div className="h-14 w-14 rounded-2xl bg-primary/10 flex flex-col items-center justify-center text-primary border border-primary/20">
                          <span className="text-xs font-bold uppercase">{apt.scheduled_at ? format(new Date(apt.scheduled_at), "MMM") : "---"}</span>
                          <span className="text-lg font-bold">{apt.scheduled_at ? format(new Date(apt.scheduled_at), "d") : "--"}</span>
                        </div>
                        <div className="flex-1">
                          <p className="font-bold text-foreground group-hover:text-primary transition-colors">
                            Session with {apt.counselor?.profile?.full_name || "Counselor"}
                          </p>
                          <p className="text-sm text-muted-foreground flex items-center gap-1">
                            <Bot className="h-3 w-3" /> {apt.scheduled_at ? format(new Date(apt.scheduled_at), "h:mm a") : "Time TBD"}
                          </p>
                        </div>
                        <Button 
                          className="rounded-full px-6 bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20" 
                          size="sm" 
                          onClick={() => openVideoCallRoom(apt)}
                        >
                          Join
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Wellness Tips & Mood Analytics */}
            <Card className="border-none shadow-xl shadow-primary/5 rounded-3xl overflow-hidden bg-background">
              <CardHeader className="bg-secondary/10 border-b border-border/50">
                <CardTitle className="text-xl font-bold flex items-center gap-2">
                  <Heart className="h-5 w-5 text-primary" />
                  Your Wellness Corner
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-4">
                  {tipsLoading ? (
                    <div className="p-6 rounded-2xl bg-secondary/20 text-center text-muted-foreground">
                      Loading daily tips...
                    </div>
                  ) : dailyTips.length === 0 ? (
                    <div className="p-6 rounded-2xl bg-secondary/20 text-center">
                      <p className="text-sm text-muted-foreground mb-3">
                        {tipsError || "Daily tips are unavailable right now."}
                      </p>
                      <Button variant="outline" size="sm" onClick={() => navigate("/student/ai-support")}>
                        Ask AI Support
                      </Button>
                    </div>
                  ) : (
                    <>
                      {mlInsights && (
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="rounded-2xl bg-secondary/30 p-4">
                            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Forecast</p>
                            <p className="mt-2 text-lg font-semibold capitalize text-foreground">
                              {mlInsights?.risk_forecast?.level || "unknown"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {typeof mlInsights?.risk_forecast?.score === "number" ? `${mlInsights.risk_forecast.score}/100` : "No score"}
                            </p>
                          </div>
                          <div className="rounded-2xl bg-secondary/30 p-4">
                            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Focus</p>
                            <p className="mt-2 text-sm font-medium text-foreground">
                              {mlInsights?.focus_area || "Routine wellbeing support"}
                            </p>
                          </div>
                          <div className="rounded-2xl bg-secondary/30 p-4">
                            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Trend</p>
                            <p className="mt-2 text-lg font-semibold capitalize text-foreground">
                              {mlInsights?.trend?.label || "steady"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Confidence {typeof mlInsights?.risk_forecast?.confidence === "number" ? `${mlInsights.risk_forecast.confidence}%` : "n/a"}
                            </p>
                          </div>
                        </div>
                      )}
                      <div className="p-4 rounded-2xl bg-primary/5 border border-primary/10">
                        <p className="text-sm font-medium text-primary mb-1 italic">Tip of the day:</p>
                        <p className="text-base text-foreground font-medium">{dailyTips[0]}</p>
                      </div>
                      <div className="grid gap-3">
                        {dailyTips.slice(1).map((tip, i) => (
                          <div
                            key={i}
                            className="flex items-start gap-3 p-4 rounded-2xl bg-secondary/30 border border-transparent hover:border-primary/20 transition-all duration-300"
                          >
                            <div className="mt-1 h-2 w-2 rounded-full bg-primary/40 shrink-0" />
                            <p className="text-sm text-foreground/80">{tip}</p>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {wellnessSummary?.generated_at && (
                    <p className="text-xs text-muted-foreground">
                      Live insights updated: {new Date(wellnessSummary.generated_at).toLocaleString()}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Panic Button Section - Reimagined as Support Center */}
          <div className="mt-8 rounded-[2.5rem] bg-destructive/5 border-2 border-destructive/10 p-1">
            <div className="rounded-[2.25rem] bg-white dark:bg-zinc-900 p-8 flex flex-col lg:flex-row items-center justify-between gap-8 shadow-inner">
              <div className="flex items-center gap-6">
                <div className="h-20 w-20 rounded-3xl bg-destructive/10 flex items-center justify-center shrink-0 shadow-lg shadow-destructive/5">
                  <AlertTriangle className="h-10 w-10 text-destructive animate-pulse" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-foreground mb-2">
                    Are you feeling overwhelmed?
                  </h3>
                  <p className="text-muted-foreground text-lg max-w-lg">
                    It's okay to not be okay. If you're in immediate distress, our team and emergency resources are just a click away.
                  </p>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-4 w-full lg:w-auto">
                <Button 
                  variant="outline" 
                  className="h-16 px-8 rounded-2xl gap-3 border-2 hover:bg-secondary/50 transition-all text-lg font-bold" 
                  onClick={handleCallNow}
                >
                  <Phone className="h-6 w-6 text-primary" />
                  24/7 Hotline
                </Button>
                <Button 
                  variant="destructive" 
                  className="h-16 px-8 rounded-2xl gap-3 shadow-xl shadow-destructive/20 hover:scale-105 transition-all text-lg font-bold"
                  onClick={handlePanicButton}
                  disabled={isPanicLoading}
                >
                  <AlertTriangle className="h-6 w-6" />
                  {isPanicLoading ? "Notifying..." : "I Need Help Now"}
                </Button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default StudentDashboard;

