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
      <div className={cn("mx-auto w-full max-w-xs", className)} aria-hidden>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted shadow-inner">
          <div
            className="h-full rounded-full bg-primary transition-all duration-200 ease-out"
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
            "rounded-full transition-all duration-200 ease-out",
            i < currentIndex && "h-2.5 w-2.5 bg-primary/70",
            i === currentIndex && "h-3 w-8 scale-105 bg-primary shadow-sm",
            i > currentIndex && "h-2.5 w-2.5 border border-border bg-muted"
          )}
        />
      ))}
    </div>
  );
}
