import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Appointment } from "@/hooks/useChatSession";
import {
  Calendar,
  CalendarPlus,
  Clock,
  Check,
  X,
  Search,
  Filter,
  FilterX,
  Loader2,
  Settings,
} from "lucide-react";
import { counselorNavItems } from "@/config/counselorNavItems";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { API_RECOVERED_EVENT, api, getApiErrorMessage } from "@/lib/api";
import { getVideoCallWindowStatus, isVideoEnabledAppointment, isAppointmentAudioOnly } from "@/lib/videoCall";
import { AnonymousModeIndicator } from "@/components/privacy/AnonymousModeIndicator";
import {
  isAnonymousIdentityMaskedFromViewer,
  resolveCounselorStudentDisplayName,
} from "@/lib/anonymousMode";
import { CHAT_ANONYMITY_SYNC_EVENT } from "@/lib/chatRealtimeEvents";
import { toast } from "sonner";
import { format } from "date-fns";

type AppointmentFilter = "all" | "action_needed" | "upcoming" | "completed" | "cancelled";
type CounselorSchedule = {
  id?: number;
  day_of_week: number;
  is_working_day: boolean;
  start_time: string;
  end_time: string;
  break_start?: string | null;
  break_end?: string | null;
  slot_duration_minutes: number;
};
type PagedMeta = {
  page?: number;
  per_page?: number;
  total?: number;
  total_pages?: number;
};
type AppointmentListResponse = Appointment[] | { data?: Appointment[]; meta?: PagedMeta };
const APPOINTMENTS_PAGE_SIZE = 10;
const APPOINTMENTS_REFRESH_MIN_GAP_MS = 5000;
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function timeInputValue(value?: string | null): string {
  const raw = String(value || "");
  return /^\d{2}:\d{2}/.test(raw) ? raw.slice(0, 5) : "";
}

const CounselorAppointments = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || "Counselor";
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [appointmentPage, setAppointmentPage] = useState(1);
  const [appointmentTotalPages, setAppointmentTotalPages] = useState(1);
  const [appointmentTotalItems, setAppointmentTotalItems] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [activeActionId, setActiveActionId] = useState<string | number | null>(null);
  const [bulkCancelOpen, setBulkCancelOpen] = useState(false);
  const [bulkCancelReason, setBulkCancelReason] = useState("");
  const [bulkCancelSubmitting, setBulkCancelSubmitting] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [schedules, setSchedules] = useState<CounselorSchedule[]>([]);
  const [isLoadingSchedules, setIsLoadingSchedules] = useState(false);
  const [isSavingSchedules, setIsSavingSchedules] = useState(false);
  const [isGeneratingSlots, setIsGeneratingSlots] = useState(false);
  const bulkCancelInFlightRef = useRef(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<AppointmentFilter>("all");
  const appointmentsRequestInFlightRef = useRef<Promise<void> | null>(null);
  const lastAppointmentsLoadAtRef = useRef(0);
  const appointmentPageRef = useRef(appointmentPage);

  useEffect(() => {
    setAppointmentPage(1);
    appointmentPageRef.current = 1;
    setAppointmentTotalPages(1);
    setAppointmentTotalItems(0);
    appointmentsRequestInFlightRef.current = null;
    lastAppointmentsLoadAtRef.current = 0;
    setSchedules([]);
  }, [user?.id]);

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
          if (import.meta.env.DEV) {
            console.error("Failed to load appointments:", err);
          }
          if (showErrorToast && (err as { response?: { status?: number } })?.response?.status !== 401) {
            toast.error(getApiErrorMessage(err, "Failed to load appointments"));
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
    []
  );

  const hasInitiallyLoadedRef = useRef(false);
  const loadSchedules = useCallback(async () => {
    try {
      setIsLoadingSchedules(true);
      const payload = await api.getCounselorSchedules({ timeout_ms: 10000 });
      setSchedules(Array.isArray(payload?.data) ? payload.data : []);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, "Failed to load schedule"));
    } finally {
      setIsLoadingSchedules(false);
    }
  }, []);

  const updateScheduleField = useCallback(
    (dayOfWeek: number, field: keyof CounselorSchedule, value: string | boolean | number | null) => {
      setSchedules((prev) =>
        prev.map((schedule) =>
          Number(schedule.day_of_week) === dayOfWeek
            ? { ...schedule, [field]: value }
            : schedule
        )
      );
    },
    []
  );

  const saveSchedules = useCallback(async () => {
    try {
      setIsSavingSchedules(true);
      const payload = await api.updateCounselorSchedules({
        schedules: schedules.map((schedule) => ({
          day_of_week: Number(schedule.day_of_week),
          is_working_day: Boolean(schedule.is_working_day),
          start_time: timeInputValue(schedule.start_time) || "08:00",
          end_time: timeInputValue(schedule.end_time) || "16:00",
          break_start: timeInputValue(schedule.break_start) || null,
          break_end: timeInputValue(schedule.break_end) || null,
          slot_duration_minutes: Number(schedule.slot_duration_minutes) || 60,
        })),
      });
      setSchedules(Array.isArray(payload?.data) ? payload.data : schedules);
      toast.success("Schedule saved");
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, "Failed to save schedule"));
    } finally {
      setIsSavingSchedules(false);
    }
  }, [schedules]);

  const generateWeeklySlots = useCallback(async () => {
    try {
      setIsGeneratingSlots(true);
      const payload = await api.generateCounselorSlots({ weeks: 1 });
      toast.success(`Generated ${Number(payload?.generated_count ?? 0)} slot${Number(payload?.generated_count ?? 0) === 1 ? "" : "s"}`);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, "Failed to generate slots"));
    } finally {
      setIsGeneratingSlots(false);
    }
  }, []);

  useEffect(() => {
    if (!user?.id || hasInitiallyLoadedRef.current) {
      if (!user?.id) setIsLoading(false);
      return;
    }

    hasInitiallyLoadedRef.current = true;
    void loadAppointments(true, { force: true });
  }, [loadAppointments, user?.id]);

  useEffect(() => {
    if (!scheduleOpen) return;
    void loadSchedules();
  }, [loadSchedules, scheduleOpen]);

  // Reload when user navigates via pagination, including back to page 1
  useEffect(() => {
    if (!user?.id || !hasInitiallyLoadedRef.current) return;
    appointmentPageRef.current = appointmentPage;
    void loadAppointments(true, { force: true });
  }, [appointmentPage, loadAppointments, user?.id]);

  useEffect(() => {
    if (!user?.id) return;

    const retryLoad = () => {
      if (document.visibilityState !== "visible") return;
      void loadAppointments(false, { force: true });
    };

    // When a student toggles anonymous mode off, immediately show their real name.
    const onAnonymityChanged = () => void loadAppointments(false, { force: true });

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      retryLoad();
    }, 30000);

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
  }, [loadAppointments, user?.id]);

  const stats = useMemo(() => {
    const today = new Date();
    const isSameDay = (dateStr?: string) => {
      if (!dateStr) return false;
      const d = new Date(dateStr);
      return (
        d.getFullYear() === today.getFullYear() &&
        d.getMonth() === today.getMonth() &&
        d.getDate() === today.getDate()
      );
    };

    const endOfWeek = new Date(today);
    endOfWeek.setDate(today.getDate() + 7);

    const todayCount = appointments.filter((apt) => isSameDay(apt.scheduled_at)).length;
    const pendingCount = appointments.filter(
      (apt) => apt.status === "pending" || apt.status === "scheduled"
    ).length;
    const weekCount = appointments.filter((apt) => {
      if (!apt.scheduled_at) return false;
      const date = new Date(apt.scheduled_at);
      return date >= today && date <= endOfWeek && apt.status !== "cancelled" && apt.status !== "completed";
    }).length;

    return { today: todayCount, pending: pendingCount, thisWeek: weekCount };
  }, [appointments]);

  const filteredAppointments = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();

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

    return appointments
      .filter((apt) => {
        const studentName = String(
          apt.student?.profile?.full_name || apt.student?.email || `Student #${String(apt.student_id || apt.id)}`
        ).toLowerCase();
        const status = String(apt.status || "").toLowerCase();

        const matchesSearch = search.length === 0 || studentName.includes(search) || String(apt.id).includes(search);

        const matchesFilter =
          statusFilter === "all" ||
          (statusFilter === "action_needed" && (status === "pending" || status === "scheduled")) ||
          (statusFilter === "upcoming" &&
            (status === "scheduled" || status === "confirmed" || status === "pending")) ||
          (statusFilter === "completed" && status === "completed") ||
          (statusFilter === "cancelled" && status === "cancelled");

        return matchesSearch && matchesFilter;
      })
      .sort((a, b) => {
        // Newest first (prefer creation time so newly booked shows at top)
        return getSortTimestamp(b) - getSortTimestamp(a);
      });
  }, [appointments, searchQuery, statusFilter]);

  const openBulkCancelModal = () => {
    bulkCancelInFlightRef.current = false;
    setBulkCancelReason("");
    setBulkCancelOpen(true);
  };

  const handleBulkCancelConfirm = async () => {
    if (bulkCancelInFlightRef.current || bulkCancelSubmitting) {
      return;
    }
    bulkCancelInFlightRef.current = true;
    try {
      setBulkCancelSubmitting(true);
      const data = await api.bulkCancelCounselorAppointments({
        scope: "all",
        reason: bulkCancelReason,
      });
      const count = Number(data?.cancelled_count ?? 0);
      const msg =
        typeof data?.message === "string" && data.message.length > 0
          ? data.message
          : "Sessions successfully cancelled.";
      if (count > 0) {
        toast.success(msg);
      } else {
        toast.message(msg);
      }
      setBulkCancelOpen(false);
      await loadAppointments(true, { force: true });
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, "Failed to cancel sessions"));
    } finally {
      bulkCancelInFlightRef.current = false;
      setBulkCancelSubmitting(false);
    }
  };

  const updateAppointmentStatus = async (
    appointmentId: number | string,
    status: "confirmed" | "cancelled"
  ) => {
    try {
      setActiveActionId(appointmentId);
      await api.updateAppointment(String(appointmentId), { status });
      setAppointments((prev) =>
        prev.map((apt) => (String(apt.id) === String(appointmentId) ? { ...apt, status } : apt))
      );
      toast.success(status === "confirmed" ? "Appointment accepted" : "Appointment declined");
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, "Failed to update appointment"));
    } finally {
      setActiveActionId(null);
    }
  };

  const statusClassName = (status: string) => {
    const s = String(status || "").toLowerCase();
    if (s === "confirmed") {
      return "bg-success/20 text-success";
    }
    if (s === "scheduled" || s === "pending") {
      return "bg-warning/20 text-warning";
    }
    if (s === "completed") {
      return "bg-info/20 text-info";
    }
    if (s === "cancelled") {
      return "bg-destructive/20 text-destructive";
    }
    return "bg-muted text-muted-foreground";
  };

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

  const openSessionRoom = (apt: Appointment) => {
    if (!apt?.id) {
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
        <DashboardHeader title="Appointments" onMenuClick={() => setSidebarOpen(true)} />

        <main className="p-4 lg:p-6 space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Card variant="glass" className="text-center">
              <CardContent className="pt-6">
                <p className="text-4xl font-bold text-primary">{stats.today}</p>
                <p className="text-muted-foreground">Today (this page)</p>
              </CardContent>
            </Card>
            <Card variant="glass" className="text-center">
              <CardContent className="pt-6">
                <p className="text-4xl font-bold text-warning">{stats.pending}</p>
                <p className="text-muted-foreground">Pending (this page)</p>
              </CardContent>
            </Card>
            <Card variant="glass" className="text-center">
              <CardContent className="pt-6">
                <p className="text-4xl font-bold text-success">{stats.thisWeek}</p>
                <p className="text-muted-foreground">Next 7 Days (this page)</p>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              className="h-12 rounded-2xl px-4 text-sm font-bold gap-2 whitespace-nowrap"
              onClick={() => void generateWeeklySlots()}
              disabled={isGeneratingSlots}
            >
              {isGeneratingSlots ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />}
              Generate Weekly Slots
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-12 rounded-2xl px-4 text-sm font-bold gap-2 whitespace-nowrap"
              onClick={() => setScheduleOpen(true)}
            >
              <Settings className="h-4 w-4" />
              Edit Schedule
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-12 rounded-2xl px-4 text-sm font-bold border-destructive/40 text-destructive hover:bg-destructive/10 whitespace-nowrap"
              onClick={openBulkCancelModal}
            >
              Cancel All Sessions
            </Button>
          </div>

          <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>Slot schedule</DialogTitle>
                <DialogDescription>
                  Working hours generate 60-minute bookable slots before the 4 PM close. Lunch is locked out of student booking.
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
                {isLoadingSchedules ? (
                  <p className="text-sm text-muted-foreground">Loading schedule...</p>
                ) : (
                  schedules.map((schedule) => (
                    <div
                      key={schedule.day_of_week}
                      className="grid gap-3 rounded-2xl border border-border/60 bg-secondary/10 p-3 md:grid-cols-[70px_90px_repeat(5,minmax(0,1fr))]"
                    >
                      <div className="text-sm font-bold">{DAY_LABELS[Number(schedule.day_of_week) - 1] || schedule.day_of_week}</div>
                      <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={Boolean(schedule.is_working_day)}
                          onChange={(event) => updateScheduleField(Number(schedule.day_of_week), "is_working_day", event.target.checked)}
                        />
                        Active
                      </label>
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase tracking-wider">Start</Label>
                        <Input
                          type="time"
                          value={timeInputValue(schedule.start_time)}
                          onChange={(event) => updateScheduleField(Number(schedule.day_of_week), "start_time", event.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase tracking-wider">End</Label>
                        <Input
                          type="time"
                          value={timeInputValue(schedule.end_time)}
                          onChange={(event) => updateScheduleField(Number(schedule.day_of_week), "end_time", event.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase tracking-wider">Lunch start</Label>
                        <Input
                          type="time"
                          value={timeInputValue(schedule.break_start)}
                          onChange={(event) => updateScheduleField(Number(schedule.day_of_week), "break_start", event.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase tracking-wider">Lunch end</Label>
                        <Input
                          type="time"
                          value={timeInputValue(schedule.break_end)}
                          onChange={(event) => updateScheduleField(Number(schedule.day_of_week), "break_end", event.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase tracking-wider">Interval mins</Label>
                        <Input
                          type="number"
                          min={30}
                          max={360}
                          value={Number(schedule.slot_duration_minutes) || 60}
                          onChange={(event) => updateScheduleField(Number(schedule.day_of_week), "slot_duration_minutes", Number(event.target.value))}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setScheduleOpen(false)}>
                  Close
                </Button>
                <Button type="button" onClick={() => void saveSchedules()} disabled={isSavingSchedules || isLoadingSchedules}>
                  {isSavingSchedules ? "Saving..." : "Save Schedule"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={bulkCancelOpen}
            onOpenChange={(open) => {
              setBulkCancelOpen(open);
              if (!open) {
                bulkCancelInFlightRef.current = false;
                setBulkCancelReason("");
                setBulkCancelSubmitting(false);
              }
            }}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Bulk cancel sessions</DialogTitle>
                <DialogDescription>Are you sure you want to cancel all sessions?</DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="bulk-cancel-reason">Reason (optional)</Label>
                <Textarea
                  id="bulk-cancel-reason"
                  placeholder="Students may see this in their notification."
                  value={bulkCancelReason}
                  onChange={(e) => setBulkCancelReason(e.target.value)}
                  className="min-h-[88px] resize-y"
                  disabled={bulkCancelSubmitting}
                />
              </div>
              <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => setBulkCancelOpen(false)}
                  disabled={bulkCancelSubmitting}
                >
                  âœ– No, Go Back
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full sm:w-auto"
                  onClick={() => void handleBulkCancelConfirm()}
                  disabled={bulkCancelSubmitting}
                >
                  âœ” Yes, Cancel
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <div className="flex flex-col xl:flex-row gap-4 items-start xl:items-center">
            <div className="relative w-full xl:max-w-md group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by student name or appointment ID..."
                className="pl-9 h-11 bg-secondary/20 border-none rounded-2xl focus-visible:ring-4 focus-visible:ring-primary/5 transition-all"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={statusFilter === "all" ? "default" : "outline"}
                onClick={() => setStatusFilter("all")}
                className="rounded-xl h-9"
              >
                <Filter className="h-3.5 w-3.5 mr-2" />
                All
              </Button>
              <Button
                size="sm"
                variant={statusFilter === "action_needed" ? "default" : "outline"}
                onClick={() => setStatusFilter("action_needed")}
                className="rounded-xl h-9"
              >
                Needs Action
              </Button>
              <Button
                size="sm"
                variant={statusFilter === "upcoming" ? "default" : "outline"}
                onClick={() => setStatusFilter("upcoming")}
                className="rounded-xl h-9"
              >
                Upcoming
              </Button>
              <Button
                size="sm"
                variant={statusFilter === "completed" ? "default" : "outline"}
                onClick={() => setStatusFilter("completed")}
                className="rounded-xl h-9"
              >
                Completed
              </Button>
              <Button
                size="sm"
                variant={statusFilter === "cancelled" ? "default" : "outline"}
                onClick={() => setStatusFilter("cancelled")}
                className="rounded-xl h-9"
              >
                Cancelled
              </Button>
              {(statusFilter !== "all" || searchQuery.trim().length > 0) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-2 rounded-xl h-9 text-muted-foreground hover:text-primary"
                  onClick={() => {
                    setSearchQuery("");
                    setStatusFilter("all");
                  }}
                >
                  <FilterX className="h-3.5 w-3.5" />
                  Clear
                </Button>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-1">
            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground/60">
              Showing {filteredAppointments.length} of {appointments.length} on this page
              {appointmentTotalItems > appointments.length ? ` (${appointmentTotalItems} total)` : ""}
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

          <Card variant="glass" className="border-none shadow-none bg-transparent">
            <CardContent className="p-0 pt-2">
              <div className="space-y-4">
                {isLoading ? (
                  <p className="text-sm text-muted-foreground">Loading appointments...</p>
                ) : filteredAppointments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {appointments.length === 0
                      ? "No appointments yet. Students can book sessions from their portal."
                      : "No appointments match the current search or filter."}
                  </p>
                ) : (
                  filteredAppointments.map((apt) => {
                    const isAnonymousApt = isAnonymousIdentityMaskedFromViewer(apt);
                    const studentName = resolveCounselorStudentDisplayName(apt);

                    const isPhysical =
                      (apt as any).session_type === 'physical' ||
                      (apt as any).location_type === 'physical' ||
                      (apt as any).type === 'in_person' ||
                      (apt.notes ?? '').toLowerCase().includes('physical');
                    const isUpdating = String(activeActionId) === String(apt.id);
                    const status = String(apt.status || "").toLowerCase();
                    const videoWindow = !isPhysical
                      ? getVideoCallWindowStatus(apt.scheduled_at, apt.duration_minutes)
                      : null;
                    const showVideoStart =
                      !isPhysical &&
                      (status === "confirmed" || status === "scheduled") &&
                      Boolean(videoWindow?.canStart);

                    return (
                      <div
                        key={apt.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 p-5 rounded-[2rem] bg-secondary/10 border border-border/50 hover:bg-secondary/20 transition-all duration-300"
                      >
                        <div className="flex items-center gap-4">
                          <div className="h-14 w-14 rounded-2xl bg-info/10 flex items-center justify-center shrink-0">
                            <Calendar className="h-6 w-6 text-info" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-foreground truncate">{studentName}</p>
                            {isAnonymousApt && (
                              <div className="mt-1.5">
                                <AnonymousModeIndicator variant="badge" audience="counselor" />
                              </div>
                            )}
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 mt-0.5">
                              {isPhysical ? 'In-person' : 'Online Session'}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-4 sm:gap-8">
                          <div className="min-w-[120px]">
                            <p className="text-sm font-bold text-foreground">
                              {apt.scheduled_at ? format(new Date(apt.scheduled_at), "MMM d, yyyy") : "TBD"}
                            </p>
                            <p className="text-[10px] font-bold text-muted-foreground flex items-center gap-1.5 mt-0.5">
                              <Clock className="h-3 w-3" />
                              {apt.scheduled_at ? format(new Date(apt.scheduled_at), "h:mm a") : "TBD"}
                            </p>
                          </div>
                          <span
                            className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${statusClassName(
                              apt.status
                            )}`}
                          >
                            {apt.status}
                          </span>
                          {(status === "pending" || status === "scheduled") && (
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-success"
                                disabled={isUpdating}
                                onClick={() => updateAppointmentStatus(apt.id, "confirmed")}
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-destructive"
                                disabled={isUpdating}
                                onClick={() => updateAppointmentStatus(apt.id, "cancelled")}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                          {showVideoStart && (
                            <Button size="sm" onClick={() => openSessionRoom(apt)}>
                              Start
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default CounselorAppointments;
