/**
 * Spatial Audio Manager using Web Audio API
 * Provides 2D stereo panning and distance-based volume attenuation
 * for proximity voice in the Peer Counselor & Student Spatial Lounge.
 */

export interface SpatialAudioTrackNode {
  sourceNode: MediaStreamAudioSourceNode;
  pannerNode: StereoPannerNode;
  gainNode: GainNode;
  stream: MediaStream;
  audioElement?: HTMLAudioElement;
  x: number;
  y: number;
}

export class SpatialAudioManager {
  private audioCtx: AudioContext | null = null;
  private trackNodes: Map<string, SpatialAudioTrackNode> = new Map();
  private maxDistance: number = 650; // Distance beyond which audio plays at minimum whisper floor
  private ambientAudioElement: HTMLAudioElement | null = null;
  private ambientSourceNode: MediaElementAudioSourceNode | null = null;
  private ambientGain: GainNode | null = null;
  private ambientPanner: StereoPannerNode | null = null;
  private isAmbientPlaying: boolean = false;
  private speakerPos: { x: number; y: number } = { x: 340, y: 220 };
  private sidetoneNode: { source: MediaStreamAudioSourceNode; gain: GainNode } | null = null;
  private sidetoneAudioElement: HTMLAudioElement | null = null;

  constructor(maxDistance: number = 650) {
    this.maxDistance = maxDistance;
  }

  /**
   * Ensure AudioContext is initialized and running (must be triggered by user action)
   */
  public ensureContext(): AudioContext {
    if (!this.audioCtx) {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioCtxClass();
    }
    if (this.audioCtx.state === "suspended") {
      void this.audioCtx.resume().catch((err) => {
        console.warn("[SpatialAudio] AudioContext resume failed:", err);
      });
    }
    return this.audioCtx;
  }

  public getContext(): AudioContext | null {
    return this.audioCtx;
  }

  /**
   * Attach a remote audio stream for a specific participant.
   * Handles both WebRTC MediaStreamTrack and LiveKit RemoteAudioTrack,
   * binding an HTMLAudioElement to satisfy browser WebRTC decoding.
   */
  public attachTrack(
    id: string,
    mediaStreamTrack: MediaStreamTrack,
    targetX: number,
    targetY: number,
    myX: number,
    myY: number,
    livekitRemoteTrack?: { attach?: (el: HTMLMediaElement) => HTMLMediaElement }
  ): void {
    const ctx = this.ensureContext();
    this.detachTrack(id);

    try {
      const stream = new MediaStream([mediaStreamTrack]);

      // Hidden HTMLAudioElement ensures browser WebRTC decoder pipeline pushes audio
      const audioElement = document.createElement("audio");
      audioElement.id = `spatial-remote-audio-${id}`;
      audioElement.autoplay = true;
      // Keep muted = false and volume tiny (0.0001) so Chromium's WebRTC decoder actively decodes
      // remote audio frames without silencing AudioContext.createMediaStreamSource(stream).
      audioElement.muted = false;
      audioElement.volume = 0.0001;
      audioElement.style.display = "none";

      if (livekitRemoteTrack && typeof livekitRemoteTrack.attach === "function") {
        livekitRemoteTrack.attach(audioElement);
      } else {
        audioElement.srcObject = stream;
      }

      document.body.appendChild(audioElement);
      void audioElement.play().catch(() => {
        // Element play will unblock on user gesture if autoplay policy triggered
      });

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
        audioElement,
        x: targetX,
        y: targetY,
      });

      this.updateParticipantPosition(id, targetX, targetY, myX, myY);
    } catch (err) {
      console.warn("[SpatialAudio] Could not attach audio track:", err);
    }
  }

  /**
   * Update relative 2D positions and smoothly recalculate volume & stereo pan
   * Includes a minimum volume floor so partners never go dead silent across the meadow.
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

    // Minimum volume floor (0.22) guarantees you can ALWAYS hear your partner talking,
    // and as you walk closer, volume increases smoothly up to 1.0 with stereo panning.
    let targetGain = 0.22;
    let targetPan = 0;

    if (distance <= this.maxDistance) {
      const fraction = Math.max(0, 1 - distance / this.maxDistance);
      // Smooth interpolation: from 0.22 at max distance to 1.0 at distance 0
      targetGain = 0.22 + 0.78 * Math.pow(fraction, 1.2);

      // Stereo pan: -1 (far left) to +1 (far right) based on horizontal offset
      const panRatio = Math.max(-1, Math.min(1, dx / (this.maxDistance * 0.7)));
      targetPan = panRatio;
    } else {
      // Gentle distant whisper (0.15) outside hearing radius
      targetGain = 0.15;
      targetPan = Math.sign(dx) * 0.9;
    }

    const now = this.audioCtx.currentTime;
    node.gainNode.gain.setTargetAtTime(targetGain, now, 0.04);
    node.pannerNode.pan.setTargetAtTime(targetPan, now, 0.04);

    // Fail-safe direct audio playback: if Web Audio is suspended or throttled,
    // ensure HTMLAudioElement outputs the spatial volume directly so audio is never silent.
    if (node.audioElement) {
      if (this.audioCtx.state === "running") {
        node.audioElement.volume = 0.0001;
      } else {
        node.audioElement.volume = Math.max(0.1, Math.min(1.0, targetGain));
      }
    }

    return { distance, inRange, volume: targetGain };
  }

  /**
   * Remove and clean up nodes and audio element for a participant
   */
  public detachTrack(id: string): void {
    const node = this.trackNodes.get(id);
    if (!node) return;

    try {
      node.gainNode.disconnect();
      node.pannerNode.disconnect();
      node.sourceNode.disconnect();
      if (node.audioElement) {
        node.audioElement.pause();
        node.audioElement.srcObject = null;
        node.audioElement.remove();
      }
    } catch {
      // Ignore cleanup error if already disconnected
    }
    this.trackNodes.delete(id);
  }

  /**
   * Enable local microphone sidetone / loopback so user hears their own voice back live
   */
  public enableSidetone(stream: MediaStream, volume: number = 0.8): void {
    this.disableSidetone();
    const ctx = this.ensureContext();

    // 1. Web Audio graph loopback
    try {
      const source = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      source.connect(gain);
      gain.connect(ctx.destination);
      this.sidetoneNode = { source, gain };
    } catch (err) {
      console.warn("[SpatialAudio] Web Audio sidetone failed:", err);
    }

    // 2. Direct hardware HTMLAudioElement loopback (bypasses browser AEC ducking so voice is 100% audible)
    try {
      let loopback = document.getElementById("spatial-mic-loopback") as HTMLAudioElement | null;
      if (!loopback) {
        loopback = document.createElement("audio");
        loopback.id = "spatial-mic-loopback";
        loopback.autoplay = true;
        loopback.playsInline = true;
        document.body.appendChild(loopback);
      }
      loopback.srcObject = stream;
      loopback.volume = Math.max(0.1, Math.min(1.0, volume));
      loopback.muted = false;
      void loopback.play().catch((err) => {
        console.warn("[SpatialAudio] Direct loopback play error:", err);
      });
      this.sidetoneAudioElement = loopback;
    } catch (err) {
      console.warn("[SpatialAudio] HTMLAudioElement loopback failed:", err);
    }
  }

  public disableSidetone(): void {
    if (this.sidetoneNode) {
      try {
        this.sidetoneNode.gain.disconnect();
        this.sidetoneNode.source.disconnect();
      } catch {
        // Ignored
      }
      this.sidetoneNode = null;
    }
    if (this.sidetoneAudioElement) {
      try {
        this.sidetoneAudioElement.pause();
        this.sidetoneAudioElement.srcObject = null;
        this.sidetoneAudioElement.remove();
      } catch {
        // Ignored
      }
      this.sidetoneAudioElement = null;
    }
  }

  public isSidetoneActive(): boolean {
    return this.sidetoneNode !== null || this.sidetoneAudioElement !== null;
  }

  /**
   * Play an audible acoustic confirmation chime (mic on, mic off, test tone)
   */
  public playChime(type: "mic-on" | "mic-off" | "test"): void {
    const ctx = this.ensureContext();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    if (type === "mic-on") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.08);
      osc.frequency.setValueAtTime(783.99, now + 0.16);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.36);
    } else if (type === "mic-off") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(783.99, now);
      osc.frequency.setValueAtTime(659.25, now + 0.08);
      osc.frequency.setValueAtTime(523.25, now + 0.16);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.31);
    } else {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(554.37, now + 0.12);
      osc.frequency.setValueAtTime(659.25, now + 0.24);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
      osc.start(now);
      osc.stop(now + 0.56);
    }

    osc.connect(gain);
    gain.connect(ctx.destination);
  }

  /**
   * Create a real-time microphone volume analyser for voice activity detection
   */
  public createMicLevelAnalyser(stream: MediaStream): {
    analyser: AnalyserNode;
    getVolume: () => number;
  } {
    const ctx = this.ensureContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.4;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const getVolume = () => {
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const avg = sum / dataArray.length;
      return Math.min(1, avg / 128); // Returns normalized 0 to 1
    };

    return { analyser, getVolume };
  }

  /**
   * Initialize or retrieve the Zen Meadow stock beat audio element and Web Audio nodes.
   * Plays a cozy, relaxing royalty-free lofi chill beat instead of synthetic oscillators.
   */
  private ensureAmbientNodes(): void {
    if (this.ambientAudioElement && this.ambientGain && this.ambientPanner) {
      return;
    }

    const ctx = this.ensureContext();

    if (!this.ambientAudioElement) {
      const audio = document.createElement("audio");
      audio.id = "spatial-zen-radio-stock-beat";
      audio.src = "/assets/sounds/zen-lofi-beat.mp3";
      audio.loop = true;
      audio.preload = "auto";
      audio.crossOrigin = "anonymous";
      audio.volume = 0.35;

      audio.onerror = (e) => {
        console.warn("[SpatialAudio] Zen radio beat loading error:", e);
      };

      document.body.appendChild(audio);
      this.ambientAudioElement = audio;
    }

    if (!this.ambientSourceNode) {
      try {
        const source = ctx.createMediaElementSource(this.ambientAudioElement);
        const panner = ctx.createStereoPanner();
        const gain = ctx.createGain();

        gain.gain.setValueAtTime(0.001, ctx.currentTime);
        source.connect(panner);
        panner.connect(gain);
        gain.connect(ctx.destination);

        this.ambientSourceNode = source;
        this.ambientPanner = panner;
        this.ambientGain = gain;
      } catch (err) {
        console.warn("[SpatialAudio] Web Audio media element source error:", err);
      }
    }
  }

  /**
   * Start tranquil ambient stock beat for the meadow speaker.
   * ONLY plays when explicitly called (turned on by user).
   */
  public startAmbientSpeaker(myX: number, myY: number, speakerPos?: { x: number; y: number }): void {
    if (speakerPos) {
      this.speakerPos = speakerPos;
    }

    try {
      this.ensureAmbientNodes();
      this.isAmbientPlaying = true;

      if (this.ambientAudioElement) {
        this.ambientAudioElement.currentTime = this.ambientAudioElement.currentTime || 0;
        void this.ambientAudioElement.play().catch((err) => {
          console.warn("[SpatialAudio] Zen radio playback error:", err);
        });
      }

      this.updateAmbientPosition(myX, myY);
    } catch (err) {
      console.warn("[SpatialAudio] Zen radio start failed:", err);
    }
  }

  public updateAmbientPosition(myX: number, myY: number): void {
    const dx = this.speakerPos.x - myX;
    const dy = this.speakerPos.y - myY;
    const distance = Math.hypot(dx, dy);

    let targetGain = 0;
    let targetPan = 0;

    // Smooth spatial attenuation: loudest when close to the gramophone (up to 0.32 max),
    // smoothly tapering off as you walk around the meadow.
    if (distance <= this.maxDistance * 1.3) {
      const fraction = Math.max(0, 1 - distance / (this.maxDistance * 1.3));
      targetGain = Math.pow(fraction, 1.5) * 0.32; // Gentle, relaxing background level
      targetPan = Math.max(-1, Math.min(1, dx / (this.maxDistance * 0.8)));
    }

    if (this.ambientGain && this.audioCtx && this.audioCtx.state === "running") {
      const now = this.audioCtx.currentTime;
      this.ambientGain.gain.setTargetAtTime(targetGain, now, 0.08);
      if (this.ambientPanner) {
        this.ambientPanner.pan.setTargetAtTime(targetPan, now, 0.08);
      }
    } else if (this.ambientAudioElement) {
      // Fallback volume on direct audio element if Web Audio context is suspended
      this.ambientAudioElement.volume = Math.max(0, Math.min(0.35, targetGain));
    }
  }

  public stopAmbientSpeaker(): void {
    this.isAmbientPlaying = false;
    if (this.ambientGain && this.audioCtx) {
      try {
        this.ambientGain.gain.setTargetAtTime(0, this.audioCtx.currentTime, 0.05);
      } catch {
        // Ignored
      }
    }
    if (this.ambientAudioElement) {
      try {
        this.ambientAudioElement.pause();
      } catch {
        // Ignored
      }
    }
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
    if (this.ambientAudioElement) {
      try {
        this.ambientAudioElement.pause();
        this.ambientAudioElement.remove();
      } catch {
        // Ignored
      }
      this.ambientAudioElement = null;
      this.ambientSourceNode = null;
      this.ambientGain = null;
      this.ambientPanner = null;
    }
    this.disableSidetone();
    for (const [id] of this.trackNodes) {
      this.detachTrack(id);
    }
    if (this.audioCtx && this.audioCtx.state !== "closed") {
      void this.audioCtx.close();
      this.audioCtx = null;
    }
  }
}
