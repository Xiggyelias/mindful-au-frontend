import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutDashboard,
  MessageSquare,
  Calendar,
  Bot,
  Video,
  History,
  Heart,
  ArrowRightLeft,
  Plus,
  Clock,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { API_RECOVERED_EVENT, api, getApiErrorMessage } from "@/lib/api";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/student/dashboard" },
  { label: "Chat", icon: MessageSquare, path: "/student/chat" },
  { label: "Appointments", icon: Calendar, path: "/student/appointments" },
  { label: "Referrals", icon: ArrowRightLeft, path: "/student/referrals" },
  { label: "AI Support", icon: Bot, path: "/student/ai-support" },
  { label: "Video Call", icon: Video, path: "/student/video-call" },
  { label: "Past Sessions", icon: History, path: "/student/history" },
  { label: "Wellness", icon: Heart, path: "/student/wellness" },
];

type PagedMeta = {
  page?: number;
  per_page?: number;
  total?: number;
  total_pages?: number;
};

type AppointmentListResponse = any[] | { data?: any[]; meta?: PagedMeta };
const APPOINTMENTS_PAGE_SIZE = 12;
const APPOINTMENTS_REFRESH_MIN_GAP_MS = 5000;
const COUNSELORS_REFRESH_MIN_GAP_MS = 10000;

const StudentAppointments = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [appointmentPage, setAppointmentPage] = useState(1);
  const [appointmentTotalPages, setAppointmentTotalPages] = useState(1);
  const [appointmentTotalItems, setAppointmentTotalItems] = useState(0);
  const [counselors, setCounselors] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [openDialog, setOpenDialog] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [appointmentToCancel, setAppointmentToCancel] = useState<any | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);
  const [form, setForm] = useState({
    counselor_id: "",
    scheduled_at: "",
    mode: "online",
    duration_minutes: 60,
  });
  const appointmentsRequestInFlightRef = useRef<Promise<void> | null>(null);
  const counselorsRequestInFlightRef = useRef<Promise<void> | null>(null);
  const lastAppointmentsLoadAtRef = useRef(0);
  const lastCounselorsLoadAtRef = useRef(0);
  const { toast } = useToast();
  const { user } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split('@')[0] || "Student";

  useEffect(() => {
    setAppointmentPage(1);
    setAppointmentTotalPages(1);
    setAppointmentTotalItems(0);
    appointmentsRequestInFlightRef.current = null;
    counselorsRequestInFlightRef.current = null;
    lastAppointmentsLoadAtRef.current = 0;
    lastCounselorsLoadAtRef.current = 0;
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
    [appointmentPage, toast]
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
    [toast]
  );

  useEffect(() => {
    if (!user) return;
    void loadCounselors(true, { force: true });
  }, [loadCounselors, user]);

  useEffect(() => {
    if (!user) return;
    void loadAppointments(true, { force: true });
  }, [loadAppointments, user]);

  useEffect(() => {
    if (!user) return;

    const retryLoad = () => {
      if (document.visibilityState !== "visible") return;
      void loadAppointments(false);
      void loadCounselors(false);
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
  }, [loadAppointments, loadCounselors, user]);

  const availableCounselors = useMemo(() => {
    const list = (Array.isArray(counselors) ? counselors : []).filter((c: any) => Boolean(c?.id));
    return list.sort((a: any, b: any) => Number(Boolean(b?.is_online)) - Number(Boolean(a?.is_online)));
  }, [counselors]);

  useEffect(() => {
    if (!openDialog) return;
    if (availableCounselors.length === 0) return;

    setForm((prev) => {
      const selectedExists = availableCounselors.some((c: any) => String(c.id) === prev.counselor_id);
      if (selectedExists) return prev;
      return { ...prev, counselor_id: String(availableCounselors[0].id) };
    });
  }, [availableCounselors, openDialog]);

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
      await api.createAppointment({
        counselor_id: Number(form.counselor_id),
        scheduled_at: scheduledAt,
        duration_minutes: form.duration_minutes || 60,
        notes: form.mode === "online" ? "Online" : "Physical",
      });
      toast({ title: "Appointment booked!" });
      setOpenDialog(false);
      setForm({
        counselor_id: "",
        scheduled_at: "",
        mode: "online",
        duration_minutes: 60,
      });
      await loadAppointments(false, { force: true });
    } catch (err: any) {
      console.error("Create appointment error", err);
      toast({
        title: "Booking failed",
        description: getApiErrorMessage(err, "Please try again."),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const openCancelDialog = (appointment: any) => {
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
    } catch (err: any) {
      console.error("Cancel appointment error", err);
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
    return map[status] || "bg-secondary/40 text-foreground";
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
                            {c.is_online ? " (Online)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {availableCounselors.length} counselor{availableCounselors.length === 1 ? "" : "s"} available
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Mode</Label>
                    <Select
                      value={form.mode}
                      onValueChange={(val) => setForm({ ...form, mode: val })}
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
                  <div className="space-y-2">
                    <Label>Date & Time</Label>
                    <Input
                      type="datetime-local"
                      value={form.scheduled_at}
                      onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Duration (minutes)</Label>
                    <Input
                      type="number"
                      min={15}
                      max={120}
                      value={form.duration_minutes}
                      onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })}
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
            appointments.map((apt) => (
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
                          {apt.notes?.includes("Physical") ? "Physical" : "Online"}
                        </p>
                        {apt.status === "cancelled" && apt.cancellation_reason && (
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
                          {apt.scheduled_at ? new Date(apt.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ""}
                        </p>
                      </div>
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-medium ${statusBadge(apt.status)}`}
                      >
                        {apt.status}
                      </span>
                      {(apt.status === "scheduled" || apt.status === "confirmed") && (
                        <div className="flex items-center gap-2">
                          {apt.status === "scheduled" && (
                            <Button size="sm">
                              {apt.notes?.includes("Physical") ? "Details" : "Join"}
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
                    </div>
                  </div>
                </CardContent>
              </Card>
            )))}
          </div>
        </main>
      </div>
    </div>
  );
};

export default StudentAppointments;
