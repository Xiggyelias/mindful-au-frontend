/**
 * Spatial Audio Manager using Web Audio API
 * Provides 2D stereo panning and distance-based volume attenuation
 * for proximity voice in the Peer Counselor Spatial Lounge.
 */

export interface SpatialAudioTrackNode {
  sourceNode: MediaStreamAudioSourceNode;
  pannerNode: StereoPannerNode;
  gainNode: GainNode;
  stream: MediaStream;
  x: number;
  y: number;
}

export class SpatialAudioManager {
  private audioCtx: AudioContext | null = null;
  private trackNodes: Map<string, SpatialAudioTrackNode> = new Map();
  private maxDistance: number = 260; // Distance beyond which audio is silent
  private ambientOscillator: OscillatorNode | null = null;
  private ambientGain: GainNode | null = null;
  private ambientPanner: StereoPannerNode | null = null;
  private isAmbientPlaying: boolean = false;
  private speakerPos: { x: number; y: number } = { x: 340, y: 220 };

  constructor(maxDistance: number = 260) {
    this.maxDistance = maxDistance;
  }

  /**
   * Ensure AudioContext is initialized and running (must be triggered by user action)
   */
  public ensureContext(): AudioContext {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioCtxClass();
    }
    if (this.audioCtx.state === 'suspended') {
      void this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  public getContext(): AudioContext | null {
    return this.audioCtx;
  }

  /**
   * Attach a remote audio stream for a specific participant
   */
  public attachTrack(
    id: string,
    mediaStreamTrack: MediaStreamTrack,
    targetX: number,
    targetY: number,
    myX: number,
    myY: number
  ): void {
    const ctx = this.ensureContext();
    this.detachTrack(id);

    try {
      const stream = new MediaStream([mediaStreamTrack]);
      const sourceNode = ctx.createMediaStreamSource(stream);
      const pannerNode = ctx.createStereoPanner();
      const gainNode = ctx.createGain();

      sourceNode.connect(pannerNode);
      pannerNode.connect(gainNode);
      gainNode.connect(ctx.destination);

      this.trackNodes.set(id, {
        sourceNode,
        pannerNode,
        gainNode,
        stream,
        x: targetX,
        y: targetY,
      });

      this.updateParticipantPosition(id, targetX, targetY, myX, myY);
    } catch (err) {
      console.warn('[SpatialAudio] Could not attach audio track:', err);
    }
  }

  /**
   * Update relative 2D positions and smoothly recalculate volume & stereo pan
   */
  public updateParticipantPosition(
    id: string,
    targetX: number,
    targetY: number,
    myX: number,
    myY: number
  ): { distance: number; inRange: boolean; volume: number } {
    const node = this.trackNodes.get(id);
    const dx = targetX - myX;
    const dy = targetY - myY;
    const distance = Math.hypot(dx, dy);
    const inRange = distance <= this.maxDistance;

    if (!node || !this.audioCtx) {
      return { distance, inRange, volume: 0 };
    }

    node.x = targetX;
    node.y = targetY;

    let targetGain = 0;
    let targetPan = 0;

    if (inRange) {
      // Smooth quadratic distance attenuation: 1 at d=0 down to 0 at maxDistance
      const fraction = Math.max(0, 1 - distance / this.maxDistance);
      targetGain = Math.pow(fraction, 1.4);

      // Stereo pan: -1 (far left) to +1 (far right) based on horizontal offset
      const panRatio = Math.max(-1, Math.min(1, dx / (this.maxDistance * 0.8)));
      targetPan = panRatio;
    }

    const now = this.audioCtx.currentTime;
    node.gainNode.gain.setTargetAtTime(targetGain, now, 0.04);
    node.pannerNode.pan.setTargetAtTime(targetPan, now, 0.04);

    return { distance, inRange, volume: targetGain };
  }

  /**
   * Remove and clean up nodes for a participant who disconnected
   */
  public detachTrack(id: string): void {
    const node = this.trackNodes.get(id);
    if (!node) return;

    try {
      node.gainNode.disconnect();
      node.pannerNode.disconnect();
      node.sourceNode.disconnect();
    } catch {
      // Ignore cleanup error if already disconnected
    }
    this.trackNodes.delete(id);
  }

  /**
   * Start tranquil ambient nature soundscape for the meadow speaker ("Neil's Speaker")
   */
  public startAmbientSpeaker(myX: number, myY: number, speakerPos?: { x: number; y: number }): void {
    if (this.isAmbientPlaying) return;
    if (speakerPos) {
      this.speakerPos = speakerPos;
    }

    const ctx = this.ensureContext();
    try {
      // Synthesize soothing warm chord for the lounge radio
      const osc = ctx.createOscillator();
      const panner = ctx.createStereoPanner();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, ctx.currentTime); // Soft A3 meditative drone

      // Sub-harmonic depth
      const lfo = ctx.createOscillator();
      lfo.frequency.setValueAtTime(0.2, ctx.currentTime);
      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(4, ctx.currentTime);
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      lfo.start();

      osc.connect(panner);
      panner.connect(gain);
      gain.connect(ctx.destination);

      gain.gain.setValueAtTime(0.01, ctx.currentTime);
      osc.start();

      this.ambientOscillator = osc;
      this.ambientPanner = panner;
      this.ambientGain = gain;
      this.isAmbientPlaying = true;

      this.updateAmbientPosition(myX, myY);
    } catch (err) {
      console.warn('[SpatialAudio] Ambient generator failed:', err);
    }
  }

  public updateAmbientPosition(myX: number, myY: number): void {
    if (!this.ambientGain || !this.ambientPanner || !this.audioCtx) return;

    const dx = this.speakerPos.x - myX;
    const dy = this.speakerPos.y - myY;
    const distance = Math.hypot(dx, dy);

    let targetGain = 0;
    let targetPan = 0;

    if (distance <= this.maxDistance * 1.2) {
      const fraction = Math.max(0, 1 - distance / (this.maxDistance * 1.2));
      targetGain = Math.pow(fraction, 1.8) * 0.12; // Gentle background volume
      targetPan = Math.max(-1, Math.min(1, dx / (this.maxDistance * 0.8)));
    }

    const now = this.audioCtx.currentTime;
    this.ambientGain.gain.setTargetAtTime(targetGain, now, 0.05);
    this.ambientPanner.pan.setTargetAtTime(targetPan, now, 0.05);
  }

  public stopAmbientSpeaker(): void {
    if (!this.isAmbientPlaying) return;
    try {
      this.ambientOscillator?.stop();
      this.ambientGain?.disconnect();
      this.ambientPanner?.disconnect();
    } catch {
      // Ignored
    }
    this.ambientOscillator = null;
    this.ambientGain = null;
    this.ambientPanner = null;
    this.isAmbientPlaying = false;
  }

  public toggleAmbientSpeaker(myX: number, myY: number): boolean {
    if (this.isAmbientPlaying) {
      this.stopAmbientSpeaker();
      return false;
    } else {
      this.startAmbientSpeaker(myX, myY);
      return true;
    }
  }

  public isAmbientActive(): boolean {
    return this.isAmbientPlaying;
  }

  public cleanup(): void {
    this.stopAmbientSpeaker();
    for (const [id] of this.trackNodes) {
      this.detachTrack(id);
    }
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      void this.audioCtx.close();
      this.audioCtx = null;
    }
  }
}
