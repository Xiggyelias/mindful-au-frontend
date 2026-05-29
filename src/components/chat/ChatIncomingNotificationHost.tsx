import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNowStrict } from "date-fns";
import { X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { dispatchChatIncomingDigest } from "@/lib/chatRealtimeEvents";
import { playChatNotificationSound } from "@/lib/chatNotificationSound";

import { tryDecryptChatNotificationPreview } from "@/lib/notificationChatDecrypt";

const POLL_MS = 15_000;
const POLL_BACKOFF_INITIAL_MS = 45_000;
const POLL_BACKOFF_MAX_MS = 5 * 60_000;
const AUTO_DISMISS_MS = 6_500;
const PREVIEW_MAX = 52;
const DIGEST_LEADER_KEY = "mindful:chat-digest-leader";
const DIGEST_LEADER_HEARTBEAT_MS = 4_000;
const DIGEST_LEADER_STALE_MS = 12_000;

type DigestRow = {
  id: number;
  session_id: number;
  sender_label: string;
  preview: string;
  created_at: string;
  message_id?: number;
  is_encrypted?: boolean;
  message_type?: string;
};

type ToastItem = {
  key: string;
  sessionId: number;
  headline: string;
  previewLine: string;
  timeLabel: string;
  decryptHint?: { messageId: number; messageType: string };
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
    const decryptHint =
      last.is_encrypted === true &&
      Number.isFinite(Number(last.message_id)) &&
      Number(last.message_id) > 0 &&
      /secure message/i.test(String(last.preview || ""))
        ? { messageId: Number(last.message_id), messageType: String(last.message_type || "text") }
        : undefined;
    out.push({
      key: `${sessionId}-${last.id}-${last.created_at}`,
      sessionId,
      headline: count > 1 ? `${sender} · ${count} new` : sender,
      previewLine,
      timeLabel: formatToastTime(last.created_at),
      decryptHint,
    });
  }
  return out;
}

async function enhanceToastItemsWithDecrypt(uid: number, items: ToastItem[]): Promise<ToastItem[]> {
  if (!Number.isFinite(uid) || uid <= 0) {
    return items;
  }
  return Promise.all(
    items.map(async (item) => {
      if (!item.decryptHint) {
        return item;
      }
      const plain = await tryDecryptChatNotificationPreview(
        uid,
        String(item.sessionId),
        item.decryptHint.messageId,
        item.decryptHint.messageType
      );
      if (!plain) {
        return item;
      }
      const previewLine = String(item.previewLine || "");
      const firstSep = previewLine.indexOf(" · ");
      const colon = previewLine.indexOf(": ");
      const name = colon >= 0 ? previewLine.slice(0, colon) : item.headline;
      if (firstSep === -1) {
        return { ...item, previewLine: `${name}: ${plain}` };
      }
      const tail = previewLine.slice(firstSep);
      return { ...item, previewLine: `${name}: ${plain}${tail}` };
    })
  );
}

type DigestLeaderState = { id: string; ts: number };

function readDigestLeader(): DigestLeaderState | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(DIGEST_LEADER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DigestLeaderState;
    const id = String(parsed?.id || "").trim();
    const ts = Number(parsed?.ts || 0);
    if (!id || !Number.isFinite(ts) || ts <= 0) return null;
    return { id, ts };
  } catch {
    return null;
  }
}

function writeDigestLeader(state: DigestLeaderState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(DIGEST_LEADER_KEY, JSON.stringify(state));
  } catch {
    // best effort
  }
}

function clearDigestLeaderIfOwned(tabId: string): void {
  const leader = readDigestLeader();
  if (!leader || leader.id !== tabId) return;
  try {
    localStorage.removeItem(DIGEST_LEADER_KEY);
  } catch {
    // best effort
  }
}

function isDigestRateLimited(error: unknown): boolean {
  const status =
    (error as { response?: { status?: number } })?.response?.status ??
    (error as { status?: number })?.status;
  return status === 429;
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
  const backoffUntilRef = useRef(0);
  const backoffMsRef = useRef(POLL_BACKOFF_INITIAL_MS);
  const tabIdRef = useRef(`digest-tab-${Math.random().toString(36).slice(2)}-${Date.now()}`);
  const isLeaderTabRef = useRef(false);
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

    const timersForCleanup = timersRef.current;
    const tabId = tabIdRef.current;

    let cancelled = false;

    const evaluateDigestLeadership = () => {
      const now = Date.now();
      const leader = readDigestLeader();
      const leaderIsStale = !leader || now - leader.ts > DIGEST_LEADER_STALE_MS;
      if (document.visibilityState !== "visible") {
        clearDigestLeaderIfOwned(tabId);
        isLeaderTabRef.current = false;
        return;
      }
      if (leaderIsStale || leader.id === tabId) {
        writeDigestLeader({ id: tabId, ts: now });
        isLeaderTabRef.current = true;
        return;
      }
      isLeaderTabRef.current = false;
    };

    evaluateDigestLeadership();
    const leaderTimer = window.setInterval(evaluateDigestLeadership, DIGEST_LEADER_HEARTBEAT_MS);

    const tick = async () => {
      if (
        cancelled ||
        document.visibilityState !== "visible" ||
        inFlightRef.current ||
        !isLeaderTabRef.current
      ) {
        return;
      }
      if (Date.now() < backoffUntilRef.current) {
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

        const batchKey = [...rows]
          .map((r) => Number(r.id))
          .filter((id) => Number.isFinite(id))
          .sort((a, b) => a - b)
          .join(",");
        playChatNotificationSound({ batchKey });

        let grouped = groupDigestRows(rows);
        const uid = Number(user?.id);
        if (Number.isFinite(uid) && uid > 0) {
          grouped = await enhanceToastItemsWithDecrypt(uid, grouped);
        }

        if (typeof Notification !== "undefined" && document.hidden && Notification.permission === "granted") {
          try {
            for (const g of grouped.slice(0, 2)) {
              void new Notification("New message", {
                body: g.previewLine,
                tag: `chat-${g.sessionId}`,
                icon: "/assets/icons/notify-192.png",
                badge: "/assets/icons/notify-badge-96.png",
              });
            }
          } catch {
            // ignore
          }
        }

        setToasts((prev) => {
          const next = [...grouped, ...prev].slice(0, 6);
          return next;
        });

        grouped.forEach((g) => {
          if (timersRef.current.has(g.key)) return;
          const timerId = window.setTimeout(() => dismiss(g.key), AUTO_DISMISS_MS);
          timersRef.current.set(g.key, timerId);
        });

        backoffMsRef.current = POLL_BACKOFF_INITIAL_MS;
      } catch (error) {
        if (isDigestRateLimited(error)) {
          const nextBackoff = Math.min(
            POLL_BACKOFF_MAX_MS,
            Math.max(POLL_BACKOFF_INITIAL_MS, backoffMsRef.current * 2)
          );
          backoffMsRef.current = nextBackoff;
          backoffUntilRef.current = Date.now() + nextBackoff;
        }
      } finally {
        inFlightRef.current = false;
      }
    };

    void tick();
    const interval = window.setInterval(() => void tick(), POLL_MS);

    const onVis = () => {
      evaluateDigestLeadership();
      if (document.visibilityState === "visible" && Date.now() >= backoffUntilRef.current) {
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.clearInterval(leaderTimer);
      document.removeEventListener("visibilitychange", onVis);
      clearDigestLeaderIfOwned(tabId);
      timersForCleanup.forEach((id) => window.clearTimeout(id));
      timersForCleanup.clear();
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
            "rounded-2xl border border-zinc-800/90 border-l-4 border-l-red-600 bg-zinc-950/98 text-left",
            "shadow-xl shadow-black/50 backdrop-blur-md transition hover:bg-black"
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
