import type { ChatMessage } from "@/hooks/useEncryptedChat";

const DEFAULT_DELETE_FOR_EVERYONE_MINUTES = 15;

const fallbackDeleteUntil = (createdAt?: string | null): number => {
  const createdMs = new Date(String(createdAt ?? "")).getTime();
  if (!Number.isFinite(createdMs)) return 0;
  return createdMs + DEFAULT_DELETE_FOR_EVERYONE_MINUTES * 60 * 1000;
};

export function canDeleteMessageForEveryone(
  message: Pick<ChatMessage, "sender_id" | "created_at" | "delete_for_everyone_until" | "is_deleted">,
  currentUserId?: number | string | null,
): boolean {
  if (!currentUserId || message.is_deleted) return false;
  if (String(message.sender_id) !== String(currentUserId)) return false;

  const untilMs = message.delete_for_everyone_until
    ? new Date(message.delete_for_everyone_until).getTime()
    : fallbackDeleteUntil(message.created_at);

  return Number.isFinite(untilMs) && Date.now() <= untilMs;
}
