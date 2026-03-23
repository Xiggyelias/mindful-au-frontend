import { useEffect, useState } from "react";
import { Loader2, Mic } from "lucide-react";
import { api, getApiErrorMessage } from "@/lib/api";

type VoiceNotePlayerProps = {
  messageId: number | string;
  className?: string;
};

export const VoiceNotePlayer = ({ messageId, className = "" }: VoiceNotePlayerProps) => {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isActive = true;
    let objectUrl: string | null = null;

    setIsLoading(true);
    setError(null);
    setAudioUrl(null);

    void api
      .downloadVoiceNote(String(messageId))
      .then((blob) => {
        if (!isActive) {
          return;
        }

        objectUrl = window.URL.createObjectURL(blob);
        setAudioUrl(objectUrl);
      })
      .catch((err: unknown) => {
        if (!isActive) {
          return;
        }

        setError(getApiErrorMessage(err, "Unable to load voice note"));
      })
      .finally(() => {
        if (isActive) {
          setIsLoading(false);
        }
      });

    return () => {
      isActive = false;
      if (objectUrl) {
        window.URL.revokeObjectURL(objectUrl);
      }
    };
  }, [messageId]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Loading voice note...</span>
      </div>
    );
  }

  if (error || !audioUrl) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Mic className="h-4 w-4" />
        <span>{error || "Voice note unavailable"}</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <audio controls preload="none" className={`w-full max-w-xs ${className}`.trim()}>
        <source src={audioUrl} />
        Your browser does not support the audio element.
      </audio>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Mic className="h-3 w-3" />
        <span>Voice note</span>
      </div>
    </div>
  );
};
