let resumedAudioContext: AudioContext | null = null;

/**
 * Short, low-volume tone so incoming chat is noticeable without being intrusive.
 */
export function playChatNotificationSound(): void {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      return;
    }
    if (!resumedAudioContext) {
      resumedAudioContext = new Ctor();
    }
    const ctx = resumedAudioContext;
    void ctx.resume().catch(() => undefined);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.14);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
  } catch {
    // Ignore — autoplay policies or missing Web Audio
  }
}
