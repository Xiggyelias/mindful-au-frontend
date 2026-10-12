import { AlertCircle, ClipboardCheck, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AssessmentMode = "quick" | "full_university" | "clinical_intake";

const ASSESSMENT_MODE_OPTIONS: {
  id: AssessmentMode;
  emoji: string;
  title: string;
  badge: string;
  description: string;
}[] = [
  {
    id: "quick",
    emoji: "⚡",
    title: "Quick Campus Check-in",
    badge: "10 questions · ~2 min",
    description: "One focused question across each campus wellness area for a fast pulse check.",
  },
  {
    id: "full_university",
    emoji: "🎓",
    title: "Full Campus Assessment",
    badge: "30 questions · ~5 min",
    description: "Complete 10-domain university check-in covering academics, sleep, mood, and social life.",
  },
  {
    id: "clinical_intake",
    emoji: "🩺",
    title: "Pre-Counselling Intake",
    badge: "Comprehensive · ~7 min",
    description: "Multi-format intake with scales, checklists, and reflection prompts for your counselor.",
  },
];

export function WellnessCheckInIntro({
  needsAssessment,
  isLoading,
  questionCount,
  selectedMode = "quick",
  onSelectMode,
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
  selectedMode?: AssessmentMode;
  onSelectMode?: (mode: AssessmentMode) => void;
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
        "rounded-[2rem] border border-border/80 bg-gradient-to-b from-accent/40 via-card to-background",
        "px-6 py-10 shadow-[0_24px_60px_-24px_rgba(56,89,120,0.35)] animate-fade-in"
      )}
    >
      <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-10 -left-10 h-36 w-36 rounded-full bg-primary/10 blur-2xl" />

      <div className="relative z-10 flex flex-col items-center text-center">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-primary text-4xl shadow-lg shadow-primary/25 animate-scale-in">
          🌿
        </div>

        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">Wellness check-in</p>
        <h1 className="mt-3 font-sans text-2xl font-bold leading-tight text-slate-800 dark:text-foreground sm:text-3xl">
          Let&apos;s see how you&apos;re doing
        </h1>
        <p className="mt-3 max-w-sm text-base leading-relaxed text-slate-600 dark:text-muted-foreground">
          Choose the mode of assessment that fits your time today — one gentle question at a time.
        </p>

        {needsAssessment && (
          <div className="mt-5 flex w-full items-start gap-3 rounded-2xl border border-primary/30 bg-accent px-4 py-3 text-left">
            <ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <p className="text-sm leading-snug text-foreground">
              Your counselor asked for a check-in before you use chat and appointments. You&apos;re almost there.
            </p>
          </div>
        )}

        <div className="mt-6 grid w-full gap-3 text-left" role="radiogroup" aria-label="Assessment mode">
          {ASSESSMENT_MODE_OPTIONS.map((mode) => {
            const active = selectedMode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onSelectMode?.(mode.id)}
                className={cn(
                  "flex w-full items-start gap-3.5 rounded-2xl border-2 px-4 py-3.5 text-left transition-all",
                  active
                    ? "border-primary bg-accent/80 shadow-md shadow-primary/10"
                    : "border-white/80 bg-white/75 hover:border-primary/40 hover:bg-white dark:border-border dark:bg-card/80"
                )}
              >
                <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background text-2xl shadow-sm" aria-hidden>
                  {mode.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-bold text-slate-800 dark:text-foreground">{mode.title}</span>
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                        active
                          ? "bg-primary text-primary-foreground"
                          : "bg-slate-100 text-slate-600 dark:bg-secondary dark:text-muted-foreground"
                      )}
                    >
                      {mode.badge}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-muted-foreground">
                    {mode.description}
                  </p>
                </div>
              </button>
            );
          })}
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

        <div className="mt-7 flex w-full flex-col gap-3">
          <Button
            type="button"
            size="lg"
            disabled={isLoading || questionCount === 0 || isHardError}
            onClick={onStart}
            className="h-14 w-full rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-lg shadow-primary/25 hover:bg-primary/90"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                One moment…
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-5 w-5" />
                Start check-in ({questionCount} questions)
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
