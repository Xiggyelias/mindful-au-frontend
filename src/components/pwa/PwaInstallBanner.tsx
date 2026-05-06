import { useCallback, useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const THEME_COLOR = "#9e2e45";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Chrome/Edge “Install app” flow: captures beforeinstallprompt and shows a small banner.
 */
export function PwaInstallBanner() {
  const [visible, setVisible] = useState(false);
  const [installed, setInstalled] = useState(isStandalone());
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone()) {
      setInstalled(true);
      return;
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      deferredRef.current = e as BeforeInstallPromptEvent;
      setVisible(true);
    };

    const onInstalled = () => {
      setInstalled(true);
      setVisible(false);
      deferredRef.current = null;
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const onInstallClick = useCallback(async () => {
    const ev = deferredRef.current;
    if (!ev) return;
    await ev.prompt();
    await ev.userChoice;
    deferredRef.current = null;
    setVisible(false);
  }, []);

  const onDismiss = useCallback(() => {
    setVisible(false);
  }, []);

  if (installed || !visible) return null;

  return (
    <div
      className={cn(
        "fixed bottom-0 left-0 right-0 z-[100] border-t border-border/80 bg-background/95 p-3 shadow-lg backdrop-blur-md",
        "animate-in slide-in-from-bottom-4 duration-300"
      )}
      role="region"
      aria-label="Install app"
    >
      <div className="mx-auto flex max-w-lg flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex items-start gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-md"
            style={{ backgroundColor: THEME_COLOR }}
          >
            <Download className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <p className="text-sm font-semibold">Install this app</p>
            <p className="text-xs text-muted-foreground">
              Add Counselling Management System to your home screen for quicker access and a fullscreen experience.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2 sm:justify-end">
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={onDismiss}>
            Not now
          </Button>
          <Button
            id="installBtn"
            type="button"
            size="sm"
            className="font-semibold"
            style={{ backgroundColor: THEME_COLOR }}
            onClick={() => void onInstallClick()}
          >
            Install app
          </Button>
        </div>
      </div>
    </div>
  );
}
