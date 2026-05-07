/**
 * Notification audio modeled after polished messengers (WhatsApp / Discord):
 * — Short alerts: gentle dual-tone “glass ping”, smooth AD-style envelopes (no clicks)
 * — Call ringtones: looping assets with fade-in / fade-out via Web Audio gain
 * — Focus-aware ducking for non-critical cues when the tab is in the background
 * — HTML5 Audio only as fallback when Web Audio is unavailable
 */

const STORAGE_KEY = "mindful_au_notification_sounds_v1";

const RING_FADE_IN_SEC = 0.2;
const RING_FADE_OUT_SEC = 0.16;
/** When tab is hidden, message & reminder playback is scaled by this (calls & emergency stay full). */
const BACKGROUND_DUCK = 0.68;

export type MessageVariant = "standard" | "soft";

export type NotificationSoundSettings = {
  masterMuted: boolean;
  masterVolume: number;
  messageEnabled: boolean;
  callRingtoneEnabled: boolean;
  reminderEnabled: boolean;
  emergencyEnabled: boolean;
  messageVariant: MessageVariant;
};

const defaultSettings: NotificationSoundSettings = {
  masterMuted: false,
  masterVolume: 0.85,
  messageEnabled: true,
  callRingtoneEnabled: true,
  reminderEnabled: true,
  emergencyEnabled: true,
  messageVariant: "standard",
};

const SOUND_URLS = {
  message: "/assets/sounds/message.mp3",
  audioCall: "/assets/sounds/audio-call.mp3",
  videoCall: "/assets/sounds/video-call.mp3",
  reminder: "/assets/sounds/reminder.mp3",
  emergency: "/assets/sounds/emergency.mp3",
} as const;

function loadSettings(): NotificationSoundSettings {
  if (typeof window === "undefined") {
    return { ...defaultSettings };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...defaultSettings };
    }
    const parsed = JSON.parse(raw) as Partial<NotificationSoundSettings>;
    const merged = { ...defaultSettings, ...parsed };
    if (typeof merged.masterVolume !== "number" || Number.isNaN(merged.masterVolume)) {
      merged.masterVolume = defaultSettings.masterVolume;
    }
    merged.masterVolume = Math.min(1, Math.max(0, merged.masterVolume));
    if (merged.messageVariant !== "standard" && merged.messageVariant !== "soft") {
      merged.messageVariant = "standard";
    }
    return merged;
  } catch {
    return { ...defaultSettings };
  }
}

let settingsCache: NotificationSoundSettings = loadSettings();

const listeners = new Set<() => void>();

function emitSettings() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

function persistSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settingsCache));
  } catch {
    /* ignore */
  }
  emitSettings();
}

export function subscribeNotificationSoundSettings(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getNotificationSoundSettings(): NotificationSoundSettings {
  return { ...settingsCache };
}

export function setNotificationSoundSettings(patch: Partial<NotificationSoundSettings>) {
  settingsCache = { ...settingsCache, ...patch };
  if (typeof settingsCache.masterVolume !== "number" || Number.isNaN(settingsCache.masterVolume)) {
    settingsCache.masterVolume = defaultSettings.masterVolume;
  }
  settingsCache.masterVolume = Math.min(1, Math.max(0, settingsCache.masterVolume));
  if (settingsCache.messageVariant !== "standard" && settingsCache.messageVariant !== "soft") {
    settingsCache.messageVariant = "standard";
  }
  persistSettings();
}

let resumedCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      return null;
    }
    if (!resumedCtx) {
      resumedCtx = new Ctor();
    }
    void resumedCtx.resume().catch(() => undefined);
    return resumedCtx;
  } catch {
    return null;
  }
}

function isDocumentHidden(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return document.visibilityState === "hidden";
}

function duckForShortCue(peak: number): number {
  if (!isDocumentHidden()) {
    return peak;
  }
  return peak * BACKGROUND_DUCK;
}

/** Smooth gain envelope: linear attack, exponential decay (Discord / modern UI style). */
function envelopeGain(
  gain: GainNode,
  ctx: AudioContext,
  startTime: number,
  peak: number,
  attackSec: number,
  holdSec: number,
  decaySec: number
) {
  const t = startTime;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(peak, t + attackSec);
  const holdEnd = t + attackSec + holdSec;
  gain.gain.setValueAtTime(peak, holdEnd);
  const floor = Math.max(0.0001, peak * 0.001);
  gain.gain.exponentialRampToValueAtTime(floor, holdEnd + decaySec);
}

/**
 * WhatsApp-inspired message ping: two close sine tones, short and non-intrusive.
 */
function playMessageSynthesized(variant: MessageVariant, peakGain: number): boolean {
  const ctx = getAudioContext();
  if (!ctx) {
    return false;
  }
  void ctx.resume().catch(() => undefined);

  const soft = variant === "soft";
  const rootHz = soft ? 740 : 830;
  const upperHz = soft ? 990 : 1180;
  const peak = duckForShortCue(peakGain) * (soft ? 0.82 : 1);

  const t0 = ctx.currentTime;
  const osc1 = ctx.createOscillator();
  const g1 = ctx.createGain();
  osc1.type = "sine";
  osc1.frequency.setValueAtTime(rootHz, t0);
  osc1.connect(g1);
  g1.connect(ctx.destination);
  envelopeGain(g1, ctx, t0, peak * 0.55, 0.008, 0.02, 0.075);

  const t2 = t0 + 0.045;
  const osc2 = ctx.createOscillator();
  const g2 = ctx.createGain();
  osc2.type = "sine";
  osc2.frequency.setValueAtTime(upperHz, t2);
  osc2.connect(g2);
  g2.connect(ctx.destination);
  envelopeGain(g2, ctx, t2, peak * 0.48, 0.01, 0.028, 0.09);

  osc1.start(t0);
  osc1.stop(t0 + 0.22);
  osc2.start(t2);
  osc2.stop(t2 + 0.22);
  return true;
}

/** Gentle session reminder: warm two-note chime, lower than ringtone priority. */
function playReminderSynthesized(peakGain: number): boolean {
  const ctx = getAudioContext();
  if (!ctx) {
    return false;
  }
  void ctx.resume().catch(() => undefined);

  const peak = duckForShortCue(peakGain);
  const t0 = ctx.currentTime;

  const a1 = ctx.createOscillator();
  const g1 = ctx.createGain();
  a1.type = "sine";
  a1.frequency.setValueAtTime(587.33, t0);
  a1.connect(g1);
  g1.connect(ctx.destination);
  envelopeGain(g1, ctx, t0, peak * 0.42, 0.012, 0.06, 0.12);

  const t1 = t0 + 0.07;
  const a2 = ctx.createOscillator();
  const g2 = ctx.createGain();
  a2.type = "sine";
  a2.frequency.setValueAtTime(783.99, t1);
  a2.connect(g2);
  g2.connect(ctx.destination);
  envelopeGain(g2, ctx, t1, peak * 0.36, 0.014, 0.08, 0.14);

  a1.start(t0);
  a1.stop(t0 + 0.35);
  a2.start(t1);
  a2.stop(t1 + 0.35);
  return true;
}

/** Emergency: urgent but controlled (sine fundamentals, not harsh square clicks). */
function playEmergencyPulse(ctx: AudioContext, start: number, peak: number) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(880, start);
  o.frequency.exponentialRampToValueAtTime(620, start + 0.11);
  o.connect(g);
  g.connect(ctx.destination);
  envelopeGain(g, ctx, start, peak, 0.004, 0.02, 0.1);
  o.start(start);
  o.stop(start + 0.2);
}

function playEmergencySynthesized(peakGain: number): boolean {
  const ctx = getAudioContext();
  if (!ctx) {
    return false;
  }
  void ctx.resume().catch(() => undefined);

  const peak = peakGain;
  const t0 = ctx.currentTime;
  playEmergencyPulse(ctx, t0, peak * 0.52);
  playEmergencyPulse(ctx, t0 + 0.19, peak * 0.44);
  playEmergencyPulse(ctx, t0 + 0.4, peak * 0.38);
  return true;
}

/** Fallback ring pulse — soft overlapping tones (Discord call-adjacent simplicity). */
function playCallPulseFallback(kind: "audio" | "video") {
  const ctx = getAudioContext();
  if (!ctx) {
    return;
  }
  void ctx.resume().catch(() => undefined);

  const peak = kind === "video" ? 0.11 : 0.078;
  const t0 = ctx.currentTime;
  const freqs = kind === "video" ? [740, 988, 740] : [659, 880, 659];
  const offsets = [0, 0.18, 0.42];
  const lens = kind === "video" ? [0.14, 0.16, 0.18] : [0.12, 0.13, 0.14];

  offsets.forEach((off, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(freqs[i], t0 + off);
    o.connect(g);
    g.connect(ctx.destination);
    envelopeGain(g, ctx, t0 + off, peak, 0.015, 0.04, lens[i]);
    o.start(t0 + off);
    o.stop(t0 + off + 0.3);
  });
}

/* --- Ringtone: HTML element + Web Audio gain (smooth in / out) --- */

const audioCallPlayer = typeof Audio !== "undefined" ? new Audio() : (null as unknown as HTMLAudioElement);
const videoCallPlayer = typeof Audio !== "undefined" ? new Audio() : (null as unknown as HTMLAudioElement);

const ringGainByEl = new WeakMap<HTMLAudioElement, GainNode>();
let ringStopTimer: number | null = null;

function clearRingStopTimer() {
  if (ringStopTimer !== null) {
    window.clearTimeout(ringStopTimer);
    ringStopTimer = null;
  }
}

function ensureRingGain(el: HTMLAudioElement): GainNode | null {
  const ctx = getAudioContext();
  if (!ctx) {
    return null;
  }
  const gain = ringGainByEl.get(el);
  if (gain) {
    return gain;
  }
  try {
    const g = ctx.createGain();
    g.gain.value = 0;
    const src = ctx.createMediaElementSource(el);
    src.connect(g);
    g.connect(ctx.destination);
    el.volume = 1;
    ringGainByEl.set(el, g);
    return g;
  } catch {
    return null;
  }
}

let activeRingKind: "audio" | "video" | null = null;
let fallbackRingTimer: number | null = null;

function stopFallbackRing() {
  if (fallbackRingTimer !== null) {
    window.clearInterval(fallbackRingTimer);
    fallbackRingTimer = null;
  }
}

function startFallbackRing(kind: "audio" | "video") {
  stopFallbackRing();
  activeRingKind = kind;
  const intervalMs = kind === "video" ? 2100 : 2600;
  playCallPulseFallback(kind);
  fallbackRingTimer = window.setInterval(() => {
    playCallPulseFallback(kind);
  }, intervalMs);
}

function fadeOutRingElement(el: HTMLAudioElement) {
  const ctx = getAudioContext();
  const gain = ringGainByEl.get(el);
  if (gain && ctx) {
    const t = ctx.currentTime;
    const now = Math.max(0.0001, gain.gain.value);
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(now, t);
    gain.gain.linearRampToValueAtTime(0, t + RING_FADE_OUT_SEC);
    window.setTimeout(() => {
      el.pause();
      el.currentTime = 0;
    }, RING_FADE_OUT_SEC * 1000 + 30);
  } else {
    el.volume = 0;
    el.pause();
    el.currentTime = 0;
  }
}

let html5RingRampTimer: number | null = null;

function clearHtml5RingRamp() {
  if (html5RingRampTimer !== null) {
    window.clearInterval(html5RingRampTimer);
    html5RingRampTimer = null;
  }
}

export function stopCallRingtone() {
  stopFallbackRing();
  clearRingStopTimer();
  clearHtml5RingRamp();

  fadeOutRingElement(audioCallPlayer);
  fadeOutRingElement(videoCallPlayer);

  const ctx = getAudioContext();
  const needsTimer = Boolean(
    ctx && (ringGainByEl.get(audioCallPlayer) || ringGainByEl.get(videoCallPlayer))
  );
  if (needsTimer) {
    ringStopTimer = window.setTimeout(() => {
      audioCallPlayer.pause();
      audioCallPlayer.currentTime = 0;
      videoCallPlayer.pause();
      videoCallPlayer.currentTime = 0;
      ringStopTimer = null;
    }, RING_FADE_OUT_SEC * 1000 + 40);
  }

  activeRingKind = null;
}

function ringEffectiveVolume(kind: "audio" | "video"): number {
  const s = settingsCache;
  if (s.masterMuted || !s.callRingtoneEnabled) {
    return 0;
  }
  const base = s.masterVolume;
  return kind === "video" ? Math.min(1, base * 1.02) : base * 0.94;
}

/**
 * Looping ringtone. One at a time; crossfade handled by fading the inactive element out first.
 */
export function startCallRingtone(kind: "audio" | "video") {
  const vol = ringEffectiveVolume(kind);
  if (vol <= 0) {
    return;
  }

  void getAudioContext()?.resume().catch(() => undefined);
  clearRingStopTimer();
  clearHtml5RingRamp();

  const el = kind === "video" ? videoCallPlayer : audioCallPlayer;
  const other = kind === "video" ? audioCallPlayer : videoCallPlayer;

  const gain = ensureRingGain(el);
  const ctx = getAudioContext();
  const playingHtml5 = !el.paused && Boolean(gain && ctx && gain.gain.value > 0.02);

  if (activeRingKind === kind && playingHtml5 && fallbackRingTimer === null) {
    return;
  }
  if (activeRingKind === kind && fallbackRingTimer !== null) {
    return;
  }

  fadeOutRingElement(other);
  stopFallbackRing();

  activeRingKind = kind;
  el.loop = true;
  el.src = kind === "video" ? SOUND_URLS.videoCall : SOUND_URLS.audioCall;

  if (gain && ctx) {
    const t = ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(0, t);
    void el.play().then(() => {
      const c = getAudioContext();
      const g = ringGainByEl.get(el);
      if (!c || !g) {
        return;
      }
      const t2 = c.currentTime;
      g.gain.cancelScheduledValues(t2);
      g.gain.setValueAtTime(0, t2);
      g.gain.linearRampToValueAtTime(vol, t2 + RING_FADE_IN_SEC);
    }).catch(() => {
      startFallbackRing(kind);
    });
  } else {
    el.volume = 0;
    void el
      .play()
      .then(() => {
        const steps = 12;
        const dt = (RING_FADE_IN_SEC * 1000) / steps;
        let i = 0;
        clearHtml5RingRamp();
        html5RingRampTimer = window.setInterval(() => {
          i += 1;
          el.volume = vol * (i / steps);
          if (i >= steps) {
            clearHtml5RingRamp();
          }
        }, dt);
      })
      .catch(() => {
        startFallbackRing(kind);
      });
  }
}

let lastMessageAt = 0;
let lastMessageBatchKey: string | null = null;
/** Batch rapid messages like WhatsApp (one tactile ping per burst). */
const MESSAGE_DEBOUNCE_MS = 720;

function messageEffectiveVolume(): number {
  const s = settingsCache;
  if (s.masterMuted || !s.messageEnabled) {
    return 0;
  }
  const variantMul = s.messageVariant === "soft" ? 0.75 : 1;
  return s.masterVolume * 0.38 * variantMul;
}

function playMessageMp3Fallback(peakedVolume: number) {
  const url = SOUND_URLS.message;
  const a = new Audio(url);
  a.volume = 0;
  const target = duckForShortCue(peakedVolume);
  if (settingsCache.messageVariant === "soft") {
    a.playbackRate = 0.96;
  }
  void a
    .play()
    .then(() => {
      const steps = 8;
      let i = 0;
      const id = window.setInterval(() => {
        i += 1;
        a.volume = target * (i / steps);
        if (i >= steps) {
          window.clearInterval(id);
        }
      }, 18);
    })
    .catch(() => undefined);
}

/**
 * New chat batch only (caller should skip bootstrap / refresh replay).
 */
export function playMessageNotificationSound(options?: { batchKey?: string }) {
  const vol = messageEffectiveVolume();
  if (vol <= 0) {
    return;
  }

  const now = Date.now();
  const batchKey = options?.batchKey ?? null;
  if (batchKey && batchKey === lastMessageBatchKey && now - lastMessageAt < MESSAGE_DEBOUNCE_MS) {
    return;
  }
  if (now - lastMessageAt < MESSAGE_DEBOUNCE_MS && !batchKey) {
    return;
  }
  lastMessageAt = now;
  lastMessageBatchKey = batchKey;

  if (!playMessageSynthesized(settingsCache.messageVariant, vol)) {
    playMessageMp3Fallback(vol);
  }
}

function reminderEffectiveVolume(): number {
  const s = settingsCache;
  if (s.masterMuted || !s.reminderEnabled) {
    return 0;
  }
  return s.masterVolume * 0.34;
}

export function playSessionReminderSound() {
  const vol = reminderEffectiveVolume();
  if (vol <= 0) {
    return;
  }
  if (!playReminderSynthesized(vol)) {
    const a = new Audio(SOUND_URLS.reminder);
    a.volume = duckForShortCue(vol);
    void a.play().catch(() => undefined);
  }
}

function emergencyEffectiveVolume(): number {
  const s = settingsCache;
  if (s.masterMuted || !s.emergencyEnabled) {
    return 0;
  }
  return Math.min(1, s.masterVolume);
}

export function playEmergencyAlertSound() {
  const vol = emergencyEffectiveVolume();
  if (vol <= 0) {
    return;
  }
  stopCallRingtone();

  if (!playEmergencySynthesized(vol)) {
    const a = new Audio(SOUND_URLS.emergency);
    a.volume = vol;
    void a.play().catch(() => undefined);
  }
}

export function primeNotificationAudioFromUserGesture() {
  const ctx = getAudioContext();
  void ctx?.resume().catch(() => undefined);

  const primeUrl = (url: string) => {
    try {
      const a = new Audio(url);
      a.volume = 0;
      void a
        .play()
        .then(() => {
          a.pause();
          a.currentTime = 0;
        })
        .catch(() => undefined);
    } catch {
      /* ignore */
    }
  };
  primeUrl(SOUND_URLS.message);
  primeUrl(SOUND_URLS.audioCall);
  primeUrl(SOUND_URLS.videoCall);
}

if (typeof document !== "undefined") {
  document.addEventListener(
    "pointerdown",
    () => {
      primeNotificationAudioFromUserGesture();
    },
    { once: true, passive: true }
  );
}
