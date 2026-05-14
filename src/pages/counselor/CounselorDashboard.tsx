import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Appointment } from "@/hooks/useChatSession";
import {
  LayoutDashboard,
  MessageSquare,
  Calendar,
  Users,
  Brain,
  Video,
  FileText,
  Heart,
  Bell,
  TrendingUp,
  AlertTriangle,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { StatsCard } from "@/components/StatsCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/useAuth";
import { api, getApiErrorMessage } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { isSameDay, isValid, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import {
  describeOnlineAppointmentFormat,
  isAppointmentAudioOnly,
  isVideoEnabledAppointment,
} from "@/lib/videoCall";
import { CounselorIncomingCallBanner } from "@/components/counselor/CounselorIncomingCallBanner";
import { CounselorSessionReminderBanner } from "@/components/counselor/CounselorSessionReminderBanner";
import { AnonymousModeIndicator } from "@/components/privacy/AnonymousModeIndicator";
import { CHAT_ANONYMITY_SYNC_EVENT } from "@/lib/chatRealtimeEvents";
import { dedupeCounselorChatListRows, isValidChatListRow } from "@/lib/counselorChatListDedupe";
import {
  anonymousLabelForCounselor,
  isAnonymousSessionFlag,
  isAnonymousIdentityMaskedFromViewer,
} from "@/lib/anonymousMode";

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

const DASHBOARD_APPOINTMENT_PAGE_SIZE = 120;
const DASHBOARD_SESSION_PAGE_SIZE = 200;
const DASHBOARD_SESSION_RETRY_PAGE_SIZE = 100;
const DASHBOARD_SESSION_TIMEOUT_MS = 20000;
const DASHBOARD_SESSION_RETRY_TIMEOUT_MS = 15000;
const DASHBOARD_CONVERSATIONS_PAGE_SIZE = 8;
/** Fetch more raw sessions before dedupe so the strip still fills after merging duplicates. */
const DASHBOARD_CONVERSATIONS_FETCH_SIZE = 48;

type DashboardOpenConversation = {
  sessionId: number;
  label: string;
  isAnonymous: boolean;
  unreadCount: number;
};

const toList = <T,>(payload: unknown): T[] => {
  if (Array.isArray(payload)) {
    return payload as T[];
  }
  if (payload && typeof payload === "object" && Array.isArray((payload as any).data)) {
    return (payload as any).data as T[];
  }
  return [];
};

function mapChatListRowsToOpenConversations(
  rows: Record<string, unknown>[],
  maxItems: number
): DashboardOpenConversation[] {
  return rows
    .filter(isValidChatListRow)
    .slice(0, maxItems)
    .map((row) => {
    const isAnon = isAnonymousSessionFlag(row.is_anonymous);
    const isMasked = isAnonymousIdentityMaskedFromViewer(row as any);
    const student = row.student as Record<string, unknown> | undefined;
    const profile = student?.profile as Record<string, unknown> | undefined;
    const fromApiName = String(profile?.full_name ?? "").trim();
    const email = typeof student?.email === "string" ? student.email : "";
    const sid = Number(row.student_id ?? 0);
    const peerSid = Number(row.chat_peer_student_id ?? 0);
    const idFallback =
      Number.isInteger(sid) && sid > 0
        ? sid
        : Number.isInteger(peerSid) && peerSid > 0
          ? peerSid
          : row.id;
    const label = isMasked
      ? anonymousLabelForCounselor()
      : fromApiName ||
        (email ? email.split("@")[0] : "") ||
        (isAnon ? anonymousLabelForCounselor() : `Student #${idFallback}`);

    return {
      sessionId: Number(row.id),
      label,
      isAnonymous: Boolean(isAnon),
      unreadCount: Math.max(0, Math.floor(Number(row.unread_count ?? 0))),
    };
  });
}

const CounselorDashboard = () => {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [counselorWellness, setCounselorWellness] = useState<any>(null);
  const [diagnosticsSummary, setDiagnosticsSummary] = useState<any>(null);
  const [activeSessionStudentIds, setActiveSessionStudentIds] = useState<number[]>([]);
  const [openConversations, setOpenConversations] = useState<DashboardOpenConversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const loadRequestRef = useRef(0);
  const { user } = useAuth();
  const { toast } = useToast();
  const userName = user?.profile?.full_name || user?.email?.split('@')[0] || "Counselor";
  const [incomingCallBannerActive, setIncomingCallBannerActive] = useState(false);
  const [sessionReminderBannerActive, setSessionReminderBannerActive] = useState(false);
  const isApprovedCounselor = user?.roles?.some((r: { role: string; approved: boolean }) => r.role === "counselor" && r.approved);

  const loadDashboardData = useCallback(async () => {
    const requestId = ++loadRequestRef.current;

    if (!isApprovedCounselor) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const appointmentsPayload = await api.getAppointments({
        page: 1,
        per_page: DASHBOARD_APPOINTMENT_PAGE_SIZE,
        timeout_ms: 15000,
      });

      if (loadRequestRef.current !== requestId) {
        return;
      }

      const appointmentRows = toList<Appointment>(appointmentsPayload);
      console.log("DEBUG: CounselorDashboard appointments response:", appointmentsPayload);
      setAppointments(appointmentRows);
      setIsLoading(false);

      // Stage 2: enrich with wellness, diagnostics summary, and active session students.
      void (async () => {
        const loadSessionSnapshot = async () => {
          try {
            return await api.getSessions({
              lightweight: true,
              open_only: true,
              page: 1,
              per_page: DASHBOARD_SESSION_PAGE_SIZE,
              timeout_ms: DASHBOARD_SESSION_TIMEOUT_MS,
            });
          } catch (err) {
            const isTimeout = (err as { code?: string })?.code === "ECONNABORTED";
            if (!isTimeout) {
              throw err;
            }

            return api.getSessions({
              lightweight: true,
              open_only: true,
              page: 1,
              per_page: DASHBOARD_SESSION_RETRY_PAGE_SIZE,
              timeout_ms: DASHBOARD_SESSION_RETRY_TIMEOUT_MS,
            });
          }
        };

        const [wellnessResult, summaryResult, sessionsResult, chatListResult] = await Promise.allSettled([
          api.getCounselorWellnessSummary(),
          api.getAIDiagnosticsSummary({ days: 30 }),
          loadSessionSnapshot(),
          api.getChatSessions({
            open_only: true,
            page: 1,
            per_page: DASHBOARD_CONVERSATIONS_FETCH_SIZE,
            as_role: "counselor",
            timeout_ms: 15000,
          }),
        ]);

        if (loadRequestRef.current !== requestId) {
          return;
        }

        if (wellnessResult.status === "fulfilled") {
          setCounselorWellness(wellnessResult.value || null);
        }

        if (summaryResult.status === "fulfilled") {
          setDiagnosticsSummary(summaryResult.value || null);
        }

        if (chatListResult.status === "fulfilled") {
          try {
            console.log("DEBUG: CounselorDashboard chat list response:", chatListResult.value);
            const rawList = toList<Record<string, unknown>>(chatListResult.value);
            const chatRows = dedupeCounselorChatListRows(rawList, "dashboard");
            setOpenConversations(
              mapChatListRowsToOpenConversations(chatRows, DASHBOARD_CONVERSATIONS_PAGE_SIZE)
            );
          } catch (chatMapErr) {
            if (import.meta.env.DEV) {
              console.warn("Counselor dashboard: chat list dedupe/map failed, using raw list", chatMapErr);
            }
            try {
              const rawList = toList<Record<string, unknown>>(chatListResult.value).filter(isValidChatListRow);
              setOpenConversations(
                mapChatListRowsToOpenConversations(rawList, DASHBOARD_CONVERSATIONS_PAGE_SIZE)
              );
            } catch {
              setOpenConversations([]);
            }
          }
        } else {
          setOpenConversations([]);
          if (import.meta.env.DEV) {
            console.warn("Counselor dashboard: chat list failed", chatListResult.reason);
          }
        }

        const sessionRows =
          sessionsResult.status === "fulfilled" ? toList<Record<string, unknown>>(sessionsResult.value) : [];
        const uniqueStudentIds = Array.from(
          new Set(
            sessionRows
              .map((session) => Number(session?.student_id))
              .filter((id) => Number.isInteger(id) && id > 0)
          )
        );
        setActiveSessionStudentIds(uniqueStudentIds);
        if (sessionsResult.status === "rejected" && import.meta.env.DEV) {
          console.warn("Counselor dashboard: open sessions snapshot failed", sessionsResult.reason);
        }
      })();
    } catch (err: unknown) {
      if (import.meta.env.DEV) {
        console.error("Failed to load counselor dashboard data", err);
      }
      if (loadRequestRef.current === requestId) {
        toast({
          title: "Could not load dashboard data",
          description: getApiErrorMessage(err, "Please try again."),
          variant: "destructive",
        });
      }
    } finally {
      if (loadRequestRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [isApprovedCounselor, toast]);

  useEffect(() => {
    if (!user?.id) {
      setIsLoading(false);
      return;
    }
    void loadDashboardData();
  }, [loadDashboardData, user?.id]);

  useEffect(() => {
    if (!user?.id || !isApprovedCounselor) {
      return;
    }
    const syncStrip = async () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      try {
        const chatListResult = await api.getChatSessions({
          open_only: true,
          page: 1,
          per_page: DASHBOARD_CONVERSATIONS_FETCH_SIZE,
          as_role: "counselor",
          timeout_ms: 15000,
        });
        try {
          const rawList = toList<Record<string, unknown>>(chatListResult);
          const chatRows = dedupeCounselorChatListRows(rawList, "dashboard");
          setOpenConversations(
            mapChatListRowsToOpenConversations(chatRows, DASHBOARD_CONVERSATIONS_PAGE_SIZE)
          );
        } catch (chatMapErr) {
          if (import.meta.env.DEV) {
            console.warn("Counselor dashboard: strip refresh dedupe failed", chatMapErr);
          }
          try {
            const rawList = toList<Record<string, unknown>>(chatListResult).filter(isValidChatListRow);
            setOpenConversations(
              mapChatListRowsToOpenConversations(rawList, DASHBOARD_CONVERSATIONS_PAGE_SIZE)
            );
          } catch {
            // keep previous strip
          }
        }
      } catch {
        // Background refresh
      }
    };

    const intervalId = window.setInterval(syncStrip, 15_000);
    const kick = () => void syncStrip();
    window.addEventListener("focus", kick);
    window.addEventListener(CHAT_ANONYMITY_SYNC_EVENT, kick);
    document.addEventListener("visibilitychange", kick);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", kick);
      window.removeEventListener(CHAT_ANONYMITY_SYNC_EVENT, kick);
      document.removeEventListener("visibilitychange", kick);
    };
  }, [isApprovedCounselor, user?.id]);

  /** Keeps "today's schedule" correct across midnight and long-lived tabs. */
  const [nowTicker, setNowTicker] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNowTicker(Date.now());
    const id = window.setInterval(tick, 60_000);
    const onFocus = () => tick();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  const todayAnchor = useMemo(() => new Date(nowTicker), [nowTicker]);

  const todaysAppointments = useMemo(() => {
    return appointments.filter((a) => {
      if (!a.scheduled_at) return false;
      const d = parseISO(a.scheduled_at);
      return isValid(d) && isSameDay(d, todayAnchor);
    });
  }, [appointments, todayAnchor]);

  const completedToday = todaysAppointments.filter((a) => a.status === "completed").length;
  const pendingToday = todaysAppointments.filter(
    (a) => a.status === "scheduled" || a.status === "confirmed"
  ).length;

  const activeStudents = useMemo(() => {
    const ids = new Set<number>();
    appointments
      .map((appointment) => Number(appointment?.student_id))
      .filter((id) => Number.isInteger(id) && id > 0)
      .forEach((id) => ids.add(id));
    activeSessionStudentIds.forEach((id) => ids.add(id));
    return ids.size;
  }, [activeSessionStudentIds, appointments]);

  const aiAlertsCount = useMemo(
    () => Number(diagnosticsSummary?.high_or_critical || 0),
    [diagnosticsSummary]
  );

  const stats = [
    {
      title: "Today's Sessions",
      value: todaysAppointments.length,
      change: `${completedToday} completed, ${pendingToday} pending`,
      trend: "neutral" as const,
      icon: Calendar,
    },
    {
      title: "Active Students",
      value: activeStudents,
      change: "",
      trend: "neutral" as const,
      icon: Users,
    },
    {
      title: "Active Chats",
      value: activeSessionStudentIds.length,
      change: "Open chat sessions",
      trend: "neutral" as const,
      icon: MessageSquare,
    },
    {
      title: "AI Alerts",
      value: aiAlertsCount,
      change: "",
      trend: "neutral" as const,
      icon: Brain,
    },
  ];

  const handleViewAll = () => {
    navigate("/counselor/appointments");
  };

  const handleJoinSession = (apt: Appointment) => {
    if (!isVideoEnabledAppointment(apt.notes)) {
      navigate("/counselor/appointments");
      return;
    }
    const params = new URLSearchParams({
      appointment_id: String(apt.id),
      autostart: "1",
    });
    if (isVideoEnabledAppointment(apt.notes)) {
      params.set("mode", isAppointmentAudioOnly(apt) ? "audio" : "video");
    }
    navigate(`/counselor/video?${params.toString()}`);
  };

  const handleViewAlerts = () => {
    navigate("/counselor/ai-insights");
  };

  const handleViewStudents = () => {
    navigate("/counselor/students");
  };

  // Block dashboard access until admin approval
  if (user && !isApprovedCounselor) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="max-w-lg w-full">
          <CardHeader className="flex flex-row items-center gap-3">
            <AlertTriangle className="h-6 w-6 text-warning" />
            <CardTitle>Counselor account pending approval</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>Your counselor account is awaiting admin approval. You will gain access to the dashboard once approved.</p>
            <p>If this seems like an error, please contact an administrator.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

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
        <CounselorIncomingCallBanner
          enabled={Boolean(isApprovedCounselor)}
          onActiveChange={setIncomingCallBannerActive}
        />
        <CounselorSessionReminderBanner
          enabled={Boolean(isApprovedCounselor)}
          incomingCallBannerActive={incomingCallBannerActive}
          onActiveChange={setSessionReminderBannerActive}
        />
        <DashboardHeader
          title="Counselor Dashboard"
          onMenuClick={() => setSidebarOpen(true)}
        />

        <main
          className={cn(
            "space-y-6 p-4 transition-[padding-top] duration-300 lg:p-6",
            incomingCallBannerActive &&
              sessionReminderBannerActive &&
              "pt-44 lg:pt-52",
            incomingCallBannerActive &&
              !sessionReminderBannerActive &&
              "pt-28 lg:pt-32",
            !incomingCallBannerActive &&
              sessionReminderBannerActive &&
              "pt-24 lg:pt-28"
          )}
        >
          {/* Welcome Section */}
          <div className="glass-card bg-gradient-to-br from-info/20 to-info/5 border-info/20">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h2 className="text-2xl font-display font-bold text-foreground mb-2">
                  Welcome back, {userName}!
                </h2>
                <p className="text-muted-foreground">
                  Here are your latest sessions and students.
                </p>
              </div>
              <Button variant="hero" className="gap-2" onClick={handleViewAlerts}>
                <Bell className="h-4 w-4" />
                View Alerts
              </Button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {stats.map((s) => (
              <StatsCard
                key={s.title}
                title={s.title}
                value={s.value}
                change={s.change}
                trend={s.trend}
                icon={s.icon}
              />
            ))}
          </div>

          <Card variant="glass">
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-2">
              <CardTitle className="flex items-center gap-2 text-lg">
                <MessageSquare className="h-5 w-5 text-primary" />
                Student conversations
              </CardTitle>
              <Button variant="outline" size="sm" onClick={() => navigate("/counselor/messages")}>
                Open Messages
              </Button>
            </CardHeader>
            <CardContent>
              {openConversations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No open chat conversations.</p>
              ) : (
                <ul className="space-y-2">
                  {openConversations.map((c) => {
                    const initials = c.isAnonymous
                      ? "??"
                      : (() => {
                          const parts = c.label.trim().split(/\s+/).filter(Boolean);
                          if (parts.length === 0) return "??";
                          if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
                          return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
                        })();
                    return (
                      <li key={c.sessionId}>
                        <button
                          type="button"
                          onClick={() => navigate(`/counselor/messages?session=${c.sessionId}`)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-xl border border-transparent p-3 text-left transition-colors",
                            "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 dark:hover:bg-muted/25"
                          )}
                        >
                          <div
                            className={cn(
                              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-inner ring-2 ring-background",
                              c.isAnonymous ? "bg-muted-foreground/55" : "bg-info"
                            )}
                          >
                            {initials}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                              <p className="truncate font-medium text-foreground">{c.label}</p>
                              {c.isAnonymous && (
                                <span className="shrink-0 rounded-md bg-muted px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  Anon
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">Tap to open chat</p>
                          </div>
                          {c.unreadCount > 0 && (
                            <span
                              className="flex h-[1.35rem] min-w-[1.35rem] shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-white tabular-nums shadow-sm ring-2 ring-background"
                              aria-label={`${c.unreadCount} unread message${c.unreadCount === 1 ? "" : "s"}`}
                            >
                              {c.unreadCount > 99 ? "99+" : c.unreadCount}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>


          <div className="grid gap-6 lg:grid-cols-3">
            {/* Today's Schedule */}
            <Card variant="glass" className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-lg flex items-center justify-between">
                  Today's Schedule
                  <Button variant="ghost" size="sm" onClick={handleViewAll}>
                    View All
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {isLoading ? (
                    <p className="text-muted-foreground text-sm">Loading today&apos;s schedule...</p>
                  ) : todaysAppointments.length === 0 ? (
                    <p className="text-muted-foreground text-sm">No sessions scheduled for today.</p>
                  ) : (
                    todaysAppointments.map((apt) => (
                      <div
                        key={apt.id}
                        className="flex items-center gap-4 p-4 rounded-xl bg-secondary/30"
                      >
                        <div className="text-center min-w-[90px]">
                          <p className="text-sm font-medium text-foreground tabular-nums">
                            {apt.scheduled_at
                              ? (() => {
                                  const t = parseISO(apt.scheduled_at);
                                  return isValid(t)
                                    ? t.toLocaleTimeString(undefined, {
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      })
                                    : "—";
                                })()
                              : "—"}
                          </p>
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-foreground">
                            {isAnonymousIdentityMaskedFromViewer(apt)
                              ? anonymousLabelForCounselor()
                              : apt.student?.profile?.full_name ||
                                apt.student?.email ||
                                (isAnonymousSessionFlag(apt.is_anonymous) ? anonymousLabelForCounselor() : "Student")}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <p className="text-sm text-muted-foreground">
                              {describeOnlineAppointmentFormat(apt.notes)}
                            </p>
                            {isAnonymousSessionFlag(apt.is_anonymous) && (
                              <AnonymousModeIndicator variant="badge" audience="counselor" />
                            )}
                          </div>
                        </div>
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-medium ${
                            apt.status === "completed"
                              ? "bg-success/20 text-success"
                              : "bg-warning/20 text-warning"
                          }`}
                        >
                          {apt.status}
                        </span>
                        {(apt.status === "scheduled" || apt.status === "confirmed") && (
                          <Button size="sm" onClick={() => handleJoinSession(apt)}>
                            {isVideoEnabledAppointment(apt.notes) ? "Join" : "Details"}
                          </Button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            {/* AI Wellness Check */}
            <Card variant="glass" className="border-info/20">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Heart className="h-5 w-5 text-info" />
                  Your Wellness
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-muted-foreground">Stress Level</span>
                    <span className="text-foreground font-medium">
                      {counselorWellness?.labels?.stress ?? "--"}
                    </span>
                  </div>
                  <Progress
                    value={typeof counselorWellness?.scores?.stress_level === "number" ? counselorWellness.scores.stress_level : 0}
                    className="h-2"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-muted-foreground">Burnout Risk</span>
                    <span className="text-foreground font-medium">
                      {counselorWellness?.labels?.burnout ?? "--"}
                    </span>
                  </div>
                  <Progress
                    value={typeof counselorWellness?.scores?.burnout_index === "number" ? counselorWellness.scores.burnout_index : 0}
                    className="h-2"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-muted-foreground">Workload</span>
                    <span className="text-foreground font-medium">
                      {typeof counselorWellness?.metrics?.workload_index === "number"
                        ? `${counselorWellness.metrics.workload_index}%`
                        : "--"}
                    </span>
                  </div>
                  <Progress
                    value={typeof counselorWellness?.metrics?.workload_index === "number" ? counselorWellness.metrics.workload_index : 0}
                    className="h-2"
                  />
                </div>
                {counselorWellness?.recommendations && (
                  <div className="pt-2 text-sm text-muted-foreground">
                    <p>Live recommendation: {counselorWellness.recommendations}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Student Emotional Trends */}
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                Student Risk Trends
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-4">
                {(() => {
                  const byRisk = diagnosticsSummary?.by_risk_level || {};

                  return [
                    { label: "Low", count: Number(byRisk.low || 0), color: "bg-success/20 text-success" },
                    { label: "Medium", count: Number(byRisk.medium || 0), color: "bg-warning/20 text-warning" },
                    { label: "High", count: Number(byRisk.high || 0), color: "bg-info/20 text-info" },
                    { label: "Critical", count: Number(byRisk.critical || 0), color: "bg-primary/20 text-primary" },
                  ].map((item) => (
                    <Button
                      key={item.label}
                      variant="ghost"
                      className="h-auto p-4 rounded-xl bg-secondary/30 hover:bg-secondary/50 flex-col gap-2"
                      onClick={handleViewStudents}
                    >
                      <div
                        className={`inline-flex items-center justify-center h-12 w-12 rounded-full ${item.color}`}
                      >
                        <span className="text-xl font-bold">{item.count}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{item.label}</p>
                    </Button>
                  ));
                })()}
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default CounselorDashboard;
