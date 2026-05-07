import { useEffect, useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VoiceMemoPlayer } from "@/components/chat/VoiceMemoPlayer";
import type { ChatMessage } from "@/hooks/useEncryptedChat";
import { api } from "@/lib/api";
import {
  resolveMessageAttachment,
  getAttachmentKind,
  formatChatFileSize,
  type ChatAttachment,
} from "@/lib/chatAttachments";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type ChatAttachmentViewProps = {
  message: ChatMessage;
  isOutgoing: boolean;
};

export function ChatAttachmentView({ message: msg, isOutgoing }: ChatAttachmentViewProps) {
  const [downloading, setDownloading] = useState(false);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const resolved = resolveMessageAttachment(msg);
  const att =
    resolved ??
    ({
      file_name: msg.message_type === "voice" ? "Voice note" : "Attachment",
      file_type: msg.message_type === "voice" ? "audio/webm" : "application/octet-stream",
      file_size: 0,
      url: msg.file_url ?? null,
      download_url: msg.file_url ?? null,
    } satisfies ChatAttachment);

  const resolvedUrl = (att.url || msg.file_url || "").trim();
  const hasPreviewUrl = resolvedUrl.length > 0;

  useEffect(() => {
    setImageLoadFailed(false);
  }, [resolvedUrl]);
  const kind = getAttachmentKind(att);
  const hasSize = Number(att.file_size) > 0;
  const messageId = Number(msg.id);

  const handleDownload = async () => {
    if (Number.isInteger(messageId) && messageId > 0) {
      setDownloading(true);
      try {
        const ok = await api.downloadChatMessageAttachment(messageId, att.file_name);
        if (!ok) {
          toast.error("Could not download file");
        }
      } finally {
        setDownloading(false);
      }
      return;
    }

    const fallback = (att.download_url || att.url || resolvedUrl || "").trim();
    if (fallback) {
      window.open(fallback, "_blank", "noopener,noreferrer");
      return;
    }

    toast.error("Attachment is not available to download yet");
  };

  const downloadControl = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(
        "h-8 shrink-0 gap-1.5 border-dashed px-2.5 text-xs font-semibold",
        isOutgoing && "border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/15"
      )}
      disabled={downloading}
      onClick={() => void handleDownload()}
    >
      {downloading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Download className="h-3.5 w-3.5" />
      )}
      Download
    </Button>
  );

  if (kind === "image" && hasPreviewUrl) {
    const metaText = cn(
      "text-[10px] font-medium uppercase tracking-tight",
      isOutgoing ? "text-primary-foreground/85" : "text-muted-foreground"
    );

    return (
      <div className="max-w-sm space-y-2">
        {imageLoadFailed ? (
          <div
            className={cn(
              "flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-4 py-6 text-center",
              isOutgoing
                ? "border-primary-foreground/35 bg-primary-foreground/10"
                : "border-border/60 bg-muted/40"
            )}
          >
            <p className={cn("text-sm font-medium", isOutgoing ? "text-primary-foreground" : "text-foreground")}>
              Image preview unavailable
            </p>
            <p
              className={cn(
                "text-xs",
                isOutgoing ? "text-primary-foreground/80" : "text-muted-foreground"
              )}
            >
              Open or save the file with Download (e.g. expired link or network block).
            </p>
            {downloadControl}
          </div>
        ) : (
          <a
            href={att.download_url || att.url || resolvedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "block overflow-hidden rounded-2xl border transition-all hover:ring-2",
              isOutgoing
                ? "border-primary-foreground/30 hover:ring-primary-foreground/35"
                : "border-border/50 hover:ring-primary/20"
            )}
          >
            <img
              src={resolvedUrl}
              alt={att.file_name}
              className="max-h-80 w-full object-cover"
              loading="lazy"
              onError={() => setImageLoadFailed(true)}
            />
          </a>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={cn("min-w-0 truncate", metaText)}>{att.file_name}</span>
          <div className="flex shrink-0 items-center gap-2">
            {hasSize ? <span className={metaText}>{formatChatFileSize(att.file_size)}</span> : null}
            {downloadControl}
          </div>
        </div>
      </div>
    );
  }

  if (kind === "image" && !hasPreviewUrl) {
    return (
      <div className="max-w-sm space-y-3">
        <div
          className={cn(
            "rounded-2xl border border-dashed px-4 py-5 text-center",
            isOutgoing
              ? "border-primary-foreground/35 bg-primary-foreground/10"
              : "border-border/60 bg-muted/40"
          )}
        >
          <p className={cn("text-sm font-medium", isOutgoing ? "text-primary-foreground" : "")}>
            {att.file_name}
          </p>
          {hasSize ? (
            <p className={cn("mt-1 text-xs", isOutgoing ? "text-primary-foreground/80" : "text-muted-foreground")}>
              {formatChatFileSize(att.file_size)}
            </p>
          ) : null}
          <div className={cn("mt-4 flex justify-center", isOutgoing && "text-primary-foreground")}>
            {downloadControl}
          </div>
        </div>
      </div>
    );
  }

  if (kind === "audio") {
    const isVoiceMemo = msg.message_type === "voice";
    if (hasPreviewUrl) {
      return (
        <div className="max-w-[min(100%,20rem)] space-y-2">
          <VoiceMemoPlayer
            src={resolvedUrl}
            mimeType={att.file_type}
            headline={isVoiceMemo ? "Voice memo" : "Audio attachment"}
            fileSizeBytes={hasSize ? Number(att.file_size) : undefined}
            bubbleRole={isOutgoing ? "outgoing" : "incoming"}
          />
          <div className={cn("flex justify-end", isOutgoing && "text-primary-foreground")}>{downloadControl}</div>
        </div>
      );
    }

    return (
      <div className="flex max-w-sm flex-col gap-2 rounded-2xl border border-border/60 bg-background/50 p-3">
        <p className="text-sm font-medium">{isVoiceMemo ? "Voice memo" : "Audio attachment"}</p>
        {hasSize ? <p className="text-xs opacity-70">{formatChatFileSize(att.file_size)}</p> : null}
        <div className="flex justify-end">{downloadControl}</div>
      </div>
    );
  }

  return (
    <div className="flex max-w-sm items-center gap-3 rounded-2xl bg-background/50 p-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <FileText className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{att.file_name}</p>
        {hasSize ? <p className="text-xs opacity-70">{formatChatFileSize(att.file_size)}</p> : null}
      </div>
      {downloadControl}
    </div>
  );
}
