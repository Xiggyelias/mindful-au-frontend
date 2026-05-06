import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNowStrict } from "date-fns";
import { X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { dispatchChatIncomingDigest } from "@/lib/chatRealtimeEvents";
import { playChatNotificationSound } from "@/lib/chatNotificationSound";

const POLL_MS = 5_000;
const AUTO_DISMISS_MS = 6_500;
const PREVIEW_MAX = 52;

type DigestRow = {
  id: number;
  session_id: number;
  sender_label: string;
  preview: string;
  created_at: string;
};

type ToastItem = {
  key: string;
  sessionId: number;
  headline: string;
  previewLine: string;
  timeLabel: string;
};

function truncatePreview(text: string, max = PREVIEW_MAX): string {
  const t = text.trim();
  if (t.length <= max) {
    return t;
  }
  return `${t.slice(0, max - 1)}…`;
}

function formatToastTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) {
    return "";
  }
  const sec = (Date.now() - t) / 1000;
  if (sec >= 0 && sec < 60) {
    return "Just now";
  }
  try {
    return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
  } catch {
    return "";
  }
}

function groupDigestRows(rows: DigestRow[]): ToastItem[] {
  const bySession = new Map<number, DigestRow[]>();
  for (const row of rows) {
    const sid = Number(row.session_id);
    if (!Number.isFinite(sid) || sid <= 0) continue;
    const list = bySession.get(sid) ?? [];
    list.push(row);
    bySession.set(sid, list);
  }

  const out: ToastItem[] = [];
  for (const [sessionId, list] of bySession) {
    const sorted = [...list].sort((a, b) => Number(a.id) - Number(b.id));
    const last = sorted[sorted.length - 1];
    const count = sorted.length;
    const sender = String(last.sender_label || "Someone").trim() || "Someone";
    const preview = truncatePreview(String(last.preview || ""));
    const previewLine =
      count > 1
        ? `${sender}: ${preview} · ${count} new messages`
        : `${sender}: ${preview}`;
    out.push({
      key: `${sessionId}-${last.id}-${last.created_at}`,
      sessionId,
      headline: count > 1 ? `${sender} · ${count} new` : sender,
      previewLine,
      timeLabel: formatToastTime(last.created_at),
    });
  }
  return out;
}

/**
 * Polls the server for new inbound chat and surfaces WhatsApp-style banners + sound.
 * Does not replace per-thread polling; it refreshes chat lists via a global event.
 */
export function ChatIncomingNotificationHost() {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const afterIdRef = useRef(0);
  const bootstrappedRef = useRef(false);
  const inFlightRef = useRef(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((key: string) => {
    setToasts((prev) => prev.filter((t) => t.key !== key));
    const timerId = timersRef.current.get(key);
    if (timerId) {
      window.clearTimeout(timerId);
      timersRef.current.delete(key);
    }
  }, []);

  const openChat = useCallback(
    (sessionId: number) => {
      const q = `?session=${encodeURIComponent(String(sessionId))}`;
      if (role === "peer_counselor") {
        navigate(`/peer/chats${q}`);
      } else if (role === "counselor") {
        navigate(`/counselor/messages${q}`);
      } else if (role === "student") {
        navigate(`/student/chat${q}`);
      }
    },
    [navigate, role]
  );

  useEffect(() => {
    if (!user?.id) {
      bootstrappedRef.current = false;
      afterIdRef.current = 0;
      setToasts([]);
      return;
    }

    if (role !== "counselor" && role !== "peer_counselor" && role !== "student") {
      return;
    }

    let cancelled = false;

    const tick = async () => {
      if (cancelled || document.visibilityState !== "visible" || inFlightRef.current) {
        return;
      }
      inFlightRef.current = true;
      try {
        const payload = (await api.getChatIncomingDigest({ after_id: afterIdRef.current })) as {
          after_id?: number;
          messages?: DigestRow[];
        };
        const nextAfter = Number(payload?.after_id ?? afterIdRef.current);
        if (Number.isFinite(nextAfter)) {
          afterIdRef.current = nextAfter;
        }

        if (!bootstrappedRef.current) {
          bootstrappedRef.current = true;
          return;
        }

        const rows = Array.isArray(payload?.messages) ? payload.messages : [];
        if (rows.length === 0) {
          return;
        }

        const sessionIds = rows.map((r) => Number(r.session_id)).filter((id) => Number.isFinite(id) && id > 0);
        dispatchChatIncomingDigest(sessionIds);

        playChatNotificationSound();

        if (typeof Notification !== "undefined" && document.hidden && Notification.permission === "granted") {
          try {
            const grouped = groupDigestRows(rows);
            for (const g of grouped.slice(0, 2)) {
              void new Notification("New message", { body: g.previewLine, tag: `chat-${g.sessionId}` });
            }
          } catch {
            // ignore
          }
        }

        const grouped = groupDigestRows(rows);
        setToasts((prev) => {
          const next = [...grouped, ...prev].slice(0, 6);
          return next;
        });

        grouped.forEach((g) => {
          if (timersRef.current.has(g.key)) return;
          const timerId = window.setTimeout(() => dismiss(g.key), AUTO_DISMISS_MS);
          timersRef.current.set(g.key, timerId);
        });
      } catch {
        // Polling should stay quiet; chat page surfaces hard failures.
      } finally {
        inFlightRef.current = false;
      }
    };

    void tick();
    const interval = window.setInterval(() => void tick(), POLL_MS);

    const onVis = () => {
      if (document.visibilityState === "visible") {
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
      timersRef.current.forEach((id) => window.clearTimeout(id));
      timersRef.current.clear();
    };
  }, [dismiss, role, user?.id]);

  if (!user?.id || (role !== "counselor" && role !== "peer_counselor" && role !== "student")) {
    return null;
  }

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed top-0 left-0 right-0 z-[100] flex flex-col items-center gap-2 pointer-events-none",
        "pt-[max(0.75rem,env(safe-area-inset-top))] px-3 sm:px-4"
      )}
    >
      {toasts.map((item) => (
        <button
          type="button"
          key={item.key}
          onClick={() => {
            openChat(item.sessionId);
            dismiss(item.key);
          }}
          className={cn(
            "pointer-events-auto w-full max-w-md animate-in slide-in-from-top-2 fade-in duration-300",
            "rounded-2xl border border-red-600/55 bg-zinc-950/95 text-left shadow-xl shadow-black/40",
            "backdrop-blur-md transition hover:bg-zinc-950"
          )}
        >
          <div className="flex gap-3 p-3.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-white truncate">{item.headline}</p>
                {item.timeLabel ? (
                  <span className="shrink-0 text-[11px] text-zinc-400 tabular-nums">{item.timeLabel}</span>
                ) : null}
              </div>
              <p className="mt-1 text-xs leading-snug text-zinc-300 line-clamp-2">{item.previewLine}</p>
            </div>
            <span
              role="button"
              tabIndex={0}
              className="shrink-0 rounded-full p-1 text-zinc-500 hover:text-white hover:bg-white/10"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                dismiss(item.key);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  dismiss(item.key);
                }
              }}
            >
              <X className="h-4 w-4" />
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
