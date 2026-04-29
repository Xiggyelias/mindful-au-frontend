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
  isReconnecting: boolean;
  isDisconnected: boolean;
  rejoinDeadline: number | null;
  isSignalingReady: boolean;
  isAudioOnly: boolean;
  isLocalVideoEnabled: boolean;
  error: string | null;
  isRelayError: boolean;
  notice: string | null;
  isIncomingCall: boolean;
  incomingCallerId: string | null;
  incomingAudioOnly: boolean;
  localSpeaking: boolean;
  remoteSpeaking: boolean;
  callQuality: {
    latencyMs: number | null;
    jitterMs: number | null;
    packetLossPercent: number | null;
  };
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

const SPEAKING_THRESHOLD = 0.06;
const SPEAKING_HOLD_MS = 300;

type WebRTCEngineListener = (state: WebRTCState) => void;

type WebRTCEngine = {
  sessionId: string;
  userId: string;
  lowBandwidthMode: boolean;
  state: WebRTCState;
  peerConnection: RTCPeerConnection | null;
  channel: ReturnType<typeof supabase.channel> | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  pendingIceCandidates: RTCIceCandidateInit[];
  remotePeerId: string | null;
  observedRemoteTrackIds: Set<string>;
  makingOffer: boolean;
  ignoreOffer: boolean;
  wasConnected: boolean;
  reconnectAttempts: number;
  cleanupInProgress: boolean;
  connectionTimeout: ReturnType<typeof setTimeout> | null;
  pendingCallRequest: { audioOnly: boolean } | null;
  localSpeakingSince: number | null;
  remoteSpeakingSince: number | null;
  localVideoElements: Set<HTMLVideoElement>;
  remoteVideoElements: Set<HTMLVideoElement>;
  listeners: Set<WebRTCEngineListener>;

  reconnectDeadlineMs: number | null;
  reconnectIntervalId: number | null;
};

const DEFAULT_ENGINE_STATE: WebRTCState = {
  localStream: null,
  remoteStream: null,
  remoteHasVideo: false,
  isConnected: false,
  isConnecting: false,
  isReconnecting: false,
  isDisconnected: false,
  rejoinDeadline: null,
  isSignalingReady: false,
  isAudioOnly: false,
  isLocalVideoEnabled: false,
  error: null,
  isRelayError: false,
  notice: null,
  isIncomingCall: false,
  incomingCallerId: null,
  incomingAudioOnly: false,
  localSpeaking: false,
  remoteSpeaking: false,
  callQuality: {
    latencyMs: null,
    jitterMs: null,
    packetLossPercent: null,
  },
};

const engine: WebRTCEngine = {
  sessionId: "",
  userId: "",
  lowBandwidthMode: false,
  state: { ...DEFAULT_ENGINE_STATE },
  peerConnection: null,
  channel: null,
  localStream: null,
  remoteStream: null,
  pendingIceCandidates: [],
  remotePeerId: null,
  observedRemoteTrackIds: new Set(),
  makingOffer: false,
  ignoreOffer: false,
  wasConnected: false,
  reconnectAttempts: 0,
  cleanupInProgress: false,
  connectionTimeout: null,
  pendingCallRequest: null,
  localSpeakingSince: null,
  remoteSpeakingSince: null,
  localVideoElements: new Set(),
  remoteVideoElements: new Set(),
  listeners: new Set(),

  reconnectDeadlineMs: null,
  reconnectIntervalId: null,
};

const ACTIVE_CALL_STORAGE_KEY = "mindful.activeCall";
const RECONNECT_WINDOW_MS = 5 * 60 * 1000;
const RECONNECT_RETRY_INTERVAL_MS = 3000;

type PersistedActiveCall = {
  sessionId: string;
  userId: string;
  reconnectUntil: number;
};

const readPersistedActiveCall = (): PersistedActiveCall | null => {
  try {
    const raw = localStorage.getItem(ACTIVE_CALL_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<PersistedActiveCall>;
    if (!parsed?.sessionId || !parsed?.userId || typeof parsed.reconnectUntil !== "number") {
      return null;
    }
    return {
      sessionId: String(parsed.sessionId),
      userId: String(parsed.userId),
      reconnectUntil: parsed.reconnectUntil,
    };
  } catch {
    return null;
  }
};

const persistActiveCall = (sessionId: string, userId: string, reconnectUntil: number) => {
  try {
    const payload: PersistedActiveCall = {
      sessionId: String(sessionId || ""),
      userId: String(userId || ""),
      reconnectUntil,
    };
    localStorage.setItem(ACTIVE_CALL_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage failures.
  }
};

const clearPersistedActiveCall = () => {
  try {
    localStorage.removeItem(ACTIVE_CALL_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
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

const notifyEngineState = () => {
  for (const listener of engine.listeners) {
    listener(engine.state);
  }
};

const setEngineState = (updater: (prev: WebRTCState) => WebRTCState) => {
  engine.state = updater(engine.state);
  notifyEngineState();
};

const clearEngineConnectionTimeout = () => {
  if (engine.connectionTimeout) {
    clearTimeout(engine.connectionTimeout);
    engine.connectionTimeout = null;
  }
};

const clearEngineReconnectLoop = () => {
  if (engine.reconnectIntervalId) {
    window.clearInterval(engine.reconnectIntervalId);
    engine.reconnectIntervalId = null;
  }
  engine.reconnectDeadlineMs = null;
};

const closeEnginePeerConnection = (connection: RTCPeerConnection | null) => {
  if (!connection) {
    return;
  }

  connection.onicecandidate = null;
  connection.onicecandidateerror = null;
  connection.ontrack = null;
  connection.onconnectionstatechange = null;
  connection.oniceconnectionstatechange = null;
  connection.close();
};

const updateEngineRemoteStreamState = (stream: MediaStream | null) => {
  const nextStream = stream
    ? (() => {
        stream.getTracks().forEach((track) => {
          if (track.readyState === "ended") {
            stream.removeTrack(track);
          }
        });
        return stream;
      })()
    : null;

  engine.remoteStream = nextStream;

  const videoTracks = nextStream?.getVideoTracks() || [];
  // Some browsers keep remote video tracks in `readyState: "new"` until the first frames start.
  // If we require `readyState === "live"`, the UI may hide the remote video permanently.
  const hasVideoTrack = videoTracks.some((track) => track.readyState !== "ended");

  console.log("[WebRTC] Remote stream video tracks:", {
    videoTrackCount: videoTracks.length,
    hasVideoTrack,
    tracks: videoTracks.map((t) => ({
      id: t.id,
      readyState: t.readyState,
      enabled: (t as any).enabled,
      muted: (t as any).muted,
    })),
  });

  setEngineState((prev) => ({
    ...prev,
    remoteStream: nextStream,
    remoteHasVideo: hasVideoTrack,
    isConnecting: false,
    error: null,
    notice: null,
  }));

  if (nextStream) {
    for (const element of engine.remoteVideoElements) {
      element.srcObject = nextStream;
      playMediaElement(element);
    }
  }
};

const setEngineConnectionError = (message: string, isRelay = false) => {
  setEngineState((prev) => ({
    ...prev,
    isConnected: false,
    isConnecting: false,
    isReconnecting: false,
    error: message,
    isRelayError: isRelay,
    notice: null,
  }));
};

const startEngineConnectionTimeout = () => {
  clearEngineConnectionTimeout();
  engine.connectionTimeout = setTimeout(() => {
    cleanupEngineCall(false);
    setEngineConnectionError(
      "We couldn't connect the call in time. Check your connection and try again."
    );
  }, VIDEO_CALL_LIMITS.connectionTimeoutMs);
};

const flushEnginePendingIceCandidates = async (connection: RTCPeerConnection) => {
  if (!connection.remoteDescription || engine.pendingIceCandidates.length === 0) {
    return;
  }

  const queuedCandidates = [...engine.pendingIceCandidates];
  engine.pendingIceCandidates = [];

  for (const candidate of queuedCandidates) {
    try {
      await connection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error("Error applying queued ICE candidate:", error);
    }
  }
};

const applyEngineVideoSenderParameters = (sender: RTCRtpSender) => {
  if (sender.track?.kind !== "video") {
    return;
  }

  const parameters = sender.getParameters();
  if (!parameters.encodings) {
    parameters.encodings = [{}];
  }

  const maxBitrate = engine.lowBandwidthMode ? 250_000 : 1_500_000;
  parameters.encodings[0].maxBitrate = maxBitrate;

  void sender.setParameters(parameters).catch((error) => {
    console.warn("Failed to set video bitrate parameters:", error);
  });
};

const attachEngineLocalTracks = (connection: RTCPeerConnection, stream: MediaStream) => {
  const existingTrackIds = new Set(
    connection
      .getSenders()
      .map((sender) => sender.track?.id)
      .filter((trackId): trackId is string => Boolean(trackId))
  );

  console.log("[WebRTC] Attaching local tracks:", {
    audioTracks: stream.getAudioTracks().map(t => ({ id: t.id, enabled: t.enabled, readyState: t.readyState })),
    videoTracks: stream.getVideoTracks().map(t => ({ id: t.id, enabled: t.enabled, readyState: t.readyState })),
    existingSenders: connection.getSenders().length,
  });

  stream.getTracks().forEach((track) => {
    if (!existingTrackIds.has(track.id)) {
      const sender = connection.addTrack(track, stream);
      applyEngineVideoSenderParameters(sender);
      console.log("[WebRTC] Added track:", track.kind, track.id);
    } else {
      console.log("[WebRTC] Track already added:", track.kind, track.id);
    }
  });

  // Log final state
  console.log("[WebRTC] After attaching, senders:", connection.getSenders().map(s => ({ trackKind: s.track?.kind, trackId: s.track?.id })));
};

const sendEngineOffer = async (connection: RTCPeerConnection, options?: { iceRestart?: boolean }) => {
  const stream = engine.localStream;
  if (!stream || !engine.channel) {
    console.error("[WebRTC] Cannot send offer: missing stream or channel");
    return false;
  }

  engine.makingOffer = true;

  try {
    if (options?.iceRestart && typeof connection.restartIce === "function") {
      connection.restartIce();
    }

    const offer = await connection.createOffer(options?.iceRestart ? { iceRestart: true } : undefined);

    console.log("[WebRTC] Created offer:", {
      type: offer.type,
      sdpLength: offer.sdp?.length,
      hasVideo: offer.sdp?.includes("m=video"),
      hasAudio: offer.sdp?.includes("m=audio"),
    });

    await connection.setLocalDescription(offer);

    console.log("[WebRTC] Sending offer, signaling state:", connection.signalingState);

    await engine.channel.send({
      type: "broadcast",
      event: "offer",
      payload: {
        offer,
        senderId: String(engine.userId || ""),
        audioOnly: stream.getVideoTracks().length === 0,
      },
    });

    return true;
  } catch (error) {
    console.error("[WebRTC] Error sending offer:", error);
    return false;
  } finally {
    engine.makingOffer = false;
  }
};

const handleEngineConnectionFailure = () => {
  clearEngineConnectionTimeout();
  cleanupEngineCall(false);

  let errorMessage = "Connection failed. Please try again on a stable network.";
  if (!HAS_RELAY_ICE_SERVER) {
    errorMessage += " TURN relay servers are also required for some mobile and office networks.";
    console.warn(
      "WebRTC relay (TURN) servers are not configured. Calls may fail on carrier, office, or NAT-restricted networks."
    );
  }

  setEngineConnectionError(errorMessage, !HAS_RELAY_ICE_SERVER);
};

const createEnginePeerConnection = () => {
  const connection = new RTCPeerConnection(RTC_CONFIGURATION);

  connection.onicecandidate = async (event) => {
    if (event.candidate && engine.channel) {
      await engine.channel.send({
        type: "broadcast",
        event: "ice-candidate",
        payload: {
          candidate: event.candidate,
          senderId: String(engine.userId || ""),
        },
      });
    }
  };

  connection.onicecandidateerror = (event) => {
    console.warn("ICE candidate error:", event);
  };

  connection.ontrack = (event) => {
    console.log("[WebRTC] ontrack event:", {
      trackKind: event.track?.kind,
      trackId: event.track?.id,
      streams: event.streams?.length,
      streamIds: event.streams?.map(s => s.id),
    });

    const remoteStream = engine.remoteStream ?? new MediaStream();
    const alreadyAdded = remoteStream.getTracks().some((track) => track.id === event.track.id);

    if (!alreadyAdded) {
      remoteStream.addTrack(event.track);
      console.log("[WebRTC] Remote track received and added:", {
        kind: event.track.kind,
        id: event.track.id,
        enabled: event.track.enabled,
        muted: event.track.muted,
        readyState: event.track.readyState,
      });
    } else {
      console.log("[WebRTC] Remote track already exists:", event.track.id);
    }

    if (!engine.observedRemoteTrackIds.has(event.track.id)) {
      engine.observedRemoteTrackIds.add(event.track.id);
      const syncRemoteState = () => {
        if (event.track.readyState === "ended") {
          remoteStream.removeTrack(event.track);
        }
        updateEngineRemoteStreamState(engine.remoteStream);
      };
      event.track.addEventListener("mute", syncRemoteState);
      event.track.addEventListener("unmute", syncRemoteState);
      event.track.addEventListener("ended", syncRemoteState);
    }

    engine.remoteStream = remoteStream;
    updateEngineRemoteStreamState(remoteStream);
  };

  connection.onconnectionstatechange = () => {
    console.log("[WebRTC] Connection state changed:", connection.connectionState, "signaling:", connection.signalingState);

    if (connection.connectionState === "connected") {
      console.log("[WebRTC] Peer connection established, local senders:", connection.getSenders().map(s => s.track?.kind));
      console.log("[WebRTC] Remote receivers:", connection.getReceivers().map(r => r.track?.kind));
      engine.wasConnected = true;
      engine.reconnectAttempts = 0;
      clearEngineConnectionTimeout();
      clearEngineReconnectLoop();
      if (engine.sessionId && engine.userId) {
        persistActiveCall(engine.sessionId, engine.userId, Date.now() + RECONNECT_WINDOW_MS);
      }
      setEngineState((prev) => ({
        ...prev,
        isConnected: true,
        isConnecting: false,
        isReconnecting: false,
        error: null,
        notice: null,
      }));
      return;
    }

    if (connection.connectionState === "connecting") {
      setEngineState((prev) => ({
        ...prev,
        isConnecting: true,
        error: null,
        notice:
          engine.wasConnected && engine.reconnectAttempts > 0
            ? "Connection interrupted. Trying to reconnect..."
            : null,
      }));
      return;
    }

    if (connection.connectionState === "disconnected" || connection.connectionState === "failed") {
      console.log("[WebRTC] Connection lost:", connection.connectionState);
      clearEngineConnectionTimeout();
      const deadline = Date.now() + RECONNECT_WINDOW_MS;
      engine.reconnectDeadlineMs = deadline;
      if (engine.sessionId && engine.userId) {
        persistActiveCall(engine.sessionId, engine.userId, deadline);
      }
      setEngineState((prev) => ({
        ...prev,
        isConnected: false,
        isConnecting: false,
        isReconnecting: false,
        isDisconnected: true,
        rejoinDeadline: deadline,
        error: null,
        notice: null,
      }));
      return;
    }

    if (connection.connectionState === "closed") {
      clearEngineConnectionTimeout();
      setEngineState((prev) => ({
        ...prev,
        isConnected: false,
        isConnecting: false,
        notice: null,
      }));
    }
  };

  connection.oniceconnectionstatechange = () => {
    console.log("[WebRTC] ICE connection state:", connection.iceConnectionState);
    if (connection.iceConnectionState === "failed") {
      handleEngineConnectionFailure();
    }
  };

  return connection;
};

const createEngineFreshPeerConnection = () => {
  if (engine.peerConnection) {
    closeEnginePeerConnection(engine.peerConnection);
  }

  const connection = createEnginePeerConnection();
  engine.peerConnection = connection;
  engine.pendingIceCandidates = [];
  engine.remotePeerId = null;
  return connection;
};

const initializeEngineMedia = async (audioOnlyRequested = false) => {
  if (engine.localStream) {
    return engine.localStream;
  }

  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.getUserMedia ||
    typeof RTCPeerConnection === "undefined"
  ) {
    setEngineConnectionError("This device or browser does not support secure in-browser calls.");
    return null;
  }

  const tryGetMedia = async (constraints: MediaStreamConstraints) => {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);

    engine.localStream = stream;
    setEngineState((prev) => ({
      ...prev,
      localStream: stream,
      isAudioOnly: stream.getVideoTracks().length === 0,
      isLocalVideoEnabled: stream.getVideoTracks().some((track) => track.enabled),
    }));

    for (const element of engine.localVideoElements) {
      element.srcObject = stream;
      playMediaElement(element);
    }

    return stream;
  };

  try {
    if (audioOnlyRequested) {
      return await tryGetMedia(AUDIO_ONLY_CONSTRAINTS);
    }

    try {
      return await tryGetMedia(engine.lowBandwidthMode ? LOW_BANDWIDTH_MEDIA_CONSTRAINTS : MEDIA_CONSTRAINTS);
    } catch (videoError) {
      console.warn("Falling back to audio-only media:", videoError);
      return await tryGetMedia(AUDIO_ONLY_CONSTRAINTS);
    }
  } catch (error) {
    console.error("Error accessing media devices:", error);
    setEngineConnectionError(getMediaErrorMessage(error, audioOnlyRequested));
    return null;
  }
};

const rollbackEngineConnectionIfNeeded = async (connection: RTCPeerConnection, stream: MediaStream) => {
  if (connection.signalingState === "stable") {
    return connection;
  }

  try {
    await connection.setLocalDescription({ type: "rollback" });
    return connection;
  } catch (rollbackError) {
    console.warn("Rollback failed, replacing peer connection:", rollbackError);
    const replacement = createEngineFreshPeerConnection();
    attachEngineLocalTracks(replacement, stream);
    return replacement;
  }
};

const clearEngineMedia = () => {
  if (engine.localStream) {
    engine.localStream.getTracks().forEach((track) => track.stop());
    engine.localStream = null;
  }
};

const cleanupEngineCall = (broadcastEnd = true, clearMedia = true) => {
  if (engine.cleanupInProgress) {
    return;
  }

  engine.cleanupInProgress = true;
  clearEngineConnectionTimeout();
  clearEngineReconnectLoop();
  engine.pendingIceCandidates = [];
  engine.remotePeerId = null;
  engine.remoteStream = null;
  engine.observedRemoteTrackIds.clear();
  engine.pendingCallRequest = null;
  engine.makingOffer = false;
  engine.ignoreOffer = false;
  engine.wasConnected = false;
  engine.reconnectAttempts = 0;
  engine.localSpeakingSince = null;
  engine.remoteSpeakingSince = null;

  if (clearMedia) {
    clearEngineMedia();
  }

  if (engine.peerConnection) {
    closeEnginePeerConnection(engine.peerConnection);
    engine.peerConnection = null;
  }

  for (const element of engine.localVideoElements) {
    element.srcObject = null;
  }

  for (const element of engine.remoteVideoElements) {
    element.srcObject = null;
  }

  if (broadcastEnd && engine.channel) {
    void engine.channel.send({
      type: "broadcast",
      event: "call-ended",
      payload: { senderId: String(engine.userId || "") },
    });
  }

  if (broadcastEnd) {
    clearPersistedActiveCall();
  }

  setEngineState((prev) => ({
    ...prev,
    localStream: null,
    remoteStream: null,
    remoteHasVideo: false,
    isConnected: false,
    isConnecting: false,
    isReconnecting: false,
    isAudioOnly: false,
    isLocalVideoEnabled: false,
    error: null,
    isRelayError: false,
    notice: null,
    isIncomingCall: false,
    incomingCallerId: null,
    incomingAudioOnly: false,
    localSpeaking: false,
    remoteSpeaking: false,
    isDisconnected: false,
    rejoinDeadline: null,
    callQuality: {
      latencyMs: null,
      jitterMs: null,
      packetLossPercent: null,
    },
  }));

  engine.cleanupInProgress = false;
};

const ensureEngineChannel = (sessionId: string, userId: string) => {
  if (!sessionId) {
    return;
  }

  const normalizedUserId = String(userId || "");
  if (engine.channel && engine.sessionId === sessionId) {
    return;
  }

  if (engine.channel) {
    engine.channel.unsubscribe();
    engine.channel = null;
  }

  engine.sessionId = sessionId;
  engine.userId = normalizedUserId;

  const channel = supabase.channel(`video-call-${sessionId}`);
  engine.channel = channel;
  setEngineState((prev) => ({ ...prev, isSignalingReady: false, error: null, notice: null }));

  channel
    .on("broadcast", { event: "call-request" }, ({ payload }) => {
      const normalizedSenderId = String(payload?.senderId || "");
      if (!normalizedSenderId || normalizedSenderId === normalizedUserId) {
        return;
      }
      const currentState = engine.state;
      if (currentState.isConnected || currentState.isConnecting || engine.localStream) {
        void engine.channel?.send({
          type: "broadcast",
          event: "call-rejected",
          payload: {
            senderId: normalizedUserId,
            targetId: normalizedSenderId,
            reason: "busy",
          },
        });
        return;
      }

      setEngineState((prev) => ({
        ...prev,
        isIncomingCall: true,
        incomingCallerId: normalizedSenderId,
        incomingAudioOnly: Boolean(payload?.audioOnly),
        error: null,
        notice: null,
      }));
    })
    .on("broadcast", { event: "call-accepted" }, ({ payload }) => {
      const normalizedSenderId = String(payload?.senderId || "");
      const normalizedTargetId = String(payload?.targetId || "");
      if (
        !normalizedSenderId ||
        normalizedSenderId === normalizedUserId ||
        (normalizedTargetId && normalizedTargetId !== normalizedUserId)
      ) {
        return;
      }

      const pendingRequest = engine.pendingCallRequest;
      if (!pendingRequest) {
        return;
      }

      void (async () => {
        try {
          clearEngineConnectionTimeout();
          const stream = await initializeEngineMedia(pendingRequest.audioOnly);
          if (!stream) {
            clearEngineConnectionTimeout();
            setEngineState((prev) => ({ ...prev, isConnecting: false }));
            return;
          }

          const connection = createEngineFreshPeerConnection();
          attachEngineLocalTracks(connection, stream);
          engine.remotePeerId = normalizedSenderId;
          engine.pendingCallRequest = null;
          startEngineConnectionTimeout();
          await sendEngineOffer(connection);
        } catch (error) {
          console.error("Error handling accepted call:", error);
          cleanupEngineCall(false);
          setEngineConnectionError("Call could not be started after acceptance.");
        }
      })();
    })
    .on("broadcast", { event: "call-rejected" }, ({ payload }) => {
      const normalizedSenderId = String(payload?.senderId || "");
      const normalizedTargetId = String(payload?.targetId || "");
      if (
        !normalizedSenderId ||
        normalizedSenderId === normalizedUserId ||
        (normalizedTargetId && normalizedTargetId !== normalizedUserId)
      ) {
        return;
      }

      engine.pendingCallRequest = null;
      clearEngineConnectionTimeout();
      setEngineState((prev) => ({
        ...prev,
        isConnecting: false,
        error:
          payload?.reason === "busy"
            ? "Participant is currently in another call."
            : payload?.reason === "media-unavailable"
            ? "Participant could not access their camera or microphone."
            : "Call was declined.",
      }));
    })
    .on("broadcast", { event: "offer" }, ({ payload }) => {
      const offer = payload?.offer as RTCSessionDescriptionInit | undefined;
      const senderId = String(payload?.senderId || "");
      const audioOnly = Boolean(payload?.audioOnly);
      if (!offer || !senderId || senderId === normalizedUserId) {
        return;
      }

      console.log("[WebRTC] Received offer:", {
        senderId,
        audioOnly,
        sdpLength: offer.sdp?.length,
        hasVideo: offer.sdp?.includes("m=video"),
        hasAudio: offer.sdp?.includes("m=audio"),
      });

      void (async () => {
        if (engine.remotePeerId && engine.remotePeerId !== senderId) {
          setEngineConnectionError("Participant limit reached (max 2 users per call).");
          return;
        }

        if (typeof navigator !== "undefined" && !navigator.onLine) {
          setEngineConnectionError("You are offline. Reconnect to join the call.");
          return;
        }

        setEngineState((prev) => ({ ...prev, isConnecting: true, error: null, notice: null }));

        try {
          const stream = await initializeEngineMedia(audioOnly);
          if (!stream) {
            clearEngineConnectionTimeout();
            setEngineState((prev) => ({ ...prev, isConnecting: false }));
            return;
          }

          let connection =
            engine.peerConnection && engine.peerConnection.signalingState !== "closed"
              ? engine.peerConnection
              : createEngineFreshPeerConnection();

          attachEngineLocalTracks(connection, stream);

          const offerCollision = engine.makingOffer || connection.signalingState !== "stable";
          const politePeer = isPolitePeer(normalizedUserId, senderId);
          engine.ignoreOffer = !politePeer && offerCollision;
          if (engine.ignoreOffer) {
            return;
          }

          if (offerCollision) {
            connection = await rollbackEngineConnectionIfNeeded(connection, stream);
          }

          startEngineConnectionTimeout();
          await connection.setRemoteDescription(new RTCSessionDescription(offer));
          engine.remotePeerId = senderId;
          engine.ignoreOffer = false;
          engine.reconnectAttempts = 0;
          setEngineState((prev) => ({
            ...prev,
            isIncomingCall: false,
            incomingCallerId: null,
            incomingAudioOnly: false,
          }));

          const answer = await connection.createAnswer();

          console.log("[WebRTC] Created answer:", {
            type: answer.type,
            sdpLength: answer.sdp?.length,
            hasVideo: answer.sdp?.includes("m=video"),
            hasAudio: answer.sdp?.includes("m=audio"),
          });

          await connection.setLocalDescription(answer);

          console.log("[WebRTC] Sending answer, signaling state:", connection.signalingState);

          await engine.channel?.send({
            type: "broadcast",
            event: "answer",
            payload: {
              answer,
              senderId: normalizedUserId,
            },
          });

          await flushEnginePendingIceCandidates(connection);
        } catch (error) {
          console.error("Error handling offer:", error);
          cleanupEngineCall(false);
          setEngineConnectionError("Failed to join the incoming call.");
        }
      })();
    })
    .on("broadcast", { event: "answer" }, ({ payload }) => {
      const answer = payload?.answer as RTCSessionDescriptionInit | undefined;
      const senderId = String(payload?.senderId || "");
      if (!answer || !senderId || senderId === normalizedUserId || !engine.peerConnection) {
        return;
      }

      if (engine.remotePeerId && engine.remotePeerId !== senderId) {
        return;
      }

      void (async () => {
        const connection = engine.peerConnection;
        if (!connection) {
          return;
        }

        // Check signaling state - if stable, we already have a connection
        if (connection.signalingState === "stable") {
          // Already connected, just update remote peer ID if needed
          if (!engine.remotePeerId) {
            engine.remotePeerId = senderId;
          }
          return;
        }

        // Only process answer if we're expecting one (have local offer)
        if (connection.signalingState !== "have-local-offer") {
          console.warn("Ignoring answer: wrong signaling state", connection.signalingState);
          return;
        }

        try {
          console.log("[WebRTC] Setting remote answer, signaling state:", connection.signalingState);
          await connection.setRemoteDescription(new RTCSessionDescription(answer));
          console.log("[WebRTC] Remote answer set successfully, connection state:", connection.connectionState);
          engine.remotePeerId = senderId;
          engine.ignoreOffer = false;
          engine.reconnectAttempts = 0;
          await flushEnginePendingIceCandidates(connection);
        } catch (error) {
          console.error("[WebRTC] Error handling answer:", error);
          setEngineConnectionError("Failed to establish the call connection.");
        }
      })();
    })
    .on("broadcast", { event: "ice-candidate" }, ({ payload }) => {
      const candidate = payload?.candidate as RTCIceCandidateInit | undefined;
      const senderId = String(payload?.senderId || "");
      if (!candidate || !senderId || senderId === normalizedUserId) {
        return;
      }

      // Lock onto the first peer we hear from so we don't accidentally drop
      // candidates before an offer/answer finishes setting `remotePeerId`.
      if (!engine.remotePeerId) {
        engine.remotePeerId = senderId;
      }

      if (engine.remotePeerId && engine.remotePeerId !== senderId) {
        return;
      }

      const connection = engine.peerConnection;
      if (!connection || !connection.remoteDescription) {
        engine.pendingIceCandidates.push(candidate);
        return;
      }

      void connection.addIceCandidate(new RTCIceCandidate(candidate)).catch((error) => {
        console.error("Error adding ICE candidate:", error);
      });
    })
    .on("broadcast", { event: "call-ended" }, ({ payload }) => {
      if (String(payload?.senderId || "") !== normalizedUserId) {
        cleanupEngineCall(false);
      }
    })
    .on("broadcast", { event: "call-recover" }, ({ payload }) => {
      const senderId = String(payload?.senderId || "");
      if (!senderId || senderId === normalizedUserId) {
        return;
      }
      if (engine.remotePeerId && engine.remotePeerId !== senderId) {
        return;
      }
      if (!engine.localStream) {
        return;
      }
      if (!engine.peerConnection || engine.peerConnection.signalingState === "closed") {
        const connection = createEngineFreshPeerConnection();
        attachEngineLocalTracks(connection, engine.localStream);
      }
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        setEngineState((prev) => ({ ...prev, isSignalingReady: true, error: null, notice: null }));
      }

      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        setEngineState((prev) => ({ ...prev, isSignalingReady: false }));
        setEngineConnectionError("Call signaling channel unavailable.");
      }
    });
};

const performEngineRejoin = async (): Promise<boolean> => {
  if (!engine.sessionId || !engine.userId) {
    return false;
  }

  if (!engine.reconnectDeadlineMs || Date.now() > engine.reconnectDeadlineMs) {
    cleanupEngineCall(true);
    setEngineConnectionError("Rejoin window has expired. Please start a new call.");
    return false;
  }

  setEngineState((prev) => ({
    ...prev,
    isDisconnected: false,
    isConnecting: true,
    isReconnecting: true,
    error: null,
    notice: "Rejoining call...",
  }));

  try {
    ensureEngineChannel(engine.sessionId, engine.userId);
    if (!engine.channel) {
      throw new Error("Call channel not available");
    }

    const stream = await initializeEngineMedia(engine.state.isAudioOnly);
    if (!stream) {
      setEngineState((prev) => ({
        ...prev,
        isConnecting: false,
        isReconnecting: false,
        isDisconnected: true,
      }));
      return false;
    }

    const connection = createEngineFreshPeerConnection();
    attachEngineLocalTracks(connection, stream);

    await sendEngineOffer(connection);
    await engine.channel.send({
      type: "broadcast",
      event: "call-recover",
      payload: {
        senderId: String(engine.userId || ""),
      },
    });

    startEngineConnectionTimeout();
    return true;
  } catch (error) {
    console.error("Failed to rejoin call:", error);
    setEngineState((prev) => ({
      ...prev,
      isConnecting: false,
      isReconnecting: false,
      isDisconnected: true,
      error: "Failed to rejoin call. You can try again.",
    }));
    return false;
  }
};

export const useWebRTC = (sessionId: string, userId: string) => {
  const { lowBandwidthMode } = useBandwidthMode();
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const [state, setState] = useState<WebRTCState>(() => engine.state);

  useEffect(() => {
    engine.lowBandwidthMode = lowBandwidthMode;
  }, [lowBandwidthMode]);

  useEffect(() => {
    const listener: WebRTCEngineListener = (nextState) => {
      setState(nextState);
    };

    engine.listeners.add(listener);
    setState(engine.state);
    return () => {
      engine.listeners.delete(listener);
    };
  }, []);

  const startCall = useCallback(
    async (options: StartCallOptions = {}) => {
      const currentState = engine.state;

      if (!sessionId) {
        setEngineConnectionError("Select a session before starting a call.");
        return false;
      }

      if (!String(userId || "")) {
        setEngineConnectionError("Sign in before starting a call.");
        return false;
      }

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setEngineConnectionError("You are offline. Reconnect to start the call.");
        return false;
      }

      ensureEngineChannel(sessionId, userId);
      if (!engine.channel || !currentState.isSignalingReady) {
        setEngineConnectionError("Call channel is not ready yet. Please try again.");
        return false;
      }

      if (currentState.isConnected) {
        return true;
      }

      if (currentState.isConnecting) {
        return false;
      }

      setEngineState((prev) => ({ ...prev, isConnecting: true, error: null, notice: null }));

      try {
        engine.pendingCallRequest = { audioOnly: Boolean(options.audioOnly) };
        engine.ignoreOffer = false;
        engine.reconnectAttempts = 0;
        await engine.channel.send({
          type: "broadcast",
          event: "call-request",
          payload: {
            senderId: String(userId || ""),
            audioOnly: Boolean(options.audioOnly),
          },
        });

        return true;
      } catch (error) {
        console.error("Error starting call:", error);
        cleanupEngineCall(false);
        setEngineConnectionError("Failed to start the call.");
        return false;
      }
    },
    [
      sessionId,
      userId,
    ]
  );

  const acceptIncomingCall = useCallback(async () => {
    const incomingCallerId = engine.state.incomingCallerId;
    const incomingAudioOnly = Boolean(engine.state.incomingAudioOnly);
    ensureEngineChannel(sessionId, userId);
    if (!incomingCallerId || !engine.channel) {
      return false;
    }

    setEngineState((prev) => ({
      ...prev,
      isIncomingCall: false,
      incomingCallerId: null,
      incomingAudioOnly: false,
      isConnecting: true,
    }));

    const stream = await initializeEngineMedia(incomingAudioOnly);
    if (!stream) {
      setEngineState((prev) => ({
        ...prev,
        isConnecting: false,
        isIncomingCall: false,
        incomingCallerId: null,
        incomingAudioOnly: false,
      }));
      await engine.channel.send({
        type: "broadcast",
        event: "call-rejected",
        payload: {
          senderId: String(userId || ""),
          targetId: incomingCallerId,
          reason: "media-unavailable",
        },
      });
      return false;
    }

    await engine.channel.send({
      type: "broadcast",
      event: "call-accepted",
      payload: {
        senderId: String(userId || ""),
        targetId: incomingCallerId,
      },
    });
    return true;
  }, [sessionId, userId]);

  const rejectIncomingCall = useCallback(async () => {
    const incomingCallerId = engine.state.incomingCallerId;
    setEngineState((prev) => ({
      ...prev,
      isIncomingCall: false,
      incomingCallerId: null,
      incomingAudioOnly: false,
      isConnecting: false,
    }));

    ensureEngineChannel(sessionId, userId);
    if (!incomingCallerId || !engine.channel) {
      return false;
    }

    await engine.channel.send({
      type: "broadcast",
      event: "call-rejected",
      payload: {
        senderId: String(userId || ""),
        targetId: incomingCallerId,
        reason: "declined",
      },
    });
    return true;
  }, [sessionId, userId]);

  const toggleMute = useCallback(() => {
    if (engine.localStream) {
      engine.localStream.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
    }
  }, []);

  const toggleVideo = useCallback(() => {
    const toggle = async () => {
      const stream = engine.localStream;
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
            setEngineState((prev) => ({
              ...prev,
              error: "No camera was found. Connect a camera and try again.",
              isRelayError: false,
              notice: null,
            }));
            return false;
          }

          stream.addTrack(videoTrack);
          setEngineState((prev) => ({
            ...prev,
            localStream: stream,
            isAudioOnly: false,
            isLocalVideoEnabled: true,
            error: null,
            isRelayError: false,
          }));

          const connection = engine.peerConnection;
          if (connection) {
            const sender = connection.addTrack(videoTrack, stream);
            applyEngineVideoSenderParameters(sender);

            if (
              engine.channel &&
              engine.state.isSignalingReady &&
              connection.signalingState === "stable" &&
              !engine.makingOffer
            ) {
              await sendEngineOffer(connection);
            }
          }

          return true;
        } catch (error) {
          console.error("Error enabling camera:", error);
          setEngineState((prev) => ({
            ...prev,
            error: getMediaErrorMessage(error, false),
            isRelayError: false,
            notice: null,
          }));
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
    lowBandwidthMode,
  ]);

  const startAudioCall = useCallback(async () => {
    return startCall({ audioOnly: true });
  }, [startCall]);

  const endCall = useCallback(() => {
    cleanupEngineCall(true);
  }, []);

  const rejoinCall = useCallback(async () => {
    return performEngineRejoin();
  }, []);

  useEffect(() => {
    if (!sessionId) {
      setEngineState((prev) => ({
        ...prev,
        isSignalingReady: false,
        notice: null,
        remoteStream: null,
        remoteHasVideo: false,
      }));
      return;
    }

    ensureEngineChannel(sessionId, userId);
  }, [sessionId, userId]);

  useEffect(() => {
    if (!sessionId || !String(userId || "")) {
      return;
    }

    const persisted = readPersistedActiveCall();
    if (!persisted) {
      return;
    }

    if (
      persisted.sessionId !== sessionId ||
      persisted.userId !== String(userId || "") ||
      Date.now() > persisted.reconnectUntil
    ) {
      return;
    }

    if (engine.state.isConnected || engine.state.isConnecting) {
      return;
    }

    engine.sessionId = sessionId;
    engine.userId = String(userId || "");
    engine.reconnectDeadlineMs = persisted.reconnectUntil;

    setEngineState((prev) => ({
      ...prev,
      isDisconnected: true,
      rejoinDeadline: persisted.reconnectUntil,
      notice: "You can rejoin the ongoing call.",
    }));
  }, [sessionId, userId]);

  useEffect(() => {
    if (localVideoRef.current && state.localStream) {
      engine.localVideoElements.add(localVideoRef.current);
      localVideoRef.current.srcObject = state.localStream;
      playMediaElement(localVideoRef.current);
    }
    return () => {
      if (localVideoRef.current) {
        engine.localVideoElements.delete(localVideoRef.current);
      }
    };
  }, [state.isAudioOnly, state.isLocalVideoEnabled, state.localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && state.remoteStream) {
      engine.remoteVideoElements.add(remoteVideoRef.current);
      remoteVideoRef.current.srcObject = state.remoteStream;
      playMediaElement(remoteVideoRef.current);
    }
    return () => {
      if (remoteVideoRef.current) {
        engine.remoteVideoElements.delete(remoteVideoRef.current);
      }
    };
  }, [state.remoteHasVideo, state.remoteStream]);

  useEffect(() => {
    if (typeof AudioContext === "undefined") {
      return;
    }

    const localTrack = engine.localStream?.getAudioTracks()[0];
    const remoteTrack = engine.remoteStream?.getAudioTracks()[0];
    if (!localTrack && !remoteTrack) {
      setEngineState((prev) => ({
        ...prev,
        localSpeaking: false,
        remoteSpeaking: false,
      }));
      return;
    }

    const context = new AudioContext();
    const localAnalyser = localTrack ? context.createAnalyser() : null;
    const remoteAnalyser = remoteTrack ? context.createAnalyser() : null;
    if (localAnalyser) {
      localAnalyser.fftSize = 2048;
    }
    if (remoteAnalyser) {
      remoteAnalyser.fftSize = 2048;
    }

    const connectTrack = (track: MediaStreamTrack, analyser: AnalyserNode | null) => {
      if (!analyser) {
        return;
      }
      const source = context.createMediaStreamSource(new MediaStream([track]));
      source.connect(analyser);
    };

    if (localTrack) {
      connectTrack(localTrack, localAnalyser);
    }
    if (remoteTrack) {
      connectTrack(remoteTrack, remoteAnalyser);
    }

    const sample = (analyser: AnalyserNode | null) => {
      if (!analyser) {
        return 0;
      }
      const data = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let index = 0; index < data.length; index += 1) {
        const value = (data[index] - 128) / 128;
        sum += value * value;
      }
      return Math.sqrt(sum / data.length);
    };

    let animationFrameId = 0;
    const tick = () => {
      const now = Date.now();
      const localLevel = sample(localAnalyser);
      const remoteLevel = sample(remoteAnalyser);

      if (localLevel >= SPEAKING_THRESHOLD) {
        engine.localSpeakingSince = now;
        setEngineState((prev) => (prev.localSpeaking ? prev : { ...prev, localSpeaking: true }));
      } else if (
        engine.localSpeakingSince &&
        now - engine.localSpeakingSince > SPEAKING_HOLD_MS
      ) {
        setEngineState((prev) => (prev.localSpeaking ? { ...prev, localSpeaking: false } : prev));
      }

      if (remoteLevel >= SPEAKING_THRESHOLD) {
        engine.remoteSpeakingSince = now;
        setEngineState((prev) => (prev.remoteSpeaking ? prev : { ...prev, remoteSpeaking: true }));
      } else if (
        engine.remoteSpeakingSince &&
        now - engine.remoteSpeakingSince > SPEAKING_HOLD_MS
      ) {
        setEngineState((prev) => (prev.remoteSpeaking ? { ...prev, remoteSpeaking: false } : prev));
      }

      animationFrameId = window.requestAnimationFrame(tick);
    };

    animationFrameId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(animationFrameId);
      void context.close();
      setEngineState((prev) => ({
        ...prev,
        localSpeaking: false,
        remoteSpeaking: false,
      }));
    };
  }, [
    state.localStream,
    state.remoteStream,
  ]);

  useEffect(() => {
    const connection = engine.peerConnection;
    if (!connection || !state.isConnected) {
      setState((prev) => ({
        ...prev,
        callQuality: {
          latencyMs: null,
          jitterMs: null,
          packetLossPercent: null,
        },
      }));
      return;
    }

    let cancelled = false;
    const updateStats = async () => {
      try {
        const stats = await connection.getStats();
        let latencyMs: number | null = null;
        let jitterMs: number | null = null;
        let packetsLost = 0;
        let packetsReceived = 0;

        stats.forEach((report) => {
          if (report.type === "candidate-pair" && (report as any).state === "succeeded" && (report as any).currentRoundTripTime) {
            latencyMs = Math.round(Number((report as any).currentRoundTripTime) * 1000);
          }
          if (report.type === "inbound-rtp" && (report as any).kind === "audio") {
            const inbound = report as any;
            jitterMs = Number.isFinite(inbound.jitter)
              ? Math.round(Number(inbound.jitter) * 1000)
              : jitterMs;
            packetsLost += Number(inbound.packetsLost || 0);
            packetsReceived += Number(inbound.packetsReceived || 0);
          }
        });

        const totalPackets = packetsLost + packetsReceived;
        const packetLossPercent =
          totalPackets > 0 ? Number(((packetsLost / totalPackets) * 100).toFixed(1)) : null;

        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            callQuality: {
              latencyMs,
              jitterMs,
              packetLossPercent,
            },
          }));
        }
      } catch {
        // Ignore transient stats failures.
      }
    };

    void updateStats();
    const intervalId = window.setInterval(() => {
      void updateStats();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [state.isConnected]);

  return {
    ...state,
    localVideoRef,
    remoteVideoRef,
    startCall,
    startAudioCall,
    endCall,
    rejoinCall,
    toggleMute,
    toggleVideo,
    acceptIncomingCall,
    rejectIncomingCall,
  };
};
