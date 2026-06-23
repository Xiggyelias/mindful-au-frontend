import { AlertCircle, Calendar, CheckCircle, Heart, LayoutDashboard, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type CheckInResult = {
  id: number;
  total_score: number;
  risk_level: string;
  category_scores: Record<string, number>;
  ai_recommendations: {
    primary: string;
    actions: string[];
    category_alerts?: Record<string, string>;
    counselor_summary?: string;
    focus_areas?: string[];
    risk_flags?: string[];
  };
  created_at: string;
};

const RISK_STYLES: Record<string, { label: string; emoji: string; ring: string; bg: string }> = {
  low: { label: "You're doing okay", emoji: "🌱", ring: "text-emerald-600", bg: "from-emerald-50 to-teal-50" },
  medium: { label: "Some bumps — that's normal", emoji: "🌤️", ring: "text-amber-600", bg: "from-amber-50 to-orange-50" },
  high: { label: "A lot on your plate", emoji: "💙", ring: "text-orange-600", bg: "from-orange-50 to-rose-50" },
  critical: { label: "You deserve support now", emoji: "🤝", ring: "text-rose-600", bg: "from-rose-50 to-red-50" },
};

function riskStyle(level: string) {
  return RISK_STYLES[level] ?? RISK_STYLES.medium;
}

export function WellnessCheckInResults({
  result,
  history,
  trends,
  isHistoryLoading,
  onDashboard,
  onWellness,
  onAppointments,
}: {
  result: CheckInResult;
  history: CheckInResult[];
  trends: { date: string; score: number; risk_level: string }[];
  isHistoryLoading: boolean;
  onDashboard: () => void;
  onWellness: () => void;
  onAppointments: () => void;
}) {
  const style = riskStyle(result.risk_level);
  const trendPoints = trends.slice(-7);

  return (
    <div className="mx-auto max-w-lg space-y-6 animate-fade-in">
      <div
        className={cn(
          "overflow-hidden rounded-[2rem] border border-white/70 bg-gradient-to-b p-6 shadow-lg sm:p-8",
          style.bg
        )}
      >
        <div className="text-center">
          <span className="text-5xl" aria-hidden>
            {style.emoji}
          </span>
          <h2 className="mt-4 font-sans text-2xl font-bold text-slate-800">Thanks for checking in</h2>
          <p className="mt-2 text-slate-600">{style.label}</p>
        </div>

        <div className="mt-8 rounded-2xl bg-white/80 p-5 text-center shadow-sm">
          <p className="text-sm font-medium text-slate-500">Your snapshot</p>
          <p className={cn("mt-1 text-4xl font-bold tabular-nums", style.ring)}>{result.total_score}%</p>
          <p className="mt-1 text-sm capitalize text-slate-600">{result.risk_level} concern level</p>
        </div>

        <div className="mt-6 space-y-3">
          <p className="text-sm font-semibold text-slate-700">What stood out</p>
          {Object.entries(result.category_scores).map(([category, score]) => (
            <div key={category} className="rounded-xl bg-white/70 px-3 py-2.5">
              <div className="mb-1.5 flex justify-between text-sm">
                <span className="capitalize text-slate-600">{category.replace(/_/g, " ")}</span>
                <span className="font-semibold text-slate-800">{score}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-sky-400 to-violet-400 transition-all"
                  style={{ width: `${Math.min(100, Number(score))}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 space-y-3 rounded-2xl border border-white/80 bg-white/75 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Heart className="h-4 w-4 text-rose-500" />
            For you right now
          </p>
          <p className="text-sm leading-relaxed text-slate-700">{result.ai_recommendations.primary}</p>
          <ul className="space-y-2">
            {result.ai_recommendations.actions.map((action, index) => (
              <li key={index} className="flex items-start gap-2 text-sm text-slate-600">
                <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                <span>{action}</span>
              </li>
            ))}
          </ul>
        </div>

        {result.ai_recommendations.risk_flags && result.ai_recommendations.risk_flags.length > 0 && (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50/90 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-rose-800">
              <AlertCircle className="h-4 w-4" />
              Worth a closer look
            </p>
            <ul className="mt-2 space-y-1 text-sm text-rose-900/90">
              {result.ai_recommendations.risk_flags.map((flag) => (
                <li key={flag}>• {flag}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-8 flex flex-col gap-3">
          <Button
            type="button"
            onClick={onDashboard}
            className="h-14 rounded-2xl bg-gradient-to-r from-sky-500 to-violet-500 text-base font-semibold"
          >
            <LayoutDashboard className="mr-2 h-5 w-5" />
            Go to dashboard
          </Button>
          <div className="grid grid-cols-2 gap-3">
            <Button type="button" variant="outline" onClick={onWellness} className="h-12 rounded-2xl">
              Wellness
            </Button>
            <Button type="button" variant="outline" onClick={onAppointments} className="h-12 rounded-2xl">
              <Calendar className="mr-1 h-4 w-4" />
              Book support
            </Button>
          </div>
        </div>
      </div>

      {history.length > 0 && (
        <div className="rounded-[1.75rem] border border-white/70 bg-white/90 p-5 shadow-sm">
          <p className="flex items-center gap-2 font-semibold text-slate-800">
            <TrendingUp className="h-4 w-4 text-violet-500" />
            Your past check-ins
          </p>
          {isHistoryLoading ? (
            <p className="mt-3 text-sm text-slate-500">Loading…</p>
          ) : (
            <div className="mt-3 space-y-2">
              {history.slice(0, 5).map((item, index) => {
                const rs = riskStyle(item.risk_level);
                return (
                  <div
                    key={item.id || index}
                    className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-800">
                        {new Date(item.created_at).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </p>
                      <p className="text-xs text-slate-500">{rs.label}</p>
                    </div>
                    <span className={cn("text-sm font-bold", rs.ring)}>{item.total_score}%</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {trendPoints.length > 0 && (
        <div className="rounded-[1.75rem] border border-white/70 bg-white/90 p-5 shadow-sm">
          <p className="font-semibold text-slate-800">Recent trend</p>
          <div className="mt-3 space-y-2">
            {trendPoints.map((trend) => (
              <div key={trend.date} className="flex items-center justify-between text-sm">
                <span className="text-slate-500">
                  {new Date(trend.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
                <span className={cn("font-semibold", riskStyle(trend.risk_level).ring)}>{trend.score}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
