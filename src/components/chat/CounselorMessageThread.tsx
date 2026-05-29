import React, { useCallback, useRef } from "react";
import { Virtuoso } from "react-virtuoso";
import { Loader2, Trash2, ArrowDown, AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  formatInDisplayZone,
  isTodayInDisplayZone,
  isYesterdayInDisplayZone,
} from "@/lib/displayTimezone";
import { ChatMessageErrorBoundary } from "@/components/chat/ChatMessageErrorBoundary";
import type { ChatMessage } from "@/hooks/useEncryptedChat";
import { useVirtuosoFirstItemIndex } from "@/hooks/useVirtuosoFirstItemIndex";

const parseBackendDateThread = (value?: string | null): Date | null => {
  if (value == null) return null;
  const s = String(value).trim();
  if (s === "") return null;
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) {
    const legacy = new Date(s.replace(" ", "T"));
    if (!Number.isNaN(legacy.getTime())) return legacy;
  }
  return null;
};

const formatMessageTime = (dateString?: string) => {
  const d = parseBackendDateThread(dateString);
  if (!d) return "";
  if (isTodayInDisplayZone(d)) return formatInDisplayZone(d, "h:mm a");
  if (isYesterdayInDisplayZone(d)) return `Yesterday ${formatInDisplayZone(d, "h:mm a")}`;
  return formatInDisplayZone(d, "MMM d, h:mm a");
};

const getInitials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
};

const getUserColor = (name: string) => {
  const colors = [
    "bg-blue-500",
    "bg-purple-500",
    "bg-emerald-500",
    "bg-orange-500",
    "bg-pink-500",
    "bg-indigo-500",
    "bg-cyan-500",
    "bg-rose-500",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

type RowProps = {
  msg: ChatMessage;
  prevSenderId: string | null;
  currentUserId: number | string;
  studentLabel: string;
  studentIsAnonymous: boolean;
  isDeleting: boolean;
  canModerateChat: boolean;
  onDeleteMessage: (id: number) => void | Promise<void>;
  renderMessageContent: (msg: ChatMessage, isOutgoing: boolean) => React.ReactNode;
};

const CounselorMessageRow = React.memo(
  function CounselorMessageRow({
    msg,
    prevSenderId,
    currentUserId,
    studentLabel,
    studentIsAnonymous,
    isDeleting,
    canModerateChat,
    onDeleteMessage,
    renderMessageContent,
  }: RowProps) {
    const isMine = Boolean(currentUserId) && String(msg.sender_id) === String(currentUserId);
    const sameSenderAsPrev = prevSenderId !== null && prevSenderId === String(msg.sender_id);
    const showAvatar = !sameSenderAsPrev;
    const incomingInitials = studentIsAnonymous ? "AU" : getInitials(studentLabel);

    return (
      <div
        className={cn("flex w-full min-w-0 items-end gap-2.5", isMine ? "justify-end" : "justify-start")}
      >
        {!isMine && (
          <div className="flex w-9 shrink-0 justify-center">
            {showAvatar ? (
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-sm ring-2 ring-background ${getUserColor(studentLabel)}`}
                title={studentLabel}
              >
                {incomingInitials}
              </div>
            ) : (
              <div className="h-9 w-9" aria-hidden />
            )}
          </div>
        )}

        <div className={`group flex min-w-0 max-w-[min(92%,36rem)] flex-col gap-0.5 ${isMine ? "items-end" : "items-start"}`}>
          <div className={cn("flex items-end gap-1", isMine ? "flex-row-reverse" : "flex-row")}>
            {/* Attachment-first messages (voice notes, files, images) supply their own
                visual bubble via ChatAttachmentView — skip the outer wrapper so we
                don't get a double-bubble with extra padding. */}
            {msg.message_type === "voice" || msg.message_type === "file" || msg.has_file ? (
              <div className="min-w-0">
                <ChatMessageErrorBoundary>{renderMessageContent(msg, isMine)}</ChatMessageErrorBoundary>
              </div>
            ) : (
            <div
              className={cn(
                "rounded-2xl border px-4 py-3 shadow-sm transition-colors duration-200",
                isMine
                  ? "rounded-br-md border-primary/30 bg-primary text-primary-foreground"
                  : "rounded-bl-md border-border/60 bg-muted/80 text-foreground dark:bg-muted/40"
              )}
            >
              <div className="text-[15px] leading-relaxed">
                <ChatMessageErrorBoundary>{renderMessageContent(msg, isMine)}</ChatMessageErrorBoundary>
              </div>
            </div>
            )}
            {canModerateChat ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  "h-8 w-8 shrink-0 opacity-0 transition-opacity group-hover:opacity-100",
                  isMine
                    ? "text-primary-foreground/90 hover:bg-primary-foreground/15 hover:text-primary-foreground"
                    : "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                )}
                disabled={isDeleting}
                onClick={() => void onDeleteMessage(msg.id)}
                aria-label="Delete message"
              >
                {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </Button>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5 px-0.5">
            <span className="text-[10px] font-medium text-muted-foreground">{formatMessageTime(msg.created_at)}</span>
            {isMine && (
              <span
                className={cn("text-[11px]", msg.seen_at ? "text-emerald-500" : "text-muted-foreground/50")}
                aria-label={msg.seen_at ? "Seen" : "Sent"}
                title={msg.seen_at ? "Seen" : "Sent"}
              >
                {msg.seen_at ? "✓✓" : "✓"}
              </span>
            )}
          </div>
        </div>
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
    prev.prevSenderId === next.prevSenderId &&
    prev.isDeleting === next.isDeleting &&
    prev.canModerateChat === next.canModerateChat &&
    prev.currentUserId === next.currentUserId &&
    prev.studentLabel === next.studentLabel &&
    prev.studentIsAnonymous === next.studentIsAnonymous &&
    prev.renderMessageContent === next.renderMessageContent
);

export type CounselorMessageThreadProps = {
  /** Resets prepend scroll tracking when the open conversation changes. */
  conversationKey: string;
  messages: ChatMessage[];
  currentUserId: number | string;
  studentLabel: string;
  studentIsAnonymous: boolean;
  isPeerTyping: boolean;
  hasOlderMessages: boolean;
  isLoadingOlderMessages: boolean;
  /** Error message if conversation failed to load */
  error?: string | null;
  onLoadOlder: () => void | Promise<void>;
  deletingMessageIds: Set<number>;
  onDeleteMessage: (id: number) => void | Promise<void>;
  canModerateChat: boolean;
  renderMessageContent: (msg: ChatMessage, isOutgoing: boolean) => React.ReactNode;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onAtBottomChange?: (atBottom: boolean) => void;
  showScrollToBottom?: boolean;
  scrollToBottom?: () => void;
  /** Retry loading the conversation */
  onRetryLoad?: () => void;
};

export const CounselorMessageThread: React.FC<CounselorMessageThreadProps> = ({
  conversationKey,
  messages,
  currentUserId,
  studentLabel,
  studentIsAnonymous,
  isPeerTyping,
  hasOlderMessages,
  isLoadingOlderMessages,
  error,
  onLoadOlder,
  deletingMessageIds,
  onDeleteMessage,
  canModerateChat,
  renderMessageContent,
  scrollRef,
  containerRef,
  onAtBottomChange,
  showScrollToBottom = false,
  scrollToBottom,
  onRetryLoad,
}) => {
  const firstItemIndex = useVirtuosoFirstItemIndex(messages, conversationKey);
  const olderInflightRef = useRef(false);

  const handleStartReached = useCallback(() => {
    if (!hasOlderMessages || isLoadingOlderMessages || olderInflightRef.current) {
      return;
    }
    olderInflightRef.current = true;
    void Promise.resolve(onLoadOlder()).finally(() => {
      olderInflightRef.current = false;
    });
  }, [hasOlderMessages, isLoadingOlderMessages, onLoadOlder]);

  // Show error state with retry button if conversation failed to load
  if (error && messages.length === 0) {
    return (
      <div ref={containerRef} className="relative min-h-0 flex-1 flex items-center justify-center p-8">
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

  return (
    <div ref={containerRef} className="relative min-h-0 flex-1 flex flex-col">
      {messages.length === 0 && !error ? (
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-8">
          <div className="pointer-events-none absolute -left-16 top-16 h-48 w-48 rounded-full bg-emerald-300/20 blur-3xl" />
          <div className="pointer-events-none absolute bottom-8 right-10 h-56 w-56 rounded-full bg-sky-300/20 blur-3xl" />
          <div className="relative w-full max-w-lg rounded-[2rem] border border-slate-200/70 bg-white/75 p-8 text-center shadow-xl backdrop-blur-sm">
            <div className="mx-auto mb-4 inline-flex rounded-[1.75rem] border border-emerald-200/70 bg-emerald-100/80 p-5 shadow-sm">
              <Loader2 className="h-8 w-8 text-emerald-700 animate-spin" />
            </div>
            <h3 className="text-xl font-display font-bold tracking-tight text-slate-900">Preparing secure thread</h3>
            <p className="mt-2 text-sm text-muted-foreground">Encrypted conversation context is loading.</p>
          </div>
        </div>
      ) : null}
      <Virtuoso
        key={conversationKey}
        style={{ height: "100%" }}
        data={messages}
        firstItemIndex={firstItemIndex}
        initialTopMostItemIndex={Math.max(0, messages.length - 1)}
        atBottomStateChange={onAtBottomChange}
        followOutput="smooth"
        defaultItemHeight={96}
        increaseViewportBy={{ top: 280, bottom: 400 }}
        startReached={handleStartReached}
        components={{
          Header: () =>
            hasOlderMessages ? (
              <div className="mx-auto flex w-full max-w-3xl justify-center px-3 pt-2 md:max-w-none md:px-6">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void onLoadOlder()}
                  disabled={isLoadingOlderMessages}
                >
                  {isLoadingOlderMessages ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Loading older...
                    </span>
                  ) : (
                    "Load older messages"
                  )}
                </Button>
              </div>
            ) : (
              <div className="h-1 shrink-0" aria-hidden />
            ),
          Footer: () => (
            <div className="mx-auto w-full max-w-3xl space-y-3 px-3 md:max-w-none md:px-6 lg:py-2 motion-reduce:animate-none">
              {isPeerTyping && (
                <div className="flex items-end gap-2.5 motion-reduce:animate-none">
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-sm ring-2 ring-background ${getUserColor(studentLabel)}`}
                  >
                    {studentIsAnonymous ? "AU" : getInitials(studentLabel)}
                  </div>
                  <div className="max-w-[min(92%,36rem)] rounded-2xl rounded-bl-md border border-border/50 bg-secondary/35 px-4 py-3 shadow-sm flex items-center justify-center flex-col items-start gap-1">
                    <p className="text-[11px] font-medium text-muted-foreground">Student is typing…</p>
                    <div className="flex items-center gap-1.5 py-0.5">
                      <span
                        className="h-2 w-2 rounded-full bg-rose-600/70 dark:bg-rose-400/80 animate-bounce"
                        style={{ animationDelay: "0ms" }}
                      />
                      <span
                        className="h-2 w-2 rounded-full bg-rose-600/70 dark:bg-rose-400/80 animate-bounce"
                        style={{ animationDelay: "150ms" }}
                      />
                      <span
                        className="h-2 w-2 rounded-full bg-rose-600/70 dark:bg-rose-400/80 animate-bounce"
                        style={{ animationDelay: "300ms" }}
                      />
                    </div>
                  </div>
                </div>
              )}
              <div ref={scrollRef} className="h-px w-full" />
            </div>
          ),
        }}
        itemContent={(index, msg) => {
          const dataIndex = index - firstItemIndex;
          const prev = dataIndex > 0 ? messages[dataIndex - 1] ?? null : null;
          const prevSenderId = prev ? String(prev.sender_id) : null;
          const isDeleting = deletingMessageIds.has(msg.id);
          return (
            <div className="mx-auto w-full max-w-3xl px-3 py-1.5 md:max-w-none md:px-6">
              <CounselorMessageRow
                msg={msg}
                prevSenderId={prevSenderId}
                currentUserId={currentUserId}
                studentLabel={studentLabel}
                studentIsAnonymous={studentIsAnonymous}
                isDeleting={isDeleting}
                canModerateChat={canModerateChat}
                onDeleteMessage={onDeleteMessage}
                renderMessageContent={renderMessageContent}
              />
            </div>
          );
        }}
      />

      {showScrollToBottom && scrollToBottom ? (
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="absolute bottom-4 right-4 z-40 h-10 w-10 rounded-full border border-border/50 shadow-lg transition-transform hover:scale-105 motion-reduce:transition-none md:bottom-6 md:right-6"
          onClick={scrollToBottom}
          aria-label="Scroll to bottom of messages"
        >
          <ArrowDown className="h-5 w-5" />
        </Button>
      ) : null}
    </div>
  );
};
