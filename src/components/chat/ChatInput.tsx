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
  ChevronLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  allowAttachments?: boolean;
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
  /** Called when microphone access fails — show a user-facing error toast here. */
  onVoiceError?: (error: Error) => void;
  onRemoveFile: () => void;
  onEmojiClick: (emojiData: { emoji: string }) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
}

type MicGestureState = "idle" | "recording" | "cancelling" | "locked";

const NUM_BARS = 36;

function formatRecordingTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Deterministic idle bar heights so the waveform area never looks empty. */
const IDLE_BARS = Array.from({ length: NUM_BARS }, (_, i) =>
  Math.max(0.08, 0.15 + 0.1 * Math.abs(Math.sin(i * 0.72)))
);

export const ChatInput: React.FC<ChatInputProps> = React.memo(
  ({
    message,
    isSending,
    isUploading,
    uploadProgress: _uploadProgress,
    isVoiceMode: _isVoiceMode,
    recording: _recording,
    recordingTime,
    isPaused,
    selectedFile,
    allowAttachments = true,
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
    onVoiceError,
    onRemoveFile,
    onEmojiClick,
    fileInputRef,
  }) => {
    const [micState, setMicState] = useState<MicGestureState>("idle");
    const holdStartYRef = useRef<number | null>(null);
    const holdStartXRef = useRef<number | null>(null);
    const holdPointerIdRef = useRef<number | null>(null);
    const holdStartedAtRef = useRef<number>(0);

    const LOCK_UP_PX = 60;
    const CANCEL_LEFT_PX = 60;
    const TAP_TO_LOCK_MS = 220;

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
      holdStartedAtRef.current = Date.now();
      e.currentTarget.setPointerCapture(e.pointerId);
      setMicState("recording");
      try {
        await onVoiceStart();
      } catch (err) {
        setMicState("idle");
        holdStartYRef.current = null;
        holdStartXRef.current = null;
        holdPointerIdRef.current = null;
        onVoiceError?.(err instanceof Error ? err : new Error("Could not access microphone."));
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
      const holdDurationMs = Date.now() - holdStartedAtRef.current;
      if (micState === "locked") return;
      if (micState === "recording" && holdDurationMs <= TAP_TO_LOCK_MS) {
        setMicState("locked");
        holdStartYRef.current = null;
        holdStartXRef.current = null;
        return;
      }
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
    const isRecordingHold = micState === "recording";
    // isCancelling must be included so the pill stays in recording mode
    // while the user slides left to cancel (rather than reverting to text input).
    const isActiveRecording = isRecordingHold || isLocked || isCancelling;

    const hasTextOrFile = message.trim().length > 0 || !!selectedFile;

    return (
      <div className="sticky bottom-0 z-30 border-t border-border/40 bg-background px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 sm:px-3 sm:py-2.5">
        <form onSubmit={onSubmit} className="flex flex-col gap-1.5">



          {/* ── File attachment preview ──────────────────────────────────── */}
          {selectedFile && !isActiveRecording && (
            <div className="flex items-center gap-3 rounded-2xl border border-border/50 bg-muted/40 px-3 py-2 animate-in zoom-in-95 duration-200">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                {selectedFile.type.startsWith("image/")
                  ? <ImageIcon className="h-4 w-4" />
                  : <FileText className="h-4 w-4" />}
              </div>
              <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{selectedFile.name}</p>
              {!isUploading && (
                <Button
                  variant="ghost" size="icon"
                  className="h-7 w-7 shrink-0 rounded-full text-muted-foreground hover:text-destructive"
                  onClick={onRemoveFile} aria-label="Remove file"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          )}

          {/* ── Main row ─────────────────────────────────────────────────── */}
          <div className="flex items-center gap-2">

            {/* Left side — changes per state */}
            {isLocked ? (
              /* Locked: trash button to discard */
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-11 w-11 shrink-0 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors duration-150"
                onClick={handleLockedCancel}
                aria-label="Discard voice note"
              >
                <Trash2 className="h-5 w-5" />
              </Button>
            ) : isRecordingHold || isCancelling ? (
              /* Hold recording: nothing on the left — full width for pill */
              null
            ) : allowAttachments ? (
              /* Idle: attach button */
              <div className="flex shrink-0 items-center">
                <Button
                  type="button" variant="ghost" size="icon"
                  className="h-10 w-10 rounded-full text-muted-foreground/70 hover:text-primary hover:bg-primary/8"
                  onClick={onAttachClick} aria-label="Attach file"
                >
                  <Paperclip className="h-5 w-5" />
                </Button>
                <input
                  type="file" ref={fileInputRef} className="hidden"
                  accept={CHAT_ATTACHMENT_ACCEPT} onChange={onFileSelect}
                />
              </div>
            ) : (
              <div className="hidden" aria-hidden />
            )}

            {/* ── Input pill ─────────────────────────────────────────────── */}
            <div
              className={cn(
                "relative flex flex-1 items-center overflow-hidden rounded-full transition-all duration-200",
                "h-11 border",
                isActiveRecording
                  ? isCancelling
                    ? "border-destructive/40 bg-destructive/5"
                    : isLocked
                    ? "border-border/50 bg-muted/30"
                    : "border-border/50 bg-muted/20"
                  : "border-border/60 bg-muted/20 focus-within:border-primary/40 focus-within:bg-background focus-within:ring-2 focus-within:ring-primary/10"
              )}
            >
              {isActiveRecording ? (
                /* ── Recording pill content ────────────────────────────── */
                <div className="flex w-full items-center gap-2 px-4">

                  {/* Pulsing red dot */}
                  <span
                    className={cn(
                      "h-2.5 w-2.5 shrink-0 rounded-full",
                      isCancelling
                        ? "bg-destructive/50"
                        : "bg-red-500 animate-pulse"
                    )}
                  />

                  {/* Timer */}
                  <span
                    className={cn(
                      "w-9 shrink-0 tabular-nums text-sm font-semibold leading-none",
                      isCancelling ? "text-destructive" : "text-foreground"
                    )}
                  >
                    {formatRecordingTime(recordingTime)}
                  </span>

                  {/* Waveform bars */}
                  <div className="flex flex-1 items-end justify-start overflow-hidden gap-[2px] h-7">
                    {displayBars.map((level, i) => (
                      <span
                        key={i}
                        className={cn(
                          "inline-block shrink-0 w-[2.5px] rounded-full origin-bottom",
                          isCancelling
                            ? "bg-destructive/40"
                            : isLocked
                            ? "bg-primary/60"
                            : "bg-primary/70"
                        )}
                        style={{
                          height: `${Math.round(Math.max(15, level * 100))}%`,
                          transition: "height 60ms ease-out",
                          opacity: isCancelling
                            ? 0.3 + 0.3 * (1 - i / NUM_BARS)
                            : 0.4 + 0.6 * level,
                        }}
                      />
                    ))}
                  </div>

                  {/* Right content varies by state */}
                  {isCancelling ? (
                    <span className="shrink-0 text-[11px] font-semibold text-destructive whitespace-nowrap">
                      Release to cancel
                    </span>
                  ) : isLocked ? (
                    /* Locked: show pause/resume inline + lock badge */
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button" variant="ghost" size="icon"
                        className="h-8 w-8 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={isPaused ? onVoiceResume : onVoicePause}
                        aria-label={isPaused ? "Resume" : "Pause"}
                      >
                        {isPaused
                          ? <Play className="h-3.5 w-3.5" />
                          : <Pause className="h-3.5 w-3.5" />}
                      </Button>
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10">
                        <Lock className="h-3 w-3 text-primary" />
                      </div>
                    </div>
                  ) : (
                    /* Hold recording: slide-to-cancel hint */
                    <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground/60 whitespace-nowrap">
                      <ChevronLeft className="h-3 w-3" />
                      Slide to cancel
                    </span>
                  )}
                </div>
              ) : (
                /* ── Normal text input ─────────────────────────────────── */
                <div className="flex flex-1 items-center">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button" variant="ghost" size="icon"
                        className="h-10 w-10 shrink-0 rounded-full text-muted-foreground/60 hover:text-primary hover:bg-transparent"
                        aria-label="Emoji"
                      >
                        <Smile className="h-5 w-5" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent side="top" align="start" className="p-0 border-none bg-transparent shadow-none">
                      <LazyEmojiPicker onEmojiClick={onEmojiClick} />
                    </PopoverContent>
                  </Popover>
                  <Input
                    value={message}
                    onChange={(e) => {
                      const v = e.target.value;
                      onMessageChange(v);
                      onTypingChange?.(v.trim().length > 0);
                    }}
                    onBlur={() => onTypingChange?.(false)}
                    placeholder="Message…"
                    className="flex-1 border-none bg-transparent px-1 text-[15px] shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/50"
                    disabled={isSending}
                  />
                </div>
              )}
            </div>

            {/* Right side — mic or send */}
            {isLocked ? (
              /* Locked: large send button */
              <Button
                type="button"
                size="icon"
                className="h-11 w-11 shrink-0 rounded-full bg-primary text-primary-foreground shadow-md shadow-primary/25 transition-transform duration-150 active:scale-95 hover:bg-primary/90"
                onClick={() => void handleLockedSend()}
                aria-label="Send voice note"
              >
                <Send className="h-[18px] w-[18px]" />
              </Button>
            ) : hasTextOrFile && !isActiveRecording ? (
              /* Has text/file: send button */
              <Button
                type="submit"
                size="icon"
                className={cn(
                  "h-11 w-11 shrink-0 rounded-full shadow-md transition-transform duration-150 active:scale-95",
                  "bg-primary text-primary-foreground shadow-primary/25 hover:bg-primary/90",
                  "disabled:opacity-40 disabled:cursor-not-allowed"
                )}
                disabled={isSending}
                aria-label={isSending ? "Sending…" : "Send message"}
              >
                {isSending
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Send className="h-4 w-4" />}
              </Button>
            ) : (
              /* Mic button: idle / recording-hold / cancelling */
              <div className="relative shrink-0" style={{ touchAction: "none" }}>
                {/* Lock gesture hint — appears above mic while swiping up */}
                {isRecordingHold && (
                  <div className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 animate-in fade-in zoom-in-95 duration-200">
                    <div className="flex items-center gap-1 rounded-full bg-slate-900/80 px-2.5 py-1 text-[10px] font-semibold text-white shadow-lg backdrop-blur-sm">
                      <Lock className="h-2.5 w-2.5" />
                      <span>Lock</span>
                    </div>
                  </div>
                )}

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-11 w-11 shrink-0 select-none rounded-full transition-all duration-150 motion-reduce:transition-none",
                    isRecordingHold
                      ? "scale-110 bg-red-500 text-white shadow-lg shadow-red-500/35 hover:bg-red-500"
                      : isCancelling
                      ? "scale-95 bg-red-500/70 text-white hover:bg-red-500/70"
                      : "bg-primary text-primary-foreground shadow-md shadow-primary/25 hover:bg-primary/90"
                  )}
                  onPointerDown={(e) => void handleMicPointerDown(e)}
                  onPointerMove={handleMicPointerMove}
                  onPointerUp={(e) => void handleMicPointerUp(e)}
                  disabled={isSending}
                  aria-label={
                    isRecordingHold
                      ? "Recording — release to send, slide ↑ to lock, ← to cancel"
                      : "Hold to record a voice note"
                  }
                >
                  {isCancelling
                    ? <X className="h-[18px] w-[18px]" />
                    : <Mic className={cn("h-[18px] w-[18px]", isRecordingHold && "scale-110")} />}
                </Button>

                {/* Expanding pulse ring while recording */}
                {isRecordingHold && (
                  <span
                    className="pointer-events-none absolute inset-0 rounded-full animate-mic-ring bg-red-500/25"
                    aria-hidden
                  />
                )}

                {/* Lock badge */}
                {isLocked && (
                  <div className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary shadow-sm animate-lock-pop">
                    <Lock className="h-2.5 w-2.5 text-primary-foreground" />
                  </div>
                )}
              </div>
            )}
          </div>
        </form>
      </div>
    );
  }
);

ChatInput.displayName = "ChatInput";
