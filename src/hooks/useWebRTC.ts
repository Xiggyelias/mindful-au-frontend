import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { VIDEO_CALL_LIMITS } from "@/lib/videoCall";

interface WebRTCState {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isConnected: boolean;
  isConnecting: boolean;
  isSignalingReady: boolean;
  isAudioOnly: boolean;
  error: string | null;
}

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

const MEDIA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    width: { ideal: 1280, max: 1280 },
    height: { ideal: 720, max: 720 },
    frameRate: { ideal: 24, max: 30 },
    facingMode: "user",
  },
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
};

const AUDIO_ONLY_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  video: false,
};

interface StartCallOptions {
  audioOnly?: boolean;
}

export const useWebRTC = (sessionId: string, userId: string) => {
  const [state, setState] = useState<WebRTCState>({
    localStream: null,
    remoteStream: null,
    isConnected: false,
    isConnecting: false,
    isSignalingReady: false,
    isAudioOnly: false,
    error: null,
  });

  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const cleanupInProgressRef = useRef(false);
  const connectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const remotePeerIdRef = useRef<string | null>(null);

  const clearConnectionTimeout = useCallback(() => {
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
  }, []);

  const setConnectionError = useCallback((message: string) => {
    setState((prev) => ({
      ...prev,
      isConnected: false,
      isConnecting: false,
      error: message,
    }));
  }, []);

  const cleanupCall = useCallback(
    (broadcastEnd = true) => {
      if (cleanupInProgressRef.current) return;
      cleanupInProgressRef.current = true;

      clearConnectionTimeout();
      pendingIceCandidatesRef.current = [];
      remotePeerIdRef.current = null;

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }

      if (peerConnection.current) {
        peerConnection.current.onicecandidate = null;
        peerConnection.current.ontrack = null;
        peerConnection.current.onconnectionstatechange = null;
        peerConnection.current.close();
        peerConnection.current = null;
      }

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }

      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }

      if (broadcastEnd && channelRef.current) {
        void channelRef.current.send({
          type: "broadcast",
          event: "call-ended",
          payload: { senderId: String(userId || "") },
        });
      }

      setState((prev) => ({
        ...prev,
        localStream: null,
        remoteStream: null,
        isConnected: false,
        isConnecting: false,
        isAudioOnly: false,
        error: null,
      }));

      cleanupInProgressRef.current = false;
    },
    [clearConnectionTimeout, userId]
  );

  const startConnectionTimeout = useCallback(() => {
    clearConnectionTimeout();
    connectionTimeoutRef.current = setTimeout(() => {
      cleanupCall(false);
      setConnectionError("Connection timed out. Please try again.");
    }, VIDEO_CALL_LIMITS.connectionTimeoutMs);
  }, [clearConnectionTimeout, cleanupCall, setConnectionError]);

  const flushPendingIceCandidates = useCallback(async (pc: RTCPeerConnection) => {
    if (!pc.remoteDescription || pendingIceCandidatesRef.current.length === 0) {
      return;
    }

    const queuedCandidates = [...pendingIceCandidatesRef.current];
    pendingIceCandidatesRef.current = [];

    for (const candidate of queuedCandidates) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error("Error applying queued ICE candidate:", error);
      }
    }
  }, []);

  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    pc.onicecandidate = async (event) => {
      if (event.candidate && channelRef.current) {
        await channelRef.current.send({
          type: "broadcast",
          event: "ice-candidate",
          payload: {
            candidate: event.candidate,
            senderId: String(userId || ""),
          },
        });
      }
    };

    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      setState((prev) => ({ ...prev, remoteStream }));
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        clearConnectionTimeout();
        setState((prev) => ({
          ...prev,
          isConnected: true,
          isConnecting: false,
          error: null,
        }));
      } else if (
        pc.connectionState === "disconnected" ||
        pc.connectionState === "failed"
      ) {
        clearConnectionTimeout();
        cleanupCall(false);
        setConnectionError("Connection lost.");
      } else if (pc.connectionState === "closed") {
        clearConnectionTimeout();
        setState((prev) => ({
          ...prev,
          isConnected: false,
          isConnecting: false,
        }));
      }
    };

    return pc;
  }, [cleanupCall, clearConnectionTimeout, setConnectionError, userId]);

  const initializeMedia = useCallback(async (audioOnlyRequested = false) => {
    if (localStreamRef.current) {
      return localStreamRef.current;
    }

    const tryGetMedia = async (constraints: MediaStreamConstraints) => {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      setState((prev) => ({
        ...prev,
        localStream: stream,
        isAudioOnly: stream.getVideoTracks().length === 0,
      }));

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      return stream;
    };

    try {
      if (audioOnlyRequested) {
        return await tryGetMedia(AUDIO_ONLY_CONSTRAINTS);
      }

      try {
        return await tryGetMedia(MEDIA_CONSTRAINTS);
      } catch (videoError) {
        console.warn("Falling back to audio-only media:", videoError);
        return await tryGetMedia(AUDIO_ONLY_CONSTRAINTS);
      }
    } catch (error) {
      console.error("Error accessing media devices:", error);
      setConnectionError(
        "Could not access camera/microphone. Please check permissions."
      );
      return null;
    }
  }, [setConnectionError]);

  const startCall = useCallback(async (options: StartCallOptions = {}) => {
    if (!sessionId) {
      setConnectionError("Select a session before starting a call.");
      return false;
    }

    if (!String(userId || "")) {
      setConnectionError("Sign in before starting a call.");
      return false;
    }

    if (!channelRef.current || !state.isSignalingReady) {
      setConnectionError("Call channel is not ready yet. Please try again.");
      return false;
    }

    if (state.isConnected) {
      return true;
    }

    if (state.isConnecting) {
      return false;
    }

    setState((prev) => ({ ...prev, isConnecting: true, error: null }));
    startConnectionTimeout();

    try {
      const stream = await initializeMedia(Boolean(options.audioOnly));
      if (!stream) {
        clearConnectionTimeout();
        setState((prev) => ({ ...prev, isConnecting: false }));
        return false;
      }

      if (peerConnection.current) {
        peerConnection.current.close();
        peerConnection.current = null;
      }

      const pc = createPeerConnection();
      peerConnection.current = pc;
      pendingIceCandidatesRef.current = [];
      remotePeerIdRef.current = null;

      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      const isAudioOnlyOffer = stream.getVideoTracks().length === 0;

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      if (channelRef.current) {
        await channelRef.current.send({
          type: "broadcast",
          event: "offer",
          payload: {
            offer,
            senderId: String(userId || ""),
            audioOnly: isAudioOnlyOffer,
          },
        });
      }

      return true;
    } catch (error) {
      console.error("Error starting call:", error);
      cleanupCall(false);
      setConnectionError("Failed to start call.");
      return false;
    }
  }, [
    cleanupCall,
    clearConnectionTimeout,
    initializeMedia,
    createPeerConnection,
    sessionId,
    startConnectionTimeout,
    state.isConnected,
    state.isConnecting,
    state.isSignalingReady,
    setConnectionError,
    userId,
  ]);

  const handleOffer = useCallback(
    async (
      offer: RTCSessionDescriptionInit,
      senderId: string,
      audioOnly = false
    ) => {
      const normalizedSenderId = String(senderId || "");
      const normalizedUserId = String(userId || "");

      if (!normalizedSenderId || normalizedSenderId === normalizedUserId) return;

      if (
        remotePeerIdRef.current &&
        remotePeerIdRef.current !== normalizedSenderId
      ) {
        setConnectionError("Participant limit reached (max 2 users per call).");
        return;
      }

      setState((prev) => ({ ...prev, isConnecting: true, error: null }));
      startConnectionTimeout();

      try {
        const stream = await initializeMedia(audioOnly);
        if (!stream) {
          clearConnectionTimeout();
          setState((prev) => ({ ...prev, isConnecting: false }));
          return;
        }

        if (peerConnection.current) {
          peerConnection.current.close();
          peerConnection.current = null;
        }

        const pc = createPeerConnection();
        peerConnection.current = pc;
        pendingIceCandidatesRef.current = [];
        remotePeerIdRef.current = normalizedSenderId;

        stream.getTracks().forEach((track) => {
          pc.addTrack(track, stream);
        });

        await pc.setRemoteDescription(new RTCSessionDescription(offer));

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        if (channelRef.current) {
          await channelRef.current.send({
            type: "broadcast",
            event: "answer",
            payload: {
              answer,
              senderId: normalizedUserId,
            },
          });
        }

        await flushPendingIceCandidates(pc);
      } catch (error) {
        console.error("Error handling offer:", error);
        cleanupCall(false);
        setConnectionError("Failed to process incoming call offer.");
      }
    },
    [
      cleanupCall,
      clearConnectionTimeout,
      initializeMedia,
      createPeerConnection,
      flushPendingIceCandidates,
      startConnectionTimeout,
      setConnectionError,
      userId,
    ]
  );

  const handleAnswer = useCallback(
    async (answer: RTCSessionDescriptionInit, senderId: string) => {
      const normalizedSenderId = String(senderId || "");
      const normalizedUserId = String(userId || "");

      if (!normalizedSenderId || normalizedSenderId === normalizedUserId) return;
      if (!peerConnection.current) return;

      if (
        remotePeerIdRef.current &&
        remotePeerIdRef.current !== normalizedSenderId
      ) {
        return;
      }

      try {
        await peerConnection.current.setRemoteDescription(
          new RTCSessionDescription(answer)
        );
        remotePeerIdRef.current = normalizedSenderId;
        await flushPendingIceCandidates(peerConnection.current);
      } catch (error) {
        console.error("Error handling answer:", error);
        setConnectionError("Failed to establish call connection.");
      }
    },
    [flushPendingIceCandidates, setConnectionError, userId]
  );

  const handleIceCandidate = useCallback(
    async (candidate: RTCIceCandidateInit, senderId: string) => {
      const normalizedSenderId = String(senderId || "");
      const normalizedUserId = String(userId || "");

      if (!candidate || !normalizedSenderId || normalizedSenderId === normalizedUserId) {
        return;
      }

      if (
        remotePeerIdRef.current &&
        remotePeerIdRef.current !== normalizedSenderId
      ) {
        return;
      }

      const pc = peerConnection.current;

      if (!pc || !pc.remoteDescription) {
        pendingIceCandidatesRef.current.push(candidate);
        return;
      }

      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error("Error adding ICE candidate:", error);
      }
    },
    [userId]
  );

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
    }
  }, []);

  const toggleVideo = useCallback(() => {
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      if (videoTracks.length === 0) {
        setState((prev) => ({ ...prev, isAudioOnly: true }));
        return;
      }

      videoTracks.forEach((track) => {
        track.enabled = !track.enabled;
      });
    }
  }, []);

  const startAudioCall = useCallback(async () => {
    return startCall({ audioOnly: true });
  }, [startCall]);

  const endCall = useCallback(() => {
    cleanupCall(true);
  }, [cleanupCall]);

  useEffect(() => {
    if (!sessionId) {
      setState((prev) => ({ ...prev, isSignalingReady: false }));
      return;
    }

    const channel = supabase.channel(`video-call-${sessionId}`);
    channelRef.current = channel;
    setState((prev) => ({ ...prev, isSignalingReady: false, error: null }));

    channel
      .on("broadcast", { event: "offer" }, ({ payload }) => {
        void handleOffer(payload.offer, payload.senderId, Boolean(payload.audioOnly));
      })
      .on("broadcast", { event: "answer" }, ({ payload }) => {
        void handleAnswer(payload.answer, payload.senderId);
      })
      .on("broadcast", { event: "ice-candidate" }, ({ payload }) => {
        void handleIceCandidate(payload.candidate, payload.senderId);
      })
      .on("broadcast", { event: "call-ended" }, ({ payload }) => {
        if (String(payload?.senderId || "") !== String(userId || "")) {
          cleanupCall(false);
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setState((prev) => ({ ...prev, isSignalingReady: true, error: null }));
        }

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setState((prev) => ({ ...prev, isSignalingReady: false }));
          setConnectionError("Call signaling channel unavailable.");
        }
      });

    return () => {
      cleanupCall(false);
      setState((prev) => ({ ...prev, isSignalingReady: false }));
      channel.unsubscribe();
      if (channelRef.current === channel) {
        channelRef.current = null;
      }
    };
  }, [
    cleanupCall,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    sessionId,
    setConnectionError,
    userId,
  ]);

  useEffect(() => {
    return () => {
      cleanupCall(false);
      if (channelRef.current) {
        channelRef.current.unsubscribe();
        channelRef.current = null;
      }
    };
  }, [cleanupCall]);

  useEffect(() => {
    if (localVideoRef.current && state.localStream) {
      localVideoRef.current.srcObject = state.localStream;
    }
  }, [state.localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && state.remoteStream) {
      remoteVideoRef.current.srcObject = state.remoteStream;
    }
  }, [state.remoteStream]);

  return {
    ...state,
    localVideoRef,
    remoteVideoRef,
    startCall,
    startAudioCall,
    endCall,
    toggleMute,
    toggleVideo,
  };
};
