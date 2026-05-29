import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  categoryMeta,
  friendlySectionTitle,
  optionEmoji,
} from "@/lib/wellnessCheckInUi";
import { CheckInProgressDots } from "@/components/assessment/CheckInProgressDots";

export type CheckInQuestion = {
  id: string;
  category: string;
  type: string;
  question: string;
  description: string;
  section?: string;
  section_title?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
};

type WellnessCheckInQuestionProps = {
  question: CheckInQuestion;
  questionIndex: number;
  totalQuestions: number;
  response: unknown;
  showSection: boolean;
  isLoading: boolean;
  onResponse: (value: unknown) => void;
  onToggleMulti: (optionValue: string) => void;
  onBack: () => void;
  onAnswerAndAdvance: (value: unknown) => void;
  onSkip?: () => void;
  onNext: () => void;
  onSubmit: () => void;
};

export function WellnessCheckInQuestion({
  question,
  questionIndex,
  totalQuestions,
  response,
  showSection,
  isLoading,
  onResponse,
  onToggleMulti,
  onBack,
  onAnswerAndAdvance,
  onSkip,
  onNext,
  onSubmit,
}: WellnessCheckInQuestionProps) {
  const [slideKey, setSlideKey] = useState(question.id);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const prevIndexRef = useRef(questionIndex);

  useEffect(() => {
    const prev = prevIndexRef.current;
    setDirection(questionIndex >= prev ? "forward" : "back");
    prevIndexRef.current = questionIndex;
    setSlideKey(question.id);
  }, [question.id, questionIndex]);

  const isOptional = question.required === false;
  const isLast = questionIndex === totalQuestions - 1;
  const meta = categoryMeta(question.category);
  const SectionIcon = meta.icon;
  const isSafety =
    question.section === "10" || question.section_title?.toLowerCase().includes("safety");

  const pickAndAdvance = (value: unknown) => {
    onAnswerAndAdvance(value);
  };

  const renderOptions = () => {
    const scaleTypes = ["scale", "scale_1_5", "frequency_5", "multiple_choice", "single_choice"];

    if (scaleTypes.includes(question.type) && question.options?.length) {
      return (
        <div className="mt-6 flex flex-col gap-3">
          {question.options.map((option) => {
            const selected = String(response) === String(option.value);
            const emoji = optionEmoji(option.label, option.value);
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => pickAndAdvance(option.value)}
                className={cn(
                  "group flex min-h-[3.5rem] w-full items-center gap-4 rounded-2xl border-2 px-4 py-3.5 text-left transition-all duration-150",
                  "active:scale-[0.98] touch-manipulation",
                  selected
                    ? "border-primary bg-accent shadow-md shadow-primary/10 scale-[1.01]"
                    : "border-border bg-card hover:border-primary/40 hover:bg-accent/50 hover:shadow-sm"
                )}
              >
                <span
                  className={cn(
                    "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl transition-transform duration-150",
                    selected ? "scale-105 bg-background shadow-sm" : "bg-muted group-hover:scale-105"
                  )}
                  aria-hidden
                >
                  {emoji}
                </span>
                <span className="text-base font-medium text-foreground">{option.label}</span>
              </button>
            );
          })}
        </div>
      );
    }

    if (question.type === "scale_1_10") {
      return (
        <div className="mt-6 grid grid-cols-5 gap-2 sm:grid-cols-10">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((value) => {
            const selected = response === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => pickAndAdvance(value)}
                className={cn(
                  "flex aspect-square items-center justify-center rounded-xl border-2 text-sm font-semibold transition-all touch-manipulation",
                  selected
                    ? "border-primary bg-primary text-primary-foreground scale-105"
                    : "border-border bg-card text-foreground hover:border-primary/40"
                )}
              >
                {value}
              </button>
            );
          })}
        </div>
      );
    }

    if (question.type === "multi_select" && question.options?.length) {
      return (
        <div className="mt-6 flex flex-col gap-2">
          {question.options.map((option) => {
            const selected = Array.isArray(response) && response.includes(option.value);
            return (
              <label
                key={option.value}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-3.5 transition-all touch-manipulation",
                  selected ? "border-primary bg-accent" : "border-border bg-card"
                )}
              >
                <Checkbox checked={selected} onCheckedChange={() => onToggleMulti(option.value)} />
                <span className="text-2xl" aria-hidden>
                  {optionEmoji(option.label)}
                </span>
                <span className="text-sm font-medium text-foreground">{option.label}</span>
              </label>
            );
          })}
        </div>
      );
    }

    if (question.type === "yes_no") {
      return (
        <div className="mt-6 grid grid-cols-2 gap-3">
          {(["yes", "no"] as const).map((value) => {
            const selected = response === value;
            const label = value === "yes" ? "Yes" : "Not really";
            return (
              <button
                key={value}
                type="button"
                onClick={() => pickAndAdvance(value)}
                className={cn(
                  "flex min-h-[4.5rem] flex-col items-center justify-center gap-2 rounded-2xl border-2 transition-all touch-manipulation",
                  selected
                    ? "border-primary bg-accent shadow-md scale-[1.02]"
                    : "border-border bg-card hover:border-primary/40"
                )}
              >
                <span className="text-3xl">{optionEmoji(label, value)}</span>
                <span className="text-sm font-semibold text-foreground">{label}</span>
              </button>
            );
          })}
        </div>
      );
    }

    if (question.type === "text" || question.type === "textarea") {
      return (
        <textarea
          value={(response as string) || ""}
          onChange={(e) => onResponse(e.target.value)}
          placeholder="Share as much or as little as you like…"
          className="mt-6 min-h-[120px] w-full resize-none rounded-2xl border-2 border-border bg-card p-4 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
          rows={question.type === "textarea" ? 5 : 4}
        />
      );
    }

    return null;
  };

  return (
    <div
      className={cn(
        "relative mx-auto flex min-h-[min(720px,calc(100dvh-8rem))] w-full max-w-lg flex-col",
        "rounded-[2rem] border border-border/80 bg-gradient-to-b from-accent/30 via-card to-background",
        "px-5 py-6 shadow-lg sm:px-7 sm:py-8"
      )}
    >
      <div className="mb-6">
        <CheckInProgressDots total={totalQuestions} currentIndex={questionIndex} className="w-full" />
      </div>

      <div
        key={slideKey}
        className={cn(
          "flex flex-1 flex-col animate-fade-in",
          direction === "forward" ? "origin-left" : "origin-right"
        )}
      >
        {showSection && (
          <div
            className={cn(
              "mb-5 flex items-center gap-3 rounded-2xl border border-border/80 bg-gradient-to-r px-4 py-3",
              meta.tint
            )}
          >
            <span className="text-2xl" aria-hidden>
              {meta.emoji}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Up next</p>
              <p className="flex items-center gap-2 font-semibold text-foreground">
                <SectionIcon className="h-4 w-4 text-primary" />
                {friendlySectionTitle(question.section_title, question.category)}
              </p>
            </div>
          </div>
        )}

        {isSafety && (
          <div className="mb-4 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm leading-relaxed text-destructive">
            If you&apos;re in immediate danger, contact emergency services. Honest answers help us support you
            safely.
          </div>
        )}

        <div className="flex-1">
          <h2 className="font-serif text-xl font-bold leading-snug text-foreground sm:text-2xl">
            {question.question}
          </h2>
          {question.description ? (
            <p className="mt-3 text-base leading-relaxed text-muted-foreground">{question.description}</p>
          ) : null}

          {renderOptions()}
        </div>

        <div className="mt-8 flex flex-col gap-3 pt-2">
          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={onBack}
              disabled={questionIndex === 0 || isLoading}
              className="h-12 min-w-[5.5rem] flex-1 rounded-2xl border-2 font-medium"
            >
              Back
            </Button>
            {isLast ? (
              <Button
                type="button"
                disabled={isLoading}
                onClick={onSubmit}
                className="h-12 flex-[2] rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-md hover:bg-primary/90"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Putting it together…
                  </>
                ) : (
                  "See my insights"
                )}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={onNext}
                disabled={isLoading}
                className="h-12 flex-[2] rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-md hover:bg-primary/90"
              >
                Continue
              </Button>
            )}
          </div>

          {isOptional && onSkip ? (
            <button
              type="button"
              onClick={onSkip}
              className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Skip this one — that&apos;s okay
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
