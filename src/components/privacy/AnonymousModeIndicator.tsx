import { Shield } from "lucide-react";
import { cn } from "@/lib/utils";

/** Shared shell: black field, red accent, white type — use for all anonymous / privacy surfaces. */
export const anonymousPrivacyShell =
  "border border-red-600/95 bg-black text-white shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_8px_30px_-8px_rgba(220,38,38,0.35)]";

export type AnonymousModeVariant = "badge" | "banner" | "inline";

type Props = {
  variant?: AnonymousModeVariant;
  className?: string;
  /** Counselor-facing copy is shorter; student banner explains protection. */
  audience?: "student" | "counselor";
};

export function AnonymousModeIndicator({ variant = "badge", className, audience = "student" }: Props) {
  const detail =
    audience === "counselor"
      ? "Identity protected — no name or profile shown"
      : "Your name, photo, and contact details stay hidden from this side of the session.";

  if (variant === "banner") {
    return (
      <div
        className={cn(
          "flex items-start gap-3 rounded-xl px-3 py-2.5 text-sm font-medium leading-snug",
          anonymousPrivacyShell,
          className
        )}
        role="status"
        aria-live="polite"
      >
        <Shield className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden />
        <span>
          <span className="font-semibold text-red-500">Anonymous Mode</span>
          <span className="text-white/90"> — {detail}</span>
        </span>
      </div>
    );
  }

  if (variant === "inline") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-red-500",
          className
        )}
      >
        <Shield className="h-3 w-3" aria-hidden />
        Anonymous
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide",
        anonymousPrivacyShell,
        className
      )}
    >
      <Shield className="h-3 w-3 shrink-0 text-red-500" aria-hidden />
      <span className="text-white">Anonymous Mode</span>
    </span>
  );
}
