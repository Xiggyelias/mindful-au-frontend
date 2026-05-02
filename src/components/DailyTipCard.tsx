import {
  Heart,
  Leaf,
  Loader2,
  RefreshCcw,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DailyTip } from "@/lib/api";

interface DailyTipCardProps {
  tip: DailyTip | null;
  isLoading?: boolean;
  error?: string | null;
  title?: string;
  actionLabel?: string;
  onAction?: () => void;
  onRefresh?: () => void;
  onToggleFavorite?: () => void;
  isSavingFavorite?: boolean;
  className?: string;
}

export const DailyTipCard = ({
  tip,
  isLoading = false,
  error = null,
  title = "Daily Wellness Tip",
  actionLabel,
  onAction,
  onRefresh,
  onToggleFavorite,
  isSavingFavorite = false,
  className,
}: DailyTipCardProps) => {
  return (
    <Card
      className={`overflow-hidden border border-sky-200/60 bg-[linear-gradient(145deg,rgba(240,249,255,0.96),rgba(236,253,245,0.96))] shadow-[0_18px_50px_-28px_rgba(14,116,144,0.4)] dark:border-sky-900/60 dark:bg-[linear-gradient(145deg,rgba(8,47,73,0.72),rgba(6,78,59,0.68))] ${className ?? ""}`}
    >
      <CardHeader className="space-y-4 border-b border-sky-200/50 bg-white/35 backdrop-blur-sm dark:border-sky-900/50 dark:bg-slate-950/10">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <CardTitle className="flex items-center gap-2 text-lg text-slate-900 dark:text-slate-50">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-200">
                <Leaf className="h-5 w-5" />
              </span>
              {title}
            </CardTitle>
            <p className="max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Small, supportive guidance for today. Wellness tips are short by design so they stay easy to use even on busy or low-bandwidth days.
            </p>
          </div>
          {tip?.category ? (
            <Badge className="whitespace-nowrap border border-emerald-300/60 bg-emerald-500/10 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-500/20 dark:text-emerald-100">
              {tip.category}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-5">
        {isLoading ? (
          <div className="rounded-3xl border border-dashed border-sky-200/70 bg-white/50 px-4 py-8 text-center text-sm text-slate-600 dark:border-sky-900/60 dark:bg-slate-950/10 dark:text-slate-300">
            <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
            Loading today&apos;s wellness tip...
          </div>
        ) : tip ? (
          <>
            <div className="rounded-[1.75rem] border border-sky-200/70 bg-white/70 p-5 shadow-sm dark:border-sky-900/60 dark:bg-slate-950/15">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-slate-900 dark:text-slate-50">
                    {tip.title}
                  </p>
                  <p className="mt-3 text-sm leading-7 text-slate-700 dark:text-slate-200">
                    {tip.content}
                  </p>
                </div>
                {tip.is_favorite ? (
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-200">
                    <Heart className="h-4 w-4 fill-current" />
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {tip.personalized ? (
                <Badge variant="outline" className="gap-1 border-sky-300/70 bg-sky-500/10 text-sky-700 dark:border-sky-800/70 dark:bg-sky-500/20 dark:text-sky-100">
                  <Sparkles className="h-3 w-3" />
                  Personalized for today
                </Badge>
              ) : null}
              {tip.mood ? (
                <Badge variant="outline" className="capitalize border-emerald-300/70 bg-emerald-500/10 text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-500/20 dark:text-emerald-100">
                  Mood: {tip.mood}
                </Badge>
              ) : null}
              {tip.served_for_date ? (
                <Badge variant="outline" className="border-slate-300/70 bg-white/60 text-slate-600 dark:border-slate-700/70 dark:bg-slate-950/10 dark:text-slate-300">
                  {tip.served_for_date}
                </Badge>
              ) : null}
            </div>
          </>
        ) : (
          <div className="rounded-3xl border border-dashed border-sky-200/70 bg-white/50 px-4 py-8 text-sm text-slate-600 dark:border-sky-900/60 dark:bg-slate-950/10 dark:text-slate-300">
            {error || "No active wellness tip is available right now."}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {onRefresh ? (
            <Button variant="outline" onClick={onRefresh} disabled={isLoading}>
              <RefreshCcw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          ) : null}
          {tip && onToggleFavorite ? (
            <Button
              variant={tip.is_favorite ? "secondary" : "outline"}
              onClick={onToggleFavorite}
              disabled={isSavingFavorite}
            >
              {isSavingFavorite ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Heart className={`mr-2 h-4 w-4 ${tip.is_favorite ? "fill-current" : ""}`} />
              )}
              {tip.is_favorite ? "Saved" : "Save tip"}
            </Button>
          ) : null}
          {actionLabel && onAction ? (
            <Button onClick={onAction}>{actionLabel}</Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
};
