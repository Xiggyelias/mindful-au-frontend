import { useState, useRef, useCallback, useEffect } from "react";
import {
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  ConnectionState,
  MediaDeviceFailure,
  type RemoteTrack,
  type RemoteParticipant,
  type LocalVideoTrack,
} from "livekit-client";
import { api } from "@/lib/api";

/**
 * LiveKit call engine.
 *
 * Media transport moves from hand-rolled RTCPeerConnection-over-Supabase-Realtime to a
 * LiveKit SFU (self-hosted server or LiveKit Cloud). The SFU absorbs the failure modes
 * that made the peer-to-peer path fragile — NAT traversal without a managed TURN relay,
 * glare-handled offer/answer races across a polling channel,ICE candidate queues keyed to
 * one tab lifetime, and per-tab reconnection logic — because
 * reconnection, ICE negotiation, track (un)subscribing, and simulcast quality adaptation
 * are handled inside the LiveKit client.
 *
 * The ring / accept / decline lifecycle stays on CallCoordinator (backend `authorize`
 * + incoming-call signals), exactly as before — only the media leg changes. When
 * LIVEKIT_* env vars are not configured on the backend, callers fall back to useWebRTC.
 */

export interface LiveKitState {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  remoteMediaEpoch: number;
  remoteHasVideo: boolean;
  isConnected: boolean;
  isConnecting: boolean;
  isReconnecting: boolean;
  isDisconnected: boolean;
  rejoinDeadline: number | null;
  isSignalingReady: boolean;
  isAudioOnly: boolean;
  isLocalVideoEnabled: boolean;
  canFlipCamera: boolean;
  error: string | null;
  isRelayError: boolean;
  notice: string | null;
  isIncomingCall: boolean;
  incomingCallerId: string | null;
  incomingAudioOnly: boolean;
  localSpeaking: boolean;
  remoteSpeaking: boolean;
}

const DEFAULT_STATE: LiveKitState = {
  localStream: null,
  remoteStream: null,
  remoteMediaEpoch: 0,
  remoteHasVideo: false,
  isConnected: false,
  isConnecting: false,
  isReconnecting: false,
  isDisconnected: false,
  rejoinDeadline: null,
  isSignalingReady: true, // signaling is server-side; always ready once configured
  isAudioOnly: false,
  isLocalVideoEnabled: false,
  canFlipCamera: false,
  error: null,
  isRelayError: false,
  notice: null,
  isIncomingCall: false,
  incomingCallerId: null,
  incomingAudioOnly: false,
  localSpeaking: false,
  remoteSpeaking: false,
};

/** Module-level singleton so the call survives route changes, same as the WebRTC engine. */
const engine = {
  room: null as Room | null,
  appointmentId: null as number | null,
  identity: "",
  state: { ...DEFAULT_STATE } as LiveKitState,
  listeners: new Set<(state: LiveKitState) => void>(),
  localVideoElements: new Set<HTMLVideoElement>(),
  remoteVideoElements: new Set<HTMLVideoElement>(),
  facingMode: "user" as "user" | "environment",
  lowBandwidthMode: false,
};

const setState = (updater: (prev: LiveKitState) => LiveKitState) => {
  engine.state = updater(engine.state);
  for (const listener of engine.listeners) {
    listener(engine.state);
  }
};

const playMediaElement = (element: HTMLVideoElement | null, muted?: boolean) => {
  if (!element) return;
  if (typeof muted === "boolean") {
    element.muted = muted;
    if (!muted && element.volume !== 1) element.volume = 1;
  }
  element.play().catch(() => {
    /* Playback can be deferred until the browser has a user gesture. */
  });
};

const bindRemoteStreams = () => {
  const room = engine.room;
  if (!room) return;

  // Compose everything every remote participant publishes into one stream. A LiveKit
  // room is normally 1:1 for these calls, but composing keeps the hook honest if a
  // moderator or a retry ever leaves a second participant in the room.
  const streams = new Map<MediaStream, Set<MediaStreamTrack>>();
  for (const participant of room.remoteParticipants.values()) {
    for (const publication of participant.trackPublications.values()) {
      const track = publication.track as RemoteTrack | undefined;
      if (!track?.mediaStreamTrack) continue;
      const mediaStream = track.mediaStream as unknown as MediaStream;
      const tracks = streams.get(mediaStream) ?? new Set<MediaStreamTrack>();
      tracks.add(track.mediaStreamTrack);
      streams.set(mediaStream, tracks);
    }
  }

  let composed: MediaStream | null = null;
  if (streams.size > 0) {
    composed = new MediaStream();
    for (const tracks of streams.values()) {
      for (const track of tracks) {
        composed.addTrack(track);
      }
    }
  }

  const hasVideo = Boolean(composed?.getVideoTracks().some((track) => track.readyState !== "ended"));

  setState((prev) => ({
    ...prev,
    remoteStream: composed,
    remoteMediaEpoch: prev.remoteMediaEpoch + 1,
    remoteHasVideo: hasVideo,
    remoteSpeaking: room.remoteParticipants.size > 0,
    isConnected: room.remoteParticipants.size > 0,
    // Leave isConnecting alone here: during connect the room reaches Connected before
    // local tracks publish, and clearing isConnecting here is what killed the call.
    // It is cleared in bindLocalStream once media is actually acquired.
    isReconnecting: false,
    notice: null,
  }));

  if (composed) {
    for (const element of engine.remoteVideoElements) {
      element.srcObject = composed;
      playMediaElement(element, false);
    }
  }
};

const bindLocalStream = (stream: MediaStream | null) => {
  // Local media is bound only after connect() + track publishing complete — this is the
  // single point where the connect transaction is allowed to clear isConnecting. Clearing
  // it earlier (e.g. on the room's Connected event) breaks the `isConnecting &&
  // !localStream` "still ringing out" bracket the call pages rely on: with LiveKit the
  // signaling room connects before the tracks are published, so the abandoned-ring
  // cleanup on the call pages fired mid-connect and tore the fresh room down
  // (CLIENT_REQUEST_LEAVE 22ms after join -> PublishTrackError on every start).
  setState((prev) => ({
    ...prev,
    localStream: stream,
    isConnecting: false,
  }));
  if (stream) {
    for (const element of engine.localVideoElements) {
      element.srcObject = stream;
      playMediaElement(element, true);
    }
  }
};

const captureError = (error: unknown): string => {
  const failure = error ? MediaDeviceFailure.getFailure(error as Error) : null;
  if (failure) {
    switch (failure) {
      case MediaDeviceFailure.PermissionDenied:
        return "Camera or microphone permission is blocked. Allow access to start the call.";
      case MediaDeviceFailure.NotFound:
        return "No camera or microphone was found on this device.";
      case MediaDeviceFailure.DeviceInUse:
        return "Your camera or microphone is busy in another app. Close it and try again.";
      default:
        return "Could not access camera or microphone. Check device permissions and try again.";
    }
  }
  // Non-device errors (token failure, room connect failure) fall through to a generic
  // message; the caller adds network context for thrown Error instances.
  return "";
};

const refreshCameraCapability = async () => {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const canFlip = devices.filter((device) => device.kind === "videoinput").length > 1;
    setState((prev) => (prev.canFlipCamera === canFlip ? prev : { ...prev, canFlipCamera: canFlip }));
  } catch {
    /* Permission changes will refresh this on the next call attempt. */
  }
};

const createRoom = (appointmentId: number): Room => {
  const resolution = engine.lowBandwidthMode ? VideoPresets.h360 : VideoPresets.h720;
  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
    videoCaptureDefaults: { resolution: resolution.resolution },
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  room.on(RoomEvent.TrackSubscribed, () => bindRemoteStreams());
  room.on(RoomEvent.TrackUnsubscribed, () => bindRemoteStreams());
  room.on(RoomEvent.TrackPublished, () => bindRemoteStreams());
  room.on(RoomEvent.TrackUnpublished, () => bindRemoteStreams());
  room.on(RoomEvent.ParticipantConnected, () => bindRemoteStreams());
  room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
    bindRemoteStreams();
    // A 1:1 call where the other side leaves is over — surface the same terminal state
    // the peer-to-peer engine produced so end-of-call bookkeeping still runs.
    if (room.remoteParticipants.size === 0) {
      setState((prev) => ({
        ...prev,
        notice: `${participant.identity} left the call.`,
      }));
    }
  });
  room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
    if (state === ConnectionState.Reconnecting) {
      setState((prev) => ({ ...prev, isReconnecting: true, notice: "Connection interrupted. Reconnecting..." }));
    } else if (state === ConnectionState.Connected) {
      // Fires both for the initial connection and after a LiveKit-managed reconnect;
      // clearing isReconnecting here covers the reconnect case the old enum had a
      // dedicated value for. isConnecting is intentionally NOT cleared here — the room
      // reaches Connected before local tracks are published, and the call pages' cleanup
      // effects key off isConnecting. It is cleared in bindLocalStream instead.
      setState((prev) => ({ ...prev, isReconnecting: false, notice: null, isConnected: room.remoteParticipants.size > 0 }));
      bindRemoteStreams();
    } else if (state === ConnectionState.Disconnected) {
      setState((prev) => ({ ...prev, isConnected: false, isReconnecting: false }));
    }
  });
  room.on(RoomEvent.MediaDevicesError, (error: Error) => {
    setState((prev) => ({ ...prev, error: captureError(error) }));
  });
  room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Array<{ identity: string }>) => {
    const remoteSpeaking = speakers.some((speaker) => speaker.identity !== engine.identity);
    setState((prev) => (prev.remoteSpeaking === remoteSpeaking ? prev : { ...prev, remoteSpeaking }));
  });

  void appointmentId;
  return room;
};

const tearRoomDown = () => {
  const room = engine.room;
  engine.room = null;
  engine.appointmentId = null;
  engine.identity = "";

  if (engine.state.localStream) {
    for (const track of engine.state.localStream.getTracks()) {
      try {
        track.stop();
      } catch {
        /* best effort */
      }
    }
  }

  if (room) {
    try {
      room.localParticipant.setMicrophoneEnabled(false);
      room.localParticipant.setCameraEnabled(false);
    } catch {
      /* Already disconnected. */
    }
    void room.disconnect();
  }

  setState((prev) => ({
    ...prev,
    localStream: null,
    remoteStream: null,
    remoteMediaEpoch: prev.remoteMediaEpoch + 1,
    remoteHasVideo: false,
    isConnected: false,
    isConnecting: false,
    isReconnecting: false,
    isDisconnected: false,
    rejoinDeadline: null,
    isAudioOnly: false,
    isLocalVideoEnabled: false,
    error: null,
    notice: null,
  }));
};

export const useLiveKit = (appointmentId: number, userId: string) => {
  const [state, setStateLocal] = useState<LiveKitState>(() => engine.state);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const listener = (nextState: LiveKitState) => setStateLocal(nextState);
    engine.listeners.add(listener);
    setStateLocal(engine.state);
    return () => {
      engine.listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    void refreshCameraCapability();
    const mediaDevices = typeof navigator === "undefined" ? null : navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;
    const onDeviceChange = () => void refreshCameraCapability();
    mediaDevices.addEventListener("devicechange", onDeviceChange);
    return () => mediaDevices.removeEventListener("devicechange", onDeviceChange);
  }, []);

  // Attach / detach the video elements this hook instance owns. The engine can be
  // controlled from FloatingCallDock as well, and both share the same streams.
  useEffect(() => {
    const el = localVideoRef.current;
    if (el && state.localStream) {
      engine.localVideoElements.add(el);
      el.srcObject = state.localStream;
      playMediaElement(el, true);
    }
    return () => {
      if (el) engine.localVideoElements.delete(el);
    };
  }, [state.localStream, state.isAudioOnly, state.isLocalVideoEnabled]);

  useEffect(() => {
    const el = remoteVideoRef.current;
    if (el && state.remoteStream) {
      engine.remoteVideoElements.add(el);
      el.srcObject = state.remoteStream;
      playMediaElement(el, false);
    }
    return () => {
      if (el) engine.remoteVideoElements.delete(el);
    };
  }, [state.remoteStream, state.remoteHasVideo, state.remoteMediaEpoch]);

  /** Connect to the LiveKit room for this appointment and publish local media. */
  const connectRoom = useCallback(
    async (mode: "video" | "audio"): Promise<boolean> => {
      if (!appointmentId || appointmentId <= 0) {
        setState((prev) => ({ ...prev, error: "Select a session before starting a call." }));
        return false;
      }
      if (!userId) {
        setState((prev) => ({ ...prev, error: "Sign in before starting a call." }));
        return false;
      }
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setState((prev) => ({ ...prev, error: "You are offline. Reconnect to start the call." }));
        return false;
      }

      // Idempotent: an in-flight or connected room for the same appointment is reused.
      if (engine.room && engine.appointmentId === appointmentId) {
        if (engine.room.state === ConnectionState.Connected) return true;
        if (engine.room.state === ConnectionState.Connecting) return true;
      }

      setState((prev) => ({
        ...prev,
        isConnecting: true,
        isAudioOnly: mode === "audio",
        isLocalVideoEnabled: mode === "video",
        error: null,
        notice: null,
      }));

      try {
        const authorization = await api.getLiveKitToken(appointmentId);
        if (!authorization?.url || !authorization?.token) {
          throw new Error("LiveKit is not configured on the server.");
        }

        // A leftover room from a previous call must be torn down first, or the audio
        // context and published tracks of both rooms end up jamming each other.
        if (engine.room && engine.appointmentId !== appointmentId) {
          tearRoomDown();
        }

        const room = engine.room ?? createRoom(appointmentId);
        engine.room = room;
        engine.appointmentId = appointmentId;
        engine.identity = `${userId}`;

        let livekitUrl = authorization.url.trim();
        if (livekitUrl.startsWith("http://")) {
          livekitUrl = "ws://" + livekitUrl.slice(7);
        } else if (livekitUrl.startsWith("https://")) {
          livekitUrl = "wss://" + livekitUrl.slice(8);
        }

        // If the server configured localhost/127.0.0.1 but the user's browser is accessing
        // from a remote device, rewrite the host to the current hostname/origin so it connects.
        try {
          const parsedUrl = new URL(livekitUrl);
          const isLocalhostHost =
            parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1";
          if (
            isLocalhostHost &&
            typeof window !== "undefined" &&
            window.location.hostname !== "localhost" &&
            window.location.hostname !== "127.0.0.1"
          ) {
            parsedUrl.hostname = window.location.hostname;
            livekitUrl = parsedUrl.toString();
          }
        } catch {
          /* keep livekitUrl */
        }

        await room.connect(livekitUrl, authorization.token, { autoSubscribe: true });

        // Enable microphone with graceful degradation
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
        } catch (micErr) {
          console.warn("[LiveKit] Microphone acquisition warning:", micErr);
        }

        // Enable camera if video mode, falling back to audio if camera is busy or unavailable
        if (mode === "video") {
          try {
            await room.localParticipant.setCameraEnabled(true);
            engine.facingMode = "user";
          } catch (camErr) {
            console.warn("[LiveKit] Camera acquisition warning:", camErr);
            setState((prev) => ({
              ...prev,
              isAudioOnly: true,
              isLocalVideoEnabled: false,
              notice: "Camera preview unavailable. Audio is live.",
            }));
          }
        }

        const localTracks = [
          ...room.localParticipant.audioTrackPublications.values(),
          ...room.localParticipant.videoTrackPublications.values(),
        ]
          .map((publication) => publication.track?.mediaStreamTrack)
          .filter((track): track is MediaStreamTrack => Boolean(track));

        const localStream = localTracks.length > 0 ? new MediaStream(localTracks) : null;
        bindLocalStream(localStream);

        void refreshCameraCapability();
        return true;
      } catch (error: unknown) {
        tearRoomDown();
        const message = captureError(error) || (
          error instanceof Error
            ? `Could not connect: ${error.message}`
            : "Could not connect to the call."
        );
        setState((prev) => ({ ...prev, error: message, isConnecting: false }));
        return false;
      }
    },
    [appointmentId, userId]
  );

  const startCall = useCallback(async () => connectRoom("video"), [connectRoom]);
  const startAudioCall = useCallback(async () => connectRoom("audio"), [connectRoom]);

  const endCall = useCallback(() => {
    tearRoomDown();
  }, []);

  /** LiveKit reconnects on its own; this hook exists to satisfy the old call rejoin UI. */
  const rejoinCall = useCallback(async (): Promise<boolean> => {
    if (!engine.appointmentId) return false;
    return connectRoom(engine.state.isAudioOnly ? "audio" : "video");
  }, [connectRoom]);

  const toggleMute = useCallback(() => {
    const room = engine.room;
    if (!room) return;
    void room.localParticipant.setMicrophoneEnabled(
      !room.localParticipant.isMicrophoneEnabled
    );
  }, []);

  const toggleVideo = useCallback(async () => {
    const room = engine.room;
    if (!room) return false;
    const enabled = !room.localParticipant.isCameraEnabled;
    await room.localParticipant.setCameraEnabled(enabled);
    setState((prev) => ({
      ...prev,
      isLocalVideoEnabled: enabled,
      isAudioOnly: enabled ? false : prev.isAudioOnly,
    }));
    return enabled;
  }, []);

  /** Switch between the front camera and the next available one (mobile flip-camera UX). */
  const flipCamera = useCallback(async (): Promise<boolean> => {
    const room = engine.room;
    if (!room) return false;
    const publication = room.localParticipant.getTrackPublication(Track.Source.Camera);
    const track = publication?.track as LocalVideoTrack | undefined;
    if (!track) return false;

    const nextFacing = engine.facingMode === "user" ? "environment" : "user";
    engine.facingMode = nextFacing;

    try {
      await track.restartTrack({ facingMode: nextFacing });
      return true;
    } catch {
      // Desktops and many laptops do not honour facingMode; cycle by device list instead.
      let switched = false;
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter((device) => device.kind === "videoinput");
        if (cameras.length > 1) {
          const activeDeviceId = track.mediaStreamTrack.getSettings().deviceId;
          const currentIndex = cameras.findIndex((camera) => camera.deviceId === activeDeviceId);
          const next = cameras[(currentIndex + 1) % cameras.length];
          if (next) {
            await room.switchActiveDevice("videoinput", next.deviceId);
            switched = true;
          }
        }
      } catch {
        switched = false;
      }
      return switched;
    }
  }, []);

  // The ring / incoming-call detection stays on the existing useIncomingCalls signal
  // path; the hook only reports the media-transport side of the call. Keeping
  // isIncomingCall / acceptIncomingCall / rejectIncomingCall out of this hook is
  // deliberate: their logic ties to call rows and server state, not to WebRTC, and is
  // already exercised end-to-end by the incoming-call banners.
  const acceptIncomingCall = useCallback(
    async (explicitCallerId?: string, audioOnlyOverride?: boolean) => {
      void explicitCallerId;
      const mode = audioOnlyOverride ? "audio" : "video";
      return connectRoom(mode);
    },
    [connectRoom]
  );

  const rejectIncomingCall = useCallback(async () => {
    return true;
  }, []);

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
    flipCamera,
    currentFacingMode: engine.facingMode,
    acceptIncomingCall,
    rejectIncomingCall,
  };
};

/**
 * Active call dock hook for LiveKit, allowing FloatingCallDock to attach to ongoing calls.
 */
export const useLiveKitActiveCallDock = () => {
  const [state, setStateLocal] = useState<LiveKitState>(() => engine.state);
  const [sessionId, setSessionId] = useState<string>(() => (engine.appointmentId ? String(engine.appointmentId) : ""));
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const listener = (nextState: LiveKitState) => {
      setStateLocal(nextState);
      setSessionId(engine.appointmentId ? String(engine.appointmentId) : "");
    };
    engine.listeners.add(listener);
    setStateLocal(engine.state);
    setSessionId(engine.appointmentId ? String(engine.appointmentId) : "");
    return () => {
      engine.listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    const el = localVideoRef.current;
    if (el && state.localStream) {
      engine.localVideoElements.add(el);
      el.srcObject = state.localStream;
      playMediaElement(el, true);
    }
    return () => {
      if (el) engine.localVideoElements.delete(el);
    };
  }, [state.localStream]);

  useEffect(() => {
    const el = remoteVideoRef.current;
    if (el && state.remoteStream) {
      engine.remoteVideoElements.add(el);
      el.srcObject = state.remoteStream;
      playMediaElement(el, false);
    }
    return () => {
      if (el) engine.remoteVideoElements.delete(el);
    };
  }, [state.remoteStream, state.remoteMediaEpoch]);

  const endCall = useCallback(() => {
    tearRoomDown();
  }, []);

  const toggleMute = useCallback(() => {
    const room = engine.room;
    if (!room) return;
    void room.localParticipant.setMicrophoneEnabled(
      !room.localParticipant.isMicrophoneEnabled
    );
  }, []);

  const isMuted = !engine.room?.localParticipant?.isMicrophoneEnabled;

  return {
    ...state,
    sessionId,
    isMuted,
    localVideoRef,
    remoteVideoRef,
    endCall,
    toggleMute,
  };
};

export default useLiveKit;
