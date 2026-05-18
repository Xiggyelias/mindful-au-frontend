import React, { useRef, useState } from "react";
import {
  Send,
  Paperclip,
  Mic,
  Smile,
  X,
  Pause,
  Play,
  Lock,
  Loader2,
  Trash2,
  ImageIcon,
  FileText,
  ChevronUp,
  ChevronLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CHAT_ATTACHMENT_ACCEPT } from "@/lib/chatAttachments";
import { LazyEmojiPicker } from "@/components/chat/LazyEmojiPicker";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  message: string;
  isSending: boolean;
  isUploading: boolean;
  uploadProgress: number;
  isVoiceMode: boolean;
  recording: { blob: File; url: string } | null;
  recordingTime: number;
  isPaused: boolean;
  selectedFile: File | null;
  /** Live normalised bar heights (0–1) from Web Audio API. */
  audioLevels?: number[];
  onMessageChange: (val: string) => void;
  onTypingChange?: (isTyping: boolean) => void;
  onSubmit: (e: React.FormEvent) => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onAttachClick: () => void;
  /** Called when hold starts — should call startRecording() */
  onVoiceStart: () => Promise<void>;
  /** Called when hold is released without lock — stops recording and sends */
  onVoiceStopAndSend: () => Promise<void>;
  /** Called when locked-mode Send button is pressed */
  onVoiceSendNow?: () => Promise<void> | void;
  onVoicePause: () => void;
  onVoiceResume: () => void;
  onVoiceCancel: () => void;
  onRemoveFile: () => void;
  onEmojiClick: (emojiData: { emoji: string }) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
}

type MicGestureState = "idle" | "recording" | "cancelling" | "locked";

const NUM_BARS = 28;

function formatRecordingTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Deterministic idle bar heights so the waveform area never looks empty. */
const IDLE_BARS = Array.from({ length: NUM_BARS }, (_, i) =>
  Math.max(0.1, 0.18 + 0.12 * Math.abs(Math.sin(i * 0.72)))
);

export const ChatInput: React.FC<ChatInputProps> = React.memo(
  ({
    message,
    isSending,
    isUploading,
    uploadProgress,
    isVoiceMode,
    recording,
    recordingTime,
    isPaused,
    selectedFile,
    audioLevels,
    onMessageChange,
    onTypingChange,
    onSubmit,
    onFileSelect,
    onAttachClick,
    onVoiceStart,
    onVoiceStopAndSend,
    onVoiceSendNow,
    onVoicePause,
    onVoiceResume,
    onVoiceCancel,
    onRemoveFile,
    onEmojiClick,
    fileInputRef,
  }) => {
    const [micState, setMicState] = useState<MicGestureState>("idle");
    const holdStartYRef = useRef<number | null>(null);
    const holdStartXRef = useRef<number | null>(null);
    const holdPointerIdRef = useRef<number | null>(null);

    const LOCK_UP_PX = 60;
    const CANCEL_LEFT_PX = 60;

    // The bars to render: live levels while recording, else idle fallback
    const displayBars: number[] =
      audioLevels && audioLevels.length >= NUM_BARS
        ? audioLevels.slice(0, NUM_BARS)
        : IDLE_BARS;

    const handleMicPointerDown = async (e: React.PointerEvent<HTMLButtonElement>) => {
      if (isSending || micState === "locked") return;
      holdPointerIdRef.current = e.pointerId;
      holdStartYRef.current = e.clientY;
      holdStartXRef.current = e.clientX;
      e.currentTarget.setPointerCapture(e.pointerId);
      setMicState("recording");
      try {
        await onVoiceStart();
      } catch {
        setMicState("idle");
      }
    };

    const handleMicPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
      if (micState === "locked" || holdStartYRef.current == null || holdStartXRef.current == null) return;
      const dy = holdStartYRef.current - e.clientY;
      const dx = holdStartXRef.current - e.clientX;
      if (dy >= LOCK_UP_PX) { setMicState("locked"); return; }
      if (dx >= CANCEL_LEFT_PX && micState === "recording") setMicState("cancelling");
      else if (dx < CANCEL_LEFT_PX && micState === "cancelling") setMicState("recording");
    };

    const handleMicPointerUp = async (e: React.PointerEvent<HTMLButtonElement>) => {
      if (holdPointerIdRef.current !== e.pointerId) return;
      holdPointerIdRef.current = null;
      if (micState === "locked") return;
      if (micState === "cancelling") {
        onVoiceCancel();
        setMicState("idle");
      } else if (micState === "recording") {
        setMicState("idle");
        await onVoiceStopAndSend();
      } else {
        setMicState("idle");
      }
      holdStartYRef.current = null;
      holdStartXRef.current = null;
    };

    const handleLockedSend = async () => {
      setMicState("idle");
      await Promise.resolve(onVoiceSendNow?.());
    };

    const handleLockedCancel = () => {
      onVoiceCancel();
      setMicState("idle");
    };

    const isLocked = micState === "locked";
    const isCancelling = micState === "cancelling";
    const isActiveRecording = micState === "recording" || isLocked;

    return (
      <div className="border-t border-border/50 bg-gradient-to-b from-background/60 to-background/95 px-3 py-3 sm:px-4 backdrop-blur-xl">
        <form onSubmit={onSubmit} className="space-y-3">

          {/* ── File upload progress bar ─────────────────────────────────── */}
          {isUploading && !isActiveRecording && (
            <div className="space-y-1.5 animate-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Uploading…
                </span>
                <span className="tabular-nums">{uploadProgress}%</span>
              </div>
              <Progress value={uploadProgress} className="h-1" />
            </div>
          )}

          {/* ── File attachment preview ───────────────────────────────────── */}
          {selectedFile && (
            <div className="flex items-center gap-3 rounded-2xl border border-primary/10 bg-secondary/25 p-3 animate-in zoom-in-95 duration-300">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-primary">
                {selectedFile.type.startsWith("image/")
                  ? <ImageIcon className="h-5 w-5" />
                  : <FileText className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium leading-tight">{selectedFile.name}</p>
                <p className="text-[10px] font-semibold uppercase tracking-wide opacity-50 mt-0.5">
                  Ready to attach
                </p>
              </div>
              {!isUploading && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 rounded-full text-muted-foreground hover:text-destructive"
                  onClick={onRemoveFile}
                  aria-label="Remove selected file"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}

          {/* ── Main input row ────────────────────────────────────────────── */}
          <div className="flex items-end gap-2 sm:gap-2.5">

            {/* Input / recording area */}
            <div
              className={cn(
                "relative flex flex-1 overflow-hidden rounded-[1.75rem] border bg-white/90 shadow-md shadow-slate-200/50 backdrop-blur-md transition-all duration-300 dark:bg-slate-900/80 dark:border-slate-700/50 dark:shadow-none",
                isActiveRecording
                  ? [
                      "min-h-[5.5rem] items-stretch py-2.5",
                      isCancelling
                        ? "border-destructive/40 bg-red-50/80 dark:bg-red-950/20 ring-2 ring-destructive/20"
                        : isLocked
                        ? "border-primary/30 bg-emerald-50/60 dark:bg-emerald-950/15 ring-2 ring-primary/15"
                        : "border-primary/25 bg-white/95 ring-2 ring-primary/12 dark:bg-slate-900/90",
                    ].join(" ")
                  : "items-center border-slate-200/70 focus-within:border-primary/30 focus-within:ring-2 focus-within:ring-primary/10"
              )}
            >
              {isActiveRecording ? (
                /* ── Recording overlay ─────────────────────────────────── */
                <div className="flex w-full flex-col gap-2 px-4">
                  {/* Top row: status + timer */}
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                        isCancelling
                          ? "bg-destructive/15 text-destructive"
                          : isLocked
                          ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400"
                          : "bg-primary/10 text-primary"
                      )}
                    >
                      {isCancelling
                        ? <X className="h-3 w-3" />
                        : isLocked
                        ? <Lock className="h-2.5 w-2.5" />
                        : <Mic className="h-2.5 w-2.5" />}
                    </div>
                    <span
                      className={cn(
                        "flex-1 text-[11px] font-semibold uppercase tracking-wide",
                        isCancelling
                          ? "text-destructive"
                          : isLocked
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-muted-foreground"
                      )}
                    >
                      {isCancelling
                        ? "Release to cancel"
                        : isLocked
                        ? "Hands-free — recording"
                        : "Hold · swipe ↑ lock · ← cancel"}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-sm tabular-nums font-semibold",
                        isCancelling ? "text-destructive/80" : "text-foreground"
                      )}
                    >
                      {formatRecordingTime(recordingTime)}
                    </span>
                  </div>

                  {/* Live waveform bars */}
                  <div
                    className="flex h-9 items-end gap-[2.5px]"
                    aria-hidden
                  >
                    {displayBars.map((level, i) => (
                      <div
                        key={i}
                        className={cn(
                          "w-[3px] rounded-full origin-bottom",
                          isCancelling
                            ? "bg-destructive/50"
                            : isLocked
                            ? "bg-emerald-500/70"
                            : "bg-primary/65"
                        )}
                        style={{
                          height: `${Math.round(Math.max(8, level * 100))}%`,
                          transition: "height 60ms ease-out",
                          opacity: isCancelling
                            ? 0.4 + 0.4 * (1 - i / NUM_BARS)
                            : 0.45 + 0.55 * level,
                        }}
                      />
                    ))}
                  </div>

                  {/* Progress track */}
                  <div
                    className={cn(
                      "h-0.5 w-full rounded-full overflow-hidden",
                      isCancelling ? "bg-destructive/15" : "bg-primary/12"
                    )}
                  >
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width] duration-300",
                        isCancelling ? "bg-destructive/40" : "bg-primary/35"
                      )}
                      style={{ width: isCancelling ? "100%" : "50%" }}
                    />
                  </div>

                  {/* Locked mode controls */}
                  {isLocked && (
                    <div className="flex items-center gap-1.5 pt-0.5 animate-in slide-in-from-bottom-1 duration-200">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1 rounded-xl px-2.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted/60"
                        onClick={isPaused ? onVoiceResume : onVoicePause}
                        aria-label={isPaused ? "Resume recording" : "Pause recording"}
                      >
                        {isPaused
                          ? <><Play className="h-3.5 w-3.5" /> Resume</>
                          : <><Pause className="h-3.5 w-3.5" /> Pause</>}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1 rounded-xl px-2.5 text-[11px] font-semibold text-muted-foreground hover:bg-destructive/8 hover:text-destructive"
                        onClick={handleLockedCancel}
                        aria-label="Discard voice recording"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Discard
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="ml-auto h-8 gap-1.5 rounded-xl border-primary/25 bg-primary/5 px-3 text-[11px] font-bold text-primary hover:bg-primary/12 hover:text-primary"
                        onClick={() => void handleLockedSend()}
                        aria-label="Send voice note now"
                      >
                        <Send className="h-3.5 w-3.5" />
                        Send now
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                /* ── Normal text input ──────────────────────────────────── */
                <>
                  <div className="flex items-center pl-1">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 shrink-0 rounded-full text-muted-foreground/70 hover:text-primary hover:bg-primary/8"
                          aria-label="Open emoji picker"
                        >
                          <Smile className="h-5 w-5" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        side="top"
                        align="start"
                        className="p-0 border-none bg-transparent shadow-none"
                      >
                        <LazyEmojiPicker onEmojiClick={onEmojiClick} />
                      </PopoverContent>
                    </Popover>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 rounded-full text-muted-foreground/70 hover:text-primary hover:bg-primary/8"
                      onClick={onAttachClick}
                      aria-label="Attach a file"
                    >
                      <Paperclip className="h-5 w-5" />
                    </Button>
                    <input
                      type="file"
                      ref={fileInputRef}
                      className="hidden"
                      accept={CHAT_ATTACHMENT_ACCEPT}
                      onChange={onFileSelect}
                    />
                  </div>
                  <Input
                    value={message}
                    onChange={(e) => {
                      const v = e.target.value;
                      onMessageChange(v);
                      onTypingChange?.(v.trim().length > 0);
                    }}
                    onBlur={() => onTypingChange?.(false)}
                    placeholder="Write a message…"
                    className="h-11 flex-1 border-none bg-transparent px-2 text-[15px] focus-visible:ring-0 placeholder:text-muted-foreground/50"
                    disabled={isSending}
                  />
                </>
              )}
            </div>

            {/* ── Right-side buttons ─────────────────────────────────────── */}
            <div className="flex shrink-0 items-center gap-2 self-end pb-0.5">

              {/* Gesture hint overlay (appears above mic while holding) */}
              {micState === "recording" && (
                <div className="pointer-events-none absolute right-[4rem] bottom-20 z-50 flex flex-col items-center gap-2 animate-in fade-in zoom-in-95 duration-300">
                  <div className="flex items-center gap-1.5 rounded-full bg-slate-900/85 px-3 py-1.5 text-[10px] font-bold text-white shadow-xl backdrop-blur-md">
                    <ChevronUp className="h-3 w-3 animate-slide-up-hint" />
                    <span>Lock</span>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-full bg-slate-900/85 px-3 py-1.5 text-[10px] font-bold text-white shadow-xl backdrop-blur-md">
                    <ChevronLeft className="h-3 w-3 animate-slide-left-hint" />
                    <span>Cancel</span>
                  </div>
                </div>
              )}

              {/* Mic button */}
              <div className="relative">
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className={cn(
                    "h-12 w-12 shrink-0 select-none rounded-full shadow-sm transition-all duration-200 motion-reduce:transition-none",
                    micState === "recording"
                      && "scale-110 bg-primary text-primary-foreground shadow-lg shadow-primary/30 ring-4 ring-primary/20",
                    micState === "locked"
                      && "bg-primary text-primary-foreground shadow-md ring-4 ring-primary/15",
                    micState === "cancelling"
                      && "scale-95 bg-destructive text-destructive-foreground ring-4 ring-destructive/25",
                    micState === "idle"
                      && "bg-white/95 text-muted-foreground hover:-translate-y-0.5 hover:bg-primary/8 hover:text-primary hover:shadow-md dark:bg-slate-800/90 dark:hover:bg-primary/12"
                  )}
                  onPointerDown={(e) => void handleMicPointerDown(e)}
                  onPointerMove={handleMicPointerMove}
                  onPointerUp={(e) => void handleMicPointerUp(e)}
                  disabled={isSending}
                  aria-label={
                    isLocked
                      ? "Recording locked — use controls above"
                      : micState === "recording"
                      ? "Recording — release to send, swipe ↑ to lock, ← to cancel"
                      : "Hold to record a voice note"
                  }
                >
                  {isCancelling
                    ? <X className="h-5 w-5" />
                    : <Mic className={cn("h-5 w-5 transition-transform duration-150", micState === "recording" && "scale-110")} />}
                </Button>

                {/* Expanding ring during active recording */}
                {micState === "recording" && (
                  <span
                    className="pointer-events-none absolute inset-0 rounded-full animate-mic-ring bg-primary/30"
                    aria-hidden
                  />
                )}

                {/* Lock badge pop */}
                {isLocked && (
                  <div className="pointer-events-none absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 shadow-md animate-lock-pop">
                    <Lock className="h-2.5 w-2.5 text-white" />
                  </div>
                )}
              </div>

              {/* Send button */}
              <Button
                type="submit"
                size="icon"
                className={cn(
                  "h-12 w-12 shrink-0 rounded-full shadow-lg transition-transform duration-150 active:scale-95 motion-reduce:transition-none",
                  "bg-gradient-to-br from-primary to-primary/85 text-primary-foreground",
                  "shadow-primary/25 hover:-translate-y-0.5 hover:shadow-primary/35",
                  "disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0 disabled:shadow-none"
                )}
                disabled={
                  (!message.trim() && !selectedFile && !recording) ||
                  isSending ||
                  isActiveRecording
                }
                aria-label={isSending ? "Sending…" : "Send message"}
              >
                {isSending
                  ? <Loader2 className="h-5 w-5 animate-spin" />
                  : <Send className="h-5 w-5" />}
              </Button>
            </div>
          </div>
        </form>
      </div>
    );
  }
);

ChatInput.displayName = "ChatInput";
