import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatChatFileSize } from "@/lib/chatAttachments";

export type VoiceMemoBubbleRole = "outgoing" | "incoming";

function formatPlayTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export interface VoiceMemoPlayerProps {
  src: string;
  mimeType?: string | null;
  /** Shown as a short category line (e.g. Voice memo, Audio attachment) */
  headline: string;
  fileSizeBytes?: number;
  bubbleRole: VoiceMemoBubbleRole;
  className?: string;
}

/**
 * In-app voice playback styled for a counselling context (not a consumer chat clone).
 * Uses a hidden <audio> element with custom controls and timeline.
 */
export function VoiceMemoPlayer({
  src,
  mimeType: _mimeType,
  headline,
  fileSizeBytes,
  bubbleRole,
  className,
}: VoiceMemoPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
  }, [src]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onTime = () => setCurrent(el.currentTime);
    const onDur = () => {
      const d = el.duration;
      setDuration(Number.isFinite(d) && d > 0 ? d : 0);
    };
    const onEnd = () => {
      setPlaying(false);
      setCurrent(0);
      el.currentTime = 0;
    };

    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onDur);
    el.addEventListener("durationchange", onDur);
    el.addEventListener("ended", onEnd);

    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onDur);
      el.removeEventListener("durationchange", onDur);
      el.removeEventListener("ended", onEnd);
    };
  }, [src]);

  const togglePlay = useCallback(async () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
      return;
    }
    try {
      await el.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  }, [playing]);

  const seekFromEvent = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = audioRef.current;
      if (!el || !Number.isFinite(duration) || duration <= 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
      el.currentTime = (x / rect.width) * duration;
      setCurrent(el.currentTime);
    },
    [duration]
  );

  const pct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;
  const isOutgoing = bubbleRole === "outgoing";

  const shell = isOutgoing
    ? "border-primary-foreground/20 bg-primary-foreground/[0.07]"
    : "border-border/60 bg-background/55 backdrop-blur-sm";

  const meta = isOutgoing ? "text-primary-foreground/75" : "text-muted-foreground";
  const trackBg = isOutgoing ? "bg-primary-foreground/20" : "bg-muted/90";
  const trackFill = isOutgoing ? "bg-primary-foreground/90" : "bg-primary";

  const buttonClass = isOutgoing
    ? "border-primary-foreground/35 bg-primary-foreground/[0.1] text-primary-foreground hover:bg-primary-foreground/20"
    : "border-border/80 bg-background/80 text-foreground hover:bg-muted/90";

  return (
    <div
      className={cn(
        "flex max-w-[min(100%,18rem)] items-center gap-3 rounded-2xl border px-3 py-2.5 shadow-none",
        shell,
        className
      )}
    >
      <audio ref={audioRef} src={src} preload="metadata" playsInline className="hidden" />

      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-pressed={playing}
        aria-label={playing ? "Pause playback" : "Play recording"}
        className={cn("h-10 w-10 shrink-0 rounded-full border shadow-none", buttonClass)}
        onClick={() => void togglePlay()}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 pl-0.5" />}
      </Button>

      <div className="min-w-0 flex-1 space-y-2">
        <div className={cn("flex items-center justify-between gap-2 text-[11px] font-medium leading-none", meta)}>
          <span className="truncate uppercase tracking-wide">{headline}</span>
          <span className="shrink-0 tabular-nums opacity-90" aria-live="polite">
            {formatPlayTime(current)} / {duration > 0 ? formatPlayTime(duration) : "—:—"}
          </span>
        </div>

        <div
          role="slider"
          tabIndex={0}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration) || 0}
          aria-valuenow={Math.round(current)}
          aria-label="Playback position"
          className={cn(
            "group relative h-2 cursor-pointer rounded-full outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-background",
            trackBg
          )}
          onClick={seekFromEvent}
          onKeyDown={(ev) => {
            const el = audioRef.current;
            if (!el || !duration) return;
            if (ev.key === "ArrowLeft") {
              ev.preventDefault();
              el.currentTime = Math.max(0, el.currentTime - 5);
            } else if (ev.key === "ArrowRight") {
              ev.preventDefault();
              el.currentTime = Math.min(duration, el.currentTime + 5);
            }
          }}
        >
          <div
            className={cn("pointer-events-none absolute left-0 top-0 h-full rounded-full transition-[width] duration-150", trackFill)}
            style={{ width: `${pct}%` }}
          />
        </div>

        {fileSizeBytes && fileSizeBytes > 0 ? (
          <p className={cn("text-[10px] font-medium opacity-70", meta)}>{formatChatFileSize(fileSizeBytes)}</p>
        ) : null}
      </div>
    </div>
  );
}

/** Subtle recording presence indicator (clinical — not red “live danger” framing). */
export function VoiceRecordingPresenceStrip({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex h-6 items-center gap-2 rounded-lg border border-primary/25 bg-primary/10 px-2.5", className)}
      aria-hidden
    >
      <div className="flex h-4 items-end justify-center gap-0.5">
        <span className="inline-block h-3 w-[3px] origin-bottom animate-voice-bar rounded-full bg-primary/65 [animation-delay:0ms]" />
        <span className="inline-block h-4 w-[3px] origin-bottom animate-voice-bar rounded-full bg-primary/50 [animation-delay:120ms]" />
        <span className="inline-block h-3 w-[3px] origin-bottom animate-voice-bar rounded-full bg-primary/60 [animation-delay:240ms]" />
      </div>
    </div>
  );
}
