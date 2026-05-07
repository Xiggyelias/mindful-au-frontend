import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import {
  dismissPushPrompt,
  isPushPromptDismissed,
  registerPushSubscriptionWithServer,
  WEB_PUSH_FAILURE_HINTS,
} from "@/lib/push/webPush";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/**
 * After login, offers browser push when the server has VAPID configured.
 * Visual theme: black panel, crimson accent, white type (counseling dashboard).
 */
export function PushNotificationPrompt() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [serverHasPush, setServerHasPush] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user?.id) return;

    let cancelled = false;
    void (async () => {
      try {
        const vapid = await api.getPushVapidPublicKey();
        if (cancelled) return;
        setServerHasPush(Boolean(vapid.enabled && vapid.publicKey));
      } catch {
        if (!cancelled) setServerHasPush(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || serverHasPush !== true) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (isPushPromptDismissed()) return;
    if (Notification.permission !== "default") return;

    const t = window.setTimeout(() => setOpen(true), 1200);
    return () => window.clearTimeout(t);
  }, [user?.id, serverHasPush]);

  const onEnable = useCallback(async () => {
    setBusy(true);
    try {
      const result = await registerPushSubscriptionWithServer();
      if (result.ok) {
        toast.success("Notifications enabled", {
          className: "border border-red-900/40 bg-zinc-950 text-zinc-50",
        });
        setOpen(false);
        dismissPushPrompt();
      } else if (result.reason === "no_service_worker") {
        toast.error(
        "Service worker not active. Use HTTPS production build or set VITE_ENABLE_SERVICE_WORKER=true for local tests."
        );
      } else if (result.reason === "permission_denied") {
        toast.message("Notifications blocked", {
          description: "You can enable them later in your browser settings.",
          className: "border border-zinc-700 bg-zinc-950 text-zinc-100",
        });
        dismissPushPrompt();
        setOpen(false);
      } else if (result.reason === "server_disabled") {
        toast.error("Push is not configured on the server.");
        setOpen(false);
      } else {
        const hint =
          (result.reason && WEB_PUSH_FAILURE_HINTS[result.reason]) ||
          "Could not enable notifications. Try again later.";
        const showCode = import.meta.env.VITE_DEBUG_WEB_PUSH === "true" && result.reason;
        toast.error(hint, {
          ...(showCode
            ? {
                description: `Reason code: ${result.reason}`,
              }
            : {}),
        });
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const onNotNow = useCallback(() => {
    dismissPushPrompt();
    setOpen(false);
  }, []);

  if (!user?.id || serverHasPush !== true) {
    return null;
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent
        className={cn(
          "max-w-md gap-5 border-red-900/45 bg-zinc-950 p-0 text-zinc-50 shadow-2xl shadow-red-950/25",
          "data-[state=open]:animate-in data-[state=closed]:animate-out"
        )}
      >
        <div className="h-1 w-full rounded-t-lg bg-gradient-to-r from-red-700 via-red-600 to-red-700" />
        <div className="px-6 pb-2 pt-1">
          <AlertDialogHeader className="space-y-3 text-left">
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
                  "border border-red-500/35 bg-red-600/15 text-red-400"
                )}
              >
                <Bell className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <AlertDialogTitle className="font-display text-lg font-bold tracking-tight text-white">
                  Stay in the loop
                </AlertDialogTitle>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-400/90">
                  Secure alerts
                </p>
              </div>
            </div>
            <AlertDialogDescription className="text-left text-sm leading-relaxed text-zinc-400">
              Enable notifications to receive messages, incoming calls, session reminders, cancellations,
              and emergency alerts instantly — even when this tab is in the background or the app is installed
              as a PWA.
            </AlertDialogDescription>
          </AlertDialogHeader>
        </div>
        <AlertDialogFooter className="flex-col gap-2 border-t border-zinc-800/80 bg-black/40 px-6 py-4 sm:flex-row sm:justify-end">
          <AlertDialogCancel
            type="button"
            onClick={onNotNow}
            className={cn(
              "mt-0 gap-2 border-zinc-600 bg-transparent text-zinc-300 hover:bg-zinc-900 hover:text-white"
            )}
          >
            <BellOff className="h-4 w-4" aria-hidden />
            Not now
          </AlertDialogCancel>
          <AlertDialogAction
            type="button"
            disabled={busy}
            onClick={() => void onEnable()}
            className={cn(
              "border-0 bg-red-600 font-semibold text-white shadow-md shadow-red-950/40",
              "hover:bg-red-500 focus-visible:ring-red-500 disabled:opacity-60"
            )}
          >
            {busy ? "Enabling…" : "Enable notifications"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
