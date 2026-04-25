import { Lightbulb, Loader2, Sparkles } from "lucide-react";
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
  className?: string;
}

export const DailyTipCard = ({
  tip,
  isLoading = false,
  error = null,
  title = "Tip of the Day",
  actionLabel,
  onAction,
  className,
}: DailyTipCardProps) => {
  return (
    <Card className={className}>
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Lightbulb className="h-5 w-5 text-primary" />
              {title}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              A lightweight daily prompt to support focus, recovery, and consistency.
            </p>
          </div>
          {tip?.category ? (
            <Badge variant="secondary" className="whitespace-nowrap">
              {tip.category}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="rounded-2xl border border-dashed border-border/70 bg-secondary/20 px-4 py-6 text-sm text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
            Loading today&apos;s tip...
          </div>
        ) : tip ? (
          <>
            <div className="rounded-2xl border border-primary/15 bg-primary/5 p-4">
              <p className="text-base font-semibold text-foreground">{tip.title}</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{tip.content}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {tip.personalized ? (
                <Badge variant="outline" className="gap-1">
                  <Sparkles className="h-3 w-3" />
                  Personalized
                </Badge>
              ) : null}
              {tip.mood ? (
                <Badge variant="outline" className="capitalize">
                  {tip.mood}
                </Badge>
              ) : null}
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-border/70 bg-secondary/20 px-4 py-6 text-sm text-muted-foreground">
            {error || "No active tip is available right now."}
          </div>
        )}

        {actionLabel && onAction ? (
          <Button variant="outline" onClick={onAction}>
            {actionLabel}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
};
