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
  const [inactiveProtected, setInactiveProtected] = useState(false);
  const [policyNoticeOpen, setPolicyNoticeOpen] = useState(true);
  const [timestampLabel, setTimestampLabel] = useState(() =>
    new Date().toLocaleString()
  );

  const active = useMemo(
    () => Boolean(user?.id) && isSensitivePath(location.pathname),
    [location.pathname, user?.id]
  );
  const watermarkIdentity = useMemo(() => {
    const alias = user?.profile?.anonymous_mode
      ? `User_${String(Number(user?.id || 0) % 10000).padStart(4, "0")}`
      : `UID-${String(user?.id || "").padStart(4, "0")}`;
    return alias;
  }, [user?.id, user?.profile?.anonymous_mode]);

  useEffect(() => {
    if (!active) {
      setShowShield(false);
      setInactiveProtected(false);
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
        event.preventDefault();
        triggerShield();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        setInactiveProtected(true);
        triggerShield(2200);
      } else {
        setInactiveProtected(false);
      }
    };
    const onWindowBlur = () => {
      setInactiveProtected(true);
    };
    const onWindowFocus = () => {
      setInactiveProtected(false);
    };

    const blockClipboardAndMenu = (event: Event) => {
      event.preventDefault();
      triggerShield(1300);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("focus", onWindowFocus);
    document.addEventListener("copy", blockClipboardAndMenu);
    document.addEventListener("cut", blockClipboardAndMenu);
    document.addEventListener("contextmenu", blockClipboardAndMenu);
    document.addEventListener("dragstart", blockClipboardAndMenu);

    return () => {
      if (shieldTimer) {
        clearTimeout(shieldTimer);
      }
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("focus", onWindowFocus);
      document.removeEventListener("copy", blockClipboardAndMenu);
      document.removeEventListener("cut", blockClipboardAndMenu);
      document.removeEventListener("contextmenu", blockClipboardAndMenu);
      document.removeEventListener("dragstart", blockClipboardAndMenu);
    };
  }, [active]);

  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = window.setInterval(() => {
      setTimestampLabel(new Date().toLocaleString());
    }, 1000 * 30);
    return () => {
      window.clearInterval(timer);
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
        <div className="absolute inset-0">
          <div className="absolute left-4 top-4 rounded bg-black/45 px-2 py-1 text-[10px] font-medium tracking-wide text-white/80">
            {watermarkIdentity} • {timestampLabel}
          </div>
          <div className="absolute bottom-4 right-4 rounded bg-black/45 px-2 py-1 text-[10px] font-medium tracking-wide text-white/80">
            Confidential CMS session
          </div>
        </div>
      </div>
      {policyNoticeOpen && (
        <div className="fixed bottom-4 left-1/2 z-[9992] w-[min(96vw,720px)] -translate-x-1/2 rounded-lg border border-amber-300/30 bg-amber-500/15 px-4 py-3 text-sm text-amber-50 shadow-xl backdrop-blur-md">
          <div className="flex items-start justify-between gap-3">
            <p>
              Privacy notice: Capturing or sharing counseling content is restricted.
              Monitoring and deterrence controls are active on this screen.
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
      {inactiveProtected && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/80 px-6 text-center text-white backdrop-blur-sm">
          <div>
            <p className="text-lg font-semibold">Sensitive content hidden</p>
            <p className="mt-2 text-sm text-white/80">
              Content is temporarily obscured while the app is inactive.
            </p>
          </div>
        </div>
      )}
      {showShield && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 px-6 text-center text-white">
          <div>
            <p className="text-lg font-semibold">Protected screen</p>
            <p className="mt-2 text-sm text-white/80">
              Capture and clipboard actions are restricted in this confidential area.
            </p>
          </div>
        </div>
      )}
    </>
  );
};

