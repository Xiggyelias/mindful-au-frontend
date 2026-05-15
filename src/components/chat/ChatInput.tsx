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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CHAT_ATTACHMENT_ACCEPT } from "@/lib/chatAttachments";
import { VoiceRecordingPresenceStrip } from "@/components/chat/VoiceMemoPlayer";
import { LazyEmojiPicker } from "@/components/chat/LazyEmojiPicker";

interface ChatInputProps {
  message: string;
  isSending: boolean;
  isUploading: boolean;
  uploadProgress: number;
  
  isVoiceMode: boolean;
  recording: any;
  recordingTime: number;
  isPaused: boolean;
  selectedFile: File | null;
  onMessageChange: (val: string) => void;
  onTypingChange?: (isTyping: boolean) => void;
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

export const ChatInput: React.FC<ChatInputProps> = React.memo(({
  message,
  isSending,
  isUploading,
  uploadProgress,
  
  isVoiceMode,
  recording,
  recordingTime,
  isPaused,
  selectedFile,
  onMessageChange,
  onTypingChange,
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
          <div
            className={`flex-1 relative flex bg-secondary/30 rounded-[2rem] border border-border/50 focus-within:border-primary/30 focus-within:ring-4 focus-within:ring-primary/5 transition-all duration-300 ${
              isVoiceMode ? "items-stretch py-2 min-h-[5.25rem]" : "items-center"
            }`}
          >
            {isVoiceMode ? (
              <div className="flex-1 flex flex-col gap-1.5 pl-4 pr-3 animate-in slide-in-from-left-2 duration-300">
                <div className="flex items-center gap-2">
                  <VoiceRecordingPresenceStrip className="h-8 shrink-0" />
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Recording voice memo
                  </span>
                  <span className="text-sm tabular-nums text-foreground font-medium ml-auto">{formatRecordingTime(recordingTime)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-muted/80 overflow-hidden">
                    <div className="h-full w-[45%] rounded-full bg-primary/35" aria-hidden />
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">Clinical session recording</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs text-muted-foreground"
                    onClick={isPaused ? onVoiceResume : onVoicePause}
                    aria-label={isPaused ? "Resume recording" : "Pause recording"}
                  >
                    {isPaused ? <Play className="h-3.5 w-3.5 mr-1" /> : <Pause className="h-3.5 w-3.5 mr-1" />}
                    {isPaused ? "Resume" : "Pause"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs text-muted-foreground"
                    onClick={onVoiceCancel}
                    aria-label="Discard voice recording"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    Discard
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
                      <LazyEmojiPicker onEmojiClick={onEmojiClick} />
                    </PopoverContent>
                  </Popover>
                  
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-primary" onClick={onAttachClick} aria-label="Attach file">
                    <Paperclip className="h-5 w-5" />
                  </Button>
                  <input type="file" ref={fileInputRef} className="hidden" accept={CHAT_ATTACHMENT_ACCEPT} onChange={onFileSelect} />
                </div>

                <Input
                  value={message}
                  onChange={(e) => {
                    const nextMessage = e.target.value;
                    onMessageChange(nextMessage);
                    onTypingChange?.(nextMessage.trim().length > 0);
                  }}
                  onBlur={() => onTypingChange?.(false)}
                  placeholder="Type your message..."
                  className="flex-1 bg-transparent border-none focus-visible:ring-0 h-12 text-base px-2"
                  disabled={isSending || false}
                />
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={isVoiceMode ? "outline" : "secondary"}
              size="icon"
              className={`h-12 w-12 rounded-full shadow-sm transition-all duration-300 ${
                isVoiceMode
                  ? "border-primary/40 text-primary hover:bg-primary/10"
                  : "hover:bg-primary/10 hover:text-primary shadow-lg"
              }`}
              onClick={onVoiceToggle}
              disabled={isSending}
              aria-label={isVoiceMode ? "Stop and send recording" : "Record voice memo"}
            >
              {isVoiceMode ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </Button>

            <Button
              type="submit"
              size="icon"
              className="h-12 w-12 rounded-full shadow-lg shadow-primary/20 transition-transform active:scale-95"
              disabled={(!message.trim() && !selectedFile && !recording) || isSending || false}
              aria-label={isSending ? "Sending message" : "Send message"}
            >
              {isSending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
});

ChatInput.displayName = "ChatInput";
