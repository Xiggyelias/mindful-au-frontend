import React from "react";
import { 
  Shield, 
  Loader2, 
  Trash2, 
  FileText, 
  Mic, 
  MessageSquare,
  ArrowDown
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { resolveMessageAttachment, getAttachmentKind, formatChatFileSize } from "@/lib/chatAttachments";

interface MessageListProps {
  messages: any[];
  isLoading: boolean;
  isLoadingOlderMessages: boolean;
  hasOlderMessages: boolean;
  isAtBottom: boolean;
  showScrollToBottom: boolean;
  user: any;
  activeSession: any;
  isPeerTyping: boolean;
  deletingMessageIds: Set<number>;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  onLoadOlder: () => Promise<void>;
  onDeleteMessage: (id: number) => Promise<void>;
  scrollToBottom: () => void;
  messageScrollAreaRef: React.RefObject<HTMLDivElement>;
  scrollRef: React.RefObject<HTMLDivElement>;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  isLoading,
  isLoadingOlderMessages,
  hasOlderMessages,
  isAtBottom,
  showScrollToBottom,
  user,
  activeSession,
  isPeerTyping,
  deletingMessageIds,
  onScroll,
  onLoadOlder,
  onDeleteMessage,
  scrollToBottom,
  messageScrollAreaRef,
  scrollRef,
}) => {
  const formatTime = (dateString: string) => {
    try {
      return format(new Date(dateString), "h:mm a");
    } catch {
      return "";
    }
  };

  const renderMessageContent = (msg: any) => {
    const content = msg.decryptedContent || msg.content;
    const attachment = resolveMessageAttachment(msg);

    if (attachment && (msg.message_type === "file" || msg.message_type === "voice" || msg.has_file)) {
      const kind = getAttachmentKind(attachment);
      const resolvedUrl = attachment.url || msg.file_url;
      const downloadUrl = attachment.download_url || attachment.url || msg.file_url;
      const hasSize = Number(attachment.file_size) > 0;

      if (!resolvedUrl) return <p className="italic opacity-70 text-sm">Attachment unavailable</p>;

      if (kind === "image") {
        return (
          <div className="space-y-2 max-w-sm">
            <a href={downloadUrl || resolvedUrl} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-2xl border border-border/50 hover:ring-2 hover:ring-primary/20 transition-all">
              <img src={resolvedUrl} alt={attachment.file_name} className="max-h-80 w-full object-cover" loading="lazy" />
            </a>
            <div className="flex items-center justify-between gap-3 px-1 text-[10px] font-medium opacity-70 uppercase tracking-tight">
              <span className="truncate">{attachment.file_name}</span>
              {hasSize && <span>{formatChatFileSize(attachment.file_size)}</span>}
            </div>
          </div>
        );
      }

      if (kind === "audio") {
        return (
          <div className="space-y-2">
            <audio controls preload="none" className="w-full max-w-xs h-8">
              <source src={resolvedUrl} type={attachment.file_type} />
            </audio>
            <div className="flex items-center gap-2 text-[10px] opacity-80 mt-1">
              <Mic className="h-3 w-3" />
              <span className="truncate">{attachment.file_name}</span>
              {hasSize && <span>{formatChatFileSize(attachment.file_size)}</span>}
            </div>
          </div>
        );
      }

      return (
        <div className="flex items-center gap-3 rounded-2xl bg-background/50 p-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <FileText className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{attachment.file_name}</p>
            {hasSize && <p className="text-xs opacity-70">{formatChatFileSize(attachment.file_size)}</p>}
          </div>
          <a href={downloadUrl || resolvedUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold underline">Download</a>
        </div>
      );
    }
    
    return <p className="whitespace-pre-wrap break-words">{content}</p>;
  };

  if (isLoading && messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 animate-in fade-in duration-700">
          <div className="relative">
            <div className="absolute inset-0 blur-2xl bg-primary/20 rounded-full" />
            <Loader2 className="h-12 w-12 animate-spin text-primary relative" />
          </div>
          <p className="text-muted-foreground font-medium">Securing your safe space...</p>
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md w-full text-center space-y-6 animate-in zoom-in-95 duration-500">
          <div className="inline-flex p-5 rounded-[2rem] bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/10 shadow-2xl shadow-primary/5">
            <Shield className="h-12 w-12 text-primary" />
          </div>
          <div className="space-y-2">
            <h3 className="text-2xl font-display font-bold tracking-tight">Your Safe Space</h3>
            <p className="text-muted-foreground leading-relaxed">
              Every word you share here is private and end-to-end encrypted. 
              What would you like to talk about today?
            </p>
          </div>
          <div className="grid gap-3 pt-4">
             <div className="p-4 rounded-2xl bg-secondary/30 border border-border/50 text-sm font-medium text-muted-foreground italic">
                "I'm feeling a bit overwhelmed lately..."
             </div>
             <div className="p-4 rounded-2xl bg-secondary/30 border border-border/50 text-sm font-medium text-muted-foreground italic">
                "I'd like to check in on my wellness goals."
             </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 relative overflow-hidden flex flex-col min-h-0">
      <ScrollArea 
        ref={messageScrollAreaRef}
        className="flex-1"
      >
        <div className="py-6 px-4 lg:px-6 space-y-6">
          {hasOlderMessages && (
            <div className="flex justify-center pb-4">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={onLoadOlder} 
                disabled={isLoadingOlderMessages}
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-primary"
              >
                {isLoadingOlderMessages ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-2" />
                ) : (
                  <MessageSquare className="h-3 w-3 mr-2" />
                )}
                {isLoadingOlderMessages ? "Loading history..." : "Load older messages"}
              </Button>
            </div>
          )}

          {messages.map((msg, idx) => {
            const isMe = Number(msg.sender_id) === Number(user?.id);
            const showTime = idx === 0 || formatTime(msg.created_at) !== formatTime(messages[idx-1].created_at);
            const isDeleting = deletingMessageIds.has(msg.id);

            return (
              <div key={msg.id || idx} className={`flex flex-col ${isMe ? "items-end" : "items-start"} group animate-in slide-in-from-bottom-2 duration-300`}>
                {showTime && (
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-2 px-1">
                    {formatTime(msg.created_at)}
                  </span>
                )}
                <div className="flex items-center gap-2 max-w-[85%] lg:max-w-[70%]">
                  {isMe && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => onDeleteMessage(msg.id)}
                      disabled={isDeleting}
                    >
                      {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </Button>
                  )}
                  
                  <div className={`relative px-4 py-3 rounded-[2rem] shadow-sm ${
                    isMe 
                      ? "bg-primary text-primary-foreground rounded-tr-none" 
                      : "bg-secondary/50 text-foreground rounded-tl-none border border-border/50"
                  }`}>
                    {renderMessageContent(msg)}
                  </div>
                </div>
              </div>
            );
          })}

          {isPeerTyping && (
            <div className="flex items-center gap-3 animate-in fade-in slide-in-from-left-2 duration-500">
              <div className="flex gap-1 p-3 rounded-full bg-secondary/50 border border-border/50">
                <span className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-bounce" />
                <span className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-bounce [animation-delay:0.2s]" />
                <span className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-bounce [animation-delay:0.4s]" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                Counselor is typing
              </span>
            </div>
          )}
          
          <div ref={scrollRef} className="h-px w-full" />
        </div>
      </ScrollArea>

      {showScrollToBottom && (
        <Button
          size="icon"
          variant="secondary"
          className="absolute bottom-6 right-6 h-10 w-10 rounded-full shadow-2xl border border-border/50 animate-in zoom-in fade-in duration-300 z-10 hover:scale-110 transition-transform"
          onClick={scrollToBottom}
        >
          <ArrowDown className="h-5 w-5" />
        </Button>
      )}
    </div>
  );
};
