import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  VIDEO_CALL_LIMITS,
  getWebRtcIceServers,
  hasRelayIceServer,
} from "@/lib/videoCall";

interface WebRTCState {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isConnected: boolean;
  isConnecting: boolean;
  isSignalingReady: boolean;
  isAudioOnly: boolean;
  error: string | null;
}

interface StartCallOptions {
  audioOnly?: boolean;
}

const ICE_SERVERS = getWebRtcIceServers();
const HAS_RELAY_ICE_SERVER = hasRelayIceServer(ICE_SERVERS);
const RTC_CONFIGURATION: RTCConfiguration = {
  iceServers: ICE_SERVERS,
  bundlePolicy: "balanced",
  iceCandidatePoolSize: 4,
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

const playMediaElement = (element: HTMLVideoElement | null) => {
  if (!element) {
    return;
  }

  const playPromise = element.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(() => {
      // Playback can be deferred until the browser has a user gesture.
    });
  }
};

const getMediaErrorMessage = (error: unknown, audioOnlyRequested: boolean): string => {
  const errorName =
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof (error as { name?: unknown }).name === "string"
      ? (error as { name: string }).name
      : "";

  if (errorName === "NotAllowedError" || errorName === "SecurityError") {
    return audioOnlyRequested
      ? "Microphone permission is blocked. Allow access to join the call."
      : "Camera or microphone permission is blocked. Allow access to start the call.";
  }

  if (errorName === "NotFoundError" || errorName === "DevicesNotFoundError") {
    return audioOnlyRequested
      ? "No microphone was found on this device."
      : "No camera was found. The call can continue in audio-only mode if a microphone is available.";
  }

  if (errorName === "NotReadableError" || errorName === "TrackStartError") {
    return "Your camera or microphone is busy in another app. Close the other app and try again.";
  }

  return "Could not access camera or microphone. Check device permissions and try again.";
};

const isPolitePeer = (localUserId: string, remoteUserId: string): boolean => {
  const normalizedLocalId = String(localUserId || "");
  const normalizedRemoteId = String(remoteUserId || "");

  if (!normalizedLocalId || !normalizedRemoteId || normalizedLocalId === normalizedRemoteId) {
    return false;
  }

  const localNumericId = Number(normalizedLocalId);
  const remoteNumericId = Number(normalizedRemoteId);

  if (
    Number.isFinite(localNumericId) &&
    Number.isFinite(remoteNumericId) &&
    localNumericId !== remoteNumericId
  ) {
    return localNumericId > remoteNumericId;
  }

  return normalizedLocalId.localeCompare(normalizedRemoteId) > 0;
};

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
  const makingOfferRef = useRef(false);
  const ignoreOfferRef = useRef(false);

  const clearConnectionTimeout = useCallback(() => {
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
  }, []);

  const closePeerConnection = useCallback((connection: RTCPeerConnection | null) => {
    if (!connection) {
      return;
    }

    connection.onicecandidate = null;
    connection.onicecandidateerror = null;
    connection.ontrack = null;
    connection.onconnectionstatechange = null;
    connection.oniceconnectionstatechange = null;
    connection.close();
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
      if (cleanupInProgressRef.current) {
        return;
      }

      cleanupInProgressRef.current = true;
      clearConnectionTimeout();
      pendingIceCandidatesRef.current = [];
      remotePeerIdRef.current = null;
      makingOfferRef.current = false;
      ignoreOfferRef.current = false;

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }

      if (peerConnection.current) {
        closePeerConnection(peerConnection.current);
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
    [clearConnectionTimeout, closePeerConnection, userId]
  );

  const startConnectionTimeout = useCallback(() => {
    clearConnectionTimeout();
    connectionTimeoutRef.current = setTimeout(() => {
      cleanupCall(false);
      setConnectionError("Connection timed out. Please try again.");
    }, VIDEO_CALL_LIMITS.connectionTimeoutMs);
  }, [clearConnectionTimeout, cleanupCall, setConnectionError]);

  const handleConnectionFailure = useCallback(() => {
    clearConnectionTimeout();
    cleanupCall(false);
    setConnectionError(
      HAS_RELAY_ICE_SERVER
        ? "Connection failed. Please try again on a stable network."
        : "Connection failed. Please try again on a stable network. TURN relay servers are also required for some mobile and office networks."
    );
  }, [clearConnectionTimeout, cleanupCall, setConnectionError]);

  const flushPendingIceCandidates = useCallback(async (connection: RTCPeerConnection) => {
    if (!connection.remoteDescription || pendingIceCandidatesRef.current.length === 0) {
      return;
    }

    const queuedCandidates = [...pendingIceCandidatesRef.current];
    pendingIceCandidatesRef.current = [];

    for (const candidate of queuedCandidates) {
      try {
        await connection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error("Error applying queued ICE candidate:", error);
      }
    }
  }, []);

  const attachLocalTracks = useCallback((connection: RTCPeerConnection, stream: MediaStream) => {
    const existingTrackIds = new Set(
      connection
        .getSenders()
        .map((sender) => sender.track?.id)
        .filter((trackId): trackId is string => Boolean(trackId))
    );

    stream.getTracks().forEach((track) => {
      if (!existingTrackIds.has(track.id)) {
        connection.addTrack(track, stream);
      }
    });
  }, []);

  const createPeerConnection = useCallback(() => {
    const connection = new RTCPeerConnection(RTC_CONFIGURATION);

    connection.onicecandidate = async (event) => {
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

    connection.onicecandidateerror = (event) => {
      console.warn("ICE candidate error:", event);
    };

    connection.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (!remoteStream) {
        return;
      }

      setState((prev) => ({
        ...prev,
        remoteStream,
        isConnecting: false,
        error: null,
      }));

      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
        playMediaElement(remoteVideoRef.current);
      }
    };

    connection.onconnectionstatechange = () => {
      if (connection.connectionState === "connected") {
        clearConnectionTimeout();
        setState((prev) => ({
          ...prev,
          isConnected: true,
          isConnecting: false,
          error: null,
        }));
        return;
      }

      if (connection.connectionState === "connecting") {
        setState((prev) => ({
          ...prev,
          isConnecting: true,
          error: null,
        }));
        return;
      }

      if (connection.connectionState === "disconnected") {
        startConnectionTimeout();
        setState((prev) => ({
          ...prev,
          isConnected: false,
          isConnecting: true,
          error: "Connection interrupted. Trying to reconnect...",
        }));
        return;
      }

      if (connection.connectionState === "failed") {
        handleConnectionFailure();
        return;
      }

      if (connection.connectionState === "closed") {
        clearConnectionTimeout();
        setState((prev) => ({
          ...prev,
          isConnected: false,
          isConnecting: false,
        }));
      }
    };

    connection.oniceconnectionstatechange = () => {
      if (connection.iceConnectionState === "failed") {
        handleConnectionFailure();
      }
    };

    return connection;
  }, [
    clearConnectionTimeout,
    handleConnectionFailure,
    startConnectionTimeout,
    userId,
  ]);

  const createFreshPeerConnection = useCallback(() => {
    if (peerConnection.current) {
      closePeerConnection(peerConnection.current);
    }

    const connection = createPeerConnection();
    peerConnection.current = connection;
    pendingIceCandidatesRef.current = [];
    remotePeerIdRef.current = null;
    return connection;
  }, [closePeerConnection, createPeerConnection]);

  const initializeMedia = useCallback(
    async (audioOnlyRequested = false) => {
      if (localStreamRef.current) {
        return localStreamRef.current;
      }

      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices?.getUserMedia ||
        typeof RTCPeerConnection === "undefined"
      ) {
        setConnectionError("This device or browser does not support secure in-browser calls.");
        return null;
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
          playMediaElement(localVideoRef.current);
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
        setConnectionError(getMediaErrorMessage(error, audioOnlyRequested));
        return null;
      }
    },
    [setConnectionError]
  );

  const rollbackConnectionIfNeeded = useCallback(
    async (connection: RTCPeerConnection, stream: MediaStream) => {
      if (connection.signalingState === "stable") {
        return connection;
      }

      try {
        await connection.setLocalDescription({ type: "rollback" });
        return connection;
      } catch (rollbackError) {
        console.warn("Rollback failed, replacing peer connection:", rollbackError);
        const replacement = createFreshPeerConnection();
        attachLocalTracks(replacement, stream);
        return replacement;
      }
    },
    [attachLocalTracks, createFreshPeerConnection]
  );

  const startCall = useCallback(
    async (options: StartCallOptions = {}) => {
      if (!sessionId) {
        setConnectionError("Select a session before starting a call.");
        return false;
      }

      if (!String(userId || "")) {
        setConnectionError("Sign in before starting a call.");
        return false;
      }

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setConnectionError("You are offline. Reconnect to start the call.");
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

        const connection = createFreshPeerConnection();
        attachLocalTracks(connection, stream);
        ignoreOfferRef.current = false;
        makingOfferRef.current = true;

        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        makingOfferRef.current = false;

        await channelRef.current.send({
          type: "broadcast",
          event: "offer",
          payload: {
            offer,
            senderId: String(userId || ""),
            audioOnly: stream.getVideoTracks().length === 0,
          },
        });

        return true;
      } catch (error) {
        makingOfferRef.current = false;
        console.error("Error starting call:", error);
        cleanupCall(false);
        setConnectionError("Failed to start the call.");
        return false;
      }
    },
    [
      attachLocalTracks,
      cleanupCall,
      clearConnectionTimeout,
      createFreshPeerConnection,
      initializeMedia,
      sessionId,
      startConnectionTimeout,
      state.isConnected,
      state.isConnecting,
      state.isSignalingReady,
      setConnectionError,
      userId,
    ]
  );

  const handleOffer = useCallback(
    async (
      offer: RTCSessionDescriptionInit,
      senderId: string,
      audioOnly = false
    ) => {
      const normalizedSenderId = String(senderId || "");
      const normalizedUserId = String(userId || "");

      if (!normalizedSenderId || normalizedSenderId === normalizedUserId) {
        return;
      }

      if (
        remotePeerIdRef.current &&
        remotePeerIdRef.current !== normalizedSenderId
      ) {
        setConnectionError("Participant limit reached (max 2 users per call).");
        return;
      }

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setConnectionError("You are offline. Reconnect to join the call.");
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

        let connection =
          peerConnection.current && peerConnection.current.signalingState !== "closed"
            ? peerConnection.current
            : createFreshPeerConnection();

        attachLocalTracks(connection, stream);

        const offerCollision =
          makingOfferRef.current || connection.signalingState !== "stable";
        const politePeer = isPolitePeer(normalizedUserId, normalizedSenderId);

        ignoreOfferRef.current = !politePeer && offerCollision;
        if (ignoreOfferRef.current) {
          return;
        }

        if (offerCollision) {
          connection = await rollbackConnectionIfNeeded(connection, stream);
        }

        await connection.setRemoteDescription(new RTCSessionDescription(offer));
        remotePeerIdRef.current = normalizedSenderId;
        ignoreOfferRef.current = false;

        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);

        await channelRef.current?.send({
          type: "broadcast",
          event: "answer",
          payload: {
            answer,
            senderId: normalizedUserId,
          },
        });

        await flushPendingIceCandidates(connection);
      } catch (error) {
        console.error("Error handling offer:", error);
        cleanupCall(false);
        setConnectionError("Failed to join the incoming call.");
      }
    },
    [
      attachLocalTracks,
      cleanupCall,
      clearConnectionTimeout,
      createFreshPeerConnection,
      flushPendingIceCandidates,
      initializeMedia,
      rollbackConnectionIfNeeded,
      setConnectionError,
      startConnectionTimeout,
      userId,
    ]
  );

  const handleAnswer = useCallback(
    async (answer: RTCSessionDescriptionInit, senderId: string) => {
      const normalizedSenderId = String(senderId || "");
      const normalizedUserId = String(userId || "");
      const connection = peerConnection.current;

      if (!normalizedSenderId || normalizedSenderId === normalizedUserId || !connection) {
        return;
      }

      if (
        remotePeerIdRef.current &&
        remotePeerIdRef.current !== normalizedSenderId
      ) {
        return;
      }

      try {
        await connection.setRemoteDescription(new RTCSessionDescription(answer));
        remotePeerIdRef.current = normalizedSenderId;
        ignoreOfferRef.current = false;
        await flushPendingIceCandidates(connection);
      } catch (error) {
        console.error("Error handling answer:", error);
        setConnectionError("Failed to establish the call connection.");
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

      if (ignoreOfferRef.current && !remotePeerIdRef.current) {
        return;
      }

      const connection = peerConnection.current;
      if (!connection || !connection.remoteDescription) {
        pendingIceCandidatesRef.current.push(candidate);
        return;
      }

      try {
        await connection.addIceCandidate(new RTCIceCandidate(candidate));
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

        if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
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
    handleAnswer,
    handleIceCandidate,
    handleOffer,
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
      playMediaElement(localVideoRef.current);
    }
  }, [state.localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && state.remoteStream) {
      remoteVideoRef.current.srcObject = state.remoteStream;
      playMediaElement(remoteVideoRef.current);
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
