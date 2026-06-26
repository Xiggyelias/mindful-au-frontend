import React, { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { Virtuoso } from "react-virtuoso";
import { Shield, Loader2, Trash2, MessageSquare, ArrowDown, AlertTriangle, RefreshCw, Check, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { formatInDisplayZone } from "@/lib/displayTimezone";
import { ChatMessageErrorBoundary } from "@/components/chat/ChatMessageErrorBoundary";
import { ChatAttachmentView } from "@/components/chat/ChatAttachmentView";
import { messageIsAttachmentFirst } from "@/lib/chatAttachments";
import {
  chatAvatarClass,
  chatInitials,
  chatRoleBadgeClass,
  chatRoleLabel,
  chatSenderDisplayName,
  normalizeChatRole,
} from "@/lib/chatIdentity";
import { ChatMessage } from "@/hooks/useEncryptedChat";
import { useVirtuosoFirstItemIndex } from "@/hooks/useVirtuosoFirstItemIndex";
import { Session } from "@/hooks/useChatSession";


const formatTimeLabel = (dateString: string): string => {
  try {
    const d = new Date(dateString);
    if (Number.isNaN(d.getTime())) return "";
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();
    if (isToday) return formatInDisplayZone(d, "h:mm a");
    if (isYesterday) return `Yesterday · ${formatInDisplayZone(d, "h:mm a")}`;
    return formatInDisplayZone(d, "MMM d · h:mm a");
  } catch {
    return "";
  }
};

/** Key used for time-header grouping — includes the date so same-time messages
 *  on different days each get their own header. */
const makeTimeGroupKey = (dateString: string): string => {
  try {
    const d = new Date(dateString);
    if (Number.isNaN(d.getTime())) return "";
    return formatInDisplayZone(d, "yyyy-MM-dd h:mm a");
  } catch {
    return "";
  }
};

const deliveryLabel = (msg: ChatMessage) => {
  if (msg.delivery_status === "sending") return "Sending";
  if (msg.delivery_status === "failed") return "Failed";
  if (msg.seen_at || msg.delivery_status === "read") return "Read";
  if (msg.delivery_status === "delivered") return "Delivered";
  return "Sent";
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
  /** Retry uploading a failed optimistic voice note (pass its negative tempId). */
  onRetryUpload?: (tempId: number) => void;
  /** Remove a failed optimistic message entirely. */
  onDeleteOptimistic?: (tempId: number) => void;
  /** The tempId currently being uploaded (for progress bar). */
  uploadingTempId?: number;
  /** Upload progress 0-100 for the current upload. */
  currentUploadProgress?: number;
  senderFallbackName?: string;
};

const MessageBubble = React.memo(
  function MessageBubble({
    msg,
    isMe,
    showTime,
    timeLabel,
    isDeleting,
    onDeleteMessage,
    onRetryDecrypt: _onRetryDecrypt,
    onResyncDevice: _onResyncDevice,
    onRetryUpload,
    onDeleteOptimistic,
    uploadingTempId,
    currentUploadProgress,
    senderFallbackName,
  }: BubbleRenderProps) {
    const content = msg.decryptedContent ?? msg.content;
    const isDeletedMessage = content === "This message was deleted.";
    const senderRole = normalizeChatRole(msg.sender_role || (isMe ? "student" : undefined));
    const senderName = isMe ? "You" : chatSenderDisplayName(msg, senderFallbackName || chatRoleLabel(senderRole));
    const roleLabel = chatRoleLabel(senderRole);

    const renderBody = () => {
      if (messageIsAttachmentFirst(msg) && !isDeletedMessage) {
        const isThisUpload = msg.id === uploadingTempId;
        return (
          <ChatAttachmentView
            message={messageIsAttachmentFirst(msg) ? msg : { ...msg, attachment: null }}
            isOutgoing={isMe}
            uploadProgress={isThisUpload ? (currentUploadProgress ?? 0) : 0}
            isDeleting={isDeleting}
            onRetry={msg.uploadFailed && onRetryUpload ? () => onRetryUpload(msg.id) : undefined}
            onDelete={
              msg.uploadFailed && onDeleteOptimistic
                ? () => onDeleteOptimistic(msg.id)
                // Server-saved attachment: allow deletion via the normal path
                : !msg.isUploading && !msg.uploadFailed && msg.id > 0
                ? () => onDeleteMessage(msg.id)
                : undefined
            }
          />
        );
      }
      if (msg.is_encrypted && !msg.decryptedContent) {
        return (
          <p className="text-xs italic text-muted-foreground">
            [This older message cannot be displayed]
          </p>
        );
      }
      if (isDeletedMessage) {
        return (
          <p className="text-xs italic text-muted-foreground/80 flex items-center gap-1.5 select-none py-0.5">
            <span className="text-[12px] opacity-75">🚫</span> This message was deleted.
          </p>
        );
      }
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
        <div className={cn("flex w-full items-end gap-2", isMe ? "justify-end" : "justify-start")}>
          {!isMe && (
            <div
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-sm ring-2 ring-background",
                chatAvatarClass(senderRole)
              )}
              title={`${senderName} (${roleLabel})`}
            >
              {chatInitials(senderName)}
            </div>
          )}
          <div className={cn("flex min-w-0 max-w-[85%] flex-col lg:max-w-[70%]", isMe ? "items-end" : "items-start")}>
            <div className={cn("mb-1 flex max-w-full items-center gap-1.5 px-1", isMe ? "justify-end" : "justify-start")}>
              <span className="truncate text-[11px] font-semibold text-foreground/80">{senderName}</span>
              <span className={cn("shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide", chatRoleBadgeClass(senderRole))}>
                {roleLabel}
              </span>
            </div>
            <div className="flex items-center gap-2">
          {/* Show delete for plain text messages on hover.
              Attachment messages (voice/file/image) get their own delete button
              wired through ChatAttachmentView → VoiceMemoPlayer / image overlay. */}
          {!messageIsAttachmentFirst(msg) && !isDeletedMessage && msg.id > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-8 w-8 opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0 sm:opacity-0 sm:group-hover:opacity-100",
                isMe ? "order-first" : "order-last"
              )}
              onClick={() => onDeleteMessage(msg.id)}
              disabled={isDeleting}
              aria-label={isDeleting ? "Deleting message" : "Delete message"}
            >
              {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          )}
          {/* For non-voice attachment messages (images, files) show an outer
              delete button. Voice notes render their own inside VoiceMemoPlayer. */}
          {messageIsAttachmentFirst(msg) && msg.id > 0 && !msg.isUploading && !msg.uploadFailed && !isDeletedMessage && msg.message_type !== "voice" && (
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-8 w-8 opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0 sm:opacity-0 sm:group-hover:opacity-100",
                isMe ? "order-first" : "order-last"
              )}
              onClick={() => onDeleteMessage(msg.id)}
              disabled={isDeleting}
              aria-label={isDeleting ? "Deleting attachment" : "Delete attachment"}
            >
              {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          )}
          {messageIsAttachmentFirst(msg) && !isDeletedMessage ? (
            <div className="min-w-0">
              <ChatMessageErrorBoundary>{renderBody()}</ChatMessageErrorBoundary>
            </div>
          ) : (
            <div
              className={cn(
                "relative px-4 py-3 min-w-[2.75rem] rounded-2xl shadow-sm transition-all duration-200",
                isDeletedMessage
                  ? "bg-secondary/15 border border-dashed border-border/80 text-muted-foreground/80 rounded-2xl"
                  : isMe
                  ? "bg-primary text-primary-foreground rounded-tr-sm"
                  : "bg-secondary/50 text-foreground rounded-tl-sm border border-border/50"
              )}
            >
              <ChatMessageErrorBoundary>{renderBody()}</ChatMessageErrorBoundary>
            </div>
          )}
            </div>
          </div>
        </div>
        {isMe && (
          <div className="mt-1 flex w-full max-w-[85%] lg:max-w-[70%] justify-end pr-1">
            <div className="flex items-center gap-1.5 px-0.5">
              <span
                className={cn(
                  "inline-flex items-center",
                  msg.delivery_status === "failed"
                    ? "text-destructive"
                    : msg.seen_at || msg.delivery_status === "read"
                    ? "text-emerald-500"
                    : "text-muted-foreground/60"
                )}
                aria-label={deliveryLabel(msg)}
                title={deliveryLabel(msg)}
              >
                {msg.delivery_status === "sending" ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                ) : msg.delivery_status === "failed" ? (
                  <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                ) : msg.seen_at || msg.delivery_status === "read" || msg.delivery_status === "delivered" ? (
                  <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                )}
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
    prev.msg.sender_role === next.msg.sender_role &&
    prev.msg.sender_name_snapshot === next.msg.sender_name_snapshot &&
    prev.msg.sender_display_name === next.msg.sender_display_name &&
    prev.msg.is_encrypted === next.msg.is_encrypted &&
    prev.msg.message_type === next.msg.message_type &&
    prev.msg.file_url === next.msg.file_url &&
    prev.msg.has_file === next.msg.has_file &&
    prev.msg.attachment?.id === next.msg.attachment?.id &&
    prev.msg.attachment?.url === next.msg.attachment?.url &&
    prev.msg.isUploading === next.msg.isUploading &&
    prev.msg.uploadFailed === next.msg.uploadFailed &&
    prev.msg.delivery_status === next.msg.delivery_status &&
    prev.msg.is_deleted === next.msg.is_deleted &&
    prev.isMe === next.isMe &&
    prev.showTime === next.showTime &&
    prev.timeLabel === next.timeLabel &&
    prev.isDeleting === next.isDeleting &&
    prev.uploadingTempId === next.uploadingTempId &&
    prev.currentUploadProgress === next.currentUploadProgress &&
    prev.senderFallbackName === next.senderFallbackName
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
  /** Retry uploading a failed optimistic voice note. */
  onRetryUpload?: (tempId: number) => void;
  /** Remove a failed optimistic message entirely. */
  onDeleteOptimistic?: (tempId: number) => void;
  /** The tempId currently being uploaded (for progress bar). */
  uploadingTempId?: number;
  /** Upload progress 0-100 for the current upload. */
  currentUploadProgress?: number;
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
  onRetryUpload,
  onDeleteOptimistic,
  uploadingTempId,
  currentUploadProgress,
}) => {
  const firstItemIndex = useVirtuosoFirstItemIndex(messages, conversationKey);
  const olderInflightRef = useRef(false);

  // ── Plain DOM path scroll logic (messages.length <= 200) ────────────────
  const NEAR_BOTTOM_THRESHOLD = 150;
  const isNearBottomRef = useRef(true);
  const prevMessageCountRef = useRef(0);
  // Saved (scrollHeight - scrollTop) before older messages are prepended,
  // so we can restore position after the DOM update.
  const savedDistanceFromBottomRef = useRef<number | null>(null);

  const handlePlainScroll = useCallback(() => {
    const container = messageScrollAreaRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceToBottom = scrollHeight - clientHeight - scrollTop;
    const nearBottom = distanceToBottom <= NEAR_BOTTOM_THRESHOLD;
    isNearBottomRef.current = nearBottom;
    onAtBottomChange?.(nearBottom);

    // ADD THIS: auto-load older messages when near top
    if (scrollTop < 80 && hasOlderMessages && 
        !isLoadingOlderMessages && !olderInflightRef.current) {
      olderInflightRef.current = true;
      void Promise.resolve(onLoadOlder()).finally(() => {
        olderInflightRef.current = false;
      });
    }
  }, [hasOlderMessages, isLoadingOlderMessages, onLoadOlder, messageScrollAreaRef, onAtBottomChange]);

  // Save scroll anchor before older messages load (fires before paint).
  useLayoutEffect(() => {
    if (messages.length > 200) return;
    if (isLoadingOlderMessages) {
      const container = messageScrollAreaRef.current;
      if (container) {
        savedDistanceFromBottomRef.current =
          container.scrollHeight - container.scrollTop;
      }
    }
  }, [isLoadingOlderMessages, messages.length, messageScrollAreaRef]);

  // Restore scroll anchor after older messages are prepended.
  useLayoutEffect(() => {
    if (messages.length > 200) return;
    if (!isLoadingOlderMessages && savedDistanceFromBottomRef.current !== null) {
      const container = messageScrollAreaRef.current;
      if (container) {
        container.scrollTop =
          container.scrollHeight - savedDistanceFromBottomRef.current;
      }
      savedDistanceFromBottomRef.current = null;
    }
  }, [isLoadingOlderMessages, messages.length, messageScrollAreaRef]);

  // Reset per-session scroll tracking when the conversation changes.
  useEffect(() => {
    prevMessageCountRef.current = 0;
    isNearBottomRef.current = true;
    savedDistanceFromBottomRef.current = null;
  }, [conversationKey]);

  // Auto-scroll to bottom when new messages arrive (or on first load).
  useEffect(() => {
    if (messages.length > 200) return;
    const isInitialLoad =
      prevMessageCountRef.current === 0 && messages.length > 0;
    const hasNewMessages = messages.length > prevMessageCountRef.current;
    if (isInitialLoad || (hasNewMessages && isNearBottomRef.current)) {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollIntoView({
          behavior: isInitialLoad ? "auto" : "smooth",
        });
      });
    }
    prevMessageCountRef.current = messages.length;
  }, [messages.length, scrollRef]);

  const typingLabel =
    activeSession?.assigned_role === "peer_counselor" && Number(activeSession?.peer_counselor_id) > 0
      ? "Peer supporter is typing…"
      : "Counselor is typing…";

  const supportFallbackName =
    activeSession?.assigned_role === "peer_counselor" && Number(activeSession?.peer_counselor_id) > 0
      ? activeSession.peer_counselor?.profile?.full_name ||
        activeSession.peer_counselor?.email ||
        "Peer Counselor"
      : activeSession?.counselor?.profile?.full_name ||
        activeSession?.counselor?.email ||
        "Counselor";

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
      <div className="flex-1 p-6">
        <div className="space-y-4 animate-pulse">
          {Array.from({ length: 6 }, (_, idx) => (
            <div key={idx} className={cn("flex", idx % 2 === 0 ? "justify-start" : "justify-end")}>
              <div className={cn("h-14 rounded-3xl bg-slate-200/80", idx % 2 === 0 ? "w-2/3" : "w-1/2")} />
            </div>
          ))}
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
      <div className="relative flex-1 overflow-hidden p-8">
        <div className="pointer-events-none absolute -left-16 top-16 h-48 w-48 rounded-full bg-emerald-300/20 blur-3xl" />
        <div className="pointer-events-none absolute bottom-8 right-10 h-56 w-56 rounded-full bg-sky-300/20 blur-3xl" />
        <div className="relative mx-auto flex h-full max-w-lg items-center justify-center">
          <div className="w-full rounded-[2rem] border border-slate-200/70 bg-white/75 p-8 text-center shadow-xl backdrop-blur-sm dark:bg-slate-900/55">
          <div className="mx-auto mb-4 inline-flex rounded-[1.75rem] border border-emerald-200/70 bg-emerald-100/80 p-5 shadow-sm">
            <Shield className="h-10 w-10 text-emerald-700 animate-pulse" />
          </div>
          <div className="space-y-2">
            <h3 className="text-2xl font-display font-bold tracking-tight text-slate-900 dark:text-slate-50">Start a Safe Conversation</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Select a student conversation to begin. This private channel is designed for calm, supportive, secure communication.
            </p>
          </div>
          <div className="grid gap-3 pt-5">
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
      </div>
    );
  }

  // Reliability fallback: avoid virtualization glitches on common chat sizes.
  // This keeps student/counselor threads visible even when Virtuoso state drifts.
  if (messages.length <= 200) {
    return (
      <div ref={messageScrollAreaRef} onScroll={handlePlainScroll} className="h-full flex-1 relative overflow-auto flex flex-col min-h-0">
        <div className="px-4 pt-3 lg:px-6">
          {hasOlderMessages && (
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
          )}
          {messages.map((msg, idx) => {
            const prev = idx > 0 ? messages[idx - 1] ?? null : null;
            const isMe = user?.id != null && String(msg.sender_id) === String(user.id);
            const timeLabel = formatTimeLabel(msg.created_at);
            const showTime = idx === 0 || !prev || makeTimeGroupKey(prev.created_at) !== makeTimeGroupKey(msg.created_at);
            const isDeleting = deletingMessageIds.has(msg.id);
            return (
              <div
                key={msg.id}
                className={cn(
                  "pb-6 motion-reduce:animate-none",
                  msg.isUploading || (msg.id < 0 && !msg.uploadFailed)
                    ? "animate-voice-bubble-in"
                    : "animate-in slide-in-from-bottom-2 duration-300"
                )}
              >
                <MessageBubble
                  msg={msg}
                  isMe={isMe}
                  showTime={showTime}
                  timeLabel={timeLabel}
                  isDeleting={isDeleting}
                  onDeleteMessage={onDeleteMessage}
                  onRetryDecrypt={onRetryDecrypt}
                  onResyncDevice={onResyncDevice}
                  onRetryUpload={onRetryUpload}
                  onDeleteOptimistic={onDeleteOptimistic}
                  uploadingTempId={uploadingTempId}
                  currentUploadProgress={currentUploadProgress}
                  senderFallbackName={supportFallbackName}
                />
              </div>
            );
          })}
          {isPeerTyping && (
            <div className="flex items-center gap-3 pb-4 animate-in fade-in slide-in-from-left-2 duration-500 motion-reduce:animate-none">
              <div className="flex gap-1.5 rounded-2xl rounded-tl-sm border border-border/50 bg-secondary/35 px-4 py-3 shadow-sm flex items-center justify-center">
                <span className="h-2 w-2 rounded-full bg-rose-600/70 dark:bg-rose-400/80 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="h-2 w-2 rounded-full bg-rose-600/70 dark:bg-rose-400/80 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="h-2 w-2 rounded-full bg-rose-600/70 dark:bg-rose-400/80 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                {typingLabel}
              </span>
            </div>
          )}
          <div ref={scrollRef} className="h-px w-full" />
        </div>

        {showScrollToBottom && (
          <Button
            size="icon"
            variant="secondary"
            className="absolute bottom-6 right-6 z-40 h-10 w-10 rounded-full border border-border/50 shadow-2xl animate-in zoom-in fade-in duration-300 transition-transform hover:scale-110 motion-reduce:animate-none motion-reduce:transition-none"
            onClick={scrollToBottom}
            aria-label="Scroll to bottom of messages"
          >
            <ArrowDown className="h-5 w-5" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <div ref={messageScrollAreaRef} className="h-full flex-1 relative overflow-hidden flex flex-col min-h-0">
      <Virtuoso
        key={conversationKey}
        style={{ height: "100%" }}
        data={messages}
        firstItemIndex={firstItemIndex}
        initialTopMostItemIndex={Math.max(0, messages.length - 1)}
        atBottomStateChange={onAtBottomChange}
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
            <div className="space-y-6 pb-6 motion-reduce:animate-none">
              {isPeerTyping && (
                <div className="flex items-center gap-3 px-4 lg:px-6 animate-in fade-in slide-in-from-left-2 duration-500 motion-reduce:animate-none">
                  <div className="flex gap-1.5 rounded-2xl rounded-tl-sm border border-border/50 bg-secondary/35 px-4 py-3 shadow-sm flex items-center justify-center">
                    <span className="h-2 w-2 rounded-full bg-rose-600/70 dark:bg-rose-400/80 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="h-2 w-2 rounded-full bg-rose-600/70 dark:bg-rose-400/80 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="h-2 w-2 rounded-full bg-rose-600/70 dark:bg-rose-400/80 animate-bounce" style={{ animationDelay: "300ms" }} />
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
            dataIndex === 0 || !prev || makeTimeGroupKey(prev.created_at) !== makeTimeGroupKey(msg.created_at);
          const isDeleting = deletingMessageIds.has(msg.id);

          return (
            <div className="animate-in slide-in-from-bottom-2 px-4 pb-6 duration-300 motion-reduce:animate-none lg:px-6">
              <MessageBubble
                msg={msg}
                isMe={isMe}
                showTime={showTime}
                timeLabel={timeLabel}
                isDeleting={isDeleting}
                onDeleteMessage={onDeleteMessage}
                onRetryDecrypt={onRetryDecrypt}
                onResyncDevice={onResyncDevice}
                onRetryUpload={onRetryUpload}
                onDeleteOptimistic={onDeleteOptimistic}
                uploadingTempId={uploadingTempId}
                currentUploadProgress={currentUploadProgress}
                senderFallbackName={supportFallbackName}
              />
            </div>
          );
        }}
      />

      {showScrollToBottom && (
        <Button
          size="icon"
          variant="secondary"
          className="absolute bottom-6 right-6 z-40 h-10 w-10 rounded-full border border-border/50 shadow-2xl animate-in zoom-in fade-in duration-300 transition-transform hover:scale-110 motion-reduce:animate-none motion-reduce:transition-none"
          onClick={scrollToBottom}
          aria-label="Scroll to bottom of messages"
        >
          <ArrowDown className="h-5 w-5" />
        </Button>
      )}
    </div>
  );
};
