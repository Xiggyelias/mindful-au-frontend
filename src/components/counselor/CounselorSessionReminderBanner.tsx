import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CalendarClock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatInDisplayZone } from "@/lib/displayTimezone";
import { AnonymousModeIndicator } from "@/components/privacy/AnonymousModeIndicator";
import { playSessionReminderSound } from "@/lib/sounds/notificationSoundManager";

const POLL_MS = 60_000;
const AUTO_HIDE_MS = 25_000;

export type SessionReminderItem = {
  appointment_id: number;
  student_name: string;
  is_anonymous: boolean;
  scheduled_at: string;
  duration_minutes: number;
  status: string;
};

export function CounselorSessionReminderBanner({
  enabled,
  incomingCallBannerActive,
  onActiveChange,
}: {
  enabled: boolean;
  incomingCallBannerActive: boolean;
  onActiveChange?: (active: boolean) => void;
}) {
  const navigate = useNavigate();
  const [items, setItems] = useState<SessionReminderItem[]>([]);
  const soundPlayedRef = useRef<Set<number>>(new Set());
  const hideTimersRef = useRef<Map<number, number>>(new Map());

  const clearHideTimer = useCallback((appointmentId: number) => {
    const t = hideTimersRef.current.get(appointmentId);
    if (t !== undefined) {
      window.clearTimeout(t);
      hideTimersRef.current.delete(appointmentId);
    }
  }, []);

  const removeItem = useCallback(
    (appointmentId: number) => {
      clearHideTimer(appointmentId);
      setItems((prev) => prev.filter((i) => i.appointment_id !== appointmentId));
    },
    [clearHideTimer]
  );

  const fetchReminders = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await api.getCounselorSessionReminders();
      const rows = Array.isArray(res?.data) ? (res.data as SessionReminderItem[]) : [];
      const normalized = rows.filter((r) => r && typeof r.appointment_id === "number");
      if (normalized.length === 0) return;

      setItems((prev) => {
        const existing = new Set(prev.map((p) => p.appointment_id));
        const merged = [...prev];
        for (const row of normalized) {
          if (!existing.has(row.appointment_id)) {
            merged.push(row);
            existing.add(row.appointment_id);
          }
        }
        return merged;
      });

      for (const row of normalized) {
        if (!soundPlayedRef.current.has(row.appointment_id)) {
          soundPlayedRef.current.add(row.appointment_id);
          playSessionReminderSound();
          try {
            if (typeof navigator !== "undefined" && navigator.vibrate) {
              navigator.vibrate(120);
            }
          } catch {
            /* ignore */
          }
        }
      }

      for (const row of normalized) {
        if (!hideTimersRef.current.has(row.appointment_id)) {
          const tid = window.setTimeout(() => {
            hideTimersRef.current.delete(row.appointment_id);
            removeItem(row.appointment_id);
          }, AUTO_HIDE_MS);
          hideTimersRef.current.set(row.appointment_id, tid);
        }
      }
    } catch {
      /* silent poll */
    }
  }, [enabled, removeItem]);

  useEffect(() => {
    if (!enabled) {
      setItems([]);
      soundPlayedRef.current.clear();
      hideTimersRef.current.forEach((t) => window.clearTimeout(t));
      hideTimersRef.current.clear();
      return;
    }
    void fetchReminders();
    const id = window.setInterval(() => void fetchReminders(), POLL_MS);
    return () => window.clearInterval(id);
  }, [enabled, fetchReminders]);

  useEffect(() => {
    if (!enabled) {
      onActiveChange?.(false);
      return;
    }
    onActiveChange?.(items.length > 0);
  }, [enabled, items.length, onActiveChange]);

  if (!enabled || items.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed inset-x-0 z-[105] border-b border-amber-500/40 bg-gradient-to-b from-amber-500/95 via-amber-600/90 to-amber-700/85 p-3 shadow-lg transition-[top] duration-300",
        "animate-in slide-in-from-top-2 fade-in duration-300 motion-reduce:animate-none",
        incomingCallBannerActive ? "top-[6.25rem] sm:top-[6.5rem]" : "top-0"
      )}
      role="region"
      aria-label="Upcoming session reminders"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
        {items.slice(0, 5).map((item) => (
          <ReminderRow
            key={item.appointment_id}
            item={item}
            onDismiss={() => removeItem(item.appointment_id)}
            onPrepare={() => {
              navigate("/counselor/appointments");
              removeItem(item.appointment_id);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ReminderRow({
  item,
  onDismiss,
  onPrepare,
}: {
  item: SessionReminderItem;
  onDismiss: () => void;
  onPrepare: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const startMs = new Date(item.scheduled_at).getTime();
  const secondsLeft = Number.isFinite(startMs) ? Math.max(0, Math.ceil((startMs - now) / 1000)) : 0;
  const mm = Math.floor(secondsLeft / 60);
  const ss = secondsLeft % 60;
  const countdownLabel = secondsLeft <= 0 ? "Starting now" : `${mm}:${String(ss).padStart(2, "0")}`;

  const timeLabel =
    item.scheduled_at && !Number.isNaN(startMs)
      ? formatInDisplayZone(new Date(item.scheduled_at), "EEE, MMM d · h:mm a")
      : "";

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-2xl border px-4 py-3 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between",
        item.is_anonymous
          ? "border-red-600/80 bg-black text-white shadow-[0_0_0_1px_rgba(255,255,255,0.06)]"
          : "border-white/20 bg-black/15 text-amber-50"
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-2",
            item.is_anonymous ? "bg-red-600/25 ring-red-500/40" : "bg-white/20 ring-white/30"
          )}
        >
          <CalendarClock className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <p
            className={cn(
              "text-[11px] font-bold uppercase tracking-wider",
              item.is_anonymous ? "text-red-400" : "text-amber-100/90"
            )}
          >
            Upcoming session
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <p className="truncate text-base font-semibold leading-snug">
              Upcoming session with {item.student_name}
            </p>
            {item.is_anonymous && <AnonymousModeIndicator variant="badge" audience="counselor" />}
          </div>
          <div
            className={cn(
              "mt-1 flex flex-wrap gap-x-3 text-xs",
              item.is_anonymous ? "text-white/80" : "text-amber-100/90"
            )}
          >
            {timeLabel && <span className="tabular-nums">{timeLabel}</span>}
            <span className="font-mono tabular-nums">Starts in {countdownLabel}</span>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className={cn(
            "gap-1.5 rounded-full",
            item.is_anonymous
              ? "border border-white/20 bg-white text-black hover:bg-white/90"
              : "border-white/30 bg-white/90 text-amber-900 hover:bg-white"
          )}
          onClick={onPrepare}
        >
          <Bell className="h-4 w-4" aria-hidden />
          Prepare
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={cn(
            "rounded-full",
            item.is_anonymous
              ? "text-white hover:bg-white/10 hover:text-white"
              : "text-amber-50 hover:bg-white/10 hover:text-white"
          )}
          onClick={onDismiss}
        >
          <X className="mr-1 h-4 w-4" aria-hidden />
          Dismiss
        </Button>
      </div>
    </div>
  );
}
