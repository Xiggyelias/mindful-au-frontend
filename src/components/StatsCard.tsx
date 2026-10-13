import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface StatsCardProps {
  title: string;
  value: string | number;
  change?: string;
  icon: LucideIcon;
  trend?: "up" | "down" | "neutral";
  className?: string;
}

export const StatsCard = ({
  title,
  value,
  change,
  icon: Icon,
  trend = "neutral",
  className,
}: StatsCardProps) => {
  const trendColors = {
    up: "text-success",
    down: "text-destructive",
    neutral: "text-muted-foreground",
  };

  return (
    <div
      className={cn(
        "glass-card glide-card group hover:border-primary/30 cursor-default select-none",
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground mb-1 group-hover:text-foreground/80 transition-colors">{title}</p>
          <p className="text-3xl font-bold text-foreground tracking-tight">{value}</p>
          {change && (
            <p className={cn("text-xs mt-2 font-medium", trendColors[trend])}>
              {trend === "up" && "↑ "}
              {trend === "down" && "↓ "}
              {change}
            </p>
          )}
        </div>
        <div className="p-3 rounded-2xl bg-primary/10 group-hover:bg-primary/20 group-hover:scale-105 transition-all duration-300 shadow-sm">
          <Icon className="h-6 w-6 text-primary group-hover:text-primary-glow transition-colors" />
        </div>
      </div>
    </div>
  );
};
