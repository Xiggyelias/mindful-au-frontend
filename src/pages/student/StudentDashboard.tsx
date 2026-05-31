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
  Clock,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { StatsCard } from "@/components/StatsCard";
import { DailyTipCard } from "@/components/DailyTipCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useDailyTip } from "@/hooks/useDailyTip";
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
  const [dailyMood, setDailyMood] = useState<StudentMood | null>(null);
  const [isRecordingMood, setIsRecordingMood] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const { user } = useAuth();
  const {
    tip: dailyTip,
    isLoading: tipLoading,
    error: tipError,
    refresh: refreshDailyTip,
    toggleFavorite,
    isSavingFavorite,
  } = useDailyTip();

  const userName = user?.profile?.full_name || user?.email?.split('@')[0] || "Student";

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
    let isMounted = true;

    const loadStats = async () => {
      if (!isMounted) return;
      
      try {
        setStatsLoading(true);
        setStatsError(null);
        
        const [sessions, appointments, summary, moodData] = await Promise.all([
          api.getSessions({ lightweight: true }),
          api.getAppointments(),
          api.getStudentWellnessSummary().catch(() => null),
          api.getStudentMoodToday().catch(() => null),
        ]);

        if (!isMounted) return;

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
        
        // Fix: Validate scheduled_at before creating Date objects
        const upcomingApts = appointmentItems
          .filter((a: any) => a.scheduled_at && new Date(a.scheduled_at) > new Date())
          .slice(0, 3);
        
        const wellnessScore =
          typeof summary?.scores?.wellness_score === "number" ? summary.scores.wellness_score : null;

        setStats({
          sessions: sessionItems.length,
          appointments: appointmentItems.filter((a: any) => a.status === 'scheduled').length,
          wellness: wellnessScore,
          chats: Number(summary?.ml_insights?.feature_snapshot?.ai_chat_messages_30d ?? sessionItems.length),
        });
        setUpcomingAppointments(upcomingApts);
        setDiagnostics(summary?.latest_ai_diagnostic ?? summary?.latest_diagnostic ?? null);
        if (moodData?.log?.mood) {
          setDailyMood(moodData.log.mood as StudentMood);
        } else {
          setDailyMood(null);
        }
      } catch (error) {
        if (!isMounted) return;
        const errorMessage = error instanceof Error ? error.message : "Failed to load dashboard statistics";
        setStatsError(errorMessage);
        if (import.meta.env.DEV) {
          console.error('Failed to load stats:', error);
        }
      } finally {
        if (isMounted) {
          setStatsLoading(false);
        }
      }
    };
    
    if (user) loadStats();
    
    // Cleanup function to prevent state updates on unmounted component
    return () => {
      isMounted = false;
    };
  }, [user]);

  const handlePanicButton = async () => {
    if (!user?.id) {
      toast.error("Please log in to use this feature");
      return;
    }

    // Prevent multiple concurrent panic button clicks
    if (isPanicLoading) {
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
        } catch {
          toast.warning("Location unavailable - we'll send your alert without location data.");
        }
      }

      await api.createPanicLog({ location });
      toast.success("Emergency alert sent! A counselor will contact you shortly.");
    } catch (error: any) {
      if (import.meta.env.DEV) {
        console.error('Panic button error:', error);
      }
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
        // Always sync state from server to maintain single source of truth
        try {
          const today = await api.getStudentMoodToday().catch(() => null);
          if (today?.log?.mood) {
            setDailyMood(today.log.mood as StudentMood);
          }
        } catch (syncError) {
          if (import.meta.env.DEV) {
            console.error('Failed to sync mood state:', syncError);
          }
        }
        toast.info("Today's first mood is already recorded.");
      } else {
        toast.error(message || "Unable to save mood. Please try again.");
      }
    } finally {
      setIsRecordingMood(false);
    }
  };

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
                {(() => {
                  const now = new Date();
                  const greeting = now.getHours() < 12 ? 'morning' : now.getHours() < 18 ? 'afternoon' : 'evening';
                  return (
                    <h2 className="text-3xl font-display font-bold text-foreground">
                      Good {greeting}, {userName}! ✨
                    </h2>
                  );
                })()}
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

          {/* Stats - with error display and loading indicator */}
          {statsError && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-2xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                <p className="text-destructive text-sm font-medium">{statsError}</p>
              </div>
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-destructive hover:text-destructive/80"
                onClick={() => {
                  setStatsError(null);
                  // Trigger stats reload by simulating user change
                  if (user) {
                    const loadStats = async () => {
                      try {
                        setStatsLoading(true);
                        setStatsError(null);
                        
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
                          .filter((a: any) => a.scheduled_at && new Date(a.scheduled_at) > new Date())
                          .slice(0, 3);
                        
                        const wellnessScore =
                          typeof summary?.scores?.wellness_score === "number" ? summary.scores.wellness_score : null;

                        setStats({
                          sessions: sessionItems.length,
                          appointments: appointmentItems.filter((a: any) => a.status === 'scheduled').length,
                          wellness: wellnessScore,
                          chats: Number(summary?.ml_insights?.feature_snapshot?.ai_chat_messages_30d ?? sessionItems.length),
                        });
                        setUpcomingAppointments(upcomingApts);
                        setDiagnostics(summary?.latest_ai_diagnostic ?? summary?.latest_diagnostic ?? null);
                      } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : "Failed to reload statistics";
                        setStatsError(errorMessage);
                      } finally {
                        setStatsLoading(false);
                      }
                    };
                    loadStats();
                  }
                }}
              >
                Retry
              </Button>
            </div>
          )}
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
                          {apt.scheduled_at ? (() => {
                            try {
                              const date = new Date(apt.scheduled_at);
                              if (isNaN(date.getTime())) throw new Error('Invalid date');
                              return (
                                <>
                                  <span className="text-xs font-bold uppercase">{format(date, "MMM")}</span>
                                  <span className="text-lg font-bold">{format(date, "d")}</span>
                                </>
                              );
                            } catch {
                              return (
                                <>
                                  <span className="text-xs font-bold uppercase">---</span>
                                  <span className="text-lg font-bold">--</span>
                                </>
                              );
                            }
                          })() : (
                            <>
                              <span className="text-xs font-bold uppercase">---</span>
                              <span className="text-lg font-bold">--</span>
                            </>
                          )}
                        </div>
                        <div className="flex-1">
                          <p className="font-bold text-foreground group-hover:text-primary transition-colors">
                            Session with {apt.counselor?.profile?.full_name || "Counselor"}
                          </p>
                          <p className="text-sm text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" /> 
                            {apt.scheduled_at ? (() => {
                              try {
                                const date = new Date(apt.scheduled_at);
                                if (isNaN(date.getTime())) throw new Error('Invalid date');
                                return format(date, "h:mm a");
                              } catch {
                                return "Time TBD";
                              }
                            })() : "Time TBD"}
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
            <DailyTipCard
              className="rounded-3xl shadow-xl shadow-primary/5"
              title="Your Wellness Corner"
              tip={dailyTip}
              isLoading={tipLoading}
              error={tipError}
              onRefresh={() => void refreshDailyTip()}
              onToggleFavorite={() => void toggleFavorite()}
              isSavingFavorite={isSavingFavorite}
            />
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

