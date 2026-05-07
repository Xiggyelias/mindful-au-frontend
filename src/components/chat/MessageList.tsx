import React from "react";
import { Shield, Loader2, Trash2, MessageSquare, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatInDisplayZone } from "@/lib/displayTimezone";
import { EncryptedMessagePlaceholder } from "@/components/chat/EncryptedMessagePlaceholder";
import { ChatMessageErrorBoundary } from "@/components/chat/ChatMessageErrorBoundary";
import { ChatAttachmentView } from "@/components/chat/ChatAttachmentView";
import { messageIsAttachmentFirst } from "@/lib/chatAttachments";
import { ChatMessage } from "@/hooks/useEncryptedChat";
import type { E2EVisualState } from "@/types/e2eChat";
import { Session } from "@/hooks/useChatSession";

const LOOKS_LIKE_E2E_CIPHER = (s: string): boolean => {
  const t = s.trim();
  return t.length >= 40 && /^[A-Za-z0-9+/=]+$/.test(t);
};

interface MessageListProps {
  messages: ChatMessage[];
  isLoading: boolean;
  isLoadingOlderMessages: boolean;
  hasOlderMessages: boolean;
  isAtBottom: boolean;
  showScrollToBottom: boolean;
  user: any;
  activeSession: Session | null;
  isPeerTyping: boolean;
  deletingMessageIds: Set<number>;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  onLoadOlder: () => Promise<void>;
  onDeleteMessage: (id: number) => Promise<void>;
  scrollToBottom: () => void;
  /** When set, empty-state starter lines fill the composer instead of being inert. */
  onStarterPrompt?: (draft: string) => void;
  messageScrollAreaRef: React.RefObject<HTMLDivElement>;
  scrollRef: React.RefObject<HTMLDivElement>;
  onRetryDecrypt?: () => void;
  onResyncDevice?: () => void;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  isLoading,
  isLoadingOlderMessages,
  hasOlderMessages,
  isAtBottom: _isAtBottom,
  showScrollToBottom,
  user,
  activeSession,
  isPeerTyping,
  deletingMessageIds,
  onScroll,
  onLoadOlder,
  onDeleteMessage,
  scrollToBottom,
  onStarterPrompt,
  messageScrollAreaRef,
  scrollRef,
  onRetryDecrypt,
  onResyncDevice,
}) => {
  React.useEffect(() => {
    const viewport = messageScrollAreaRef.current?.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]"
    );
    if (!viewport) return;

    const handleViewportScroll = () => {
      onScroll({ currentTarget: viewport } as React.UIEvent<HTMLDivElement>);
    };

    viewport.addEventListener("scroll", handleViewportScroll, { passive: true });
    handleViewportScroll();

    return () => {
      viewport.removeEventListener("scroll", handleViewportScroll);
    };
  }, [messageScrollAreaRef, onScroll]);

  const typingLabel =
    activeSession?.assigned_role === "peer_counselor" && Number(activeSession?.peer_counselor_id) > 0
      ? "Peer supporter is typing…"
      : "Counselor is typing…";

  const formatTime = (dateString: string) => {
    try {
      const d = new Date(dateString);
      if (Number.isNaN(d.getTime())) return "";
      return formatInDisplayZone(d, "h:mm a");
    } catch {
      return "";
    }
  };

  const renderMessageContent = (msg: ChatMessage, isOutgoing: boolean) => {
    if (messageIsAttachmentFirst(msg)) {
      return <ChatAttachmentView message={msg} isOutgoing={isOutgoing} />;
    }

    const failVisuals: E2EVisualState[] = ["awaiting_key", "needs_resync", "payload_invalid"];
    if (msg.is_encrypted && msg.e2eVisual && failVisuals.includes(msg.e2eVisual)) {
      return (
        <EncryptedMessagePlaceholder
          state={msg.e2eVisual}
          isOutgoing={isOutgoing}
          onRetryDecrypt={onRetryDecrypt}
          onResyncDevice={onResyncDevice}
        />
      );
    }

    const legacyBracket =
      msg.is_encrypted &&
      typeof msg.decryptedContent === "string" &&
      /^\s*\[(Encrypted message|Unable to decrypt)/i.test(msg.decryptedContent);
    if (legacyBracket) {
      return (
        <EncryptedMessagePlaceholder
          state="needs_resync"
          isOutgoing={isOutgoing}
          onRetryDecrypt={onRetryDecrypt}
          onResyncDevice={onResyncDevice}
        />
      );
    }

    if (
      msg.is_encrypted &&
      !msg.e2eVisual &&
      !String(msg.decryptedContent || "").trim() &&
      typeof msg.content === "string" &&
      LOOKS_LIKE_E2E_CIPHER(msg.content)
    ) {
      return (
        <EncryptedMessagePlaceholder
          state="awaiting_key"
          isOutgoing={isOutgoing}
          onRetryDecrypt={onRetryDecrypt}
          onResyncDevice={onResyncDevice}
        />
      );
    }

    const content = msg.decryptedContent ?? msg.content;
    
    return (
      <p className="whitespace-pre-wrap break-words">
        {content}
      </p>
    );
  };

  if (isLoading && messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-medium text-muted-foreground">Loading conversation...</p>
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="inline-flex rounded-[2rem] border border-primary/10 bg-primary/10 p-5">
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
            {(
              [
                {
                  draft: "I'm feeling a bit overwhelmed lately.",
                  label: 'Prompt: I\'m feeling a bit overwhelmed lately',
                  display: '"I\'m feeling a bit overwhelmed lately..."',
                },
                {
                  draft: "I'd like to check in on my wellness goals.",
                  label: "Prompt: I'd like to check in on my wellness goals",
                  display: '"I\'d like to check in on my wellness goals."',
                },
              ] as const
            ).map((prompt) =>
              onStarterPrompt ? (
                <button
                  key={prompt.draft}
                  type="button"
                  className="p-4 rounded-2xl bg-secondary/30 border border-border/50 text-sm font-medium text-muted-foreground italic text-left hover:bg-secondary/50 transition-colors"
                  onClick={() => onStarterPrompt(prompt.draft)}
                  aria-label={prompt.label}
                >
                  {prompt.display}
                </button>
              ) : (
                <p
                  key={prompt.draft}
                  className="p-4 rounded-2xl bg-secondary/30 border border-border/50 text-sm font-medium text-muted-foreground italic text-left"
                >
                  {prompt.display}
                </p>
              )
            )}
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
        <div className="flex min-h-full flex-col justify-end space-y-6 px-4 py-6 lg:px-6">
          {hasOlderMessages && (
            <div className="flex justify-center pb-4">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={onLoadOlder} 
                disabled={isLoadingOlderMessages}
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-primary"
                aria-label={isLoadingOlderMessages ? "Loading older messages" : "Load older messages"}
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
            const isMe =
              user?.id != null && String(msg.sender_id) === String(user.id);
            const showTime = idx === 0 || formatTime(msg.created_at) !== formatTime(messages[idx-1].created_at);
            const isDeleting = deletingMessageIds.has(msg.id);

            return (
              <div key={msg.id !== undefined && msg.id !== null ? msg.id : `m-${idx}`} className={`flex flex-col ${isMe ? "items-end" : "items-start"} group animate-in slide-in-from-bottom-2 duration-300`}>
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
                      aria-label={isDeleting ? "Deleting message" : "Delete message"}
                    >
                      {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </Button>
                  )}
                  
                  <div className={`relative px-4 py-3 rounded-[2rem] shadow-sm ${
                    isMe 
                      ? "bg-primary text-primary-foreground rounded-tr-none" 
                      : "bg-secondary/50 text-foreground rounded-tl-none border border-border/50"
                  }`}>
                    <ChatMessageErrorBoundary>
                      {renderMessageContent(msg, isMe)}
                    </ChatMessageErrorBoundary>
                  </div>
                </div>
                {isMe && (
                  <div className="mt-1 flex w-full max-w-[85%] lg:max-w-[70%] justify-end pr-1">
                    <div className="flex items-center gap-1.5 px-0.5">
                      <span
                        className={cn(
                          "text-[11px]",
                          msg.seen_at ? "text-emerald-500" : "text-muted-foreground/60"
                        )}
                        aria-label={msg.seen_at ? "Seen" : "Sent"}
                        title={msg.seen_at ? "Seen" : "Sent"}
                      >
                        {msg.seen_at ? "✓✓" : "✓"}
                      </span>
                    </div>
                  </div>
                )}
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
                {typingLabel}
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
          className="absolute bottom-6 right-6 h-10 w-10 rounded-full shadow-2xl border border-border/50 animate-in zoom-in fade-in duration-300 z-40 hover:scale-110 transition-transform"
          onClick={scrollToBottom}
          aria-label="Scroll to bottom of messages"
        >
          <ArrowDown className="h-5 w-5" />
        </Button>
      )}

    </div>
  );
};
