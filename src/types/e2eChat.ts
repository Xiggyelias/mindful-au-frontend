/**
 * Visual state for end-to-end encrypted chat rows (drives UX, not wire format).
 */
export type E2EVisualState =
  | "plain"
  | "decrypted"
  | "decrypting"
  | "awaiting_key"
  | "needs_resync"
  | "payload_invalid";
