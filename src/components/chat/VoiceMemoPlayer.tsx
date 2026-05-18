import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pause,
  Play,
  RotateCcw,
  AlertTriangle,
  Loader2,
  Trash2,
  Download,
} from "lucide-react";
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

const NUM_BARS = 36;

/**
 * Generate deterministic waveform bar heights from a seed string.
 * Combines multiple sine harmonics for a natural-sounding profile.
 */
function buildWaveformBars(seed: string): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const phase = (h % 100) * 0.0628;
  return Array.from({ length: NUM_BARS }, (_, i) => {
    const v =
      0.22 +
      0.32 * Math.abs(Math.sin(i * 0.68 + phase)) +
      0.22 * Math.abs(Math.sin(i * 1.37 + 0.9)) +
      0.12 * Math.abs(Math.sin(i * 2.5 + phase * 0.4)) +
      0.06 * Math.abs(Math.sin(i * 4.1));
    return Math.min(1, Math.max(0.1, v));
  });
}

export interface VoiceMemoPlayerProps {
  src: string;
  mimeType?: string | null;
  headline: string;
  fileSizeBytes?: number;
  bubbleRole: VoiceMemoBubbleRole;
  className?: string;
  isUploading?: boolean;
  uploadProgress?: number;
  uploadFailed?: boolean;
  onRetry?: () => void;
  onDelete?: () => void;
}

export function VoiceMemoPlayer({
  src,
  mimeType: _mimeType,
  headline,
  fileSizeBytes,
  bubbleRole,
  className,
  isUploading = false,
  uploadProgress = 0,
  uploadFailed = false,
  onRetry,
  onDelete,
}: VoiceMemoPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [preloadMode, setPreloadMode] = useState<"metadata" | "none">("metadata");
  const seekBarRef = useRef<HTMLDivElement>(null);

  // Low-bandwidth detection
  useEffect(() => {
    try {
      const conn = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
      setPreloadMode(
        conn?.saveData === true || /(^|-)2g/.test(String(conn?.effectiveType ?? ""))
          ? "none"
          : "metadata"
      );
    } catch {
      setPreloadMode("metadata");
    }
  }, []);

  // Reset state on src change
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
    el.playbackRate = 1;
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    setSpeed(1);
  }, [src]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => { if (!isDragging) setCurrent(el.currentTime); };
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
  }, [src, isDragging]);

  const togglePlay = useCallback(async () => {
    const el = audioRef.current;
    if (!el || isUploading || uploadFailed) return;
    if (playing) { el.pause(); setPlaying(false); return; }
    try { await el.play(); setPlaying(true); } catch { setPlaying(false); }
  }, [playing, isUploading, uploadFailed]);

  const seekTo = useCallback((clientX: number) => {
    const el = audioRef.current;
    const bar = seekBarRef.current;
    if (!el || !bar || !Number.isFinite(duration) || duration <= 0) return;
    const rect = bar.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    const t = (x / rect.width) * duration;
    el.currentTime = t;
    setCurrent(t);
  }, [duration]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    seekTo(e.clientX);
  }, [seekTo]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    seekTo(e.clientX);
  }, [isDragging, seekTo]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setIsDragging(false);
    seekTo(e.clientX);
  }, [isDragging, seekTo]);

  const cycleSpeed = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    const steps = [0.75, 1, 1.5, 2];
    const next = steps[(steps.indexOf(speed) + 1) % steps.length] ?? 1;
    el.playbackRate = next;
    setSpeed(next);
  }, [speed]);

  const replayFromStart = useCallback(async () => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = 0;
    setCurrent(0);
    try { await el.play(); setPlaying(true); } catch { setPlaying(false); }
  }, []);

  const pct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;
  const isOutgoing = bubbleRole === "outgoing";
  const waveformBars = useMemo(() => buildWaveformBars(src), [src]);

  // ── Colour tokens ──────────────────────────────────────────────────────────
  const shell = isOutgoing
    ? "border-primary-foreground/15 bg-primary-foreground/[0.06]"
    : "border-border/50 bg-background/70 backdrop-blur-sm dark:bg-slate-900/50";
  const metaCls = isOutgoing
    ? "text-primary-foreground/70"
    : "text-muted-foreground";
  const barPlayed = isOutgoing ? "bg-primary-foreground/95" : "bg-primary";
  const barUnplayed = isOutgoing ? "bg-primary-foreground/20" : "bg-muted-foreground/25";
  const barBreathing = isOutgoing ? "bg-primary-foreground" : "bg-primary";
  const btnClass = isOutgoing
    ? "border-primary-foreground/30 bg-primary-foreground/[0.08] text-primary-foreground hover:bg-primary-foreground/18"
    : "border-border/70 bg-background/90 text-foreground hover:bg-muted/80 dark:bg-slate-800/80 dark:border-slate-700/60";
  const ghostBtnCls = isOutgoing
    ? "text-primary-foreground/80 hover:bg-primary-foreground/12"
    : "text-foreground/70 hover:bg-muted/60";

  // ── Failed state ─────────────────────────────────────────────────────────
  if (uploadFailed) {
    return (
      <div
        className={cn(
          "flex max-w-[min(100%,22rem)] items-center gap-3 rounded-2xl border px-3.5 py-3",
          isOutgoing
            ? "border-destructive/25 bg-destructive/8"
            : "border-destructive/18 bg-destructive/[0.04]",
          className
        )}
      >
        <div className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border",
          "border-destructive/25 bg-destructive/10 text-destructive"
        )}>
          <AlertTriangle className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold text-destructive leading-tight">
            Failed to send
          </p>
          <p className={cn("text-[11px] leading-tight mt-0.5", metaCls)}>
            Voice note not delivered
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onRetry && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 px-2.5 text-[11px] font-bold text-destructive border-destructive/30 hover:bg-destructive/8 hover:text-destructive"
              onClick={onRetry}
            >
              <RotateCcw className="h-3 w-3" />
              Retry
            </Button>
          )}
          {onDelete && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
              aria-label="Delete failed voice note"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ── Uploading state ───────────────────────────────────────────────────────
  if (isUploading) {
    const clampedProgress = Math.min(100, Math.max(0, uploadProgress));
    return (
      <div
        className={cn(
          "flex max-w-[min(100%,22rem)] items-center gap-3 rounded-2xl border px-3.5 py-3",
          shell,
          className
        )}
      >
        <div className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border",
          btnClass
        )}>
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>

        <div className="min-w-0 flex-1 space-y-2.5">
          <div className={cn(
            "flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider",
            metaCls
          )}>
            <span className="truncate">{headline}</span>
            <span className="shrink-0 tabular-nums ml-2">{clampedProgress}%</span>
          </div>

          {/* Animated waveform bars */}
          <div className="flex h-7 items-end gap-[2px]" aria-hidden>
            {waveformBars.map((h, i) => (
              <div
                key={i}
                className={cn("w-[3px] rounded-full animate-voice-bar", barPlayed)}
                style={{
                  height: `${Math.round(h * 100)}%`,
                  animationDelay: `${(i * 30) % 800}ms`,
                  opacity: 0.35 + 0.5 * h,
                }}
              />
            ))}
          </div>

          {/* Upload progress track */}
          <div className={cn("h-1 w-full rounded-full overflow-hidden", barUnplayed)}>
            <div
              className={cn("h-full rounded-full transition-[width] duration-300", barPlayed)}
              style={{ width: `${clampedProgress}%` }}
            />
          </div>
        </div>
      </div>
    );
  }

  // ── Normal playback state ─────────────────────────────────────────────────
  return (
    <div
      className={cn(
        "flex max-w-[min(100%,22rem)] items-center gap-3 rounded-2xl border px-3.5 py-3",
        shell,
        "shadow-sm",
        className
      )}
    >
      <audio ref={audioRef} src={src} preload={preloadMode} playsInline className="sr-only" />

      {/* Play / Pause button */}
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-pressed={playing}
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        className={cn(
          "h-10 w-10 shrink-0 rounded-full border shadow-none transition-transform duration-150 active:scale-95",
          btnClass
        )}
        onClick={() => void togglePlay()}
      >
        {playing
          ? <Pause className="h-4 w-4" />
          : <Play className="h-4 w-4 translate-x-[1px]" />}
      </Button>

      {/* Waveform + controls column */}
      <div className="min-w-0 flex-1 space-y-1.5">

        {/* ── Seekable waveform ─────────────────────────────────────────── */}
        <div
          ref={seekBarRef}
          role="slider"
          tabIndex={0}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration) || 0}
          aria-valuenow={Math.round(current)}
          aria-label="Playback position"
          className="group flex h-8 cursor-pointer touch-none select-none items-end gap-[2.5px] outline-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onKeyDown={(ev) => {
            const el = audioRef.current;
            if (!el || !duration) return;
            if (ev.key === "ArrowLeft") {
              ev.preventDefault();
              el.currentTime = Math.max(0, el.currentTime - 3);
            } else if (ev.key === "ArrowRight") {
              ev.preventDefault();
              el.currentTime = Math.min(duration, el.currentTime + 3);
            }
          }}
        >
          {waveformBars.map((h, i) => {
            const barPct = ((i + 1) / NUM_BARS) * 100;
            const played = barPct <= pct;
            // Bars within 2 positions behind the playhead get a breathing animation
            const nearCursor =
              playing &&
              barPct > pct - (2 * 100) / NUM_BARS &&
              barPct <= pct;

            return (
              <div
                key={i}
                className={cn(
                  "rounded-full transition-[height] duration-75",
                  played ? barPlayed : barUnplayed,
                  nearCursor && barBreathing,
                  nearCursor && "animate-waveform-breath"
                )}
                style={{
                  width: "3px",
                  height: nearCursor
                    ? `${Math.round(h * 112)}%`
                    : played
                    ? `${Math.round(h * 100)}%`
                    : `${Math.round(h * 100)}%`,
                  opacity: played ? (nearCursor ? 1 : 0.92) : 0.38,
                  flexShrink: 0,
                  animationDuration: nearCursor ? `${380 + (i % 3) * 80}ms` : undefined,
                }}
              />
            );
          })}
        </div>

        {/* ── Time row + controls ───────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-1">
          {/* Time display */}
          <span
            className={cn("text-[10px] tabular-nums font-semibold leading-none", metaCls)}
            aria-live="polite"
          >
            {formatPlayTime(current)}
            <span className={cn("font-normal opacity-50 mx-0.5")}>/</span>
            {duration > 0 ? formatPlayTime(duration) : "—:——"}
          </span>

          {/* Right-side controls */}
          <div className="flex items-center gap-0.5">
            {fileSizeBytes && fileSizeBytes > 0 && (
              <span className={cn("text-[10px] opacity-50 mr-0.5", metaCls)}>
                {formatChatFileSize(fileSizeBytes)}
              </span>
            )}

            {/* Replay */}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={cn("h-7 w-7 rounded-full", ghostBtnCls)}
              onClick={() => void replayFromStart()}
              aria-label="Replay from start"
            >
              <RotateCcw className="h-3 w-3" />
            </Button>

            {/* Speed */}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={cn(
                "h-7 min-w-[2.25rem] rounded-full px-1.5 text-[11px] font-bold tabular-nums",
                ghostBtnCls
              )}
              onClick={cycleSpeed}
              aria-label={`Playback speed ${speed}×, tap to change`}
            >
              {speed}×
            </Button>

            {/* Download */}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={cn("h-7 w-7 rounded-full", ghostBtnCls)}
              aria-label="Download voice note"
              onClick={() => {
                if (src) window.open(src, "_blank", "noopener,noreferrer");
              }}
            >
              <Download className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Recording presence strip ──────────────────────────────────────────────────

interface VoiceRecordingPresenceStripProps {
  className?: string;
  /** Live bar heights from Web Audio API (0–1). Falls back to animated CSS. */
  audioLevels?: number[];
}

/** Subtle live-waveform strip shown while the user is actively recording. */
export function VoiceRecordingPresenceStrip({
  className,
  audioLevels,
}: VoiceRecordingPresenceStripProps) {
  const bars = audioLevels ?? null;

  return (
    <div
      className={cn(
        "flex h-7 items-end justify-center gap-[2.5px] rounded-xl border border-primary/20 bg-primary/[0.06] px-3",
        className
      )}
      aria-hidden
    >
      {bars
        ? // Live Web Audio bars
          bars.slice(0, 20).map((level, i) => (
            <span
              key={i}
              className="inline-block w-[3px] origin-bottom rounded-full bg-primary/70"
              style={{
                height: `${Math.round(Math.max(8, level * 100))}%`,
                transition: "height 60ms ease-out",
                opacity: 0.5 + 0.5 * level,
              }}
            />
          ))
        : // CSS animated fallback
          [0, 120, 240, 120, 0].map((delay, i) => (
            <span
              key={i}
              className={cn(
                "inline-block w-[3px] origin-bottom animate-voice-bar rounded-full",
                i === 2 ? "bg-primary/60 h-full" : "bg-primary/50 h-4/5"
              )}
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
    </div>
  );
}
