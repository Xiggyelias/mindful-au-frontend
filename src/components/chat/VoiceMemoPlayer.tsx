import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pause,
  Play,
  AlertTriangle,
  Loader2,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type VoiceMemoBubbleRole = "outgoing" | "incoming";

function formatPlayTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const NUM_BARS = 40;

/**
 * Deterministic static waveform used when audio is not playing.
 * Combines harmonics for a natural voice-like shape.
 */
function buildWaveformBars(seed: string): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const phase = (h % 100) * 0.0628;
  return Array.from({ length: NUM_BARS }, (_, i) => {
    const v =
      0.18 +
      0.34 * Math.abs(Math.sin(i * 0.68 + phase)) +
      0.22 * Math.abs(Math.sin(i * 1.37 + 0.9)) +
      0.14 * Math.abs(Math.sin(i * 2.5 + phase * 0.4)) +
      0.06 * Math.abs(Math.sin(i * 4.1));
    return Math.min(1, Math.max(0.08, v));
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
  /** True while the authenticated audio blob is being fetched (distinct from uploading). */
  isLoadingAudio?: boolean;
  uploadProgress?: number;
  uploadFailed?: boolean;
  /** Audio no longer exists on the server (404/410) — retrying cannot help. */
  unavailable?: boolean;
  /** True while a delete request is in-flight. */
  isDeleting?: boolean;
  onRetry?: () => void | Promise<void>;
  onDelete?: () => void;
  /** Fired when the <audio> element fails to load its current source. */
  onSourceError?: () => void;
}

export function VoiceMemoPlayer({
  src,
  mimeType: _mimeType,
  headline: _headline,
  fileSizeBytes: _fileSizeBytes,
  bubbleRole,
  className,
  isUploading = false,
  isLoadingAudio = false,
  uploadProgress: _uploadProgress = 0,
  uploadFailed = false,
  unavailable = false,
  isDeleting = false,
  onRetry,
  onDelete,
  onSourceError,
}: VoiceMemoPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [preloadMode, setPreloadMode] = useState<"metadata" | "none">("metadata");
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const seekBarRef = useRef<HTMLDivElement>(null);
  // Chrome's MediaRecorder writes WebM without a duration header, so
  // el.duration is Infinity until we force-seek to the end once per src.
  const durationProbeRef = useRef<"idle" | "probing" | "done">("idle");
  // When the user taps play but src is empty (blob not yet fetched), we set
  // this flag so that once the src arrives the player auto-plays without
  // requiring a second tap.
  const pendingPlayRef = useRef(false);

  // Web Audio API for live frequency visualisation during playback
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  // Live bar heights while playing (null → show static waveform)
  const [liveBarHeights, setLiveBarHeights] = useState<number[] | null>(null);

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

  // ── Level loop ──────────────────────────────────────────────────────────────

  const stopLevelLoop = useCallback(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setLiveBarHeights(null);
  }, []);

  const startLevelLoop = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      if (!analyserRef.current) return;
      analyserRef.current.getByteFrequencyData(dataArray);

      // Focus on the vocal / instrument range: use the first 75% of bins.
      // This avoids the nearly-silent ultra-high bins drowning out the shape.
      const usableBins = Math.floor(dataArray.length * 0.75);
      const step = usableBins / NUM_BARS;
      const levels: number[] = [];
      for (let i = 0; i < NUM_BARS; i++) {
        const lo = Math.floor(i * step);
        const hi = Math.max(lo + 1, Math.floor((i + 1) * step));
        let sum = 0;
        for (let j = lo; j < hi; j++) sum += dataArray[j] ?? 0;
        // Normalise 0-255 range → 0-1, keep a visible minimum
        levels.push(Math.max(0.06, Math.min(1, sum / ((hi - lo) * 220))));
      }
      setLiveBarHeights(levels);
      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
  }, []);

  /**
   * Lazily create the AudioContext + AnalyserNode wired to the <audio> element.
   * Must be called from a user-gesture handler (click) to satisfy autoplay policy.
   * Safe to call repeatedly — skips creation if already wired.
   */
  const setupAnalyser = useCallback(() => {
    // Disable Web Audio API wireup during playback to prevent cross-origin CORS silences,
    // reduce CPU usage, and ensure a highly stable progress-split static waveform.
    return;
  }, []);

  // Teardown analyser when src changes or on unmount
  const teardownAnalyser = useCallback(() => {
    stopLevelLoop();
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.disconnect(); } catch { /* ignore */ }
      sourceNodeRef.current = null;
    }
    if (analyserRef.current) {
      try { analyserRef.current.disconnect(); } catch { /* ignore */ }
      analyserRef.current = null;
    }
    if (audioCtxRef.current) {
      try { void audioCtxRef.current.close(); } catch { /* ignore */ }
      audioCtxRef.current = null;
    }
  }, [stopLevelLoop]);

  // Reset everything when the audio source changes
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
    setPlaybackError(null);
    durationProbeRef.current = "idle";
    // Tear down Web Audio so it's re-created on next play (new src = new stream)
    teardownAnalyser();

    // If the user previously tapped play while src was empty (async blob
    // fetch), auto-play now that the source has arrived.
    if (pendingPlayRef.current && src.trim()) {
      pendingPlayRef.current = false;
      // Small delay lets the <audio> element pick up the new src attribute
      // before we call play().  Without this the element may still reference
      // the old (empty) source.
      const timer = window.setTimeout(() => {
        if (!el.paused) return; // already playing
        el.play()
          .then(() => {
            setPlaying(true);
          })
          .catch(() => {
            setPlaying(false);
            setPlaybackError("Could not play audio");
          });
      }, 80);
      return () => window.clearTimeout(timer);
    }
  }, [src, teardownAnalyser]);

  // Unmount cleanup
  useEffect(() => () => { teardownAnalyser(); }, [teardownAnalyser]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onTime = () => {
      if (!isDragging && durationProbeRef.current !== "probing") {
        setCurrent(el.currentTime);
      }
    };

    const onDur = () => {
      const d = el.duration;
      if (Number.isFinite(d) && d > 0) {
        setDuration(d);
      } else if (d === Infinity && durationProbeRef.current === "idle" && !playing) {
        // Force the browser to compute the real duration by seeking to the
        // end; onSeeked rewinds to 0 once durationchange delivers it.
        durationProbeRef.current = "probing";
        try {
          el.currentTime = 1e7;
        } catch {
          durationProbeRef.current = "done";
        }
      }
    };

    const onSeeked = () => {
      if (durationProbeRef.current !== "probing") return;
      durationProbeRef.current = "done";
      const d = el.duration;
      if (Number.isFinite(d) && d > 0) {
        setDuration(d);
      }
      el.currentTime = 0;
      setCurrent(0);
    };

    const onEnd = () => {
      if (durationProbeRef.current === "probing") return;
      setPlaying(false);
      setCurrent(0);
      el.currentTime = 0;
      stopLevelLoop();
    };
    const onAudioError = () => {
      if (!el.src || el.src === window.location.href) {
        // Empty src — not a real error, just no audio yet
        return;
      }
      setPlaying(false);
      stopLevelLoop();
      setPlaybackError("Audio unavailable");
      // Let the parent swap in an authenticated stream URL (or mark the
      // note permanently unavailable) instead of waiting for a manual retry.
      onSourceError?.();
    };

    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onDur);
    el.addEventListener("durationchange", onDur);
    el.addEventListener("seeked", onSeeked);
    el.addEventListener("ended", onEnd);
    el.addEventListener("error", onAudioError);

    // If the audio metadata is already loaded (cached/local blob), set duration immediately
    if (Number.isFinite(el.duration) && el.duration > 0) {
      setDuration(el.duration);
    } else if (el.duration === Infinity && el.readyState >= 1) {
      // Metadata loaded before this effect ran — run the duration probe now.
      onDur();
    } else if (el.src && el.src !== window.location.href) {
      // Force load to override browser lazy-loading optimizations on hidden media elements.
      // Skip when src is empty — that would trigger a spurious error event.
      try {
        el.load();
      } catch {
        // ignore
      }
    }

    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onDur);
      el.removeEventListener("durationchange", onDur);
      el.removeEventListener("seeked", onSeeked);
      el.removeEventListener("ended", onEnd);
      el.removeEventListener("error", onAudioError);
    };
  }, [src, isDragging, stopLevelLoop, playing, onSourceError]);

  const togglePlay = useCallback(async () => {
    const el = audioRef.current;
    if (!el || isUploading || uploadFailed) return;
    if (!src.trim()) {
      if (onRetry) {
        setPlaybackError(null);
        // Remember that the user wants to play — once the async fetch
        // delivers a blob URL and the src prop updates, the reset
        // useEffect will auto-play.
        pendingPlayRef.current = true;
        await onRetry();
        return;
      }
      setPlaybackError("Audio unavailable");
      return;
    }
    if (playing) {
      el.pause();
      setPlaying(false);
      stopLevelLoop();
      return;
    }
    // If previously failed, retry the blob fetch before attempting play.
    if (playbackError && onRetry) {
      await onRetry();
      return;
    }
    setPlaybackError(null);
    // Wire up analyser on first play (requires user gesture)
    setupAnalyser();
    // Resume suspended AudioContext (browser autoplay policy)
    if (audioCtxRef.current?.state === "suspended") {
      try { await audioCtxRef.current.resume(); } catch { /* ignore */ }
    }
    try {
      await el.play();
      setPlaying(true);
      startLevelLoop();
    } catch {
      setPlaying(false);
      stopLevelLoop();
      setPlaybackError("Could not play audio");
    }
  }, [playing, isUploading, uploadFailed, playbackError, onRetry, setupAnalyser, src, startLevelLoop, stopLevelLoop]);

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
    const steps = [1, 1.5, 2];
    const next = steps[(steps.indexOf(speed) + 1) % steps.length] ?? 1;
    el.playbackRate = next;
    setSpeed(next);
  }, [speed]);

  const pct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;
  const isOutgoing = bubbleRole === "outgoing";
  // Static waveform used when idle or when Web Audio isn't available
  const staticBars = useMemo(() => buildWaveformBars(src), [src]);
  // Bars actually rendered: live data while playing, static otherwise
  const displayBars = (playing && liveBarHeights) ? liveBarHeights : staticBars;

  // ── Colour tokens ───────────────────────────────────────────────────────────
  const playBtnCls = isOutgoing
    ? "bg-primary-foreground/20 text-primary-foreground border-primary-foreground/25 hover:bg-primary-foreground/30"
    : "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20";
  const barPlayed  = isOutgoing ? "bg-primary-foreground"      : "bg-primary";
  const barUnplayed = isOutgoing ? "bg-primary-foreground/30"  : "bg-foreground/20";
  const timeCls   = isOutgoing ? "text-primary-foreground/80"  : "text-muted-foreground";
  const speedCls  = isOutgoing
    ? "text-primary-foreground/70 hover:bg-primary-foreground/15 hover:text-primary-foreground"
    : "text-muted-foreground hover:bg-muted hover:text-foreground";

  // ── Permanently unavailable (file deleted/lost on server) ─────────────────
  if (unavailable) {
    return (
      <div className={cn(
        "flex w-[min(100%,18rem)] items-center gap-3 rounded-2xl border border-dashed px-3.5 py-3",
        isOutgoing ? "border-primary-foreground/30 bg-primary/80" : "border-border/60 bg-muted/30",
        className
      )}>
        <div className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border",
          isOutgoing
            ? "border-primary-foreground/25 bg-primary-foreground/10 text-primary-foreground/70"
            : "border-border/60 bg-muted/50 text-muted-foreground"
        )}>
          <AlertTriangle className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn(
            "text-[12px] font-semibold leading-tight",
            isOutgoing ? "text-primary-foreground" : "text-foreground"
          )}>
            Voice note unavailable
          </p>
          <p className={cn("mt-0.5 text-[11px] leading-tight", timeCls)}>
            This recording is no longer stored on the server.
          </p>
        </div>
      </div>
    );
  }

  // ── Failed state ──────────────────────────────────────────────────────────
  if (uploadFailed) {
    return (
      <div className={cn(
        "flex w-[min(100%,18rem)] items-center gap-3 rounded-2xl border px-3.5 py-3",
        isOutgoing
          ? "border-destructive/25 bg-destructive/8"
          : "border-destructive/18 bg-destructive/[0.04]",
        className
      )}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-destructive/25 bg-destructive/10 text-destructive">
          <AlertTriangle className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold text-destructive leading-tight">Failed to send</p>
          <p className="text-[11px] leading-tight mt-0.5 text-destructive/70">Voice note not delivered</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onRetry && (
            <Button type="button" variant="outline" size="sm"
              className="h-8 gap-1.5 px-2.5 text-[11px] font-bold text-destructive border-destructive/30 hover:bg-destructive/8 hover:text-destructive"
              onClick={onRetry}>
              <RotateCcw className="h-3 w-3" />Retry
            </Button>
          )}
          {onDelete && (
            <Button type="button" variant="ghost" size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={onDelete} aria-label="Delete failed voice note">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ── Loading / Uploading state ──────────────────────────────────────────────
  if (isUploading || isLoadingAudio) {
    return (
      <div className={cn(
        "flex w-[min(100%,18rem)] items-center gap-3 rounded-2xl px-3.5 py-2.5",
        isOutgoing ? "bg-primary text-primary-foreground" : "border border-border/50 bg-muted/30",
        className
      )}>
        {/* Spinner in place of play button */}
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full border", playBtnCls)}>
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>

        {/* Waveform + "Sending…" label — no progress bar */}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex h-8 items-end gap-[2px]" aria-hidden>
            {staticBars.map((h, i) => (
              <div
                key={i}
                className={cn("rounded-full animate-voice-bar", barPlayed)}
                style={{
                  width: "2.5px",
                  height: `${Math.round(h * 100)}%`,
                  animationDelay: `${(i * 28) % 800}ms`,
                  opacity: 0.22 + 0.42 * h,
                }}
              />
            ))}
          </div>
          <span className={cn("block text-[11px] font-medium leading-none", timeCls)}>
            {isLoadingAudio ? "Loading…" : "Sending…"}
          </span>
        </div>
      </div>
    );
  }

  // ── Normal playback ───────────────────────────────────────────────────────
  return (
    <div className={cn(
      "group flex w-[min(100%,18rem)] items-center gap-3 rounded-2xl px-3.5 py-2.5",
      isOutgoing ? "bg-primary text-primary-foreground" : "border border-border/50 bg-muted/30",
      "shadow-sm animate-voice-bubble-in",
      className
    )}>
      <audio
        ref={audioRef}
        src={src}
        preload={preloadMode === "none" ? "none" : "auto"}
        playsInline
        style={{
          position: "absolute",
          opacity: 0,
          pointerEvents: "none",
          width: "1px",
          height: "1px",
          zIndex: -1,
        }}
      />

      {/* Play / Pause */}
      <Button
        type="button" variant="outline" size="icon"
        aria-pressed={playing}
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        className={cn("h-10 w-10 shrink-0 rounded-full border shadow-none transition-transform duration-150 active:scale-95", playBtnCls)}
        onClick={() => void togglePlay()}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
      </Button>

      {/* Waveform + time */}
      <div className="min-w-0 flex-1 space-y-1">

        {/* Seekable waveform */}
        <div
          ref={seekBarRef}
          role="slider" tabIndex={0}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration) || 0}
          aria-valuenow={Math.round(current)}
          aria-label="Playback position"
          className="flex h-8 cursor-pointer touch-none select-none items-end gap-[2px] outline-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onKeyDown={(ev) => {
            const el = audioRef.current;
            if (!el || !duration) return;
            if (ev.key === "ArrowLeft") { ev.preventDefault(); el.currentTime = Math.max(0, el.currentTime - 3); }
            else if (ev.key === "ArrowRight") { ev.preventDefault(); el.currentTime = Math.min(duration, el.currentTime + 3); }
          }}
        >
          {displayBars.map((h, i) => {
            const barPct = ((i + 1) / NUM_BARS) * 100;
            const played = barPct <= pct;
            // Always use static waveform with progress-split to avoid CORS blank-out bugs
            const useLive = false;

            return (
              <div
                key={i}
                className={cn(
                  "rounded-full",
                  useLive
                    ? barPlayed                          // all bars coloured while live
                    : played ? barPlayed : barUnplayed   // progress split when static
                )}
                style={{
                  width: "2.5px",
                  height: `${Math.round(h * 100)}%`,
                  // Smooth live updates; instant for seek scrubbing
                  transition: useLive ? "height 55ms ease-out" : "height 75ms ease-out",
                  opacity: useLive
                    ? 0.4 + 0.6 * h                     // louder = more opaque
                    : played ? 0.9 : 0.35,
                  flexShrink: 0,
                }}
              />
            );
          })}
        </div>

        {/* Time + speed + optional delete */}
        <div className="flex items-center justify-between gap-1">
          {playbackError ? (
            <span className={cn("inline-flex min-w-0 items-center gap-1 truncate text-[11px] font-semibold leading-none", isOutgoing ? "text-primary-foreground/90" : "text-destructive")}>
              <AlertTriangle className="h-3 w-3 shrink-0" />
              {playbackError}
              {onRetry && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onRetry(); }}
                  className={cn("ml-1 underline underline-offset-2 text-[10px]", isOutgoing ? "text-primary-foreground/70" : "text-destructive/70")}
                >
                  Retry
                </button>
              )}
            </span>
          ) : (
            <span className={cn("text-[11px] tabular-nums font-medium leading-none", timeCls)}>
              {playing || current > 0
                ? formatPlayTime(current)
                : duration > 0 ? formatPlayTime(duration) : "—:——"}
            </span>
          )}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={cycleSpeed}
              aria-label={`Playback speed ${speed}×, tap to change`}
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums transition-colors duration-150",
                speedCls
              )}
            >
              {speed === 1 ? "1×" : `${speed}×`}
            </button>
            {onDelete && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  "h-6 w-6 shrink-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-150",
                  isOutgoing
                    ? "text-primary-foreground/70 hover:bg-primary-foreground/15 hover:text-primary-foreground"
                    : "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                )}
                onClick={onDelete}
                disabled={isDeleting}
                aria-label={isDeleting ? "Deleting voice note" : "Delete voice note"}
              >
                {isDeleting
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <Trash2 className="h-3 w-3" />}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Recording presence strip ──────────────────────────────────────────────────

interface VoiceRecordingPresenceStripProps {
  className?: string;
  audioLevels?: number[];
}

export function VoiceRecordingPresenceStrip({ className, audioLevels }: VoiceRecordingPresenceStripProps) {
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
        ? bars.slice(0, 20).map((level, i) => (
            <span key={i} className="inline-block w-[3px] origin-bottom rounded-full bg-primary/70"
              style={{ height: `${Math.round(Math.max(8, level * 100))}%`, transition: "height 60ms ease-out", opacity: 0.5 + 0.5 * level }} />
          ))
        : [0, 120, 240, 120, 0].map((delay, i) => (
            <span key={i}
              className={cn("inline-block w-[3px] origin-bottom animate-voice-bar rounded-full", i === 2 ? "bg-primary/60 h-full" : "bg-primary/50 h-4/5")}
              style={{ animationDelay: `${delay}ms` }} />
          ))}
    </div>
  );
}
