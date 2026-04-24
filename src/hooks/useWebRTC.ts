import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBandwidthMode } from "@/hooks/useBandwidthMode";
import {
  VIDEO_CALL_LIMITS,
  getWebRtcIceServers,
  hasRelayIceServer,
} from "@/lib/videoCall";

interface WebRTCState {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  remoteHasVideo: boolean;
  isConnected: boolean;
  isConnecting: boolean;
  isSignalingReady: boolean;
  isAudioOnly: boolean;
  isLocalVideoEnabled: boolean;
  error: string | null;
  isRelayError: boolean;
  notice: string | null;
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

const LOW_BANDWIDTH_MEDIA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    width: { ideal: 640, max: 854 },
    height: { ideal: 360, max: 480 },
    frameRate: { ideal: 15, max: 20 },
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
  const { lowBandwidthMode } = useBandwidthMode();
  const [state, setState] = useState<WebRTCState>({
    localStream: null,
    remoteStream: null,
    remoteHasVideo: false,
    isConnected: false,
    isConnecting: false,
    isSignalingReady: false,
    isAudioOnly: false,
    isLocalVideoEnabled: false,
    error: null,
    isRelayError: false,
    notice: null,
  });

  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const cleanupInProgressRef = useRef(false);
  const connectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const remotePeerIdRef = useRef<string | null>(null);
  const makingOfferRef = useRef(false);
  const ignoreOfferRef = useRef(false);
  const wasConnectedRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);

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

  const setConnectionError = useCallback((message: string, isRelay = false) => {
    setState((prev) => ({
      ...prev,
      isConnected: false,
      isConnecting: false,
      error: message,
      isRelayError: isRelay,
      notice: null,
    }));
  }, []);

  const setMediaNoticeError = useCallback((message: string) => {
    setState((prev) => ({
      ...prev,
      error: message,
      isRelayError: false,
      notice: null,
    }));
  }, []);

  const applyVideoSenderParameters = useCallback(
    (sender: RTCRtpSender) => {
      if (sender.track?.kind !== "video") {
        return;
      }

      const parameters = sender.getParameters();
      if (!parameters.encodings) {
        parameters.encodings = [{}];
      }

      const maxBitrate = lowBandwidthMode ? 250_000 : 1_500_000;
      parameters.encodings[0].maxBitrate = maxBitrate;

      void sender.setParameters(parameters).catch((error) => {
        console.warn("Failed to set video bitrate parameters:", error);
      });
    },
    [lowBandwidthMode]
  );

  const updateRemoteStreamState = useCallback((stream: MediaStream | null) => {
    remoteStreamRef.current = stream;

    setState((prev) => ({
      ...prev,
      remoteStream: stream,
      remoteHasVideo: Boolean(stream?.getVideoTracks().length),
      isConnecting: false,
      error: null,
      notice: null,
    }));

    if (stream && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = stream;
      playMediaElement(remoteVideoRef.current);
    }
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
      remoteStreamRef.current = null;
      makingOfferRef.current = false;
      ignoreOfferRef.current = false;
      wasConnectedRef.current = false;
      reconnectAttemptsRef.current = 0;

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
        remoteHasVideo: false,
        isConnected: false,
        isConnecting: false,
        isAudioOnly: false,
        isLocalVideoEnabled: false,
        error: null,
        isRelayError: false,
        notice: null,
      }));

      cleanupInProgressRef.current = false;
    },
    [clearConnectionTimeout, closePeerConnection, userId]
  );

  const startConnectionTimeout = useCallback(() => {
    clearConnectionTimeout();
    connectionTimeoutRef.current = setTimeout(() => {
      cleanupCall(false);
      setConnectionError("We couldn't connect the call in time. Check your connection and try again.");
    }, VIDEO_CALL_LIMITS.connectionTimeoutMs);
  }, [clearConnectionTimeout, cleanupCall, setConnectionError]);

  const handleConnectionFailure = useCallback(() => {
    clearConnectionTimeout();
    cleanupCall(false);
    
    let errorMessage = "Connection failed. Please try again on a stable network.";
    if (!HAS_RELAY_ICE_SERVER) {
      errorMessage += " TURN relay servers are also required for some mobile and office networks.";
      console.warn(
        "WebRTC relay (TURN) servers are not configured. Calls may fail on carrier, office, or NAT-restricted networks."
      );
    }
    
    setConnectionError(errorMessage, !HAS_RELAY_ICE_SERVER);
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
        const sender = connection.addTrack(track, stream);
        applyVideoSenderParameters(sender);
      }
    });
  }, [applyVideoSenderParameters]);

  const sendOffer = useCallback(
    async (connection: RTCPeerConnection, options?: { iceRestart?: boolean }) => {
      const stream = localStreamRef.current;
      if (!stream || !channelRef.current) {
        return false;
      }

      makingOfferRef.current = true;

      try {
        if (options?.iceRestart && typeof connection.restartIce === "function") {
          connection.restartIce();
        }

        const offer = await connection.createOffer(
          options?.iceRestart ? { iceRestart: true } : undefined
        );
        await connection.setLocalDescription(offer);

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
      } finally {
        makingOfferRef.current = false;
      }
    },
    [userId]
  );

  const attemptIceRestart = useCallback(
    async (connection: RTCPeerConnection) => {
      if (
        reconnectAttemptsRef.current >= 2 ||
        !wasConnectedRef.current ||
        !remotePeerIdRef.current ||
        !localStreamRef.current ||
        !channelRef.current ||
        makingOfferRef.current
      ) {
        return;
      }

      reconnectAttemptsRef.current += 1;

      try {
        await sendOffer(connection, { iceRestart: true });
      } catch (error) {
        console.warn("ICE restart attempt failed:", error);
      }
    },
    [sendOffer]
  );

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
      let remoteStream = event.streams[0] ?? null;

      if (!remoteStream) {
        remoteStream = remoteStreamRef.current ?? new MediaStream();
        const alreadyAdded = remoteStream
          .getTracks()
          .some((track) => track.id === event.track.id);

        if (!alreadyAdded) {
          remoteStream.addTrack(event.track);
        }
      }

      updateRemoteStreamState(remoteStream);
      event.track.addEventListener("ended", () => {
        updateRemoteStreamState(remoteStreamRef.current);
      });
    };

    connection.onconnectionstatechange = () => {
      if (connection.connectionState === "connected") {
        wasConnectedRef.current = true;
        reconnectAttemptsRef.current = 0;
        clearConnectionTimeout();
        setState((prev) => ({
          ...prev,
          isConnected: true,
          isConnecting: false,
          error: null,
          notice: null,
        }));
        return;
      }

      if (connection.connectionState === "connecting") {
        setState((prev) => ({
          ...prev,
          isConnecting: true,
          error: null,
          notice:
            wasConnectedRef.current && reconnectAttemptsRef.current > 0
              ? "Connection interrupted. Trying to reconnect..."
              : null,
        }));
        return;
      }

      if (connection.connectionState === "disconnected") {
        startConnectionTimeout();
        setState((prev) => ({
          ...prev,
          isConnected: false,
          isConnecting: true,
          error: null,
          notice: wasConnectedRef.current
            ? "Connection interrupted. Trying to reconnect..."
            : prev.notice,
        }));
        void attemptIceRestart(connection);
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
          notice: null,
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
    attemptIceRestart,
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
          isLocalVideoEnabled: stream.getVideoTracks().some((track) => track.enabled),
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
          return await tryGetMedia(
            lowBandwidthMode ? LOW_BANDWIDTH_MEDIA_CONSTRAINTS : MEDIA_CONSTRAINTS
          );
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
    [lowBandwidthMode, setConnectionError]
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

      setState((prev) => ({ ...prev, isConnecting: true, error: null, notice: null }));
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
        reconnectAttemptsRef.current = 0;

        await sendOffer(connection);

        return true;
      } catch (error) {
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
      sendOffer,
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

      setState((prev) => ({ ...prev, isConnecting: true, error: null, notice: null }));
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
        reconnectAttemptsRef.current = 0;

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
        reconnectAttemptsRef.current = 0;
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
    const toggle = async () => {
      const stream = localStreamRef.current;
      if (!stream) {
        return false;
      }

      const videoTracks = stream.getVideoTracks();
      if (videoTracks.length === 0) {
        try {
          const videoStream = await navigator.mediaDevices.getUserMedia({
            video: lowBandwidthMode
              ? LOW_BANDWIDTH_MEDIA_CONSTRAINTS.video
              : MEDIA_CONSTRAINTS.video,
            audio: false,
          });
          const [videoTrack] = videoStream.getVideoTracks();

          if (!videoTrack) {
            videoStream.getTracks().forEach((track) => track.stop());
            setMediaNoticeError("No camera was found. Connect a camera and try again.");
            return false;
          }

          stream.addTrack(videoTrack);
          setState((prev) => ({
            ...prev,
            localStream: stream,
            isAudioOnly: false,
            isLocalVideoEnabled: true,
            error: null,
            isRelayError: false,
          }));

          const connection = peerConnection.current;
          if (connection) {
            const sender = connection.addTrack(videoTrack, stream);
            applyVideoSenderParameters(sender);

            if (
              channelRef.current &&
              state.isSignalingReady &&
              connection.signalingState === "stable" &&
              !makingOfferRef.current
            ) {
              await sendOffer(connection);
            }
          }

          return true;
        } catch (error) {
          console.error("Error enabling camera:", error);
          setMediaNoticeError(getMediaErrorMessage(error, false));
          return false;
        }
      }

      const shouldEnableVideo = videoTracks.some((track) => !track.enabled);
      videoTracks.forEach((track) => {
        track.enabled = shouldEnableVideo;
      });

      setState((prev) => ({
        ...prev,
        isLocalVideoEnabled: shouldEnableVideo,
        error: null,
      }));

      return shouldEnableVideo;
    };

    return toggle();
  }, [
    applyVideoSenderParameters,
    lowBandwidthMode,
    sendOffer,
    setMediaNoticeError,
    state.isSignalingReady,
  ]);

  const startAudioCall = useCallback(async () => {
    return startCall({ audioOnly: true });
  }, [startCall]);

  const endCall = useCallback(() => {
    cleanupCall(true);
  }, [cleanupCall]);

  useEffect(() => {
    if (!sessionId) {
      setState((prev) => ({
        ...prev,
        isSignalingReady: false,
        notice: null,
        remoteStream: null,
        remoteHasVideo: false,
      }));
      return;
    }

    const channel = supabase.channel(`video-call-${sessionId}`);
    channelRef.current = channel;
    setState((prev) => ({ ...prev, isSignalingReady: false, error: null, notice: null }));

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
          setState((prev) => ({ ...prev, isSignalingReady: true, error: null, notice: null }));
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
  }, [state.isAudioOnly, state.isLocalVideoEnabled, state.localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && state.remoteStream) {
      remoteVideoRef.current.srcObject = state.remoteStream;
      playMediaElement(remoteVideoRef.current);
    }
  }, [state.remoteHasVideo, state.remoteStream]);

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
