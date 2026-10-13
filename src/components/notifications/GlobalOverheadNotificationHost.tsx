import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { 
  AlertTriangle, 
  Bell, 
  CheckCheck, 
  ChevronLeft, 
  ChevronRight, 
  PhoneCall, 
  ShieldAlert, 
  Video, 
  X 
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useNotifications, AppNotification } from "@/hooks/useNotifications";
import { useAuth } from "@/hooks/useAuth";
import { 
  playEmergencyAlertSound, 
  playMessageNotificationSound 
} from "@/lib/sounds/notificationSoundManager";
import { cn } from "@/lib/utils";

/**
 * Resolves the destination URL for a given notification based on role and path.
 */
export function resolveNotificationRoute(
  notification: AppNotification,
  role?: string | null,
  currentPath = ""
): string | null {
  const title = String(notification.title || "").toLowerCase();
  const message = String(notification.message || "").toLowerCase();
  const meta = notification.meta || {};

  const cleanPath = currentPath.toLowerCase();
  const basePath = cleanPath.startsWith("/admin")
    ? "/admin"
    : cleanPath.startsWith("/counselor")
    ? "/counselor"
    : cleanPath.startsWith("/peer")
    ? "/peer"
    : "/student";

  const getChatPath = () => {
    if (basePath === "/counselor") return "/counselor/messages";
    if (basePath === "/peer") return "/peer/chats";
    if (basePath === "/admin") return "/admin/dashboard";
    return "/student/chat";
  };

  const emergencyRequestId = Number(meta.emergency_request_id);
  if (Number.isFinite(emergencyRequestId) && emergencyRequestId > 0) {
    if (basePath === "/admin" || role === "admin") return `/admin/alerts?emergency=${emergencyRequestId}`;
    if (basePath === "/peer" || role === "peer_counselor") return "/peer/escalations";
    if (basePath === "/counselor" || role === "counselor") return `/counselor/alerts?emergency=${emergencyRequestId}`;
    return "/student/appointments";
  }

  const metaPath = String(meta.path || "").trim();
  if (metaPath.startsWith("/")) {
    return metaPath;
  }

  const chatSessionId = Number(meta.chat_session_id);
  if (Number.isFinite(chatSessionId) && chatSessionId > 0) {
    return `${getChatPath()}?session=${chatSessionId}`;
  }

  const appointmentId = Number(meta.appointment_id);
  const kind = String(meta.kind || "").trim();
  if (kind === "incoming_call") {
    return role === "counselor" ? "/counselor/video" : "/student/video-call";
  }
  if (Number.isFinite(appointmentId) && appointmentId > 0) {
    if (basePath === "/admin") return "/admin/alerts";
    if (basePath === "/peer") return "/peer/dashboard";
    return `${basePath}/appointments`;
  }

  const looksLikeEmergency =
    notification.type === "panic" ||
    title.includes("panic") ||
    title.includes("emergency") ||
    title.includes("escalation") ||
    title.includes("crisis") ||
    title.includes("alert") ||
    title.includes("risk") ||
    message.includes("panic") ||
    message.includes("emergency") ||
    message.includes("escalat") ||
    message.includes("crisis") ||
    message.includes("alert") ||
    message.includes("risk");

  if (looksLikeEmergency) {
    if (basePath === "/admin" || role === "admin") return "/admin/alerts";
    if (basePath === "/peer" || role === "peer_counselor") return "/peer/escalations";
    if (basePath === "/counselor" || role === "counselor") return "/counselor/alerts";
    return "/student/appointments";
  }

  if (title.includes("session cancelled") || message.includes("session cancelled")) {
    if (basePath === "/admin") return "/admin/alerts";
    if (basePath === "/peer") return "/peer/dashboard";
    return `${basePath}/appointments`;
  }

  if (title.includes("call") || message.includes("call") || notification.type === "call") {
    if (basePath === "/student") return "/student/video-call";
    if (basePath === "/counselor") return "/counselor/video";
    if (basePath === "/peer") return "/peer/dashboard";
    if (basePath === "/admin") return "/admin/dashboard";
  }

  if (title.includes("voice note") || message.includes("voice note")) {
    return getChatPath();
  }

  if (title.includes("appointment")) {
    if (basePath === "/admin") return "/admin/alerts";
    if (basePath === "/peer") return "/peer/dashboard";
    return `${basePath}/appointments`;
  }

  if (
    meta.assessment_assigned === true ||
    title.includes("assessment") ||
    message.includes("assessment assigned") ||
    message.includes("wellness assessment")
  ) {
    if (basePath === "/counselor") return "/counselor/students";
    if (basePath === "/peer") return "/peer/dashboard";
    if (basePath === "/admin") return "/admin/dashboard";
    return "/student/diagnostic-assessment";
  }

  if (title.includes("session") || title.includes("message")) {
    return getChatPath();
  }

  if (title.includes("wellness")) {
    if (basePath === "/admin") return "/admin/dashboard";
    if (basePath === "/peer") return "/peer/dashboard";
    return `${basePath}/wellness`;
  }

  return null;
}

/**
 * Global Overhead Notification Host.
 * Mounted at the application root so notifications are visible across EVERY page.
 * Displays high-priority emergency alerts, call alerts, and incoming notifications
 * directly overhead with sound, haptics, and one-click actions.
 */
export function GlobalOverheadNotificationHost() {
  const { user, role } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { notifications, markAsRead, markAllAsRead } = useNotifications();

  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedLocallyIds, setDismissedLocallyIds] = useState<Set<number>>(new Set());
  const soundPlayedIdsRef = useRef<Set<number>>(new Set());

  // Filter unread notifications that haven't been dismissed locally in this view session
  const activeAlerts = useMemo(() => {
    if (!user?.id) return [];
    return notifications.filter((n) => !n.read && !dismissedLocallyIds.has(n.id));
  }, [notifications, user?.id, dismissedLocallyIds]);

  // Sort: Emergency & Panic first, then call alerts, then other unread notices
  const sortedAlerts = useMemo(() => {
    return [...activeAlerts].sort((a, b) => {
      const isEmergencyA =
        a.type === "panic" ||
        /panic|emergency|crisis|escalat|critical/i.test(a.title + " " + a.message);
      const isEmergencyB =
        b.type === "panic" ||
        /panic|emergency|crisis|escalat|critical/i.test(b.title + " " + b.message);

      if (isEmergencyA && !isEmergencyB) return -1;
      if (!isEmergencyA && isEmergencyB) return 1;

      const isCallA = /call|appointment/i.test(a.title + " " + a.message);
      const isCallB = /call|appointment/i.test(b.title + " " + b.message);
      if (isCallA && !isCallB) return -1;
      if (!isCallA && isCallB) return 1;

      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    });
  }, [activeAlerts]);

  // Keep active index in bounds
  useEffect(() => {
    if (activeIndex >= sortedAlerts.length && sortedAlerts.length > 0) {
      setActiveIndex(sortedAlerts.length - 1);
    }
  }, [sortedAlerts.length, activeIndex]);

  // Sound triggers for new high-priority alerts
  useEffect(() => {
    if (sortedAlerts.length === 0) return;

    for (const alert of sortedAlerts) {
      if (!soundPlayedIdsRef.current.has(alert.id)) {
        soundPlayedIdsRef.current.add(alert.id);

        const isEmergency =
          alert.type === "panic" ||
          /panic|emergency|crisis|escalat|critical/i.test(alert.title + " " + alert.message);

        if (isEmergency) {
          playEmergencyAlertSound();
          if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
            try {
              navigator.vibrate([200, 100, 200, 100, 200]);
            } catch {
              // ignore
            }
          }
        } else if (/call|appointment/i.test(alert.title + " " + alert.message)) {
          playMessageNotificationSound();
        }
      }
    }
  }, [sortedAlerts]);

  if (!user?.id || sortedAlerts.length === 0) {
    return null;
  }

  const currentAlert = sortedAlerts[activeIndex] || sortedAlerts[0];
  const destination = resolveNotificationRoute(currentAlert, role, location.pathname);

  const isEmergency =
    currentAlert.type === "panic" ||
    /panic|emergency|crisis|escalat|critical/i.test(currentAlert.title + " " + currentAlert.message);

  const isCallOrAppointment =
    /call|appointment|session/i.test(currentAlert.title + " " + currentAlert.message);

  const handleDismiss = (id: number) => {
    setDismissedLocallyIds((prev) => new Set(prev).add(id));
    void markAsRead(id);
  };

  const handleActionClick = (alert: AppNotification) => {
    void markAsRead(alert.id);
    setDismissedLocallyIds((prev) => new Set(prev).add(alert.id));
    if (destination) {
      navigate(destination);
    }
  };

  const handleDismissAll = () => {
    setDismissedLocallyIds(new Set(sortedAlerts.map((n) => n.id)));
    void markAllAsRead();
  };

  return (
    <aside
      role="region"
      aria-label="Overhead notifications"
      className={cn(
        "fixed top-0 inset-x-0 z-[120] w-full text-white shadow-2xl transition-all duration-300 animate-in slide-in-from-top-4",
        isEmergency
          ? "bg-gradient-to-r from-red-600 via-rose-600 to-red-700 border-b-2 border-red-800"
          : isCallOrAppointment
          ? "bg-gradient-to-r from-amber-600 via-orange-600 to-amber-700 border-b border-amber-800"
          : "bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border-b border-indigo-900/50"
      )}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-3 py-2 sm:px-6 sm:py-2.5">
        {/* Left: Indicator, Tag, Title & Message */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
          {/* Beacon */}
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            {isEmergency ? (
              <>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-90" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
              </>
            ) : (
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-200" />
            )}
          </span>

          {/* Icon + Badge */}
          <div className="flex shrink-0 items-center gap-1.5">
            {isEmergency ? (
              <ShieldAlert className="h-4 w-4 shrink-0 text-white animate-pulse" />
            ) : isCallOrAppointment ? (
              <Video className="h-4 w-4 shrink-0 text-white" />
            ) : (
              <Bell className="h-4 w-4 shrink-0 text-indigo-200" />
            )}

            <Badge
              variant="outline"
              className={cn(
                "border-white/30 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5",
                isEmergency
                  ? "bg-white/20 text-white"
                  : isCallOrAppointment
                  ? "bg-amber-950/40 text-amber-100"
                  : "bg-indigo-900/40 text-indigo-100"
              )}
            >
              {isEmergency
                ? "Emergency Alert"
                : isCallOrAppointment
                ? "Call Alert"
                : "Notice"}
            </Badge>
          </div>

          {/* Text preview */}
          <div className="min-w-0 flex-1 truncate text-xs sm:text-sm">
            <span className="font-bold mr-1.5">{currentAlert.title}:</span>
            <span className="font-normal opacity-95">{currentAlert.message}</span>
          </div>

          {/* Pager if multiple alerts */}
          {sortedAlerts.length > 1 && (
            <div className="hidden items-center gap-1 sm:flex shrink-0 text-[11px] font-semibold bg-black/25 px-2 py-0.5 rounded-full">
              <span>
                {activeIndex + 1} of {sortedAlerts.length}
              </span>
              <button
                type="button"
                className="hover:text-white/80 p-0.5"
                onClick={() =>
                  setActiveIndex((prev) =>
                    prev > 0 ? prev - 1 : sortedAlerts.length - 1
                  )
                }
                title="Previous alert"
                aria-label="Previous alert"
              >
                <ChevronLeft className="h-3 w-3" />
              </button>
              <button
                type="button"
                className="hover:text-white/80 p-0.5"
                onClick={() =>
                  setActiveIndex((prev) =>
                    prev < sortedAlerts.length - 1 ? prev + 1 : 0
                  )
                }
                title="Next alert"
                aria-label="Next alert"
              >
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex shrink-0 items-center gap-2">
          {destination && (
            <Button
              type="button"
              size="sm"
              className={cn(
                "h-7 px-3 text-xs font-bold shadow-md transition-all rounded-full",
                isEmergency
                  ? "bg-white text-red-600 hover:bg-white/90 hover:text-red-700"
                  : isCallOrAppointment
                  ? "bg-white text-amber-800 hover:bg-white/90 hover:text-amber-900"
                  : "bg-indigo-500 text-white hover:bg-indigo-400"
              )}
              onClick={() => handleActionClick(currentAlert)}
            >
              {isEmergency ? "Respond Now" : isCallOrAppointment ? "Join / View" : "Open"}
            </Button>
          )}

          {sortedAlerts.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] text-white/80 hover:bg-white/15 hover:text-white rounded-full hidden md:inline-flex"
              onClick={handleDismissAll}
            >
              <CheckCheck className="mr-1 h-3 w-3" />
              Dismiss All
            </Button>
          )}

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-white/90 hover:bg-white/20 hover:text-white rounded-full"
            onClick={() => handleDismiss(currentAlert.id)}
            title="Dismiss alert"
            aria-label="Dismiss alert"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
