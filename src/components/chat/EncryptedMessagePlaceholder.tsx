import { Loader2, Lock, RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { E2EVisualState } from "@/types/e2eChat";

type Props = {
  state: Exclude<E2EVisualState, "plain" | "decrypted">;
  isOutgoing: boolean;
  onRetryDecrypt?: () => void;
  onResyncDevice?: () => void;
};

export function EncryptedMessagePlaceholder({
  state,
  isOutgoing,
  onRetryDecrypt,
  onResyncDevice,
}: Props) {
  const title =
    state === "awaiting_key"
      ? "Securing this message"
      : state === "payload_invalid"
      ? "Message format not recognized"
      : "Could not unlock on this device";

  const description =
    state === "awaiting_key"
      ? "End-to-end encryption is finishing setup. This usually takes a moment."
      : state === "payload_invalid"
      ? "This may be an older message stored in a different format."
      : "Your encryption key may not match this conversation—for example after a fresh browser profile. Try reloading messages, or re-sync if the problem continues.";

  return (
    <div
      className={cn(
        "rounded-2xl border px-3 py-2.5 text-sm",
        isOutgoing
          ? "border-primary-foreground/25 bg-black/10 text-primary-foreground/95"
          : "border-zinc-700/80 bg-zinc-950/60 text-zinc-200"
      )}
    >
      <div className="flex items-start gap-2.5">
        <div
          className={cn(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
            state === "awaiting_key" ? "bg-primary/20 text-primary" : "bg-red-600/20 text-red-400"
          )}
        >
          {state === "awaiting_key" ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Lock className="h-4 w-4" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-semibold leading-tight">{title}</p>
          <p className="text-xs leading-snug opacity-85">{description}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            {onRetryDecrypt ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 gap-1.5 rounded-full text-xs"
                onClick={() => onRetryDecrypt()}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                Retry
              </Button>
            ) : null}
            {state !== "awaiting_key" && onResyncDevice ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 rounded-full border-red-500/40 text-xs text-red-200 hover:bg-red-950/50"
                onClick={() => onResyncDevice()}
              >
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
                Re-sync device
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
