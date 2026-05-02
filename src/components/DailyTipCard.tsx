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
      className={`group overflow-hidden border border-sky-200/60 bg-[linear-gradient(145deg,rgba(240,249,255,0.96),rgba(236,253,245,0.96))] shadow-[0_18px_50px_-28px_rgba(14,116,144,0.4)] transition-all duration-500 hover:shadow-[0_22px_60px_-25px_rgba(14,116,144,0.5)] dark:border-sky-900/60 dark:bg-[linear-gradient(145deg,rgba(8,47,73,0.72),rgba(6,78,59,0.68))] ${className ?? ""}`}
    >
      <CardHeader className="relative pb-0">
        <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-emerald-500/10 blur-2xl transition-all duration-700 group-hover:scale-150 group-hover:bg-emerald-500/20" />
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <CardTitle className="flex items-center gap-3 text-lg font-bold text-slate-900 dark:text-slate-50">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-500/20 transition-transform duration-500 group-hover:rotate-12">
                <Leaf className="h-6 w-6" />
              </span>
              <span className="bg-[linear-gradient(to_right,theme(colors.slate.900),theme(colors.slate.600))] bg-clip-text text-transparent dark:bg-[linear-gradient(to_right,theme(colors.slate.50),theme(colors.slate.400))]">
                {title}
              </span>
            </CardTitle>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
              Small, supportive guidance for your day
            </p>
          </div>
          {tip?.category ? (
            <Badge className="whitespace-nowrap border border-emerald-200/50 bg-emerald-100/50 text-emerald-700 shadow-sm dark:border-emerald-800/60 dark:bg-emerald-500/10 dark:text-emerald-300">
              {tip.category}
            </Badge>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="mt-6 space-y-6">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
            <div className="relative">
              <div className="h-12 w-12 rounded-full border-2 border-emerald-500/20" />
              <div className="absolute top-0 h-12 w-12 animate-spin rounded-full border-t-2 border-emerald-500" />
            </div>
            <p className="animate-pulse text-sm font-medium text-slate-500">
              Curating your wellness tip...
            </p>
          </div>
        ) : tip ? (
          <>
            <div className="relative rounded-[2rem] bg-white/60 p-6 shadow-sm transition-colors duration-500 group-hover:bg-white/80 dark:bg-slate-900/40 dark:group-hover:bg-slate-900/60">
              <div className="space-y-3">
                <h4 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                  {tip.title}
                </h4>
                <p className="text-base leading-relaxed text-slate-600 dark:text-slate-300">
                  {tip.content}
                </p>
              </div>
              {onToggleFavorite && (
                <div className="absolute -right-2 -top-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-10 w-10 rounded-full shadow-md transition-all duration-300 ${
                      tip.is_favorite
                        ? "bg-pink-50 text-pink-500 hover:bg-pink-100 hover:text-pink-600 dark:bg-pink-500/20"
                        : "bg-white text-slate-400 hover:bg-slate-50 hover:text-pink-500 dark:bg-slate-800"
                    }`}
                    onClick={onToggleFavorite}
                    disabled={isSavingFavorite}
                  >
                    {isSavingFavorite ? (
                      <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />
                    ) : (
                      <Heart
                        className={`h-5 w-5 ${tip.is_favorite ? "fill-current" : ""}`}
                      />
                    )}
                  </Button>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {tip.personalized ? (
                <Badge variant="outline" className="gap-1.5 border-emerald-200 bg-emerald-50/50 text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-500/10 dark:text-emerald-300">
                  <Sparkles className="h-3.5 w-3.5" />
                  Personalized for today
                </Badge>
              ) : null}
              {tip.mood ? (
                <Badge variant="outline" className="border-sky-200 bg-sky-50/50 text-sky-700 dark:border-sky-800/50 dark:bg-sky-500/10 dark:text-sky-300">
                  Mood: {tip.mood}
                </Badge>
              ) : null}
              {tip.served_for_date ? (
                <Badge variant="outline" className="border-slate-200 bg-white/50 text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
                  {tip.served_for_date}
                </Badge>
              ) : null}
            </div>
          </>
        ) : (
          <div className="rounded-[2rem] border border-dashed border-slate-200 bg-slate-50/50 px-4 py-10 text-center dark:border-slate-800 dark:bg-slate-950/20">
            <div className="mb-3 flex justify-center">
              <Sparkles className="h-8 w-8 text-slate-300" />
            </div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
              {error || "No wellness tip available right now. We'll have something new for you soon."}
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-2">
          {onRefresh && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl border-slate-200 bg-white/50 px-4 hover:bg-white hover:text-emerald-600 dark:border-slate-800 dark:bg-slate-900/50"
              onClick={onRefresh}
              disabled={isLoading}
            >
              <RefreshCcw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin text-emerald-500" : "text-slate-400"}`} />
              New Tip
            </Button>
          )}
          {actionLabel && onAction && (
            <Button 
              size="sm"
              className="rounded-xl bg-emerald-600 px-4 hover:bg-emerald-700 shadow-md shadow-emerald-600/10"
              onClick={onAction}
            >
              {actionLabel}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
