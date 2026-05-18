import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Appointment } from "@/hooks/useChatSession";
import {
  LayoutDashboard,
  MessageSquare,
  Calendar,
  Bot,
  Video,
  History,
  Heart,
  Mic,
  Plus,
  Clock,
  Shield,
  ClipboardCheck,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AnonymousModeIndicator } from "@/components/privacy/AnonymousModeIndicator";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { API_RECOVERED_EVENT, api, getApiErrorMessage } from "@/lib/api";
import {
  getVideoCallWindowStatus,
  isVideoEnabledAppointment,
  isAppointmentAudioOnly,
  prefersAudioOnlyOnlineCall,
} from "@/lib/videoCall";
import { isAnonymousSessionFlag, isProfileAnonymousMode } from "@/lib/anonymousMode";
import { CHAT_ANONYMITY_SYNC_EVENT } from "@/lib/chatRealtimeEvents";

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

type PagedMeta = {
  page?: number;
  per_page?: number;
  total?: number;
  total_pages?: number;
};

type AppointmentListResponse = Appointment[] | { data?: Appointment[]; meta?: PagedMeta };
const APPOINTMENTS_PAGE_SIZE = 10;
const APPOINTMENTS_REFRESH_MIN_GAP_MS = 5000;
const COUNSELORS_REFRESH_MIN_GAP_MS = 10000;
const MIN_APPOINTMENT_DURATION_MINUTES = 15;
const MAX_APPOINTMENT_DURATION_MINUTES = 120;

function normalizeDurationMinutes(value: number): number {
  if (!Number.isFinite(value)) return 60;
  return Math.min(
    MAX_APPOINTMENT_DURATION_MINUTES,
    Math.max(MIN_APPOINTMENT_DURATION_MINUTES, Math.floor(value))
  );
}

/** Value for `<input type="datetime-local" min=…>` in the user's local timezone (no `Z`). */
function toDatetimeLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isHttpServerError(error: unknown): boolean {
  const status = Number((error as { response?: { status?: unknown } })?.response?.status ?? 0);
  return Number.isFinite(status) && status >= 500;
}

const StudentAppointments = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [appointmentPage, setAppointmentPage] = useState(1);
  const [appointmentTotalPages, setAppointmentTotalPages] = useState(1);
  const [appointmentTotalItems, setAppointmentTotalItems] = useState(0);
  const [counselors, setCounselors] = useState<any[]>([]);
  const [counselorMatches, setCounselorMatches] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingMatches, setIsLoadingMatches] = useState(false);
  const [openDialog, setOpenDialog] = useState(false);
  const [bookDialogMinLocal, setBookDialogMinLocal] = useState("");
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [appointmentToCancel, setAppointmentToCancel] = useState<any | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);
  const [form, setForm] = useState({
    counselor_id: "",
    scheduled_at: "",
    mode: "online",
    online_media: "video" as "video" | "audio",
    duration_minutes: 60,
    is_anonymous: false,
  });
  const appointmentsRequestInFlightRef = useRef<Promise<void> | null>(null);
  const counselorsRequestInFlightRef = useRef<Promise<void> | null>(null);
  const lastAppointmentsLoadAtRef = useRef(0);
  const lastCounselorsLoadAtRef = useRef(0);
  const appointmentPageRef = useRef(appointmentPage);
  const hasInitiallyLoadedRef = useRef(false);
  const { toast } = useToast();

  const { user } = useAuth();
  const navigate = useNavigate();
  const userName = user?.profile?.full_name || user?.email?.split('@')[0] || "Student";
  const profileAnonymousMode = isProfileAnonymousMode(user?.profile?.anonymous_mode);

  useEffect(() => {
    setAppointmentPage(1);
    appointmentPageRef.current = 1;
    setAppointmentTotalPages(1);
    setAppointmentTotalItems(0);
    appointmentsRequestInFlightRef.current = null;
    counselorsRequestInFlightRef.current = null;
    lastAppointmentsLoadAtRef.current = 0;
    lastCounselorsLoadAtRef.current = 0;
    hasInitiallyLoadedRef.current = false;
    setIsLoading(false);
    setAppointments([]);
    setCounselors([]);
  }, [user?.id]);

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      is_anonymous: profileAnonymousMode,
    }));
  }, [profileAnonymousMode]);

  useEffect(() => {
    setForm((prev) => {
      if (prev.mode !== "online" || !prev.is_anonymous || prev.online_media !== "video") {
        return prev;
      }
      return { ...prev, online_media: "audio" };
    });
  }, [form.mode, form.is_anonymous, form.online_media]);

  const loadAppointments = useCallback(
    async (showErrorToast = true, options?: { force?: boolean }) => {
      if (appointmentsRequestInFlightRef.current) {
        await appointmentsRequestInFlightRef.current;
        return;
      }

      const force = Boolean(options?.force);
      if (
        !force &&
        Date.now() - lastAppointmentsLoadAtRef.current < APPOINTMENTS_REFRESH_MIN_GAP_MS
      ) {
        // Clear loading state if we're throttling
        setIsLoading(false);
        return;
      }

      const requestPromise = (async () => {
        try {
          setIsLoading(true);
          const payload = (await api.getAppointments({
            page: appointmentPageRef.current,
            per_page: APPOINTMENTS_PAGE_SIZE,
            timeout_ms: 15000,
          })) as AppointmentListResponse;
          const pagedPayload =
            !Array.isArray(payload) && payload && typeof payload === "object" ? payload : null;
          const normalized = (
            Array.isArray(payload)
              ? payload
              : Array.isArray(pagedPayload?.data)
              ? pagedPayload.data
              : []
          ) as Appointment[];

          const receivedPage = Number(pagedPayload?.meta?.page);
          const receivedTotalPages = Number(pagedPayload?.meta?.total_pages);
          const receivedTotal = Number(pagedPayload?.meta?.total);
          const nextPage =
            Number.isFinite(receivedPage) && receivedPage > 0 ? Math.floor(receivedPage) : 1;
          const nextTotalPages =
            Number.isFinite(receivedTotalPages) && receivedTotalPages > 0
              ? Math.floor(receivedTotalPages)
              : 1;
          const nextTotal =
            Number.isFinite(receivedTotal) && receivedTotal >= 0
              ? Math.floor(receivedTotal)
              : normalized.length;

          setAppointments(normalized);
          setAppointmentTotalPages(nextTotalPages);
          setAppointmentTotalItems(nextTotal);
          if (!pagedPayload && appointmentPageRef.current !== 1) {
            appointmentPageRef.current = 1;
            setAppointmentPage(1);
          } else if (pagedPayload && nextPage !== appointmentPageRef.current) {
            appointmentPageRef.current = nextPage;
            setAppointmentPage(nextPage);
          }
        } catch (err: unknown) {
          console.error("Failed to load appointments", err);
          if (showErrorToast) {
            toast({
              title: "Could not load appointments",
              description: getApiErrorMessage(err, "Please try again."),
              variant: "destructive",
            });
          }
        } finally {
          lastAppointmentsLoadAtRef.current = Date.now();
          setIsLoading(false);
        }
      })();

      appointmentsRequestInFlightRef.current = requestPromise;
      try {
        await requestPromise;
      } finally {
        appointmentsRequestInFlightRef.current = null;
      }
    },
    [toast] // Add toast dependency
  );

  const loadCounselors = useCallback(
    async (showErrorToast = true, options?: { force?: boolean }) => {
      if (counselorsRequestInFlightRef.current) {
        await counselorsRequestInFlightRef.current;
        return;
      }

      const force = Boolean(options?.force);
      if (
        !force &&
        Date.now() - lastCounselorsLoadAtRef.current < COUNSELORS_REFRESH_MIN_GAP_MS
      ) {
        return;
      }

      const requestPromise = (async () => {
        try {
          const counselorData = await api.getCounselors({
            lightweight: true,
            limit: 150,
            timeout_ms: 15000,
          });
          const normalized =
            Array.isArray(counselorData)
              ? counselorData
              : Array.isArray(counselorData?.data)
              ? counselorData.data
              : [];
          setCounselors(normalized);
        } catch (err: any) {
          console.error("Failed to load counselors", err);
          if (showErrorToast) {
            toast({
              title: "Could not load counselors",
              description: getApiErrorMessage(err, "Please try again."),
              variant: "destructive",
            });
          }
        } finally {
          lastCounselorsLoadAtRef.current = Date.now();
        }
      })();

      counselorsRequestInFlightRef.current = requestPromise;
      try {
        await requestPromise;
      } finally {
        counselorsRequestInFlightRef.current = null;
      }
    },
    [toast] // Add toast dependency
  );

  useEffect(() => {
    if (!user?.id || hasInitiallyLoadedRef.current) return;
    hasInitiallyLoadedRef.current = true;
    void loadAppointments(true, { force: true });
    void loadCounselors(true, { force: true });
  }, [loadAppointments, loadCounselors, user?.id]);

  // Reload when user navigates to a different page via pagination
  useEffect(() => {
    if (!user?.id || appointmentPage === 1 || !hasInitiallyLoadedRef.current) return;
    appointmentPageRef.current = appointmentPage;
    void loadAppointments(true, { force: true });
  }, [appointmentPage, loadAppointments, user?.id]);

  useEffect(() => {
    if (!user?.id) return;

    const retryLoad = () => {
      if (document.visibilityState !== "visible") return;
      void loadAppointments(false, { force: true });
      void loadCounselors(false);
    };

    const onAnonymityChanged = () => {
      // Anonymous mode was toggled — force reload so labels update immediately
      // without waiting for the 60s poll or page focus.
      void loadAppointments(false, { force: true });
    };

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadAppointments(false);
      void loadCounselors(false);
    }, 60000); // 60 seconds instead of 30

    window.addEventListener("focus", retryLoad);
    window.addEventListener("online", retryLoad);
    window.addEventListener(API_RECOVERED_EVENT, retryLoad as EventListener);
    window.addEventListener(CHAT_ANONYMITY_SYNC_EVENT, onAnonymityChanged);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", retryLoad);
      window.removeEventListener("online", retryLoad);
      window.removeEventListener(API_RECOVERED_EVENT, retryLoad as EventListener);
      window.removeEventListener(CHAT_ANONYMITY_SYNC_EVENT, onAnonymityChanged);
    };
  }, [loadAppointments, loadCounselors, user?.id]);

  const availableCounselors = useMemo(() => {
    const merged = new Map<string, any>();

    (Array.isArray(counselors) ? counselors : [])
      .filter((c: any) => Boolean(c?.id))
      .forEach((counselor: any) => {
        merged.set(String(counselor.id), {
          ...counselor,
          ml_match: null,
        });
      });

    (Array.isArray(counselorMatches) ? counselorMatches : [])
      .filter((match: any) => Boolean(match?.id))
      .forEach((match: any) => {
        const existing = merged.get(String(match.id));
        merged.set(String(match.id), {
          ...(existing || match),
          id: match.id,
          email: match.email ?? existing?.email,
          is_online: Boolean(match.is_online ?? existing?.is_online),
          profile: {
            ...(existing?.profile || {}),
            ...(match.profile || {}),
          },
          ml_match: match,
        });
      });

    return Array.from(merged.values()).sort((a: any, b: any) => {
      const aScore = Number(a?.ml_match?.score ?? -1);
      const bScore = Number(b?.ml_match?.score ?? -1);
      if (aScore !== bScore) {
        return bScore - aScore;
      }

      return Number(Boolean(b?.is_online)) - Number(Boolean(a?.is_online));
    });
  }, [counselorMatches, counselors]);

  const selectedCounselorMatch = useMemo(() => {
    return availableCounselors.find((c: any) => String(c.id) === form.counselor_id)?.ml_match ?? null;
  }, [availableCounselors, form.counselor_id]);

  const loadCounselorMatches = useCallback(
    async (mode: "online" | "physical", showErrorToast = false) => {
      if (!user) {
        setCounselorMatches([]);
        return;
      }

      try {
        setIsLoadingMatches(true);
        const data = await api.getCounselorMatches({
          mode,
          limit: 6,
          timeout_ms: 15000,
        });
        setCounselorMatches(Array.isArray(data?.matches) ? data.matches : []);
      } catch (err: any) {
        console.error("Failed to load counselor matches", err);
        setCounselorMatches([]);
        if (showErrorToast) {
          toast({
            title: "Could not load counselor matches",
            description: getApiErrorMessage(err, "Please try again."),
            variant: "destructive",
          });
        }
      } finally {
        setIsLoadingMatches(false);
      }
    },
    [user, toast]
  );

  useEffect(() => {
    if (!openDialog) return;
    if (availableCounselors.length === 0) return;

    setForm((prev) => {
      const selectedExists = availableCounselors.some((c: any) => String(c.id) === prev.counselor_id);
      if (selectedExists) return prev;
      return { ...prev, counselor_id: String(availableCounselors[0].id) };
    });
  }, [availableCounselors, openDialog]);

  useEffect(() => {
    if (!openDialog) {
      return;
    }
    setBookDialogMinLocal(toDatetimeLocalInputValue(new Date()));
  }, [openDialog]);

  useEffect(() => {
    if (!user || !openDialog) {
      return;
    }

    void loadCounselorMatches(form.mode === "physical" ? "physical" : "online");
  }, [form.mode, loadCounselorMatches, openDialog, user]);

  const handleSubmit = async () => {
    if (!form.counselor_id || !form.scheduled_at) {
      toast({ title: "Please select counselor and time" });
      return;
    }
    try {
      setIsSubmitting(true);
      const parsedScheduledAt = new Date(form.scheduled_at);
      if (!Number.isFinite(parsedScheduledAt.getTime())) {
        toast({
          title: "Invalid date/time",
          description: "Please pick a valid appointment date and time.",
          variant: "destructive",
        });
        return;
      }

      const scheduledAt = parsedScheduledAt.toISOString();
      const sessionNotes =
        form.mode === "physical"
          ? "Physical"
          : form.is_anonymous || form.online_media === "audio"
            ? "Online audio"
            : "Online";

      const callTypeForApi =
        form.mode === "physical" ? undefined : form.is_anonymous ? ("audio" as const) : form.online_media;
      const durationMinutes = normalizeDurationMinutes(form.duration_minutes);
      const basePayload = {
        counselor_id: Number(form.counselor_id),
        scheduled_at: scheduledAt,
        duration_minutes: durationMinutes,
        notes: sessionNotes,
        is_anonymous: form.is_anonymous,
      };
      try {
        await api.createAppointment({
          ...basePayload,
          ...(callTypeForApi ? { call_type: callTypeForApi } : {}),
        });
      } catch (firstError: unknown) {
        // Backward-compatibility path: some deployments still reject newer optional booking fields.
        if (!isHttpServerError(firstError) || !callTypeForApi) {
          throw firstError;
        }
        await api.createAppointment({
          ...basePayload,
          notes: sessionNotes,
        });
      }
      toast({ title: "Appointment booked!" });
      setOpenDialog(false);
      setForm({
        counselor_id: "",
        scheduled_at: "",
        mode: "online",
        online_media: "video",
        duration_minutes: 60,
        is_anonymous: profileAnonymousMode,
      });
      await loadAppointments(false, { force: true });
    } catch (err: unknown) {
      if (import.meta.env.DEV) {
        console.error("Create appointment error", err);
      }
      toast({
        title: "Booking failed",
        description: getApiErrorMessage(err, "Please try again."),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const openCancelDialog = (appointment: Appointment) => {
    setAppointmentToCancel(appointment);
    setCancellationReason("");
    setCancelDialogOpen(true);
  };

  const handleCancelAppointment = async () => {
    if (!appointmentToCancel?.id) {
      return;
    }

    const reason = cancellationReason.trim();
    if (reason.length < 5) {
      toast({
        title: "Reason required",
        description: "Please enter at least 5 characters.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsCancelling(true);
      await api.deleteAppointment(String(appointmentToCancel.id), reason);
      toast({
        title: "Appointment cancelled",
        description: "Your counselor has been notified.",
      });

      setCancelDialogOpen(false);
      setAppointmentToCancel(null);
      setCancellationReason("");

      await loadAppointments(false, { force: true });
    } catch (err: unknown) {
      if (import.meta.env.DEV) {
        console.error("Cancel appointment error", err);
      }
      toast({
        title: "Cancellation failed",
        description: getApiErrorMessage(err, "Please try again."),
        variant: "destructive",
      });
    } finally {
      setIsCancelling(false);
    }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      scheduled: "bg-warning/20 text-warning",
      confirmed: "bg-primary/20 text-primary",
      completed: "bg-success/20 text-success",
      cancelled: "bg-destructive/20 text-destructive",
    };
    const key = String(status || "").toLowerCase();
    return map[key] || "bg-secondary/40 text-foreground";
  };

  const sortedAppointments = useMemo(() => {
    const getSortTimestamp = (apt: Appointment) => {
      const createdAtMs = new Date(apt?.created_at || 0).getTime();
      if (Number.isFinite(createdAtMs) && createdAtMs > 0) {
        return createdAtMs;
      }
      const scheduledAtMs = new Date(apt?.scheduled_at || 0).getTime();
      if (Number.isFinite(scheduledAtMs) && scheduledAtMs > 0) {
        return scheduledAtMs;
      }
      return 0;
    };

    return [...appointments].sort((a, b) => getSortTimestamp(b) - getSortTimestamp(a));
  }, [appointments]);

  const canGoToPrevPage = appointmentPage > 1;
  const canGoToNextPage = appointmentPage < appointmentTotalPages;

  const handlePrevPage = () => {
    if (!canGoToPrevPage || isLoading) return;
    const next = Math.max(1, appointmentPage - 1);
    appointmentPageRef.current = next;
    setAppointmentPage(next);
  };

  const handleNextPage = () => {
    if (!canGoToNextPage || isLoading) return;
    const next = Math.min(appointmentTotalPages, appointmentPage + 1);
    appointmentPageRef.current = next;
    setAppointmentPage(next);
  };

  const openVideoCallRoom = (apt: Appointment) => {
    if (!apt?.id) {
      return;
    }

    const params = new URLSearchParams({
      appointment_id: String(apt.id),
      autostart: "1",
    });

    if (apt.counselor_id) {
      params.set("counselor_id", String(apt.counselor_id));
    }

    if (isVideoEnabledAppointment(apt.notes)) {
      params.set("mode", isAppointmentAudioOnly(apt) ? "audio" : "video");
    }

    navigate(`/student/video-call?${params.toString()}`);
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

      <div className="lg:pl-72 pl-0">
        <DashboardHeader
          title="My Appointments"
          onMenuClick={() => setSidebarOpen(true)}
        />

        <main className="p-4 lg:p-6 space-y-6">
          <div className="flex justify-between items-center gap-3">
            <h2 className="text-xl font-semibold">Scheduled Sessions</h2>
            <Dialog open={openDialog} onOpenChange={setOpenDialog}>
              <DialogTrigger asChild>
                <Button variant="hero" className="gap-2">
                  <Plus className="h-4 w-4" />
                  Book Appointment
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Book an appointment</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Recommended counselors</Label>
                      {isLoadingMatches && (
                        <span className="text-xs text-muted-foreground">Ranking counselors...</span>
                      )}
                    </div>
                    {counselorMatches.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                        {isLoadingMatches
                          ? "Preparing personalized matches."
                          : "No ranked matches yet. You can still choose from the full counselor list."}
                      </div>
                    ) : (
                      <div className="grid gap-2">
                        {counselorMatches.slice(0, 3).map((match: any) => (
                          <button
                            key={match.id}
                            type="button"
                            className={`rounded-xl border px-3 py-3 text-left transition-colors ${
                              String(match.id) === form.counselor_id
                                ? "border-primary bg-primary/5"
                                : "border-border bg-secondary/20 hover:border-primary/30"
                            }`}
                            onClick={() => setForm((prev) => ({ ...prev, counselor_id: String(match.id) }))}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-medium text-foreground">
                                  {match.profile?.full_name || match.email || "Counselor"}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Match score {Number(match.score ?? 0)}/100
                                  {match.is_online ? " • online now" : ""}
                                </p>
                              </div>
                              <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
                                {match.fit || "match"}
                              </span>
                            </div>
                            {Array.isArray(match.reasons) && match.reasons.length > 0 && (
                              <p className="mt-2 text-xs text-muted-foreground">
                                {match.reasons[0]}
                              </p>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Counselor</Label>
                    <Select
                      value={form.counselor_id}
                      onValueChange={(val) => setForm({ ...form, counselor_id: val })}
                      disabled={availableCounselors.length === 0}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={availableCounselors.length === 0 ? "No counselor available" : "Select counselor"} />
                      </SelectTrigger>
                      <SelectContent>
                        {availableCounselors.length === 0 ? (
                          <SelectItem value="none" disabled>
                            No counselor available
                          </SelectItem>
                        ) : availableCounselors.map((c: any) => (
                          <SelectItem key={c.id} value={String(c.id)}>
                            {c.profile?.full_name || c.email}
                            {c.ml_match?.score ? ` • ${c.ml_match.score}/100` : ""}
                            {c.is_online ? " (Online)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {availableCounselors.length} counselor{availableCounselors.length === 1 ? "" : "s"} available
                    </p>
                    {selectedCounselorMatch && (
                      <div className="rounded-xl bg-secondary/20 px-3 py-3 text-xs text-muted-foreground">
                        <p className="font-medium text-foreground">
                          Why this counselor
                        </p>
                        <p className="mt-1">
                          {Array.isArray(selectedCounselorMatch.reasons) && selectedCounselorMatch.reasons.length > 0
                            ? selectedCounselorMatch.reasons.join(" ")
                            : "Recommended from your recent support pattern and counselor availability."}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Mode</Label>
                    <Select
                      value={form.mode}
                      onValueChange={(val) =>
                        setForm((prev) => {
                          const mode = val as "online" | "physical";
                          return {
                            ...prev,
                            mode,
                            ...(mode === "online" && prev.is_anonymous
                              ? { online_media: "audio" as const }
                              : {}),
                          };
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="online">Online</SelectItem>
                        <SelectItem value="physical">Physical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {form.mode === "online" && (
                    <div className="space-y-2">
                      <Label>Session format</Label>
                      <RadioGroup
                        value={form.online_media}
                        onValueChange={(value) =>
                          setForm((previous) => ({
                            ...previous,
                            online_media: value as "video" | "audio",
                          }))
                        }
                        className="grid gap-2 sm:grid-cols-2"
                      >
                        <label
                          htmlFor="book-online-video"
                          className={`flex flex-col gap-2 rounded-2xl border p-3 transition-colors ${
                            form.is_anonymous ? "cursor-not-allowed opacity-50" : "cursor-pointer"
                          } ${
                            form.online_media === "video"
                              ? "border-primary bg-primary/5"
                              : "border-border bg-secondary/20 hover:border-primary/25"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <RadioGroupItem value="video" id="book-online-video" disabled={form.is_anonymous} />
                            <Video className="h-4 w-4 text-muted-foreground" aria-hidden />
                            <span className="text-sm font-medium">Video</span>
                          </div>
                          <p className="text-xs text-muted-foreground pl-6">
                            Camera and microphone (default for online sessions).
                          </p>
                        </label>
                        <label
                          htmlFor="book-online-audio"
                          className={`flex cursor-pointer flex-col gap-2 rounded-2xl border p-3 transition-colors ${
                            form.online_media === "audio"
                              ? "border-primary bg-primary/5"
                              : "border-border bg-secondary/20 hover:border-primary/25"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <RadioGroupItem value="audio" id="book-online-audio" />
                            <Mic className="h-4 w-4 text-muted-foreground" aria-hidden />
                            <span className="text-sm font-medium">Audio only</span>
                          </div>
                          <p className="text-xs text-muted-foreground pl-6">
                            Voice only—no camera required.
                          </p>
                        </label>
                      </RadioGroup>
                    </div>
                  )}
                  <div
                    className={`flex items-center justify-between rounded-2xl border p-3 transition-colors ${
                      form.is_anonymous
                        ? "border-red-600 bg-black text-white shadow-[0_0_0_1px_rgba(255,255,255,0.06)]"
                        : "border-primary/10 bg-primary/5"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Shield
                        className={`h-4 w-4 shrink-0 ${form.is_anonymous ? "text-red-500" : "text-primary"}`}
                      />
                      <div>
                        <Label
                          htmlFor="appointment-anonymous-mode"
                          className={`cursor-pointer text-sm font-medium ${form.is_anonymous ? "text-white" : ""}`}
                        >
                          Book anonymously
                        </Label>
                        <p
                          className={`text-xs ${form.is_anonymous ? "text-white/75" : "text-muted-foreground"}`}
                        >
                          Your name, photo, and contact details stay hidden from your counselor unless a safety reveal applies.
                          {form.mode === "online" && form.is_anonymous
                            ? " Anonymous online sessions are audio-only."
                            : ""}
                        </p>
                      </div>
                    </div>
                    <Switch
                      id="appointment-anonymous-mode"
                      checked={form.is_anonymous}
                      onCheckedChange={(checked) =>
                        setForm((prev) => ({
                          ...prev,
                          is_anonymous: Boolean(checked),
                          ...(prev.mode === "online"
                            ? { online_media: checked ? ("audio" as const) : ("video" as const) }
                            : {}),
                        }))
                      }
                    />
                  </div>
                  {form.is_anonymous && (
                    <AnonymousModeIndicator variant="banner" className="mt-1" />
                  )}
                  <div className="space-y-2">
                    <Label>Date & Time</Label>
                    <Input
                      type="datetime-local"
                      min={bookDialogMinLocal || undefined}
                      value={form.scheduled_at}
                      onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Duration (minutes)</Label>
                    <Input
                      type="number"
                      min={MIN_APPOINTMENT_DURATION_MINUTES}
                      max={MAX_APPOINTMENT_DURATION_MINUTES}
                      value={form.duration_minutes}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          duration_minutes: normalizeDurationMinutes(Number(e.target.value)),
                        })
                      }
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpenDialog(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleSubmit} disabled={isSubmitting || availableCounselors.length === 0}>
                    {isSubmitting ? "Booking..." : "Book"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>
              {appointmentTotalItems > 0
                ? `${appointmentTotalItems} appointment${appointmentTotalItems === 1 ? "" : "s"}`
                : "No appointments"}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={handlePrevPage}
                disabled={!canGoToPrevPage || isLoading}
              >
                Prev
              </Button>
              <span>
                Page {appointmentPage} of {Math.max(1, appointmentTotalPages)}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={handleNextPage}
                disabled={!canGoToNextPage || isLoading}
              >
                Next
              </Button>
            </div>
          </div>

          <Dialog
            open={cancelDialogOpen}
            onOpenChange={(open) => {
              setCancelDialogOpen(open);
              if (!open) {
                setAppointmentToCancel(null);
                setCancellationReason("");
              }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Cancel appointment</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Please provide a reason for cancelling this appointment.
                </p>
                {appointmentToCancel?.scheduled_at && (
                  <p className="text-xs text-muted-foreground">
                    Scheduled for{" "}
                    {new Date(appointmentToCancel.scheduled_at).toLocaleString()}
                  </p>
                )}
                <div className="space-y-2">
                  <Label htmlFor="cancel-reason">Reason</Label>
                  <Textarea
                    id="cancel-reason"
                    value={cancellationReason}
                    onChange={(e) => setCancellationReason(e.target.value)}
                    placeholder="Enter cancellation reason"
                    rows={4}
                    maxLength={1000}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setCancelDialogOpen(false);
                    setAppointmentToCancel(null);
                    setCancellationReason("");
                  }}
                >
                  Keep appointment
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleCancelAppointment}
                  disabled={isCancelling}
                >
                  {isCancelling ? "Cancelling..." : "Confirm cancellation"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <div className="grid gap-4">
            {isLoading ? (
              <p className="text-muted-foreground text-sm">Loading appointments...</p>
            ) : appointments.length === 0 ? (
              <p className="text-muted-foreground text-sm">No appointments yet. Book your first session.</p>
            ) : (
            sortedAppointments.map((apt) => {
              const isPhysical = String(apt.notes || "").trim().toLowerCase().startsWith("physical");
              const isAnonymous = isAnonymousSessionFlag(apt.is_anonymous);
              const status = String(apt.status || "").toLowerCase();
              const videoWindow =
                !isPhysical && isVideoEnabledAppointment(apt.notes)
                  ? getVideoCallWindowStatus(apt.scheduled_at, apt.duration_minutes)
                  : null;
              const showVideoJoin =
                !isPhysical &&
                isVideoEnabledAppointment(apt.notes) &&
                (status === "scheduled" || status === "confirmed") &&
                Boolean(videoWindow?.canStart);

              return (
                <Card key={apt.id} variant="glass">
                  <CardContent className="p-4">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <div className="h-12 w-12 rounded-full bg-info/20 flex items-center justify-center">
                          <Calendar className="h-6 w-6 text-info" />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">
                            {apt.counselor?.profile?.full_name || apt.counselor?.email || "Counselor"}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {isPhysical
                              ? "Physical"
                              : prefersAudioOnlyOnlineCall(apt.notes) || isAppointmentAudioOnly(apt)
                                ? "Online • Audio only"
                                : "Online • Video"}
                            {isAnonymous ? " • Anonymous" : ""}
                          </p>
                          {isAnonymous && !isPhysical && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              <AnonymousModeIndicator variant="badge" />
                              <Badge
                                variant="outline"
                                className="border-red-600/80 bg-black text-[11px] font-medium text-white"
                              >
                                Audio only
                              </Badge>
                            </div>
                          )}
                          {status === "cancelled" && apt.cancellation_reason && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Reason: {apt.cancellation_reason}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="font-medium text-foreground">
                            {apt.scheduled_at ? new Date(apt.scheduled_at).toLocaleDateString() : ""}
                          </p>
                          <p className="text-sm text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {apt.scheduled_at
                              ? new Date(apt.scheduled_at).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : ""}
                          </p>
                        </div>
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-medium ${statusBadge(apt.status)}`}
                        >
                          {apt.status}
                        </span>
                        {(status === "scheduled" || status === "confirmed") && (
                          <div className="flex items-center gap-2">
                            {showVideoJoin && (
                              <Button size="sm" onClick={() => openVideoCallRoom(apt)}>
                                Join
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => openCancelDialog(apt)}
                            >
                              Cancel
                            </Button>
                          </div>
                        )}
                        {status === "completed" && (
                          <p className="text-xs font-medium text-success">Session completed</p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            }))}
          </div>
        </main>
      </div>
    </div>
  );
};

export default StudentAppointments;
