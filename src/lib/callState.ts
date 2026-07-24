/**
 * Canonical call-lifecycle classification shared by every surface that renders WebRTC
 * call state (student/counselor call pages, the floating call dock, anything else built
 * later). Before this existed, each surface independently re-derived "what state is this
 * call in" from the same raw useWebRTC() flags with its own ad-hoc if-chain — which is
 * exactly how two of them ended up with subtly different (and once, actually buggy)
 * precedence between `isIncomingCall` and the rest. This is the one place that
 * classification lives now; callers still own their own copy/UI per status, but the
 * WORKFLOW — which state wins when multiple flags are true — is decided here once.
 *
 * Maps to the IDLE -> CALLING -> RINGING -> CONNECTED -> ENDED workflow: "idle" is both
 * the starting point and where a call lands after it ends (the engine has no lingering
 * "ended" state to represent — ending a call resets it to idle-shaped state directly, so
 * there is nothing distinct to classify as ENDED after the fact). "reconnecting" is a real
 * state the engine has (dropped mid-call, within the rejoin window) that doesn't fit
 * cleanly into the caller's 5-state list, so it's kept as an explicit extra rather than
 * silently folded into "connected" or "idle" where it would be misleading either way.
 */
export type CallStatus = "idle" | "ringing" | "calling" | "connected" | "reconnecting";

export interface CallEngineSignals {
  /** An unanswered call is ringing IN for this user (the callee's perspective). */
  isIncomingCall: boolean;
  /** This user placed (or just answered) a call that hasn't finished negotiating yet. */
  isConnecting: boolean;
  isConnected: boolean;
  /** Was connected, media dropped, still within the rejoin window. */
  isDisconnected: boolean;
  /** Camera/mic already acquired — true once ringing turns into an actual attempt. */
  localStream: unknown;
}

export function deriveCallStatus(signals: CallEngineSignals): CallStatus {
  if (signals.isConnected) {
    return "connected";
  }
  if (signals.isDisconnected) {
    return "reconnecting";
  }
  if (signals.isIncomingCall) {
    return "ringing";
  }
  if (signals.isConnecting || signals.localStream) {
    return "calling";
  }
  return "idle";
}
