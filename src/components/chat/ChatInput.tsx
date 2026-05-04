import React from "react";
import { 
  Send, 
  Paperclip, 
  Mic, 
  Smile, 
  X, 
  Pause, 
  Play, 
  Square, 
  Loader2,
  Trash2,
  ImageIcon,
  FileText
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import EmojiPicker, { Theme as EmojiTheme } from "emoji-picker-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CHAT_ATTACHMENT_ACCEPT } from "@/lib/chatAttachments";

interface ChatInputProps {
  message: string;
  isSending: boolean;
  isUploading: boolean;
  uploadProgress: number;
  isEncryptionReady: boolean;
  isVoiceMode: boolean;
  recording: any;
  recordingTime: number;
  isPaused: boolean;
  selectedFile: File | null;
  onMessageChange: (val: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onAttachClick: () => void;
  onVoiceToggle: () => void;
  onVoicePause: () => void;
  onVoiceResume: () => void;
  onVoiceCancel: () => void;
  onRemoveFile: () => void;
  onEmojiClick: (emojiData: any) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  message,
  isSending,
  isUploading,
  uploadProgress,
  isEncryptionReady,
  isVoiceMode,
  recording,
  recordingTime,
  isPaused,
  selectedFile,
  onMessageChange,
  onSubmit,
  onFileSelect,
  onAttachClick,
  onVoiceToggle,
  onVoicePause,
  onVoiceResume,
  onVoiceCancel,
  onRemoveFile,
  onEmojiClick,
  fileInputRef,
}) => {
  const formatRecordingTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="border-t border-border/50 bg-background/95 p-4">
      <form onSubmit={onSubmit} className="space-y-4">
        {isUploading && (
          <div className="space-y-2 animate-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <span className="flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Uploading attachment...
              </span>
              <span>{uploadProgress}%</span>
            </div>
            <Progress value={uploadProgress} className="h-1.5" />
          </div>
        )}

        {selectedFile && (
          <div className="flex items-center gap-3 p-3 rounded-2xl bg-secondary/30 border border-primary/10 animate-in zoom-in-95 duration-300">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              {selectedFile.type.startsWith("image/") ? <ImageIcon className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{selectedFile.name}</p>
              <p className="text-[10px] uppercase font-bold opacity-60">Ready to send</p>
            </div>
            {!isUploading && (
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={onRemoveFile} aria-label="Remove selected file">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}

        <div className="flex items-end gap-3">
          <div className="flex-1 relative flex items-center bg-secondary/30 rounded-[2rem] border border-border/50 focus-within:border-primary/30 focus-within:ring-4 focus-within:ring-primary/5 transition-all duration-300">
            {isVoiceMode ? (
              <div className="flex-1 flex items-center h-12 px-4 gap-4 animate-in slide-in-from-left-2 duration-300">
                <div className="flex items-center gap-3 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
                    <span className="text-sm font-mono font-bold">{formatRecordingTime(recordingTime)}</span>
                  </div>
                  <div className="flex-1 h-1 bg-destructive/10 rounded-full overflow-hidden">
                    <div className="h-full bg-destructive animate-progress" style={{ width: '100%' }} />
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={isPaused ? onVoiceResume : onVoicePause} aria-label={isPaused ? "Resume recording" : "Pause recording"}>
                    {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={onVoiceCancel} aria-label="Cancel voice recording">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center pl-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-primary" aria-label="Open emoji picker">
                        <Smile className="h-5 w-5" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent side="top" align="start" className="p-0 border-none bg-transparent shadow-none">
                      <EmojiPicker onEmojiClick={onEmojiClick} theme={EmojiTheme.AUTO} />
                    </PopoverContent>
                  </Popover>
                  
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-primary" onClick={onAttachClick} aria-label="Attach file">
                    <Paperclip className="h-5 w-5" />
                  </Button>
                  <input type="file" ref={fileInputRef} className="hidden" accept={CHAT_ATTACHMENT_ACCEPT} onChange={onFileSelect} />
                </div>

                <Input
                  value={message}
                  onChange={(e) => onMessageChange(e.target.value)}
                  placeholder={isEncryptionReady ? "Type your message..." : "Securing connection..."}
                  className="flex-1 bg-transparent border-none focus-visible:ring-0 h-12 text-base px-2"
                  disabled={isSending || !isEncryptionReady}
                />
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={isVoiceMode ? "destructive" : "secondary"}
              size="icon"
              className={`h-12 w-12 rounded-full shadow-lg transition-all duration-300 ${isVoiceMode ? "animate-pulse" : "hover:bg-primary/10 hover:text-primary"}`}
              onClick={onVoiceToggle}
              disabled={isSending}
              aria-label={isVoiceMode ? "Stop recording" : "Start voice message"}
            >
              {isVoiceMode ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </Button>

            <Button
              type="submit"
              size="icon"
              className="h-12 w-12 rounded-full shadow-lg shadow-primary/20 transition-transform active:scale-95"
              disabled={(!message.trim() && !selectedFile && !recording) || isSending || !isEncryptionReady}
              aria-label={isSending ? "Sending message" : "Send message"}
            >
              {isSending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
};
