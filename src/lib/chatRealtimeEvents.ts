export const CHAT_INCOMING_DIGEST_EVENT = "mindful:chat-incoming-digest";

export type ChatIncomingDigestDetail = {
  session_ids: number[];
};

export function dispatchChatIncomingDigest(sessionIds: number[]): void {
  const unique = Array.from(new Set(sessionIds.filter((id) => Number.isFinite(id) && id > 0)));
  if (unique.length === 0) {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<ChatIncomingDigestDetail>(CHAT_INCOMING_DIGEST_EVENT, {
      detail: { session_ids: unique },
    })
  );
}

/** Fired after student anonymous mode / chat anonymity changes so UIs refresh session lists. */
export const CHAT_ANONYMITY_SYNC_EVENT = "mindful:chat-anonymity-sync";

export function dispatchChatAnonymitySync(): void {
  window.dispatchEvent(new Event(CHAT_ANONYMITY_SYNC_EVENT));
}
