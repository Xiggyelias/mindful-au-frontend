import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
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
type AppointmentListResponse = any[] | { data?: any[]; meta?: PagedMeta };
const APPOINTMENTS_PAGE_SIZE = 16;
const APPOINTMENTS_REFRESH_MIN_GAP_MS = 5000;

const CounselorAppointments = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || "Counselor";
  const [appointments, setAppointments] = useState<any[]>([]);
  const [appointmentPage, setAppointmentPage] = useState(1);
  const [appointmentTotalPages, setAppointmentTotalPages] = useState(1);
  const [appointmentTotalItems, setAppointmentTotalItems] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [activeActionId, setActiveActionId] = useState<string | number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<AppointmentFilter>("all");
  const appointmentsRequestInFlightRef = useRef<Promise<void> | null>(null);
  const lastAppointmentsLoadAtRef = useRef(0);

  useEffect(() => {
    setAppointmentPage(1);
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
            page: appointmentPage,
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
          ) as any[];

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
          if (!pagedPayload && appointmentPage !== 1) {
            setAppointmentPage(1);
          } else if (pagedPayload && nextPage !== appointmentPage) {
            setAppointmentPage(nextPage);
          }
        } catch (err: any) {
          console.error("Failed to load appointments:", err);
          if (showErrorToast && err?.response?.status !== 401) {
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
    [appointmentPage]
  );

  useEffect(() => {
    if (!user) {
      setIsLoading(false);
      return;
    }

    void loadAppointments(true, { force: true });
  }, [loadAppointments, user]);

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

    const getSortTimestamp = (apt: any) => {
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
    setAppointmentPage((current) => Math.max(1, current - 1));
  };

  const handleNextPage = () => {
    if (!canGoToNextPage || isLoading) return;
    setAppointmentPage((current) => Math.min(appointmentTotalPages, current + 1));
  };

  const openSessionRoom = (appointment: any) => {
    if (!appointment?.id) {
      return;
    }

    const params = new URLSearchParams({
      appointment_id: String(appointment.id),
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

          <div className="flex flex-col lg:flex-row lg:flex-wrap gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by student name or appointment ID..."
                className="pl-9"
              />
            </div>
            <Button
              size="sm"
              variant={statusFilter === "all" ? "default" : "outline"}
              onClick={() => setStatusFilter("all")}
              className="gap-2"
            >
              <Filter className="h-4 w-4" />
              All
            </Button>
            <Button
              size="sm"
              variant={statusFilter === "action_needed" ? "default" : "outline"}
              onClick={() => setStatusFilter("action_needed")}
            >
              Needs Action
            </Button>
            <Button
              size="sm"
              variant={statusFilter === "upcoming" ? "default" : "outline"}
              onClick={() => setStatusFilter("upcoming")}
            >
              Upcoming
            </Button>
            <Button
              size="sm"
              variant={statusFilter === "completed" ? "default" : "outline"}
              onClick={() => setStatusFilter("completed")}
            >
              Completed
            </Button>
            <Button
              size="sm"
              variant={statusFilter === "cancelled" ? "default" : "outline"}
              onClick={() => setStatusFilter("cancelled")}
            >
              Cancelled
            </Button>
            {(statusFilter !== "all" || searchQuery.trim().length > 0) && (
              <Button
                size="sm"
                variant="ghost"
                className="gap-2"
                onClick={() => {
                  setSearchQuery("");
                  setStatusFilter("all");
                }}
              >
                <FilterX className="h-4 w-4" />
                Clear
              </Button>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>
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

          <Card variant="glass">
            <CardHeader>
              <CardTitle className="text-lg">Appointments</CardTitle>
            </CardHeader>
            <CardContent>
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
                        className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl bg-secondary/30"
                      >
                        <div className="flex items-center gap-4">
                          <div className="h-12 w-12 rounded-full bg-info/20 flex items-center justify-center">
                            <Calendar className="h-6 w-6 text-info" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{studentName}</p>
                            <p className="text-sm text-muted-foreground">
                              {isPhysical ? "In-person" : "Video call"}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 flex-wrap md:flex-nowrap">
                          <div className="text-right min-w-[140px]">
                            <p className="font-medium text-foreground">
                              {apt.scheduled_at ? format(new Date(apt.scheduled_at), "MMM d, yyyy") : "TBD"}
                            </p>
                            <p className="text-sm text-muted-foreground flex items-center justify-end gap-1">
                              <Clock className="h-3 w-3" />
                              {apt.scheduled_at ? format(new Date(apt.scheduled_at), "h:mm a") : "TBD"}
                            </p>
                          </div>
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-medium capitalize ${statusClassName(
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
