import React, { useCallback, useRef } from "react";
import { Virtuoso } from "react-virtuoso";
import { Shield, Loader2, Trash2, MessageSquare, ArrowDown, AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { formatInDisplayZone } from "@/lib/displayTimezone";
import { EncryptedMessagePlaceholder } from "@/components/chat/EncryptedMessagePlaceholder";
import { ChatMessageErrorBoundary } from "@/components/chat/ChatMessageErrorBoundary";
import { ChatAttachmentView } from "@/components/chat/ChatAttachmentView";
import { messageIsAttachmentFirst } from "@/lib/chatAttachments";
import { ChatMessage } from "@/hooks/useEncryptedChat";
import { useVirtuosoFirstItemIndex } from "@/hooks/useVirtuosoFirstItemIndex";
import type { E2EVisualState } from "@/types/e2eChat";
import { Session } from "@/hooks/useChatSession";

const LOOKS_LIKE_E2E_CIPHER = (s: string): boolean => {
  const t = s.trim();
  return t.length >= 40 && /^[A-Za-z0-9+/=]+$/.test(t);
};

const formatTimeLabel = (dateString: string): string => {
  try {
    const d = new Date(dateString);
    if (Number.isNaN(d.getTime())) return "";
    return formatInDisplayZone(d, "h:mm a");
  } catch {
    return "";
  }
};

type BubbleRenderProps = {
  msg: ChatMessage;
  isMe: boolean;
  showTime: boolean;
  timeLabel: string;
  isDeleting: boolean;
  onDeleteMessage: (id: number) => Promise<void>;
  onRetryDecrypt?: () => void;
  onResyncDevice?: () => void;
};

const MessageBubble = React.memo(
  function MessageBubble({
    msg,
    isMe,
    showTime,
    timeLabel,
    isDeleting,
    onDeleteMessage,
    onRetryDecrypt,
    onResyncDevice,
  }: BubbleRenderProps) {
    const renderBody = () => {
      if (messageIsAttachmentFirst(msg)) {
        return <ChatAttachmentView message={msg} isOutgoing={isMe} />;
      }

      // Add shimmer for decrypting messages
      if (msg.is_encrypted === true && !msg.decryptedContent && msg.e2eVisual === "decrypting") {
        return <div className="h-4 w-48 rounded bg-white/10 animate-pulse" />;
      }

      const failVisuals: E2EVisualState[] = ["awaiting_key", "needs_resync", "payload_invalid"];
      if (msg.is_encrypted && msg.e2eVisual && failVisuals.includes(msg.e2eVisual)) {
        return (
          <EncryptedMessagePlaceholder
            state={msg.e2eVisual as "awaiting_key" | "needs_resync" | "payload_invalid"}
            isOutgoing={isMe}
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
            isOutgoing={isMe}
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
            isOutgoing={isMe}
            onRetryDecrypt={onRetryDecrypt}
            onResyncDevice={onResyncDevice}
          />
        );
      }

      const content = msg.decryptedContent ?? msg.content;
      return <p className="whitespace-pre-wrap break-words">{content}</p>;
    };

    return (
      <div
        className={cn(
          "flex flex-col group",
          isMe ? "items-end" : "items-start"
        )}
      >
        {showTime && (
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-2 px-1">
            {timeLabel}
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
          <div
            className={cn(
              "relative px-4 py-3 rounded-[2rem] shadow-sm",
              isMe
                ? "bg-primary text-primary-foreground rounded-tr-none"
                : "bg-secondary/50 text-foreground rounded-tl-none border border-border/50"
            )}
          >
            <ChatMessageErrorBoundary>{renderBody()}</ChatMessageErrorBoundary>
          </div>
        </div>
        {isMe && (
          <div className="mt-1 flex w-full max-w-[85%] lg:max-w-[70%] justify-end pr-1">
            <div className="flex items-center gap-1.5 px-0.5">
              <span
                className={cn("text-[11px]", msg.seen_at ? "text-emerald-500" : "text-muted-foreground/60")}
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
  },
  (prev, next) =>
    prev.msg.id === next.msg.id &&
    prev.msg.seen_at === next.msg.seen_at &&
    prev.msg.decryptedContent === next.msg.decryptedContent &&
    prev.msg.e2eVisual === next.msg.e2eVisual &&
    prev.msg.content === next.msg.content &&
    prev.msg.is_encrypted === next.msg.is_encrypted &&
    prev.msg.message_type === next.msg.message_type &&
    prev.msg.file_url === next.msg.file_url &&
    prev.msg.has_file === next.msg.has_file &&
    prev.msg.attachment?.id === next.msg.attachment?.id &&
    prev.msg.attachment?.url === next.msg.attachment?.url &&
    prev.isMe === next.isMe &&
    prev.showTime === next.showTime &&
    prev.timeLabel === next.timeLabel &&
    prev.isDeleting === next.isDeleting
);

interface MessageListProps {
  /** Stabilizes scroll when older messages prepend; use active session id. */
  conversationKey: string;
  messages: ChatMessage[];
  isLoading: boolean;
  isLoadingOlderMessages: boolean;
  hasOlderMessages: boolean;
  isAtBottom: boolean;
  showScrollToBottom: boolean;
  user: { id?: string | number | null } | null;
  activeSession: Session | null;
  isPeerTyping: boolean;
  deletingMessageIds: Set<number>;
  /** Error message if conversation failed to load */
  error?: string | null;
  /** Fired when the virtual list reports bottom state (for scroll-to-bottom FAB). */
  onAtBottomChange?: (atBottom: boolean) => void;
  onLoadOlder: () => Promise<void>;
  onDeleteMessage: (id: number) => Promise<void>;
  scrollToBottom: () => void;
  /** When set, empty-state starter lines fill the composer instead of being inert. */
  onStarterPrompt?: (draft: string) => void;
  messageScrollAreaRef: React.RefObject<HTMLDivElement | null>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onRetryDecrypt?: () => void;
  onResyncDevice?: () => void;
  /** Retry loading the conversation */
  onRetryLoad?: () => void;
}

export const MessageList: React.FC<MessageListProps> = ({
  conversationKey,
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
  error,
  onAtBottomChange,
  onLoadOlder,
  onDeleteMessage,
  scrollToBottom,
  onStarterPrompt,
  messageScrollAreaRef,
  scrollRef,
  onRetryDecrypt,
  onResyncDevice,
  onRetryLoad,
}) => {
  const firstItemIndex = useVirtuosoFirstItemIndex(messages, conversationKey);
  const olderInflightRef = useRef(false);

  const typingLabel =
    activeSession?.assigned_role === "peer_counselor" && Number(activeSession?.peer_counselor_id) > 0
      ? "Peer supporter is typing…"
      : "Counselor is typing…";

  const handleStartReached = useCallback(() => {
    if (!hasOlderMessages || isLoadingOlderMessages || olderInflightRef.current) {
      return;
    }
    olderInflightRef.current = true;
    void Promise.resolve(onLoadOlder()).finally(() => {
      olderInflightRef.current = false;
    });
  }, [hasOlderMessages, isLoadingOlderMessages, onLoadOlder]);

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

  // Show error state with retry button if conversation failed to load
  if (error && messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="inline-flex rounded-[2rem] border border-destructive/20 bg-destructive/10 p-5">
            <AlertTriangle className="h-12 w-12 text-destructive" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-display font-bold tracking-tight">Could not load conversation</h3>
            <p className="text-muted-foreground leading-rel">{error}</p>
          </div>
          {onRetryLoad && (
            <Button onClick={onRetryLoad} variant="default" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Retry loading conversation
            </Button>
          )}
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
              Every word you share here is private and end-to-end encrypted. What would you like to talk about today?
            </p>
          </div>
          <div className="grid gap-3 pt-4">
            {(
              [
                {
                  draft: "I'm feeling a bit overwhelmed lately.",
                  label: "Prompt: I'm feeling a bit overwhelmed lately",
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
    <div ref={messageScrollAreaRef} className="flex-1 relative overflow-hidden flex flex-col min-h-0">
      <Virtuoso
        style={{ height: "100%" }}
        data={messages}
        firstItemIndex={firstItemIndex}
        atBottomStateChange={onAtBottomChange}
        alignToBottom
        followOutput="smooth"
        increaseViewportBy={{ top: 320, bottom: 480 }}
        defaultItemHeight={88}
        startReached={handleStartReached}
        components={{
          Header: () =>
            hasOlderMessages ? (
              <div className="flex justify-center pb-4 pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void onLoadOlder()}
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
            ) : (
              <div className="h-2 shrink-0" aria-hidden />
            ),
          Footer: () => (
            <div className="space-y-6 pb-6">
              {isPeerTyping && (
                <div className="flex items-center gap-3 px-4 lg:px-6 animate-in fade-in slide-in-from-left-2 duration-500">
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
          ),
        }}
        itemContent={(index, msg) => {
          const dataIndex = index - firstItemIndex;
          const prev = dataIndex > 0 ? messages[dataIndex - 1] ?? null : null;
          const isMe = user?.id != null && String(msg.sender_id) === String(user.id);
          const timeLabel = formatTimeLabel(msg.created_at);
          const showTime =
            dataIndex === 0 || !prev || formatTimeLabel(prev.created_at) !== timeLabel;
          const isDeleting = deletingMessageIds.has(msg.id);

          return (
            <div className="px-4 lg:px-6 pb-6 animate-in slide-in-from-bottom-2 duration-300">
              <MessageBubble
                msg={msg}
                isMe={isMe}
                showTime={showTime}
                timeLabel={timeLabel}
                isDeleting={isDeleting}
                onDeleteMessage={onDeleteMessage}
                onRetryDecrypt={onRetryDecrypt}
                onResyncDevice={onResyncDevice}
              />
            </div>
          );
        }}
      />

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
