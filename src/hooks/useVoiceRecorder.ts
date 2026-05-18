import { useState, useRef, useCallback } from "react";

export interface VoiceRecording {
  blob: File;
  url: string;
  duration: number;
  timestamp: Date;
}

export const useVoiceRecorder = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recording, setRecording] = useState<VoiceRecording | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);
  const recorderMimeTypeRef = useRef<string>("audio/webm");

  const pickSupportedRecorderMimeType = () => {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
      "audio/ogg",
    ];
    if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
      return "";
    }
    for (const candidate of candidates) {
      if (MediaRecorder.isTypeSupported(candidate)) {
        return candidate;
      }
    }
    return "";
  };

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      const preferredMimeType = pickSupportedRecorderMimeType();
      const mediaRecorder = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      recorderMimeTypeRef.current = preferredMimeType || mediaRecorder.mimeType || "audio/webm";
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const selectedMime = recorderMimeTypeRef.current || "audio/webm";
        const normalizedMime = selectedMime.startsWith("video/") ? "audio/webm" : selectedMime;
        const audioBlob = new Blob(audioChunksRef.current, { type: normalizedMime });
        const audioUrl = URL.createObjectURL(audioBlob);
        const duration = Date.now() - startTimeRef.current;
        
        // Create a proper File object with name
        const timestamp = Date.now();
        const ext =
          normalizedMime.includes("mp4") ? "m4a" :
          normalizedMime.includes("ogg") ? "ogg" :
          normalizedMime.includes("mpeg") || normalizedMime.includes("mp3") ? "mp3" :
          normalizedMime.includes("wav") ? "wav" :
          "webm";
        const fileName = `voice_message_${timestamp}.${ext}`;
        const audioFile = new File([audioBlob], fileName, { type: normalizedMime });
        
        setRecording({
          blob: audioFile,
          url: audioUrl,
          duration,
          timestamp: new Date()
        });
        
        // Clean up stream
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
      };

      mediaRecorder.start();
      startTimeRef.current = Date.now();
      setIsRecording(true);
      setIsPaused(false);
      setRecordingTime(0);

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 100);

    } catch (error) {
      console.error('Error starting recording:', error);
      throw new Error('Failed to access microphone');
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
      
      // Clear timer
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [isRecording]);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording && !isPaused) {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      
      // Clear timer
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [isRecording, isPaused]);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording && isPaused) {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      
      // Resume timer
      timerRef.current = setInterval(() => {
        setRecordingTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 100);
    }
  }, [isRecording, isPaused]);

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
      setRecording(null);
      
      // Clear timer
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      
      // Clean up stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    }
  }, [isRecording]);

  const clearRecording = useCallback(() => {
    if (recording) {
      URL.revokeObjectURL(recording.url);
      setRecording(null);
      setRecordingTime(0);
    }
  }, [recording]);

  // Cleanup on unmount
  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (recording) {
      URL.revokeObjectURL(recording.url);
    }
  }, [recording]);

  return {
    isRecording,
    isPaused,
    recording,
    recordingTime,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    cancelRecording,
    clearRecording,
    cleanup
  };
};
