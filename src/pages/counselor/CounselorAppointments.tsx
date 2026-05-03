import { useState, useEffect, useMemo, useCallback, useRef } from "react";
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
  Clock,
  Check,
  X,
  Search,
  Filter,
  FilterX,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { API_RECOVERED_EVENT, api, getApiErrorMessage } from "@/lib/api";
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

type AppointmentFilter = "all" | "action_needed" | "upcoming" | "completed" | "cancelled";
type PagedMeta = {
  page?: number;
  per_page?: number;
  total?: number;
  total_pages?: number;
};
type AppointmentListResponse = Appointment[] | { data?: Appointment[]; meta?: PagedMeta };
const APPOINTMENTS_PAGE_SIZE = 16;
const APPOINTMENTS_REFRESH_MIN_GAP_MS = 5000;

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
  useEffect(() => {
    if (!user || hasInitiallyLoadedRef.current) {
      if (!user) setIsLoading(false);
      return;
    }

    hasInitiallyLoadedRef.current = true;
    void loadAppointments(true, { force: true });
  }, [loadAppointments, user?.id]);

  // Reload when user navigates to a different page via pagination
  useEffect(() => {
    if (!user || appointmentPage === 1 || !hasInitiallyLoadedRef.current) return;
    appointmentPageRef.current = appointmentPage;
    void loadAppointments(true, { force: true });
  }, [appointmentPage, loadAppointments, user?.id]);

  useEffect(() => {
    if (!user) return;

    const retryLoad = () => {
      if (document.visibilityState !== "visible") return;
      void loadAppointments(false);
    };

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      retryLoad();
    }, 30000);

    window.addEventListener("focus", retryLoad);
    window.addEventListener("online", retryLoad);
    window.addEventListener(API_RECOVERED_EVENT, retryLoad as EventListener);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", retryLoad);
      window.removeEventListener("online", retryLoad);
      window.removeEventListener(API_RECOVERED_EVENT, retryLoad as EventListener);
    };
  }, [loadAppointments, user]);

  const today = useMemo(() => new Date(), []);

  const stats = useMemo(() => {
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
  }, [appointments, today]);

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
    if (status === "confirmed") {
      return "bg-success/20 text-success";
    }
    if (status === "scheduled" || status === "pending") {
      return "bg-warning/20 text-warning";
    }
    if (status === "completed") {
      return "bg-info/20 text-info";
    }
    if (status === "cancelled") {
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

    navigate(`/counselor/video?${params.toString()}`);
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

      <div className="lg:pl-72">
        <DashboardHeader title="Appointments" onMenuClick={() => setSidebarOpen(true)} />

        <main className="p-4 lg:p-6 space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Card variant="glass" className="text-center">
              <CardContent className="pt-6">
                <p className="text-4xl font-bold text-primary">{stats.today}</p>
                <p className="text-muted-foreground">Today</p>
              </CardContent>
            </Card>
            <Card variant="glass" className="text-center">
              <CardContent className="pt-6">
                <p className="text-4xl font-bold text-warning">{stats.pending}</p>
                <p className="text-muted-foreground">Pending Approval</p>
              </CardContent>
            </Card>
            <Card variant="glass" className="text-center">
              <CardContent className="pt-6">
                <p className="text-4xl font-bold text-success">{stats.thisWeek}</p>
                <p className="text-muted-foreground">Next 7 Days</p>
              </CardContent>
            </Card>
          </div>

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
                    const studentName =
                      apt.student?.profile?.full_name ||
                      apt.student?.email ||
                      `Student #${String(apt.student_id || apt.id).slice(-4)}`;
                    const isPhysical = String(apt.notes || "").toLowerCase().includes("physical");
                    const isUpdating = String(activeActionId) === String(apt.id);

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
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 mt-0.5">
                              {isPhysical ? "In-person" : "Secure Video"}
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
                          {(apt.status === "pending" || apt.status === "scheduled") && (
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
                          {(apt.status === "confirmed" || apt.status === "scheduled") && !isPhysical && (
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
