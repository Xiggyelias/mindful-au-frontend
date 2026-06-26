import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Appointment } from "@/hooks/useChatSession";
import { AlertTriangle, Loader2, Mic, Plus, Clock, Shield, Video, Calendar } from "lucide-react";
import { studentNavItems } from "@/config/studentNavItems";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AnonymousModeIndicator } from "@/components/privacy/AnonymousModeIndicator";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { API_RECOVERED_EVENT, api, getApiErrorMessage } from "@/lib/api";
import { formatInDisplayZone } from "@/lib/displayTimezone";
import {
  getVideoCallWindowStatus,
  isVideoEnabledAppointment,
  isAppointmentAudioOnly,
  prefersAudioOnlyOnlineCall,
} from "@/lib/videoCall";
import { isAnonymousSessionFlag } from "@/lib/anonymousMode";
import { CHAT_ANONYMITY_SYNC_EVENT } from "@/lib/chatRealtimeEvents";

type PagedMeta = {
  page?: number;
  per_page?: number;
  total?: number;
  total_pages?: number;
};

type AppointmentListResponse = Appointment[] | { data?: Appointment[]; meta?: PagedMeta };
type CounselorSlot = {
  id: number;
  counselor_id: number;
  appointment_id?: number | null;
  slot_date: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  status: "available" | "booked" | "unavailable" | string;
};
type EmergencyRequestStatus = "queued" | "assigned" | "resolved" | "cancelled";
type EmergencyRequest = {
  id: number;
  student_id: number;
  counselor_id?: number | null;
  assigned_to?: number | null;
  counselor_slot_id?: number | null;
  requested_at?: string | null;
  status: EmergencyRequestStatus | string;
  reason?: string | null;
  slot?: CounselorSlot | null;
  counselor?: {
    id: number;
    email?: string | null;
    profile?: {
      full_name?: string | null;
    } | null;
  } | null;
  assignee?: {
    id: number;
    email?: string | null;
    profile?: {
      full_name?: string | null;
    } | null;
  } | null;
};

const APPOINTMENTS_PAGE_SIZE = 10;
const APPOINTMENTS_REFRESH_MIN_GAP_MS = 5000;
const COUNSELORS_REFRESH_MIN_GAP_MS = 10000;
const SLOT_LOOKAHEAD_DAYS = 7;

function toDateOnly(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function minutesBetween(start: string, end: string): number {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 30;
  return Math.max(15, Math.round((endMs - startMs) / 60000));
}

function formatSlotTime(value: string): string {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  return formatInDisplayZone(d, "hh:mm a");
}

function formatSlotRange(start: string, end: string): string {
  const startLabel = formatSlotTime(start);
  const endLabel = formatSlotTime(end);
  if (!startLabel) return "";
  return endLabel ? `${startLabel}-${endLabel}` : startLabel;
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
  const [emergencyRequests, setEmergencyRequests] = useState<EmergencyRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingMatches, setIsLoadingMatches] = useState(false);
  const [isLoadingEmergencyRequests, setIsLoadingEmergencyRequests] = useState(false);
  const [openDialog, setOpenDialog] = useState(false);
  const [emergencyDialogOpen, setEmergencyDialogOpen] = useState(false);
  const [slots, setSlots] = useState<CounselorSlot[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  const [isEmergencySubmitting, setIsEmergencySubmitting] = useState(false);
  const [emergencyReason, setEmergencyReason] = useState("");
  const [emergencyCounselorId, setEmergencyCounselorId] = useState("");
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
  const location = useLocation();
  const preselectedSlotIdRef = useRef<number | null>(null);
  const userName = user?.profile?.full_name || user?.email?.split('@')[0] || "Student";

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
    setEmergencyRequests([]);
    setEmergencyReason("");
    setEmergencyCounselorId("");
    setEmergencyDialogOpen(false);
    setSlots([]);
    setSelectedSlotId(null);
    setForm({
      counselor_id: "",
      scheduled_at: "",
      mode: "online",
      online_media: "video",
      duration_minutes: 60,
      is_anonymous: false,
    });
  }, [user?.id]);

  useEffect(() => {
    setForm((prev) => {
      if (prev.mode !== "online" || !prev.is_anonymous || prev.online_media !== "video") {
        return prev;
      }
      return { ...prev, online_media: "audio" };
    });
  }, [form.mode, form.is_anonymous, form.online_media]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const book = params.get("book");
    const cId = params.get("counselor_id");
    const sId = params.get("slot_id");

    if (book === "1" && cId) {
      if (sId) {
        preselectedSlotIdRef.current = Number(sId);
      }
      setForm((prev) => ({
        ...prev,
        counselor_id: cId,
      }));
      setOpenDialog(true);
      
      navigate("/student/appointments", { replace: true });
    }
  }, [location.search, navigate]);

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
          if (import.meta.env.DEV) console.error("Failed to load appointments", err);
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
          if (import.meta.env.DEV) console.error("Failed to load counselors", err);
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

  const loadEmergencyRequests = useCallback(
    async (showErrorToast = false) => {
      if (!user?.id) {
        setEmergencyRequests([]);
        return;
      }

      try {
        setIsLoadingEmergencyRequests(true);
        const payload = await api.getEmergencyRequests({ timeout_ms: 12000 });
        const normalized = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.data)
            ? payload.data
            : [];
        setEmergencyRequests(normalized as EmergencyRequest[]);
      } catch (err: unknown) {
        if (import.meta.env.DEV) console.error("Failed to load emergency requests", err);
        if (showErrorToast) {
          toast({
            title: "Could not load emergency request status",
            description: getApiErrorMessage(err, "Please try again."),
            variant: "destructive",
          });
        }
      } finally {
        setIsLoadingEmergencyRequests(false);
      }
    },
    [toast, user?.id]
  );

  useEffect(() => {
    if (!user?.id || hasInitiallyLoadedRef.current) return;
    hasInitiallyLoadedRef.current = true;
    void loadAppointments(true, { force: true });
    void loadCounselors(true, { force: true });
    void loadEmergencyRequests(false);
  }, [loadAppointments, loadCounselors, loadEmergencyRequests, user?.id]);

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
      void loadEmergencyRequests(false);
    };

    const onAnonymityChanged = () => {
      // Anonymous mode was toggled â€” force reload so labels update immediately
      // without waiting for the 60s poll or page focus.
      void loadAppointments(false, { force: true });
    };

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadAppointments(false);
      void loadCounselors(false);
      void loadEmergencyRequests(false);
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
  }, [loadAppointments, loadCounselors, loadEmergencyRequests, user?.id]);

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
        if (import.meta.env.DEV) console.error("Failed to load counselor matches", err);
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
    if (!user || !openDialog) {
      return;
    }

    void loadCounselorMatches(form.mode === "physical" ? "physical" : "online");
  }, [form.mode, loadCounselorMatches, openDialog, user]);

  const loadCounselorSlots = useCallback(
    async (counselorId: string) => {
      const numericCounselorId = Number(counselorId);
      if (!Number.isFinite(numericCounselorId) || numericCounselorId <= 0) {
        setSlots([]);
        setSelectedSlotId(null);
        return;
      }

      try {
        setIsLoadingSlots(true);
        const from = new Date();
        const to = new Date();
        to.setDate(to.getDate() + SLOT_LOOKAHEAD_DAYS);
        const payload = await api.getCounselorSlots({
          counselor_id: numericCounselorId,
          from: toDateOnly(from),
          to: toDateOnly(to),
          generate: true,
          timeout_ms: 15000,
        });
        const nextSlots = Array.isArray(payload?.data) ? (payload.data as CounselorSlot[]) : [];
        setSlots(nextSlots);

        const preselectedSlot = preselectedSlotIdRef.current
          ? nextSlots.find((s) => Number(s.id) === preselectedSlotIdRef.current)
          : null;

        const targetSlot = preselectedSlot || nextSlots.find(
          (slot) => slot.status === "available" && new Date(slot.start_time).getTime() > Date.now()
        );
        if (targetSlot) {
          setSelectedSlotId(Number(targetSlot.id));
          setForm((prev) => ({
            ...prev,
            scheduled_at: targetSlot.start_time,
            duration_minutes: minutesBetween(targetSlot.start_time, targetSlot.end_time),
          }));
        } else {
          setSelectedSlotId(null);
          setForm((prev) => ({ ...prev, scheduled_at: "", duration_minutes: 60 }));
        }
        preselectedSlotIdRef.current = null;
      } catch (err: unknown) {
        if (import.meta.env.DEV) console.error("Failed to load counselor slots", err);
        setSlots([]);
        setSelectedSlotId(null);
        toast({
          title: "Could not load appointment slots",
          description: getApiErrorMessage(err, "Please try again."),
          variant: "destructive",
        });
      } finally {
        setIsLoadingSlots(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    if (!openDialog || !form.counselor_id) return;
    void loadCounselorSlots(form.counselor_id);
  }, [form.counselor_id, loadCounselorSlots, openDialog]);

  const selectedSlot = useMemo(
    () => slots.find((slot) => Number(slot.id) === Number(selectedSlotId)) ?? null,
    [selectedSlotId, slots]
  );

  const slotDays = useMemo(() => {
    const grouped = new Map<string, CounselorSlot[]>();
    slots.forEach((slot) => {
      if (!slot.slot_date) return;
      const existing = grouped.get(slot.slot_date) ?? [];
      existing.push(slot);
      grouped.set(slot.slot_date, existing);
    });

    return Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, daySlots]) => ({
        date,
        label: new Date(`${date}T00:00:00`).toLocaleDateString([], {
          weekday: "short",
          month: "short",
          day: "numeric",
        }),
        slots: daySlots
          .filter((slot) => slot.status === "available" && new Date(slot.start_time).getTime() > Date.now())
          .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()),
      }))
      .filter((day) => day.slots.length > 0);
  }, [slots]);

  const chooseSlot = useCallback((slot: CounselorSlot) => {
    if (slot.status !== "available") return;
    setSelectedSlotId(Number(slot.id));
    setForm((prev) => ({
      ...prev,
      scheduled_at: slot.start_time,
      duration_minutes: minutesBetween(slot.start_time, slot.end_time),
    }));
  }, []);

  const activeEmergencyRequest = useMemo(() => {
    return emergencyRequests.find((request) => {
      const status = String(request.status || "").toLowerCase();
      return status === "queued" || status === "assigned";
    }) ?? null;
  }, [emergencyRequests]);

  const activeEmergencyStatus = String(activeEmergencyRequest?.status || "").toLowerCase();
  const activeEmergencySlotId = Number(activeEmergencyRequest?.counselor_slot_id || activeEmergencyRequest?.slot?.id || 0);
  const activeEmergencyAppointmentId = Number(activeEmergencyRequest?.slot?.appointment_id || 0);
  const isEmergencyRequestQueued = activeEmergencyStatus === "queued";
  const isEmergencySlotReady =
    activeEmergencyStatus === "assigned" &&
    Number.isFinite(activeEmergencySlotId) &&
    activeEmergencySlotId > 0 &&
    (!Number.isFinite(activeEmergencyAppointmentId) || activeEmergencyAppointmentId <= 0);
  const isEmergencyAppointmentScheduled =
    activeEmergencyStatus === "assigned" &&
    Number.isFinite(activeEmergencyAppointmentId) &&
    activeEmergencyAppointmentId > 0;
  const isEmergencyAssigned =
    activeEmergencyStatus === "assigned" &&
    !isEmergencySlotReady &&
    !isEmergencyAppointmentScheduled;
  const emergencyResponderName =
    activeEmergencyRequest?.assignee?.profile?.full_name ||
    activeEmergencyRequest?.assignee?.email ||
    activeEmergencyRequest?.counselor?.profile?.full_name ||
    activeEmergencyRequest?.counselor?.email ||
    "a counselor";
  const emergencyButtonLabel = isEmergencySlotReady
    ? "Book Emergency Slot"
    : isEmergencyRequestQueued
      ? "Emergency Request Queued"
      : isEmergencyAppointmentScheduled
        ? "Emergency Appointment Active"
        : isEmergencyAssigned
          ? "Emergency Request Assigned"
          : "Emergency Appointment";

  const openEmergencyBooking = useCallback(
    (request: EmergencyRequest) => {
      const counselorId = Number(request.assigned_to || request.counselor_id || request.slot?.counselor_id || 0);
      const slotId = Number(request.counselor_slot_id || request.slot?.id || 0);
      if (!Number.isFinite(counselorId) || counselorId <= 0 || !Number.isFinite(slotId) || slotId <= 0) {
        toast({
          title: "Emergency slot is not ready",
          description: "Please refresh in a moment or check your notifications for the booking link.",
          variant: "destructive",
        });
        return;
      }

      preselectedSlotIdRef.current = slotId;
      setForm((prev) => ({
        ...prev,
        counselor_id: String(counselorId),
        scheduled_at: request.slot?.start_time || "",
        duration_minutes: request.slot?.start_time && request.slot?.end_time
          ? minutesBetween(request.slot.start_time, request.slot.end_time)
          : prev.duration_minutes,
        mode: "online",
        online_media: prev.is_anonymous ? "audio" : "video",
      }));
      setEmergencyDialogOpen(false);
      setOpenDialog(true);
    },
    [toast]
  );

  const openBookingForAssignedCounselor = useCallback(
    (request: EmergencyRequest) => {
      const counselorId = Number(request.assigned_to || request.counselor_id || 0);
      if (!Number.isFinite(counselorId) || counselorId <= 0) {
        toast({
          title: "Counselor not yet assigned",
          description: "Please refresh in a moment.",
          variant: "destructive",
        });
        return;
      }
      setSelectedSlotId(null);
      setSlots([]);
      setForm((prev) => ({
        ...prev,
        counselor_id: String(counselorId),
        scheduled_at: "",
        duration_minutes: 60,
        mode: "online",
        online_media: prev.is_anonymous ? "audio" : "video",
      }));
      setEmergencyDialogOpen(false);
      setOpenDialog(true);
    },
    [toast]
  );

  const handleEmergencyRequest = useCallback(async () => {
    if (activeEmergencyRequest) {
      if (isEmergencySlotReady) {
        openEmergencyBooking(activeEmergencyRequest);
        return;
      }

      toast({
        title: isEmergencyAppointmentScheduled
          ? "Emergency appointment is active"
          : isEmergencyAssigned
            ? "Emergency request accepted"
            : "Emergency request already queued",
        description: isEmergencyAppointmentScheduled
          ? "Your emergency appointment is already on your schedule."
          : isEmergencyAssigned
            ? `${emergencyResponderName} accepted your request. You can pick any available slot now.`
            : "Counselors have already been alerted. Please wait for a responder to accept the request.",
      });
      setEmergencyDialogOpen(false);
      return;
    }

    try {
      setIsEmergencySubmitting(true);

      let emergencyLocation: string | undefined;
      if (navigator.geolocation) {
        try {
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 10000,
              maximumAge: 0,
            });
          });
          emergencyLocation = `${position.coords.latitude},${position.coords.longitude}`;
        } catch {
          // no-op: location is optional for emergency requests
        }
      }

      const preferredCounselorId = Number(emergencyCounselorId || 0);
      const response = await api.createEmergencyRequest({
        counselor_id: Number.isFinite(preferredCounselorId) && preferredCounselorId > 0 ? preferredCounselorId : undefined,
        requested_at: new Date().toISOString(),
        reason: emergencyReason.trim() || "Emergency support requested from appointment booking.",
        location: emergencyLocation,
      });
      const createdRequest = response?.emergency_request as EmergencyRequest | undefined;
      if (createdRequest?.id) {
        setEmergencyRequests((prev) => [
          createdRequest,
          ...prev.filter((request) => Number(request.id) !== Number(createdRequest.id)),
        ]);
      }
      const recipientsNotified = Number(response?.recipients_notified || 0);
      toast({
        title: "Emergency request sent",
        description: recipientsNotified > 0
          ? `Your request is in the priority queue and ${recipientsNotified} responder${recipientsNotified === 1 ? " has" : "s have"} been notified.`
          : "Your request is now in the priority counselor queue.",
      });
      setEmergencyDialogOpen(false);
      setEmergencyReason("");
      await loadEmergencyRequests(false);
    } catch (err: unknown) {
      toast({
        title: "Emergency request failed",
        description: getApiErrorMessage(err, "Please try again or contact campus security directly."),
        variant: "destructive",
      });
    } finally {
      setIsEmergencySubmitting(false);
    }
  }, [
    activeEmergencyRequest,
    emergencyCounselorId,
    emergencyReason,
    emergencyResponderName,
    isEmergencyAppointmentScheduled,
    isEmergencyAssigned,
    isEmergencySlotReady,
    loadEmergencyRequests,
    openBookingForAssignedCounselor,
    openEmergencyBooking,
    toast,
  ]);

  const handleSubmit = async () => {
    if (!form.counselor_id || !selectedSlot) {
      toast({ title: "Please select counselor and an available slot" });
      return;
    }
    try {
      setIsSubmitting(true);
      const parsedScheduledAt = new Date(selectedSlot.start_time);
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
          : form.is_anonymous
            ? "Online audio"
            : "Online";

      const callTypeForApi =
        form.mode === "physical" ? undefined : form.is_anonymous ? ("audio" as const) : form.online_media;
      const durationMinutes = minutesBetween(selectedSlot.start_time, selectedSlot.end_time);
      const basePayload = {
        counselor_id: Number(form.counselor_id),
        counselor_slot_id: Number(selectedSlot.id),
        scheduled_at: scheduledAt,
        duration_minutes: durationMinutes,
        notes: sessionNotes,
        is_anonymous: form.is_anonymous,
      };
      let created: any;
      try {
        created = await api.createAppointment({
          ...basePayload,
          ...(callTypeForApi ? { call_type: callTypeForApi } : {}),
        });
      } catch (firstError: unknown) {
        // Backward-compatibility path: some deployments still reject newer optional booking fields.
        if (!isHttpServerError(firstError) || !callTypeForApi) {
          throw firstError;
        }
        created = await api.createAppointment({
          ...basePayload,
          notes: sessionNotes,
        });
      }
      if (created?.emergency) {
        toast({
          title: "Emergency request queued",
          description: created.message || "This request has been sent to the priority queue.",
        });
      } else {
        toast({ title: "Appointment booked!" });
      }
      setOpenDialog(false);
      setForm({
        counselor_id: "",
        scheduled_at: "",
        mode: "online",
        online_media: "video",
        duration_minutes: 60,
        is_anonymous: false,
      });
      setSelectedSlotId(null);
      setSlots([]);
      await loadAppointments(false, { force: true });
      await loadEmergencyRequests(false);
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
        items={studentNavItems}
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
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <h2 className="text-xl font-semibold">Scheduled Sessions</h2>
            <div className="flex flex-wrap gap-2">
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
                            onClick={() => {
                              setSelectedSlotId(null);
                              setSlots([]);
                              setForm((prev) => ({
                                ...prev,
                                counselor_id: String(match.id),
                                scheduled_at: "",
                                duration_minutes: 60,
                              }));
                            }}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-medium text-foreground">
                                  {match.profile?.full_name || match.email || "Counselor"}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Match score {Number(match.score ?? 0)}/100
                                  {match.is_online ? " â€¢ online now" : ""}
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
                      onValueChange={(val) => {
                        setSelectedSlotId(null);
                        setSlots([]);
                        setForm({ ...form, counselor_id: val, scheduled_at: "", duration_minutes: 60 });
                      }}
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
                            {c.ml_match?.score ? ` â€¢ ${c.ml_match.score}/100` : ""}
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
                  {form.mode === "online" && form.is_anonymous && (
                    <div className="flex items-center gap-2 rounded-2xl border border-border bg-secondary/20 px-3 py-2.5">
                      <Mic className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      <div>
                        <span className="text-sm font-medium">Audio only</span>
                        <p className="text-xs text-muted-foreground">Voice only â€” no camera required for anonymous sessions.</p>
                      </div>
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
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <Label>Available slots</Label>
                      {isLoadingSlots && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Loading slots
                        </span>
                      )}
                    </div>
                    <div className="max-h-[320px] space-y-3 overflow-y-auto rounded-2xl border border-border/70 bg-secondary/10 p-3">
                      {!form.counselor_id ? (
                        <p className="text-sm text-muted-foreground">Choose a counselor to see bookable times.</p>
                      ) : isLoadingSlots ? (
                        <p className="text-sm text-muted-foreground">Preparing this week&apos;s calendar.</p>
                      ) : slotDays.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No available slots are open for this counselor yet.</p>
                      ) : (
                        slotDays.map((day) => (
                          <div key={day.date} className="space-y-2">
                            <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                              {day.label}
                            </div>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                              {day.slots.map((slot: CounselorSlot) => {
                                const isAvailable = slot.status === "available" && new Date(slot.start_time).getTime() > Date.now();
                                const isSelected = Number(slot.id) === Number(selectedSlotId);
                                return (
                                  <button
                                    key={slot.id}
                                    type="button"
                                    disabled={!isAvailable}
                                    onClick={() => chooseSlot(slot)}
                                    className={`rounded-xl border px-3 py-2 text-left text-xs transition-colors ${
                                      isSelected
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : isAvailable
                                          ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:border-emerald-400"
                                          : "border-border bg-muted text-muted-foreground opacity-70"
                                    }`}
                                  >
                                    <span className="block whitespace-nowrap text-[11px] font-semibold tabular-nums sm:text-xs">
                                      {formatSlotRange(slot.start_time, slot.end_time)}
                                    </span>
                                    <span className="block text-[10px] font-medium">
                                      {isAvailable ? "Available" : "Booked"}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    {selectedSlot && (
                      <p className="text-xs text-muted-foreground">
                        Selected: {formatInDisplayZone(new Date(selectedSlot.start_time), "M/d/yyyy")},{" "}
                        {formatSlotRange(selectedSlot.start_time, selectedSlot.end_time)} (
                        {minutesBetween(selectedSlot.start_time, selectedSlot.end_time)} minutes).
                      </p>
                    )}
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpenDialog(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleSubmit} disabled={isSubmitting || availableCounselors.length === 0 || !selectedSlot}>
                    {isSubmitting ? "Booking..." : "Book"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
              <Button
                type="button"
                variant="destructive"
                className="gap-2"
                onClick={() => {
                  if (isEmergencySlotReady && activeEmergencyRequest) {
                    openEmergencyBooking(activeEmergencyRequest);
                    return;
                  }
                  if (isEmergencyAssigned && activeEmergencyRequest) {
                    openBookingForAssignedCounselor(activeEmergencyRequest);
                    return;
                  }
                  setEmergencyDialogOpen(true);
                }}
                disabled={isEmergencySubmitting}
              >
                {isEmergencySubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
                {emergencyButtonLabel}
              </Button>
              <Dialog open={emergencyDialogOpen} onOpenChange={setEmergencyDialogOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Emergency appointment</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    {activeEmergencyRequest ? (
                      <div className="rounded-2xl border border-destructive/25 bg-destructive/5 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 text-destructive" />
                            <p className="text-sm font-semibold text-foreground">
                              {isEmergencyAppointmentScheduled
                                ? "Emergency appointment scheduled"
                                : isEmergencySlotReady
                                  ? "Emergency slot ready"
                                  : isEmergencyAssigned
                                    ? "Emergency request assigned"
                                    : "Emergency request queued"}
                            </p>
                          </div>
                          <Badge variant="outline" className="border-destructive/40 text-destructive">
                            {String(activeEmergencyRequest.status || "queued")}
                          </Badge>
                        </div>
                        <p className="mt-3 text-sm text-muted-foreground">
                          {isEmergencyAppointmentScheduled
                            ? "Your accepted emergency request is already connected to an appointment on your schedule."
                            : isEmergencySlotReady
                              ? `${emergencyResponderName} accepted your request. Confirm the priority slot to place it on your schedule.`
                              : isEmergencyAssigned
                                ? `${emergencyResponderName} accepted your request. You can pick any available slot now or wait for a priority slot to be prepared.`
                                : "Counselors and responders have been alerted. This request will update when someone accepts it."}
                        </p>
                        {activeEmergencyRequest.requested_at && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Requested {new Date(activeEmergencyRequest.requested_at).toLocaleString()}
                          </p>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="rounded-2xl border border-destructive/25 bg-destructive/5 p-4">
                          <div className="flex items-start gap-3">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                            <div>
                              <p className="text-sm font-semibold text-foreground">Priority counselor request</p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                This alerts available counselors and admins for urgent support. If a counselor accepts, a priority slot appears here.
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>Preferred counselor</Label>
                          <Select
                            value={emergencyCounselorId || "any"}
                            onValueChange={(value) => setEmergencyCounselorId(value === "any" ? "" : value)}
                            disabled={availableCounselors.length === 0}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Any available counselor" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="any">Any available counselor</SelectItem>
                              {availableCounselors.map((c: any) => (
                                <SelectItem key={c.id} value={String(c.id)}>
                                  {c.profile?.full_name || c.email}
                                  {c.is_online ? " (Online)" : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="emergency-reason">What is happening?</Label>
                          <Textarea
                            id="emergency-reason"
                            value={emergencyReason}
                            onChange={(event) => setEmergencyReason(event.target.value)}
                            placeholder="Briefly describe what support you need right now"
                            rows={4}
                            maxLength={2000}
                          />
                        </div>
                      </>
                    )}
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setEmergencyDialogOpen(false)}>
                      Close
                    </Button>
                    {activeEmergencyRequest ? (
                      isEmergencySlotReady ? (
                        <Button variant="destructive" onClick={() => openEmergencyBooking(activeEmergencyRequest)}>
                          Book priority slot
                        </Button>
                      ) : isEmergencyAssigned ? (
                        <>
                          <Button
                            variant="outline"
                            onClick={() => void loadEmergencyRequests(true)}
                            disabled={isLoadingEmergencyRequests}
                          >
                            {isLoadingEmergencyRequests ? "Refreshing..." : "Refresh status"}
                          </Button>
                          <Button
                            variant="destructive"
                            onClick={() => openBookingForAssignedCounselor(activeEmergencyRequest)}
                          >
                            Pick a slot now
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="outline"
                          onClick={() => void loadEmergencyRequests(true)}
                          disabled={isLoadingEmergencyRequests}
                        >
                          {isLoadingEmergencyRequests ? "Refreshing..." : "Refresh status"}
                        </Button>
                      )
                    ) : (
                      <Button
                        variant="destructive"
                        onClick={() => void handleEmergencyRequest()}
                        disabled={isEmergencySubmitting}
                      >
                        {isEmergencySubmitting ? "Sending..." : "Send emergency request"}
                      </Button>
                    )}
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {activeEmergencyRequest && (
            <Card variant="glass" className="border-destructive/25 bg-destructive/5">
              <CardContent className="p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/15">
                      <AlertTriangle className="h-5 w-5 text-destructive" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-foreground">
                          {isEmergencyAppointmentScheduled
                            ? "Emergency appointment scheduled"
                            : isEmergencySlotReady
                              ? "Emergency slot ready"
                              : isEmergencyAssigned
                                ? "Emergency request assigned"
                                : "Emergency request in progress"}
                        </p>
                        <Badge variant="outline" className="border-destructive/40 text-destructive">
                          {String(activeEmergencyRequest.status || "queued")}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {isEmergencyAppointmentScheduled
                          ? "Your accepted emergency request is already on your appointment list."
                          : isEmergencySlotReady
                            ? `${emergencyResponderName} accepted your request. Confirm the priority slot to finish booking.`
                            : isEmergencyAssigned
                              ? `${emergencyResponderName} accepted your request. You can pick any available slot now or wait for a priority slot to be prepared.`
                              : "Counselors have been alerted. You can refresh the status while you wait."}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 md:justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void loadEmergencyRequests(true)}
                      disabled={isLoadingEmergencyRequests}
                    >
                      {isLoadingEmergencyRequests ? "Refreshing..." : "Refresh"}
                    </Button>
                    {isEmergencyAssigned && (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => openBookingForAssignedCounselor(activeEmergencyRequest)}
                      >
                        Pick a slot
                      </Button>
                    )}
                    {isEmergencySlotReady && (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => openEmergencyBooking(activeEmergencyRequest)}
                      >
                        Book slot
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

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
                                ? "Online â€¢ Audio only"
                                : "Online â€¢ Video"}
                            {isAnonymous ? " â€¢ Anonymous" : ""}
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
