import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";


const SENSITIVE_PATH_PREFIXES = [
  "/student/chat",
  "/student/video-call",
  "/counselor/messages",
  "/counselor/video",
  "/peer/chats",
];

const isSensitivePath = (path: string) =>
  SENSITIVE_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));

export const ScreenshotShield = () => {
  const { user } = useAuth();
  const location = useLocation();
  const [showShield, setShowShield] = useState(false);
  const [policyNoticeOpen, setPolicyNoticeOpen] = useState(true);

  const active = useMemo(
    () => Boolean(user?.id) && isSensitivePath(location.pathname),
    [location.pathname, user?.id]
  );

  useEffect(() => {
    if (!active) {
      setShowShield(false);
      setPolicyNoticeOpen(true);
      return;
    }

    let shieldTimer: ReturnType<typeof setTimeout> | null = null;

    const triggerShield = (durationMs = 1500) => {
      setShowShield(true);
      if (shieldTimer) {
        clearTimeout(shieldTimer);
      }
      shieldTimer = setTimeout(() => {
        setShowShield(false);
      }, durationMs);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const looksLikeCaptureShortcut =
        key === "printscreen" ||
        (event.ctrlKey && event.shiftKey && key === "s") ||
        (event.metaKey && event.shiftKey && (key === "3" || key === "4" || key === "5"));

      if (looksLikeCaptureShortcut) {
        triggerShield();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        triggerShield(1800);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      if (shieldTimer) {
        clearTimeout(shieldTimer);
      }
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [active]);



  if (!active) {
    return null;
  }

  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-[9990] overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(25deg, rgba(255,255,255,0.25) 0, rgba(255,255,255,0.25) 1px, transparent 1px, transparent 140px)",
          }}
        />
      </div>
      {policyNoticeOpen && (
        <div className="fixed bottom-4 left-1/2 z-[9992] w-[min(96vw,720px)] -translate-x-1/2 rounded-lg border border-amber-300/30 bg-amber-500/15 px-4 py-3 text-sm text-amber-50 shadow-xl backdrop-blur-md">
          <div className="flex items-start justify-between gap-3">
            <p>
              Privacy notice: Capturing or sharing counseling content is restricted.
              Watermarking and privacy reminders are active on this screen.
            </p>
            <button
              type="button"
              className="shrink-0 rounded border border-amber-100/40 px-2 py-0.5 text-xs"
              onClick={() => setPolicyNoticeOpen(false)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {showShield && (
        <div className="fixed bottom-24 right-4 z-[9999] w-[min(92vw,360px)] rounded-2xl border border-amber-300/35 bg-slate-950/90 px-4 py-3 text-white shadow-2xl backdrop-blur-xl">
          <div>
            <p className="text-sm font-semibold">Privacy reminder</p>
            <p className="mt-1 text-xs text-white/75">
              This counseling screen is watermarked. Avoid capturing or sharing confidential content.
            </p>
          </div>
        </div>
      )}
    </>
  );
};

