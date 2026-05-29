import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
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
    onResponse(value);
    if (!isLast) {
      window.setTimeout(() => onNext(), 380);
    }
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
                  "group flex min-h-[3.5rem] w-full items-center gap-4 rounded-2xl border-2 px-4 py-3.5 text-left transition-all duration-200",
                  "active:scale-[0.98] touch-manipulation",
                  selected
                    ? "border-violet-400 bg-gradient-to-r from-sky-50 to-violet-50 shadow-md shadow-violet-100/60 scale-[1.02]"
                    : "border-white/90 bg-white/85 hover:border-sky-200 hover:bg-white hover:shadow-sm"
                )}
              >
                <span
                  className={cn(
                    "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl transition-transform duration-200",
                    selected ? "scale-110 bg-white shadow-sm" : "bg-slate-50 group-hover:scale-105"
                  )}
                  aria-hidden
                >
                  {emoji}
                </span>
                <span className="text-base font-medium text-slate-800">{option.label}</span>
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
                    ? "border-violet-400 bg-violet-500 text-white scale-105"
                    : "border-white bg-white/90 text-slate-700 hover:border-sky-200"
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
                  selected ? "border-violet-300 bg-violet-50/80" : "border-white bg-white/85"
                )}
              >
                <Checkbox checked={selected} onCheckedChange={() => onToggleMulti(option.value)} />
                <span className="text-2xl" aria-hidden>
                  {optionEmoji(option.label)}
                </span>
                <span className="text-sm font-medium text-slate-800">{option.label}</span>
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
                    ? "border-emerald-400 bg-emerald-50 shadow-md scale-[1.02]"
                    : "border-white bg-white/90 hover:border-sky-200"
                )}
              >
                <span className="text-3xl">{optionEmoji(label, value)}</span>
                <span className="text-sm font-semibold text-slate-800">{label}</span>
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
          className="mt-6 min-h-[120px] w-full resize-none rounded-2xl border-2 border-white bg-white/90 p-4 text-base text-slate-800 placeholder:text-slate-400 focus:border-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-200"
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
        "rounded-[2rem] border border-white/60 bg-gradient-to-b from-sky-50/95 via-white to-violet-50/80",
        "px-5 py-6 shadow-[0_24px_60px_-24px_rgba(56,89,120,0.35)] sm:px-7 sm:py-8"
      )}
    >
      <div className="mb-6 flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onBack}
          disabled={questionIndex === 0}
          className="h-11 w-11 shrink-0 rounded-2xl bg-white/80"
          aria-label="Previous question"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <CheckInProgressDots total={totalQuestions} currentIndex={questionIndex} className="flex-1" />
        <div className="w-11" aria-hidden />
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
              "mb-5 flex items-center gap-3 rounded-2xl border border-white/80 bg-gradient-to-r px-4 py-3",
              meta.tint
            )}
          >
            <span className="text-2xl" aria-hidden>
              {meta.emoji}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Up next</p>
              <p className="flex items-center gap-2 font-semibold text-slate-800">
                <SectionIcon className="h-4 w-4 text-sky-600" />
                {friendlySectionTitle(question.section_title, question.category)}
              </p>
            </div>
          </div>
        )}

        {isSafety && (
          <div className="mb-4 rounded-2xl border border-rose-200/80 bg-rose-50/90 px-4 py-3 text-sm leading-relaxed text-rose-900/90">
            If you&apos;re in immediate danger, contact emergency services. Honest answers help us support you
            safely.
          </div>
        )}

        <div className="flex-1">
          <h2 className="text-xl font-bold leading-snug text-slate-800 sm:text-2xl">{question.question}</h2>
          {question.description ? (
            <p className="mt-3 text-base leading-relaxed text-slate-600">{question.description}</p>
          ) : null}

          {renderOptions()}
        </div>

        <div className="mt-8 flex flex-col gap-3 pt-2">
          {isLast ? (
            <Button
              type="button"
              disabled={isLoading}
              onClick={onSubmit}
              className="h-14 w-full rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 text-base font-semibold shadow-lg"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Putting it together…
                </>
              ) : (
                "See my insights ✨"
              )}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={onNext}
              className="h-12 w-full rounded-2xl border-2 border-slate-200/80 bg-white/90 font-medium"
            >
              Continue
            </Button>
          )}

          {isOptional && onSkip ? (
            <button
              type="button"
              onClick={onSkip}
              className="text-sm font-medium text-slate-500 underline-offset-4 hover:text-slate-700 hover:underline"
            >
              Skip this one — that&apos;s okay
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
