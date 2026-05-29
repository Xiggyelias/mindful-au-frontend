import { AlertCircle, ClipboardCheck, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function WellnessCheckInIntro({
  needsAssessment,
  isLoading,
  questionCount,
  error,
  isHardError,
  onStart,
  onRetry,
  onBack,
  canGoBack,
}: {
  needsAssessment: boolean;
  isLoading: boolean;
  questionCount: number;
  error: string | null;
  isHardError: boolean;
  onStart: () => void;
  onRetry: () => void;
  onBack?: () => void;
  canGoBack: boolean;
}) {
  return (
    <div
      className={cn(
        "relative mx-auto flex min-h-[min(720px,calc(100dvh-8rem))] w-full max-w-lg flex-col justify-center",
        "rounded-[2rem] border border-white/60 bg-gradient-to-b from-sky-50/95 via-white to-emerald-50/90",
        "px-6 py-10 shadow-[0_24px_60px_-24px_rgba(56,89,120,0.35)] animate-fade-in"
      )}
    >
      <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-violet-200/40 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-10 -left-10 h-36 w-36 rounded-full bg-emerald-200/35 blur-2xl" />

      <div className="relative z-10 flex flex-col items-center text-center">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-sky-400 to-violet-500 text-4xl shadow-lg shadow-sky-200/50 animate-scale-in">
          🌿
        </div>

        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-700/80">Wellness check-in</p>
        <h1 className="mt-3 font-sans text-2xl font-bold leading-tight text-slate-800 sm:text-3xl">
          Let&apos;s see how you&apos;re doing
        </h1>
        <p className="mt-4 max-w-sm text-base leading-relaxed text-slate-600">
          One gentle question at a time — like a conversation, not a test. Takes about 7 minutes.
        </p>

        {needsAssessment && (
          <div className="mt-6 flex w-full items-start gap-3 rounded-2xl border border-violet-200/80 bg-violet-50/90 px-4 py-3 text-left">
            <ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0 text-violet-600" />
            <p className="text-sm leading-snug text-violet-900/90">
              Your counselor asked for a quick check-in before you use chat and appointments. You&apos;re almost there.
            </p>
          </div>
        )}

        <div className="mt-8 grid w-full gap-3 text-left">
          {[
            { emoji: "💬", text: "Short, friendly questions about campus life" },
            { emoji: "🔒", text: "Private — only used to support you" },
            { emoji: "✨", text: "Tips tailored to how you're feeling" },
          ].map((item) => (
            <div
              key={item.text}
              className="flex items-center gap-3 rounded-2xl border border-white/80 bg-white/70 px-4 py-3 shadow-sm"
            >
              <span className="text-2xl" aria-hidden>
                {item.emoji}
              </span>
              <span className="text-sm font-medium text-slate-700">{item.text}</span>
            </div>
          ))}
        </div>

        {isLoading && (
          <div className="mt-6 flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Getting things ready…
          </div>
        )}

        {error && !isLoading && (
          <div
            className={cn(
              "mt-6 w-full rounded-2xl border px-4 py-3 text-left text-sm",
              isHardError
                ? "border-rose-200 bg-rose-50 text-rose-800"
                : "border-amber-200 bg-amber-50 text-amber-900"
            )}
          >
            <p className="mb-2">{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={onRetry} className="rounded-full">
              Try again
            </Button>
          </div>
        )}

        <div className="mt-8 flex w-full flex-col gap-3">
          <Button
            type="button"
            size="lg"
            disabled={isLoading || questionCount === 0 || isHardError}
            onClick={onStart}
            className="h-14 w-full rounded-2xl bg-gradient-to-r from-sky-500 to-violet-500 text-base font-semibold shadow-lg shadow-violet-200/40 hover:opacity-95"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                One moment…
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-5 w-5" />
                Let&apos;s begin
              </>
            )}
          </Button>

          {canGoBack && onBack && (
            <Button type="button" variant="ghost" size="lg" onClick={onBack} className="rounded-2xl text-slate-600">
              Back to dashboard
            </Button>
          )}
        </div>

        <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-slate-500">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          If you&apos;re in immediate danger, please contact local emergency services.
        </p>
      </div>
    </div>
  );
}
