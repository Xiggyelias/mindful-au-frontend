import { useState, useEffect, useCallback, useRef } from "react";
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
  Users,
  ClipboardCheck,
  Shield,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { StatsCard } from "@/components/StatsCard";
import { DailyTipCard } from "@/components/DailyTipCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useDailyTip } from "@/hooks/useDailyTip";
import { api, getApiErrorMessage } from "@/lib/api";
import { dispatchChatAnonymitySync } from "@/lib/chatRealtimeEvents";
import { isVideoEnabledAppointment, prefersAudioOnlyOnlineCall } from "@/lib/videoCall";
import { toast } from "sonner";
import { format, isValid, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { formatStudentAnonymousSessionTitle, isAnonymousSessionFlag, isProfileAnonymousMode } from "@/lib/anonymousMode";
import { StudentIncomingCallBanner } from "@/components/student/StudentIncomingCallBanner";
import { AnonymousModeToggle } from "@/components/privacy/AnonymousModeToggle";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/student/dashboard" },
  { label: "Chat", icon: MessageSquare, path: "/student/chat" },
  { label: "Appointments", icon: Calendar, path: "/student/appointments" },
  { label: "AI Support", icon: Bot, path: "/student/ai-support" },
  { label: "Video Call", icon: Video, path: "/student/video-call" },
  { label: "Past Sessions", icon: History, path: "/student/history" },
  { label: "Wellness", icon: Heart, path: "/student/wellness" },
  { label: "Assessment", icon: ClipboardCheck, path: "/student/diagnostic-assessment" },
];

const moodOptions = [
  { value: "great", label: "Great", display: "\u{1F60A} Great" },
  { value: "okay", label: "Okay", display: "\u{1F610} Okay" },
  { value: "low", label: "Low", display: "\u{1F614} Low" },
  { value: "stressed", label: "Stressed", display: "\u{1F62B} Stressed" },
  { value: "tired", label: "Tired", display: "\u{1F634} Tired" },
] as const;

type StudentMood = (typeof moodOptions)[number]["value"];

type LiteSession = {
  id: number | string;
  status?: string;
  is_anonymous?: boolean;
  anonymous_id?: string | null;
  assigned_role?: string | null;
  counselor?: { profile?: { full_name?: string | null } | null } | null;
  peer_counselor?: { profile?: { full_name?: string | null } | null } | null;
};

type AppointmentRecord = {
  id: number | string;
  scheduled_at?: string | null;
  status?: string;
  counselor_id?: number | string | null;
  notes?: string | null;
  counselor?: { profile?: { full_name?: string | null } | null } | null;
};

const UPCOMING_APPOINTMENT_STATUSES = ["scheduled", "confirmed", "pending"] as const;

function parseSessionItems(raw: unknown): LiteSession[] {
  if (Array.isArray(raw)) {
    return raw as LiteSession[];
  }
  if (raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown }).data)) {
    return (raw as { data: LiteSession[] }).data;
  }
  return [];
}

function parseAppointmentItems(raw: unknown): AppointmentRecord[] {
  if (Array.isArray(raw)) {
    return raw as AppointmentRecord[];
  }
  if (raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown }).data)) {
    return (raw as { data: AppointmentRecord[] }).data;
  }
  return [];
}

function isAppointmentUpcoming(a: AppointmentRecord, now: Date): boolean {
  if (!a.scheduled_at) return false;
  if (
    !a.status ||
    !UPCOMING_APPOINTMENT_STATUSES.includes(a.status as (typeof UPCOMING_APPOINTMENT_STATUSES)[number])
  ) {
    return false;
  }
  try {
    const t = new Date(a.scheduled_at).getTime();
    return Number.isFinite(t) && t > now.getTime();
  } catch {
    return false;
  }
}

function resolveRecentConversationTitle(session: LiteSession): string {
  if (isAnonymousSessionFlag(session.is_anonymous)) {
    return formatStudentAnonymousSessionTitle(session.anonymous_id);
  }
  const counselorName = session.counselor?.profile?.full_name?.trim();
  const peerName = session.peer_counselor?.profile?.full_name?.trim();
  const name = counselorName || peerName;
  return name && name !== "" ? name : "Support";
}

const StudentDashboard = () => {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isPanicLoading, setIsPanicLoading] = useState(false);
  const [stats, setStats] = useState({ 
    sessions: 0, 
    appointments: 0, 
    wellness: null as number | null, 
    wellnessLabel: null as string | null,
    chats: null as number | null,
  });
  const [upcomingAppointments, setUpcomingAppointments] = useState<AppointmentRecord[]>([]);
  const [recentSessions, setRecentSessions] = useState<LiteSession[]>([]);
  const [dailyMood, setDailyMood] = useState<StudentMood | null>(null);
  const [isRecordingMood, setIsRecordingMood] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [isSavingAnonymousMode, setIsSavingAnonymousMode] = useState(false);
  const { user, refreshUser } = useAuth();
  const {
    tip: dailyTip,
    isLoading: tipLoading,
    error: tipError,
    refresh: refreshDailyTip,
    toggleFavorite,
    isSavingFavorite,
  } = useDailyTip();

  const hasInitiallyLoadedRef = useRef(false);
  const lastDashboardStatsRefreshAtMs = useRef(0);

  const [incomingCallBannerActive, setIncomingCallBannerActive] = useState(false);
  const userName = user?.profile?.full_name || user?.email?.split('@')[0] || "Student";

  const openVideoCallRoom = (appointment: AppointmentRecord) => {
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

    if (isVideoEnabledAppointment(appointment.notes)) {
      params.set("mode", prefersAudioOnlyOnlineCall(appointment.notes) ? "audio" : "video");
    }

    navigate(`/student/video-call?${params.toString()}`);
  };

  const loadStats = useCallback(async (forceLoading = false) => {
    if (!user?.id) return;

    const silentRefresh = !forceLoading && lastDashboardStatsRefreshAtMs.current > 0;

    try {
      setStatsError(null);
      if (!silentRefresh) {
        setStatsLoading(true);
      }

      const [sessionsOutcome, appointmentsOutcome, summaryOutcome, moodOutcome] = await Promise.allSettled([
        api.getSessions({ lightweight: true }),
        api.getAppointments(),
        api.getStudentWellnessSummary(),
        api.getStudentMoodToday(),
      ]);

      const loadErrors: string[] = [];

      let sessionItems: LiteSession[] = [];
      if (sessionsOutcome.status === "fulfilled") {
        sessionItems = parseSessionItems(sessionsOutcome.value);
      } else {
        loadErrors.push(getApiErrorMessage(sessionsOutcome.reason, "Could not load chat sessions."));
        if (import.meta.env.DEV) {
          console.error("Dashboard: sessions fetch failed:", sessionsOutcome.reason);
        }
      }

      let appointmentItems: AppointmentRecord[] = [];
      if (appointmentsOutcome.status === "fulfilled") {
        appointmentItems = parseAppointmentItems(appointmentsOutcome.value);
      } else {
        loadErrors.push(getApiErrorMessage(appointmentsOutcome.reason, "Could not load appointments."));
        if (import.meta.env.DEV) {
          console.error("Dashboard: appointments fetch failed:", appointmentsOutcome.reason);
        }
      }

      let summary: Awaited<ReturnType<typeof api.getStudentWellnessSummary>> | null = null;
      if (summaryOutcome.status === "fulfilled") {
        summary = summaryOutcome.value;
      } else if (import.meta.env.DEV) {
        console.info("Dashboard: wellness summary unavailable:", summaryOutcome.reason);
      }

      let moodData: Awaited<ReturnType<typeof api.getStudentMoodToday>> | null = null;
      if (moodOutcome.status === "fulfilled") {
        moodData = moodOutcome.value;
      }

      const now = new Date();
      const upcomingApts = appointmentItems.filter((a) => isAppointmentUpcoming(a, now)).slice(0, 3);

      setRecentSessions(sessionItems.slice(0, 3));

      const aiChatMessages30dRaw = summary?.ml_insights?.feature_snapshot?.ai_chat_messages_30d;
      const aiParsed = Number(aiChatMessages30dRaw);
      const aiChatCount =
        aiChatMessages30dRaw !== undefined &&
        aiChatMessages30dRaw !== null &&
        Number.isFinite(aiParsed) &&
        aiParsed >= 0
          ? Math.round(aiParsed)
          : null;

      const upcomingAppointmentCount = appointmentItems.filter((a) => isAppointmentUpcoming(a, now)).length;

      setStats({
        sessions: sessionItems.filter((s) => s.status !== "completed" && s.status !== "cancelled").length,
        appointments: upcomingAppointmentCount,
        wellness: Number(summary?.scores?.wellness_score) || null,
        wellnessLabel: summary?.labels?.wellness ?? null,
        chats: aiChatCount,
      });

      setStatsError(loadErrors.length ? loadErrors.slice(0, 2).join(" ") : null);
      setUpcomingAppointments(upcomingApts);
      
      const currentMood = summary?.mood || moodData?.log?.mood;
      if (currentMood) {
        setDailyMood(currentMood as StudentMood);
      } else {
        setDailyMood(null);
      }
      lastDashboardStatsRefreshAtMs.current = Date.now();
    } catch (error: unknown) {
      const errorMessage = getApiErrorMessage(error, "Failed to load dashboard statistics");
      setStatsError(errorMessage);
      if (import.meta.env.DEV) {
        console.error("Failed to load stats:", error);
      }
    } finally {
      setStatsLoading(false);
    }
  }, [user?.id]);

  // Reset state when user changes
  useEffect(() => {
    hasInitiallyLoadedRef.current = false;
    lastDashboardStatsRefreshAtMs.current = 0;
    setStats({ sessions: 0, appointments: 0, wellness: null, wellnessLabel: null, chats: null });
    setUpcomingAppointments([]);
    setDailyMood(null);
    setStatsError(null);
    setStatsLoading(Boolean(user?.id));
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || hasInitiallyLoadedRef.current) return;
    hasInitiallyLoadedRef.current = true;

    void loadStats();
  }, [loadStats, user?.id]);

  useEffect(() => {
    const minIntervalMs = 45_000;
    const onVisibility = () => {
      if (document.visibilityState !== "visible" || !user?.id) return;
      const lastAt = lastDashboardStatsRefreshAtMs.current;
      if (lastAt === 0 || Date.now() - lastAt < minIntervalMs) return;
      void loadStats();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [loadStats, user?.id]);

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
        } catch (err) {
          if (import.meta.env.DEV) {
            console.info('Could not get location:', err);
          }
          toast.warning("Location unavailable - we'll send your alert without location data.");
        }
      }

      const response = await api.createPanicLog({ location });
      const recipientsNotified = Number(
        (response as { recipients_notified?: unknown })?.recipients_notified
      );
      const alertsEnabled = Boolean(
        (response as { alerts_enabled?: unknown })?.alerts_enabled ?? true
      );

      if (!alertsEnabled) {
        toast.warning(
          "Your emergency alert was logged, but server-side panic alerts are currently disabled. Please call the 24/7 hotline now."
        );
      } else if (Number.isFinite(recipientsNotified) && recipientsNotified === 0) {
        toast.warning(
          "Alert logged, but no on-call professional staff were reachable. Please call the 24/7 hotline immediately."
        );
      } else if (Number.isFinite(recipientsNotified) && recipientsNotified > 0) {
        toast.success(
          `Emergency alert sent to ${recipientsNotified} responder${recipientsNotified === 1 ? "" : "s"}. They will contact you shortly.`
        );
      } else {
        toast.success("Emergency alert sent. Professional support staff will follow up.");
      }
    } catch (error: unknown) {
      if (import.meta.env.DEV) {
        console.error('Panic button error:', error);
      }
      toast.error(getApiErrorMessage(error, "Failed to send emergency alert. Please call the hotline directly."));
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
    } catch (error: unknown) {
      const message = getApiErrorMessage(error, "Failed to record mood");
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

  const handleAnonymousModeToggle = async (checked: boolean) => {
    if (!user?.id) return;

    if (isProfileAnonymousMode(user.profile?.anonymous_mode) && !checked) {
      const ok = window.confirm(
        "Turning off anonymous mode will show your real name to counselors in chat. Continue?",
      );
      if (!ok) return;
    }

    try {
      setIsSavingAnonymousMode(true);
      await api.updateProfile({ anonymous_mode: checked });
      await refreshUser();
      dispatchChatAnonymitySync();
      await loadStats();
      toast.success(checked ? "Anonymous mode is on." : "Anonymous mode is off.", {
        description:
          "This is your default for new conversations. Open chats stay as they are until you change them in the chat.",
      });
    } catch (error: unknown) {
      const message = getApiErrorMessage(error, "Failed to update anonymous mode");
      toast.error(message || "Could not update anonymous mode.");
    } finally {
      setIsSavingAnonymousMode(false);
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
        <StudentIncomingCallBanner
          enabled={Boolean(user?.id)}
          onActiveChange={setIncomingCallBannerActive}
        />
        <DashboardHeader
          title="Dashboard"
          onMenuClick={() => setSidebarOpen(true)}
        />

        <main
          className={cn(
            "p-4 lg:p-6 space-y-6 transition-[padding-top] duration-300",
            incomingCallBannerActive && "pt-28 lg:pt-32"
          )}
        >
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
                      type="button"
                      aria-pressed={dailyMood === moodOption.value}
                      aria-label={`Record mood as ${moodOption.label}`}
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
          {statsLoading && (
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground" aria-live="polite">
              Updating dashboard…
            </p>
          )}
          {statsError && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-2xl p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0" aria-hidden />
                <p className="text-destructive text-sm font-medium">{statsError}</p>
              </div>
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-destructive hover:text-destructive/80 shrink-0"
                onClick={() => void loadStats(true)}
                disabled={statsLoading}
              >
                Retry
              </Button>
            </div>
          )}
          <div
            className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"
            aria-busy={statsLoading}
          >
            <StatsCard
              title="Open chats"
              value={statsLoading ? "—" : stats.sessions}
              change={statsLoading ? "Loading…" : "Threads not ended yet"}
              trend="neutral"
              icon={MessageSquare}
            />
            <StatsCard
              title="Wellness Score"
              value={statsLoading ? "—" : stats.wellness !== null ? `${stats.wellness}%` : "—"}
              change={
                statsLoading
                  ? "Loading…"
                  : stats.wellnessLabel || (stats.wellness !== null ? "Check in today" : "No data yet")
              }
              trend={statsLoading || stats.wellness === null ? "neutral" : stats.wellness >= 70 ? "up" : "neutral"}
              icon={Heart}
            />
            <StatsCard
              title="Upcoming Sessions"
              value={statsLoading ? "—" : stats.appointments}
              change={statsLoading ? "Loading…" : "Confirmed & upcoming"}
              trend="neutral"
              icon={Calendar}
            />
            <StatsCard
              title="AI assistant (30 days)"
              value={statsLoading ? "—" : stats.chats !== null ? stats.chats : "—"}
              change={
                statsLoading
                  ? "Loading…"
                  : stats.chats !== null
                    ? "Messages from AI support"
                    : "No usage data yet"
              }
              trend="neutral"
              icon={Bot}
            />
          </div>

          <Card className="border border-border/60 shadow-sm mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                Chat anonymity
              </CardTitle>
              <CardDescription>
                When on, counselors see you as &quot;Anonymous&quot; until you turn it off.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <AnonymousModeToggle
                id="student-anonymous-mode"
                checked={isProfileAnonymousMode(user?.profile?.anonymous_mode)}
                onCheckedChange={handleAnonymousModeToggle}
                disabled={isSavingAnonymousMode}
              />
              <p className="text-xs text-muted-foreground max-w-md">
                This applies to active chat sessions. You can also change this from an open chat.
              </p>
            </CardContent>
          </Card>

          <div className="grid gap-8 lg:grid-cols-2">
            {/* Recent Conversations */}
            <Card className="border-none shadow-xl shadow-primary/5 rounded-3xl overflow-hidden bg-background">
              <CardHeader className="bg-secondary/10 border-b border-border/50">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xl font-bold flex items-center gap-2">
                    <MessageSquare className="h-5 w-5 text-primary" />
                    Recent Conversations
                  </CardTitle>
                  <Button variant="ghost" size="sm" className="text-primary hover:text-primary/80" onClick={() => navigate("/student/chat")}>
                    View all
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-4">
                  {recentSessions.length === 0 ? (
                    <div className="text-center py-8 bg-secondary/20 rounded-2xl border-2 border-dashed border-border/50">
                      <p className="text-muted-foreground mb-4">No active conversations yet</p>
                      <Button variant="outline" size="sm" onClick={() => navigate("/student/chat")}>
                        Find a counselor
                      </Button>
                    </div>
                  ) : (
                    recentSessions.map((session) => {
                      const displayName = resolveRecentConversationTitle(session);
                      const isPeer = session.assigned_role === "peer_counselor";
                      const sessionStatus = session.status ?? "";
                      const appearsLive =
                        sessionStatus === "active" ||
                        sessionStatus === "pending" ||
                        sessionStatus === "open";
                      const goResumeChat = () => navigate(`/student/chat?session=${session.id}`);

                      return (
                        <div
                          key={session.id}
                          role="button"
                          tabIndex={0}
                          className="group flex items-center gap-4 p-4 rounded-2xl bg-secondary/40 hover:bg-secondary/60 transition-colors duration-300 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          onClick={goResumeChat}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              goResumeChat();
                            }
                          }}
                          aria-label={`Resume conversation: ${displayName}`}
                        >
                          <div
                            className={`h-14 w-14 shrink-0 rounded-2xl flex items-center justify-center border ${
                              isPeer ? "bg-info/10 text-info border-info/20" : "bg-primary/10 text-primary border-primary/20"
                            }`}
                          >
                            {isPeer ? (
                              <Users className="h-6 w-6" aria-hidden />
                            ) : (
                              <MessageSquare className="h-6 w-6" aria-hidden />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-foreground group-hover:text-primary transition-colors truncate">
                              {displayName}
                            </p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <span
                                className={`h-2 w-2 rounded-full shrink-0 ${
                                  appearsLive ? "bg-success animate-pulse" : "bg-muted"
                                }`}
                              />
                              {isAnonymousSessionFlag(session.is_anonymous)
                                ? "Anonymous session"
                                : isPeer
                                  ? "Peer support"
                                  : "Professional support"}
                            </p>
                          </div>
                          <span className="text-sm font-semibold text-primary whitespace-nowrap">Resume</span>
                        </div>
                      );
                    })
                  )}
                </div>
              </CardContent>
            </Card>

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
                    upcomingAppointments.map((apt) => {
                      const aptDate =
                        apt.scheduled_at != null &&
                        apt.scheduled_at !== "" &&
                        isValid(parseISO(apt.scheduled_at))
                          ? parseISO(apt.scheduled_at)
                          : null;

                      return (
                        <div
                          key={apt.id}
                          className="group flex items-center gap-4 p-4 rounded-2xl bg-secondary/40 hover:bg-secondary/60 transition-colors duration-300"
                        >
                          <div className="h-14 w-14 shrink-0 rounded-2xl bg-primary/10 flex flex-col items-center justify-center text-primary border border-primary/20">
                            {aptDate ? (
                              <>
                                <span className="text-xs font-bold uppercase">{format(aptDate, "MMM")}</span>
                                <span className="text-lg font-bold">{format(aptDate, "d")}</span>
                              </>
                            ) : (
                              <>
                                <span className="text-xs font-bold uppercase">—</span>
                                <span className="text-lg font-bold">—</span>
                              </>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-foreground group-hover:text-primary transition-colors truncate">
                              Session with {apt.counselor?.profile?.full_name || "Counselor"}
                            </p>
                            <p className="text-sm text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3 shrink-0" aria-hidden />
                              {aptDate ? format(aptDate, "h:mm a") : "Time TBD"}
                            </p>
                          </div>
                          <Button
                            type="button"
                            className="rounded-full px-6 bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 shrink-0"
                            size="sm"
                            onClick={() => openVideoCallRoom(apt)}
                          >
                            Join
                          </Button>
                        </div>
                      );
                    })
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="mt-8">
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

