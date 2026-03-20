import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface PortalCardProps {
  title: string;
  description: string;
  icon: LucideIcon;
  color: "red" | "blue" | "purple";
  onClick: () => void;
  delay?: number;
}

export const PortalCard = ({
  title,
  description,
  icon: Icon,
  color,
  onClick,
  delay = 0,
}: PortalCardProps) => {
  const colorClasses = {
    red: "from-primary/20 to-primary/5 hover:from-primary/30 hover:to-primary/10 border-primary/20 hover:border-primary/40",
    blue: "from-info/20 to-info/5 hover:from-info/30 hover:to-info/10 border-info/20 hover:border-info/40",
    purple: "from-purple-500/20 to-purple-500/5 hover:from-purple-500/30 hover:to-purple-500/10 border-purple-500/20 hover:border-purple-500/40",
  };

  const iconColors = {
    red: "text-primary bg-primary/20",
    blue: "text-info bg-info/20",
    purple: "text-purple-400 bg-purple-500/20",
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        "portal-card w-full text-left opacity-0 animate-slide-up",
        "bg-gradient-to-br border",
        colorClasses[color]
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start gap-4">
        <div className={cn("p-3 rounded-xl", iconColors[color])}>
          <Icon className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-semibold text-lg text-foreground mb-1">
            {title}
          </h3>
          <p className="text-sm text-muted-foreground line-clamp-2">
            {description}
          </p>
        </div>
        <svg
          className="h-5 w-5 text-muted-foreground mt-1 transition-transform group-hover:translate-x-1"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
      </div>
    </button>
  );
};
