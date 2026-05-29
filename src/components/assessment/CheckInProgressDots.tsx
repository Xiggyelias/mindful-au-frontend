import { cn } from "@/lib/utils";

export function CheckInProgressDots({
  total,
  currentIndex,
  className,
}: {
  total: number;
  currentIndex: number;
  className?: string;
}) {
  if (total <= 0) {
    return null;
  }

  const maxDots = 12;
  const showSegmented = total > maxDots;

  if (showSegmented) {
    const progress = Math.min(100, Math.round(((currentIndex + 1) / total) * 100));
    return (
      <div className={cn("w-full max-w-xs mx-auto", className)} aria-hidden>
        <div className="h-2.5 w-full rounded-full bg-white/60 overflow-hidden shadow-inner">
          <div
            className="h-full rounded-full bg-gradient-to-r from-sky-400 via-violet-400 to-emerald-400 transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn("flex flex-wrap items-center justify-center gap-2", className)}
      role="progressbar"
      aria-valuenow={currentIndex + 1}
      aria-valuemin={1}
      aria-valuemax={total}
      aria-label={`Step ${currentIndex + 1} of ${total}`}
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn(
            "rounded-full transition-all duration-300 ease-out",
            i < currentIndex && "h-2.5 w-2.5 bg-emerald-400/90 scale-100",
            i === currentIndex && "h-3 w-8 bg-gradient-to-r from-sky-500 to-violet-500 shadow-sm scale-105",
            i > currentIndex && "h-2.5 w-2.5 bg-white/70 border border-slate-200/80"
          )}
        />
      ))}
    </div>
  );
}
