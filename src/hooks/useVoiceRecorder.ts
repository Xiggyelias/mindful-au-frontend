import { useState, useRef, useCallback } from "react";

export interface VoiceRecording {
  blob: File;
  url: string;
  durationMs: number;
  timestamp: Date;
}

const NUM_LEVEL_BARS = 30;
const LEVEL_FPS = 30;

/** Pick the best supported MIME type/extension for this browser. */
function getBestMimeType(): { mimeType: string; extension: string } {
  const candidates = [
    { mimeType: "audio/webm;codecs=opus", extension: "webm" },
    { mimeType: "audio/webm", extension: "webm" },
    { mimeType: "audio/mp4", extension: "m4a" },
    { mimeType: "audio/ogg;codecs=opus", extension: "ogg" },
    { mimeType: "audio/ogg", extension: "ogg" },
  ];
  if (typeof MediaRecorder !== "undefined") {
    for (const c of candidates) {
      try {
        if (MediaRecorder.isTypeSupported(c.mimeType)) return c;
      } catch {
        // skip unsupported
      }
    }
  }
  return { mimeType: "", extension: "webm" };
}

const IDLE_LEVELS: number[] = Array.from({ length: NUM_LEVEL_BARS }, (_, i) =>
  Math.max(0.06, 0.12 + 0.08 * Math.abs(Math.sin(i * 0.7)))
);

export const useVoiceRecorder = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recording, setRecording] = useState<VoiceRecording | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  /** Real-time normalised bar heights (0-1), updated at ~30 fps. */
  const [audioLevels, setAudioLevels] = useState<number[]>(IDLE_LEVELS);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const pauseAccumulatedRef = useRef<number>(0);
  const pauseStartRef = useRef<number | null>(null);
  const mimeTypeRef = useRef<string>("");
  const extensionRef = useRef<string>("webm");
  const pendingStopResolveRef = useRef<((file: File | null) => void) | null>(null);
  /**
   * Set to true by stopAndGetRecording/cancelRecording when the recorder hasn't
   * started yet (still awaiting getUserMedia). startRecording checks this after
   * getUserMedia resolves so it can abort the stream immediately instead of
   * starting a recorder that nobody will ever stop.
   */
  const cancelledDuringStartRef = useRef<boolean>(false);

  // Web Audio API refs for live level analysis
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelsAnimFrameRef = useRef<number | null>(null);

  const _stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const _stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  /** Disconnect Web Audio analyser and reset levels to idle state. */
  const _stopAnalyser = useCallback(() => {
    if (levelsAnimFrameRef.current !== null) {
      cancelAnimationFrame(levelsAnimFrameRef.current);
      levelsAnimFrameRef.current = null;
    }
    if (analyserRef.current) {
      try { analyserRef.current.disconnect(); } catch { /* ignore */ }
      analyserRef.current = null;
    }
    if (audioContextRef.current) {
      try { void audioContextRef.current.close(); } catch { /* ignore */ }
      audioContextRef.current = null;
    }
    setAudioLevels(IDLE_LEVELS);
  }, []);

  const startRecording = useCallback(async () => {
    cancelledDuringStartRef.current = false;

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "Microphone access is not available. Make sure you're using a secure (HTTPS) connection."
      );
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      const name = (err as DOMException)?.name ?? "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        throw new Error(
          "Microphone access was denied. Please allow microphone access in your browser settings and try again."
        );
      }
      if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        throw new Error("No microphone found. Please connect a microphone and try again.");
      }
      if (name === "NotReadableError" || name === "TrackStartError") {
        throw new Error("Microphone is in use by another application. Please close it and try again.");
      }
      throw new Error("Could not access microphone. Please check your browser settings.");
    }

    // If stopAndGetRecording/cancelRecording was called while we were waiting for
    // getUserMedia (e.g. pointer released before permission dialog resolved),
    // abort cleanly instead of starting a recorder nobody will stop.
    if (cancelledDuringStartRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    streamRef.current = stream;
    audioChunksRef.current = [];
    pauseAccumulatedRef.current = 0;
    pauseStartRef.current = null;

    // ── Web Audio live level analysis ───────────────────────────────────────
    try {
      const AudioCtx =
        (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext) as typeof AudioContext | undefined;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        audioContextRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.75;
        analyserRef.current = analyser;
        ctx.createMediaStreamSource(stream).connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const interval = 1000 / LEVEL_FPS;
        let last = 0;

        const tick = (now: number) => {
          levelsAnimFrameRef.current = requestAnimationFrame(tick);
          if (now - last < interval) return;
          last = now;
          analyser.getByteFrequencyData(dataArray);
          const step = dataArray.length / NUM_LEVEL_BARS;
          const levels: number[] = [];
          for (let i = 0; i < NUM_LEVEL_BARS; i++) {
            let sum = 0;
            const lo = Math.floor(i * step);
            const hi = Math.floor((i + 1) * step);
            for (let j = lo; j < hi; j++) sum += dataArray[j] ?? 0;
            // Normalise to 0–1, keep a small visual floor
            levels.push(Math.max(0.06, Math.min(1, sum / ((hi - lo) * 200))));
          }
          setAudioLevels(levels);
        };
        levelsAnimFrameRef.current = requestAnimationFrame(tick);
      }
    } catch {
      // Web Audio not available — degrade gracefully
    }

    const { mimeType, extension } = getBestMimeType();
    mimeTypeRef.current = mimeType;
    extensionRef.current = extension;

    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch {
      recorder = new MediaRecorder(stream);
    }
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      _stopAnalyser();
      const usedMime = mimeTypeRef.current || "audio/webm";
      const ext = extensionRef.current || "webm";
      const blob = new Blob(audioChunksRef.current, { type: usedMime });
      const url = URL.createObjectURL(blob);
      const durationMs =
        Date.now() - startTimeRef.current - pauseAccumulatedRef.current;

      const file = new File([blob], `voice_${Date.now()}.${ext}`, {
        type: usedMime,
      });
      Object.defineProperty(file, "durationMs", {
        value: durationMs,
        writable: false,
        configurable: true,
        enumerable: true,
      });

      const rec: VoiceRecording = { blob: file, url, durationMs, timestamp: new Date() };
      setRecording(rec);

      if (pendingStopResolveRef.current) {
        pendingStopResolveRef.current(file);
        pendingStopResolveRef.current = null;
      }

      _stopStream();
    };

    recorder.start(200);
    startTimeRef.current = Date.now();
    setIsRecording(true);
    setIsPaused(false);
    setRecordingTime(0);

    timerRef.current = setInterval(() => {
      const elapsed =
        Date.now() - startTimeRef.current - pauseAccumulatedRef.current;
      setRecordingTime(Math.floor(elapsed / 1000));
    }, 250);
  }, [_stopAnalyser]);

  const stopRecording = useCallback(() => {
    _stopTimer();
    const recorder = mediaRecorderRef.current;
    try {
      if (recorder && recorder.state !== "inactive") recorder.stop();
    } catch {
      // already stopped
    }
    setIsRecording(false);
    setIsPaused(false);
  }, []);

  /**
   * Stop recording and await the File produced by onstop — use this instead of
   * stopRecording() + reading `recording` state to avoid the async setState race.
   */
  const stopAndGetRecording = useCallback((): Promise<File | null> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      // Recorder hasn't started yet (still awaiting getUserMedia) — flag the
      // pending start so it aborts as soon as getUserMedia resolves.
      cancelledDuringStartRef.current = true;
      return Promise.resolve(recording?.blob ?? null);
    }
    return new Promise<File | null>((resolve) => {
      pendingStopResolveRef.current = resolve;
      _stopTimer();
      try {
        recorder.stop();
      } catch {
        pendingStopResolveRef.current = null;
        resolve(null);
      }
      setIsRecording(false);
      setIsPaused(false);
    });
  }, [recording]);

  const pauseRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || !isRecording || isPaused) return;
    try {
      recorder.pause();
      pauseStartRef.current = Date.now();
    } catch {
      // not all browsers support pause
    }
    setIsPaused(true);
    _stopTimer();
  }, [isRecording, isPaused]);

  const resumeRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || !isRecording || !isPaused) return;
    try {
      recorder.resume();
      if (pauseStartRef.current !== null) {
        pauseAccumulatedRef.current += Date.now() - pauseStartRef.current;
        pauseStartRef.current = null;
      }
    } catch {
      // not all browsers support resume
    }
    setIsPaused(false);
    timerRef.current = setInterval(() => {
      const elapsed =
        Date.now() - startTimeRef.current - pauseAccumulatedRef.current;
      setRecordingTime(Math.floor(elapsed / 1000));
    }, 250);
  }, [isRecording, isPaused]);

  const cancelRecording = useCallback(() => {
    // Signal any pending getUserMedia to abort if it resolves late.
    cancelledDuringStartRef.current = true;
    _stopTimer();
    _stopAnalyser();
    pendingStopResolveRef.current = null;
    const recorder = mediaRecorderRef.current;
    if (recorder) {
      recorder.onstop = null; // suppress onstop to avoid stale state
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        // ignore
      }
    }
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    _stopStream();
    setIsRecording(false);
    setIsPaused(false);
  }, [_stopAnalyser]);

  const clearRecording = useCallback(() => {
    setRecording((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
    setRecordingTime(0);
  }, []);

  const cleanup = useCallback(() => {
    _stopTimer();
    _stopAnalyser();
    _stopStream();
    pendingStopResolveRef.current = null;
    setRecording((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
  }, [_stopAnalyser]);

  return {
    isRecording,
    isPaused,
    recording,
    recordingTime,
    audioLevels,
    startRecording,
    stopRecording,
    stopAndGetRecording,
    pauseRecording,
    resumeRecording,
    cancelRecording,
    clearRecording,
    cleanup,
  };
};
