import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Radio,
  Users,
  MessageSquare,
  Maximize2,
  Minimize2,
  ArrowLeft,
  Volume2,
  Heart,
  Shield,
  Loader2,
  Send,
  RefreshCw,
  Sparkles,
  UserCheck,
  Headphones,
  X,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { api, getApiErrorMessage } from "@/lib/api";
import { toast } from "sonner";
import { peerCounselorNavItems } from "@/config/counselorNavItems";
import { studentNavItems } from "@/config/studentNavItems";
import { SpatialMeadow } from "@/components/peer/SpatialMeadow";
import { SpatialAudioControls } from "@/components/peer/SpatialAudioControls";
import { PeerProfileAliasModal } from "@/components/peer/PeerProfileAliasModal";
import { PeerStudentLinkerModal, AssignedStudentItem } from "@/components/peer/PeerStudentLinkerModal";
import { SpatialAudioManager } from "@/lib/spatialAudio";
import { AvatarStyle, FloatingReaction, LoungeChatMessage, LoungeParticipant } from "@/types/spatialLounge";
import { Room, RoomEvent, RemoteTrack, Track } from "livekit-client";
import { supabase } from "@/integrations/supabase/client";
import { getWebRtcIceServers } from "@/lib/videoCall";

export const PeerSpatialLounge = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const { user } = useAuth();

  const isPeerCounselor = user?.role === "peer_counselor";

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showChatHistory, setShowChatHistory] = useState(false);
  const [isLoadingSession, setIsLoadingSession] = useState(Boolean(sessionId));

  // Assigned students linking state (Peer Counselor)
  const [assignedStudents, setAssignedStudents] = useState<AssignedStudentItem[]>([]);
  const [isLoadingAssigned, setIsLoadingAssigned] = useState(false);
  const [showLinkerModal, setShowLinkerModal] = useState(false);
  const [isSendingInvite, setIsSendingInvite] = useState(false);

  // Audio & LiveKit State
  const [isMicActive, setIsMicActive] = useState(false);
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState<string>("default");
  const [isAmbientPlaying, setIsAmbientPlaying] = useState(false);
  const [livekitConnected, setLivekitConnected] = useState(false);

  // Real-time microphone audio level & sidetone test
  const [micLevel, setMicLevel] = useState<number>(0);
  const [isSidetoneActive, setIsSidetoneActive] = useState<boolean>(false);
  const micAnalyserAnimationRef = useRef<number | null>(null);

  // WebRTC direct peer connection fallback ref
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const supabaseChannelRef = useRef<any>(null);
  const iceCandidateQueueRef = useRef<RTCIceCandidateInit[]>([]);

  const audioManagerRef = useRef<SpatialAudioManager | null>(null);
  const livekitRoomRef = useRef<Room | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // Local user state
  const defaultName =
    user?.profile?.full_name ||
    (user?.email ? user.email.split("@")[0] : isPeerCounselor ? "Peer Counselor" : "Student");

  const [localParticipant, setLocalParticipant] = useState<LoungeParticipant>({
    id: `user-${user?.id ?? "guest"}`,
    name: defaultName,
    role: isPeerCounselor ? "peer_counselor" : "student",
    avatar: isPeerCounselor ? "dino-blue" : "dino-green",
    x: isPeerCounselor ? 400 : 600,
    y: 320,
    isTalking: false,
    isMuted: true,
    isLocal: true,
  });

  const localParticipantRef = useRef(localParticipant);
  useEffect(() => {
    localParticipantRef.current = localParticipant;
  }, [localParticipant]);

  const isMicActiveRef = useRef(isMicActive);
  useEffect(() => {
    isMicActiveRef.current = isMicActive;
  }, [isMicActive]);

  const makingOfferRef = useRef<boolean>(false);
  const isSettingRemoteAnswerPendingRef = useRef<boolean>(false);

  // Assigned Partner State - strictly 1-on-1, NO dummy mock bots
  const [partnerInfo, setPartnerInfo] = useState<{
    id: number;
    name: string;
    role: string;
    avatar: string;
  } | null>(null);

  const [participants, setParticipants] = useState<LoungeParticipant[]>([]);

  const [chatMessages, setChatMessages] = useState<LoungeChatMessage[]>([]);
  const conversationMessages = chatMessages.filter((m) => m.senderId !== "system");

  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);

  // Navigation back to chat
  const handleBackToChat = useCallback(() => {
    // Notify peer immediately that we are leaving so our avatar vanishes on their screen
    if (supabaseChannelRef.current) {
      try {
        void supabaseChannelRef.current.send({
          type: "broadcast",
          event: "spatial-leave",
          payload: {
            id: localParticipantRef.current.id,
            name: localParticipantRef.current.name,
          },
        });
        void supabaseChannelRef.current.untrack();
      } catch (err) {
        console.warn("Error sending spatial-leave:", err);
      }
    }

    if (livekitRoomRef.current) {
      try {
        void livekitRoomRef.current.disconnect();
      } catch (err) {
        console.warn("LiveKit disconnect error:", err);
      }
    }

    if (isPeerCounselor) {
      navigate(sessionId ? `/peer/chats?session_id=${sessionId}` : "/peer/chats");
    } else {
      navigate(sessionId ? `/student/chat?session_id=${sessionId}` : "/student/chat");
    }
  }, [isPeerCounselor, navigate, sessionId]);

  // Native Fullscreen toggle with fallback
  const handleToggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        }
        setIsFullscreen(true);
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        }
        setIsFullscreen(false);
      }
    } catch (err) {
      console.warn("Fullscreen toggle fallback:", err);
      setIsFullscreen((prev) => !prev);
    }
  }, []);

  // Sync state if user exits via ESC key or browser F11
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
    };
  }, []);

  // Fetch assigned students for the peer counselor
  const fetchAssignedStudents = useCallback(
    async (autoLinkIfSingle = false) => {
      if (!isPeerCounselor) return;
      try {
        setIsLoadingAssigned(true);
        const students = await api.getPeerAssignedStudents();
        setAssignedStudents(students);

        // Auto-link if exactly 1 assigned student and no sessionId currently selected
        if (autoLinkIfSingle && !sessionId && students.length === 1) {
          const single = students[0];
          toast.success(`Auto-linked with assigned student ${single.student_name} 🌿`);
          void api.requestSessionSpatialLounge(single.session_id).catch(() => {});
          navigate(`/peer/spatial-lounge?session_id=${single.session_id}`, { replace: true });
        } else if (autoLinkIfSingle && !sessionId && students.length > 1) {
          // If multiple students and none selected, open linker modal for choice
          setShowLinkerModal(true);
        }
      } catch (err) {
        console.warn("Failed to fetch assigned students:", err);
      } finally {
        setIsLoadingAssigned(false);
      }
    },
    [isPeerCounselor, sessionId, navigate]
  );

  // Link / Switch to an assigned student
  const handleSelectStudent = async (student: AssignedStudentItem) => {
    try {
      toast.loading(`Linking with ${student.student_name}...`, { id: "link-student" });
      await api.requestSessionSpatialLounge(student.session_id);
      toast.success(`Linked with ${student.student_name}! Meadow invitation sent.`, { id: "link-student" });
      navigate(`/peer/spatial-lounge?session_id=${student.session_id}`);
      void fetchAssignedStudents(false);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, "Failed to link with student"), { id: "link-student" });
    }
  };

  // Resend meadow invitation ping to student
  const handleResendInvite = async () => {
    if (!sessionId) return;
    try {
      setIsSendingInvite(true);
      await api.requestSessionSpatialLounge(sessionId);
      toast.success(
        `🌿 Invitation ping re-sent to ${partnerInfo?.name || "student"}! They'll see it on their dashboard.`
      );
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, "Failed to send invitation ping"));
    } finally {
      setIsSendingInvite(false);
    }
  };

  // Load assigned students on mount for peer counselor
  useEffect(() => {
    if (isPeerCounselor) {
      void fetchAssignedStudents(true);
    }
  }, [isPeerCounselor]);

  // Initialize Spatial Audio Manager & enumerate devices
  useEffect(() => {
    const manager = new SpatialAudioManager(650);
    audioManagerRef.current = manager;

    // Unlock browser audio context on any user interaction
    const unlockAudio = () => {
      manager.ensureContext();
    };
    window.addEventListener("click", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });

    // Enumerate microphones
    if (navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => {
          const audioInputs = devices.filter((d) => d.kind === "audioinput");
          setAudioInputDevices(audioInputs);
          if (audioInputs[0]?.deviceId) {
            setSelectedAudioDeviceId(audioInputs[0].deviceId);
          }
        })
        .catch((err) => console.warn("Failed to enumerate devices:", err));
    }

    return () => {
      window.removeEventListener("click", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      manager.cleanup();
      if (micAnalyserAnimationRef.current) {
        cancelAnimationFrame(micAnalyserAnimationRef.current);
        micAnalyserAnimationRef.current = null;
      }
      if (livekitRoomRef.current) {
        livekitRoomRef.current.disconnect();
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // Toggle local mic loopback / monitor (Hear Myself)
  const handleToggleSidetone = useCallback(async () => {
    if (!audioManagerRef.current) return;
    if (isSidetoneActive) {
      audioManagerRef.current.disableSidetone();
      setIsSidetoneActive(false);
      toast.info("Mic loopback turned off.");
    } else {
      let stream = localStreamRef.current;
      if (!stream || stream.getAudioTracks().length === 0 || !isMicActive) {
        try {
          const constraints: MediaStreamConstraints = {
            audio: selectedAudioDeviceId === "default" ? true : { deviceId: { exact: selectedAudioDeviceId } },
            video: false,
          };
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          localStreamRef.current = stream;
          setIsMicActive(true);
          setLocalParticipant((prev) => ({ ...prev, isTalking: true, isMuted: false }));
        } catch (err) {
          toast.error("Microphone permission needed to hear your voice.");
          return;
        }
      }
      audioManagerRef.current.enableSidetone(stream, 0.9);
      setIsSidetoneActive(true);
      audioManagerRef.current.playChime("test");
      toast.success("🔊 Voice loopback active! Speak into your mic to hear yourself through your speakers.");
    }
  }, [isSidetoneActive, isMicActive, selectedAudioDeviceId]);

  // Sound check: plays a musical chime so the user can verify speakers/headphones
  const handleTestSound = useCallback(() => {
    if (audioManagerRef.current) {
      audioManagerRef.current.ensureContext();
      audioManagerRef.current.playChime("test");
      toast.success("🎵 Sound test chime played! If you heard it, your speakers/headphones are working.");
    }
  }, []);

  // Connect to LiveKit / Session Spatial Lounge Token
  useEffect(() => {
    let isCancelled = false;

    const connectSessionLounge = async () => {
      try {
        setIsLoadingSession(true);

        // Disconnect previous livekit room when switching sessions
        if (livekitRoomRef.current) {
          livekitRoomRef.current.disconnect();
          livekitRoomRef.current = null;
        }

        let res: any = null;

        if (sessionId) {
          // Session-bound 1-on-1 private lounge
          res = await api.getSessionSpatialLoungeToken(sessionId, {
            avatar: localParticipant.avatar,
          });
        } else if (isPeerCounselor) {
          // Generic lounge for peer counselor if no session specified
          res = await api.getSpatialLoungeToken({
            name: localParticipant.name,
            avatar: localParticipant.avatar,
          });
        }

        if (isCancelled) return;

        if (res?.user) {
          setLocalParticipant((prev) => ({
            ...prev,
            id: String(res.user.id),
            name: res.user.name || prev.name,
            role: res.user.role || prev.role,
            avatar: (res.user.avatar as AvatarStyle) || prev.avatar,
            x: res.user.initial_x ?? prev.x,
            y: res.user.initial_y ?? prev.y,
          }));
        }

        if (res?.assigned_partner) {
          setPartnerInfo(res.assigned_partner);
          const partnerAvatar = (res.assigned_partner.avatar || (isPeerCounselor ? "dino-green" : "dino-blue")) as AvatarStyle;
          // IMPORTANT: Remote participants list must start EMPTY!
          // Avatars are only created dynamically when the participant is ACTUALLY online and enters the room.
          setParticipants([]);

          setChatMessages((prev) => [
            ...prev,
            {
              id: `msg-partner-${Date.now()}`,
              senderId: "system",
              senderName: "Heart-to-Heart Meadow",
              avatar: partnerAvatar,
              text: `Paired with ${res.assigned_partner.name}. Waiting for them to enter the meadow...`,
              timestamp: "Just now",
            },
          ]);
        } else if (!sessionId) {
          // If standalone and no partner, start clean
          setPartnerInfo(null);
          setParticipants([]);
        }

        if (res?.mode === "livekit" && res?.token && res?.url) {
          const room = new Room({
            adaptiveStream: true,
            dynacast: true,
          });

          livekitRoomRef.current = room;

          room.on(RoomEvent.Connected, () => {
            setLivekitConnected(true);
            toast.success("Connected to Heart-to-Heart Spatial Audio Meadow!");
          });

          room.on(RoomEvent.Disconnected, () => {
            setLivekitConnected(false);
          });

          room.on(RoomEvent.ParticipantConnected, (p) => {
            setParticipants((prev) => {
              if (prev.some((part) => part.id === p.identity)) return prev;
              return [
                ...prev,
                {
                  id: p.identity,
                  name: p.name || "Partner",
                  role: isPeerCounselor ? "student" : "peer_counselor",
                  avatar: (isPeerCounselor ? "dino-blue" : "dino-green") as AvatarStyle,
                  x: isPeerCounselor ? 600 : 400,
                  y: 320,
                  isTalking: false,
                  isMuted: false,
                },
              ];
            });
            toast.success(`🌿 ${p.name || "Your partner"} entered the Meadow!`);
          });

          room.on(RoomEvent.ParticipantDisconnected, (p) => {
            setParticipants((prev) => prev.filter((part) => part.id !== p.identity));
            if (audioManagerRef.current) {
              audioManagerRef.current.detachTrack(p.identity);
            }
            toast.info(`${p.name || "Partner"} left the Meadow.`);
          });

          // Handle incoming audio tracks
          room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, publication, participant) => {
            if (track.kind === Track.Kind.Audio) {
              const mediaStreamTrack = track.mediaStreamTrack;
              if (mediaStreamTrack && audioManagerRef.current) {
                const found = participants.find((p) => p.id === participant.identity);
                const targetX = found?.x ?? 550;
                const targetY = found?.y ?? 320;

                audioManagerRef.current.attachTrack(
                  participant.identity,
                  mediaStreamTrack,
                  targetX,
                  targetY,
                  localParticipant.x,
                  localParticipant.y
                );
              }
            }
          });

          room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, publication, participant) => {
            if (track.kind === Track.Kind.Audio && audioManagerRef.current) {
              audioManagerRef.current.detachTrack(participant.identity);
            }
          });

          // Handle DataChannel messages (movement, chat, reactions)
          room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant) => {
            try {
              const text = new TextDecoder().decode(payload);
              const data = JSON.parse(text);

              if (data.type === "move") {
                setParticipants((prev) => {
                  const idx = prev.findIndex((p) => p.id === participant.identity);
                  if (idx >= 0) {
                    const next = [...prev];
                    next[idx] = { ...next[idx], x: data.x, y: data.y, isTalking: Boolean(data.talking) };
                    return next;
                  } else {
                    return [
                      ...prev,
                      {
                        id: participant.identity,
                        name: data.name || participant.name || "Partner",
                        role: data.role || (isPeerCounselor ? "student" : "peer_counselor"),
                        avatar: data.avatar || (isPeerCounselor ? "dino-green" : "dino-blue"),
                        x: data.x,
                        y: data.y,
                        isTalking: Boolean(data.talking),
                        isMuted: !data.talking,
                      },
                    ];
                  }
                });

                audioManagerRef.current?.updateParticipantPosition(
                  participant.identity,
                  data.x,
                  data.y,
                  localParticipant.x,
                  localParticipant.y
                );
              } else if (data.type === "chat") {
                handleReceiveChatMessage(participant.identity, data.name, data.text);
              } else if (data.type === "reaction") {
                handleReceiveReaction(participant.identity, data.emoji);
              }
            } catch (err) {
              console.warn("Failed to parse data message:", err);
            }
          });

          await room.connect(res.url, res.token);
        } else {
          // Direct WebRTC proximity lounge mode active
          toast.info("Heart-to-Heart Meadow ready (Direct WebRTC audio mode).");
        }
      } catch (err: unknown) {
        console.warn("LiveKit lounge connection fallback:", err);
        toast.info("Heart-to-Heart Meadow ready (Direct WebRTC audio mode).");
      } finally {
        if (!isCancelled) {
          setIsLoadingSession(false);
        }
      }
    };

    void connectSessionLounge();

    return () => {
      isCancelled = true;
    };
  }, [sessionId, isPeerCounselor]);

  // -------------------------------------------------------------------------
  // Direct WebRTC Peer-to-Peer Audio Transport (guaranteed fallback)
  // -------------------------------------------------------------------------
  const sendSignal = useCallback((event: string, payload: any) => {
    if (supabaseChannelRef.current) {
      void supabaseChannelRef.current.send({
        type: "broadcast",
        event,
        payload,
      });
    }
  }, []);

  const isPolite = !isPeerCounselor; // Peer counselor is impolite, student is polite

  const getOrCreatePeerConnection = useCallback(() => {
    if (
      peerConnectionRef.current &&
      peerConnectionRef.current.signalingState !== "closed"
    ) {
      return peerConnectionRef.current;
    }

    const pc = new RTCPeerConnection({
      iceServers: getWebRtcIceServers(),
      iceCandidatePoolSize: 4,
    });
    peerConnectionRef.current = pc;

    // Attach local audio track if already active
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal("spatial-ice", {
          candidate: event.candidate.toJSON(),
          senderId: localParticipantRef.current.id,
        });
      }
    };

    pc.ontrack = (event) => {
      const audioTrack = event.track;
      if (audioTrack && audioTrack.kind === "audio" && audioManagerRef.current) {
        const remoteId = partnerInfo ? String(partnerInfo.id) : (participants[0]?.id || "partner");
        const targetX = participants[0]?.x ?? (isPeerCounselor ? 600 : 400);
        const targetY = participants[0]?.y ?? 320;

        audioManagerRef.current.attachTrack(
          remoteId,
          audioTrack,
          targetX,
          targetY,
          localParticipantRef.current.x,
          localParticipantRef.current.y
        );
        audioManagerRef.current.playChime("join");
        toast.success("🌿 Partner audio connected in 3D! Move closer to hear more loudly.");
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setLivekitConnected(true);
      }
    };

    // Standard W3C Perfect Negotiation
    pc.onnegotiationneeded = async () => {
      try {
        makingOfferRef.current = true;
        const offer = await pc.createOffer({ offerToReceiveAudio: true });
        if (pc.signalingState !== "stable") return;
        await pc.setLocalDescription(offer);
        sendSignal("spatial-offer", {
          sdp: offer,
          senderId: localParticipantRef.current.id,
        });
      } catch (err) {
        console.warn("[SpatialRTC] Negotiation needed error:", err);
      } finally {
        makingOfferRef.current = false;
      }
    };

    return pc;
  }, [partnerInfo, participants, isPeerCounselor, sendSignal]);

  const handleRemoteOffer = useCallback(
    async (payload: any) => {
      if (!payload?.sdp || payload.senderId === localParticipantRef.current.id) return;
      try {
        const pc = getOrCreatePeerConnection();
        const readyForOffer =
          !makingOfferRef.current &&
          (pc.signalingState === "stable" || isSettingRemoteAnswerPendingRef.current);
        const offerCollision = !readyForOffer;

        if (offerCollision) {
          if (!isPolite) {
            return;
          }
          await Promise.all([
            pc.setLocalDescription({ type: "rollback" }),
            pc.setRemoteDescription(new RTCSessionDescription(payload.sdp)),
          ]);
        } else {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        }

        while (iceCandidateQueueRef.current.length > 0) {
          const cand = iceCandidateQueueRef.current.shift();
          if (cand) {
            await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
          }
        }

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        sendSignal("spatial-answer", {
          sdp: answer,
          senderId: localParticipantRef.current.id,
        });
      } catch (err) {
        console.warn("[SpatialRTC] Remote offer error:", err);
      }
    },
    [getOrCreatePeerConnection, isPolite, sendSignal]
  );

  const handleRemoteAnswer = useCallback(
    async (payload: any) => {
      if (!payload?.sdp || payload.senderId === localParticipantRef.current.id) return;
      try {
        const pc = getOrCreatePeerConnection();
        isSettingRemoteAnswerPendingRef.current = true;
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        isSettingRemoteAnswerPendingRef.current = false;

        while (iceCandidateQueueRef.current.length > 0) {
          const cand = iceCandidateQueueRef.current.shift();
          if (cand) {
            await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
          }
        }
      } catch (err) {
        isSettingRemoteAnswerPendingRef.current = false;
        console.warn("[SpatialRTC] Remote answer error:", err);
      }
    },
    [getOrCreatePeerConnection]
  );

  const handleRemoteIce = useCallback(
    async (payload: any) => {
      if (!payload?.candidate || payload.senderId === localParticipantRef.current.id) return;
      try {
        const pc = peerConnectionRef.current;
        if (pc && pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {});
        } else {
          iceCandidateQueueRef.current.push(payload.candidate);
        }
      } catch (err) {
        console.warn("[SpatialRTC] ICE candidate error:", err);
      }
    },
    []
  );

  // Chat receive handler
  const handleReceiveChatMessage = useCallback((senderId: string, senderName: string, text: string) => {
    setChatMessages((prev) => [
      ...prev,
      {
        id: `msg-${Date.now()}-${Math.random()}`,
        senderId,
        senderName,
        avatar: "dino-green",
        text,
        timestamp: "Just now",
      },
    ]);

    setParticipants((prev) =>
      prev.map((p) => (p.id === senderId ? { ...p, speechText: text } : p))
    );

    setTimeout(() => {
      setParticipants((prev) =>
        prev.map((p) => (p.id === senderId && p.speechText === text ? { ...p, speechText: undefined } : p))
      );
    }, 6000);
  }, []);

  // Reaction receive handler
  const handleReceiveReaction = useCallback((senderId: string, emoji: string) => {
    setParticipants((prev) => {
      const sender = prev.find((p) => p.id === senderId);
      const rxX = sender?.x ?? 500;
      const rxY = sender?.y ?? 300;

      const newReaction: FloatingReaction = {
        id: `rx-${Date.now()}-${Math.random()}`,
        emoji,
        x: rxX,
        y: rxY - 30,
        createdAt: Date.now(),
      };

      setFloatingReactions((curr) => [...curr, newReaction]);
      setTimeout(() => {
        setFloatingReactions((curr) => curr.filter((r) => r.id !== newReaction.id));
      }, 2500);

      return prev;
    });
  }, []);

  // Supabase Realtime broadcast & presence channel subscription - stable throughout the session
  useEffect(() => {
    const channelKey = sessionId ? `spatial-lounge-${sessionId}` : `spatial-lounge-public`;
    const channel = supabase.channel(channelKey, {
      config: {
        broadcast: { self: false },
        presence: { key: localParticipantRef.current.id },
      },
    });
    supabaseChannelRef.current = channel;

    // Broadcast departure so partner immediately sees avatar vanish
    const broadcastLeave = () => {
      try {
        void channel.send({
          type: "broadcast",
          event: "spatial-leave",
          payload: {
            id: localParticipantRef.current.id,
            name: localParticipantRef.current.name,
          },
        });
        void channel.untrack();
      } catch (err) {
        console.warn("Error broadcasting leave:", err);
      }
    };

    channel
      .on("broadcast", { event: "spatial-join" }, ({ payload }) => {
        if (!payload || payload.id === localParticipantRef.current.id) return;
        setParticipants((prev) => {
          const idx = prev.findIndex((p) => p.id === payload.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = { ...next[idx], ...payload, isLocal: false };
            return next;
          }
          return [...prev, { ...payload, isLocal: false }];
        });
        toast.success(`🌿 ${payload.name || "Partner"} entered the Meadow!`);

        // Reply back with our current position so newcomer sees us immediately
        void channel.send({
          type: "broadcast",
          event: "spatial-move",
          payload: {
            id: localParticipantRef.current.id,
            x: localParticipantRef.current.x,
            y: localParticipantRef.current.y,
            name: localParticipantRef.current.name,
            role: localParticipantRef.current.role,
            avatar: localParticipantRef.current.avatar,
            isTalking: isMicActiveRef.current,
          },
        });
      })
      .on("broadcast", { event: "spatial-leave" }, ({ payload }) => {
        if (!payload || !payload.id || payload.id === localParticipantRef.current.id) return;
        setParticipants((prev) => prev.filter((p) => p.id !== payload.id));
        if (audioManagerRef.current) {
          audioManagerRef.current.detachTrack(payload.id);
        }
        toast.info(`👋 ${payload.name || "Partner"} left the Meadow.`);
      })
      .on("broadcast", { event: "spatial-move" }, ({ payload }) => {
        if (!payload || payload.id === localParticipantRef.current.id) return;
        setParticipants((prev) => {
          const idx = prev.findIndex((p) => p.id === payload.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = { ...next[idx], ...payload, isLocal: false };
            return next;
          }
          return [...prev, { ...payload, isLocal: false }];
        });

        audioManagerRef.current?.updateParticipantPosition(
          payload.id,
          payload.x,
          payload.y,
          localParticipantRef.current.x,
          localParticipantRef.current.y
        );
      })
      .on("presence", { event: "leave" }, ({ key, leftPresences }) => {
        const leftId = key || (leftPresences && leftPresences[0]?.id);
        if (leftId && leftId !== localParticipantRef.current.id) {
          setParticipants((prev) => prev.filter((p) => p.id !== leftId));
          if (audioManagerRef.current) {
            audioManagerRef.current.detachTrack(leftId);
          }
          toast.info("Partner is no longer in the Meadow.");
        }
      })
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const activeRemoteIds = new Set<string>();

        Object.values(state).forEach((presences: any) => {
          if (Array.isArray(presences)) {
            presences.forEach((p: any) => {
              const pid = String(p.id || p.key);
              if (pid && pid !== localParticipantRef.current.id) {
                activeRemoteIds.add(pid);
              }
            });
          }
        });

        // Clean up any participant who is no longer present in room
        setParticipants((prev) => {
          const remaining = prev.filter((p) => activeRemoteIds.has(p.id));
          prev.forEach((p) => {
            if (!activeRemoteIds.has(p.id)) {
              audioManagerRef.current?.detachTrack(p.id);
            }
          });
          return remaining;
        });
      })
      .on("broadcast", { event: "spatial-offer" }, ({ payload }) => {
        void handleRemoteOffer(payload);
      })
      .on("broadcast", { event: "spatial-answer" }, ({ payload }) => {
        void handleRemoteAnswer(payload);
      })
      .on("broadcast", { event: "spatial-ice" }, ({ payload }) => {
        void handleRemoteIce(payload);
      })
      .on("broadcast", { event: "spatial-chat" }, ({ payload }) => {
        if (payload?.senderId === localParticipantRef.current.id) return;
        handleReceiveChatMessage(payload.senderId, payload.senderName, payload.text);
      })
      .on("broadcast", { event: "spatial-reaction" }, ({ payload }) => {
        if (payload?.senderId === localParticipantRef.current.id) return;
        handleReceiveReaction(payload.senderId, payload.emoji);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.track({
            id: localParticipantRef.current.id,
            name: localParticipantRef.current.name,
            role: localParticipantRef.current.role,
            avatar: localParticipantRef.current.avatar,
            x: localParticipantRef.current.x,
            y: localParticipantRef.current.y,
          });

          void channel.send({
            type: "broadcast",
            event: "spatial-join",
            payload: {
              id: localParticipantRef.current.id,
              name: localParticipantRef.current.name,
              role: localParticipantRef.current.role,
              avatar: localParticipantRef.current.avatar,
              x: localParticipantRef.current.x,
              y: localParticipantRef.current.y,
              isTalking: isMicActiveRef.current,
            },
          });
        }
      });

    // Window navigation & close handlers
    window.addEventListener("beforeunload", broadcastLeave);
    window.addEventListener("pagehide", broadcastLeave);

    return () => {
      window.removeEventListener("beforeunload", broadcastLeave);
      window.removeEventListener("pagehide", broadcastLeave);
      broadcastLeave();
      void supabase.removeChannel(channel);
      supabaseChannelRef.current = null;
    };
  }, [
    sessionId,
    handleRemoteOffer,
    handleRemoteAnswer,
    handleRemoteIce,
    handleReceiveChatMessage,
    handleReceiveReaction,
  ]);

  // Broadcast local movements to Supabase and LiveKit
  const handleLocalMove = useCallback(
    (newX: number, newY: number) => {
      setLocalParticipant((prev) => ({ ...prev, x: newX, y: newY }));

      // Update spatial audio nodes for all remote participants
      if (audioManagerRef.current) {
        audioManagerRef.current.updateAmbientPosition(newX, newY);
        participants.forEach((peer) => {
          audioManagerRef.current?.updateParticipantPosition(
            peer.id,
            peer.x,
            peer.y,
            newX,
            newY
          );
        });
      }

      const movePayload = {
        id: localParticipant.id,
        x: newX,
        y: newY,
        name: localParticipant.name,
        role: localParticipant.role,
        avatar: localParticipant.avatar,
        isTalking: isMicActive,
      };

      if (supabaseChannelRef.current) {
        void supabaseChannelRef.current.send({
          type: "broadcast",
          event: "spatial-move",
          payload: movePayload,
        });
      }

      // Publish move data to LiveKit room if active
      if (livekitRoomRef.current?.state === "connected") {
        try {
          const payload = JSON.stringify({
            type: "move",
            ...movePayload,
            talking: isMicActive,
          });
          void livekitRoomRef.current.localParticipant.publishData(
            new TextEncoder().encode(payload),
            { reliable: true }
          );
        } catch (err) {
          console.warn("Publish move error:", err);
        }
      }
    },
    [participants, localParticipant.id, localParticipant.name, localParticipant.role, localParticipant.avatar, isMicActive]
  );

  // Toggle Microphone / Request Audio to Talk
  const handleToggleMic = async () => {
    audioManagerRef.current?.ensureContext();

    if (isMicActive) {
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach((track) => (track.enabled = false));
      }
      if (micAnalyserAnimationRef.current) {
        cancelAnimationFrame(micAnalyserAnimationRef.current);
        micAnalyserAnimationRef.current = null;
      }
      if (isSidetoneActive && audioManagerRef.current) {
        audioManagerRef.current.disableSidetone();
        setIsSidetoneActive(false);
      }
      setMicLevel(0);
      setIsMicActive(false);
      audioManagerRef.current?.playChime("mic-off");
      setLocalParticipant((prev) => {
        const next = { ...prev, isTalking: false, isMuted: true };
        sendSignal("spatial-move", next);
        return next;
      });
      toast.info("Microphone muted.");
    } else {
      try {
        let stream = localStreamRef.current;
        if (!stream || stream.getAudioTracks().length === 0 || stream.getAudioTracks()[0].readyState === "ended") {
          const constraints: MediaStreamConstraints = {
            audio: selectedAudioDeviceId === "default" ? true : { deviceId: { exact: selectedAudioDeviceId } },
            video: false,
          };
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          localStreamRef.current = stream;
        } else {
          stream.getAudioTracks().forEach((track) => (track.enabled = true));
        }

        const audioTrack = stream.getAudioTracks()[0];

        // 1. Hook up to direct WebRTC peer connection
        const pc = getOrCreatePeerConnection();
        const senders = pc.getSenders();
        const audioSender = senders.find((s) => s.track?.kind === "audio");
        if (audioSender && audioTrack) {
          await audioSender.replaceTrack(audioTrack);
        } else if (audioTrack) {
          pc.addTrack(audioTrack, stream);
        }

        // 2. Hook up to LiveKit if connected
        if (livekitRoomRef.current?.state === "connected" && audioTrack) {
          await livekitRoomRef.current.localParticipant.publishTrack(audioTrack);
        }

        // 3. Audible confirmation chime
        audioManagerRef.current?.playChime("mic-on");

        // 4. Real-time microphone audio level meter & voice activity animation
        if (audioManagerRef.current) {
          const { getVolume } = audioManagerRef.current.createMicLevelAnalyser(stream);
          const volumeLoop = () => {
            const vol = getVolume();
            setMicLevel(vol);
            const isSpeaking = vol > 0.05;
            setLocalParticipant((prev) => {
              if (prev.isTalking !== isSpeaking) {
                sendSignal("spatial-move", { ...prev, isTalking: isSpeaking });
                return { ...prev, isTalking: isSpeaking };
              }
              return prev;
            });
            micAnalyserAnimationRef.current = requestAnimationFrame(volumeLoop);
          };
          micAnalyserAnimationRef.current = requestAnimationFrame(volumeLoop);
        }

        setIsMicActive(true);
        setLocalParticipant((prev) => {
          const next = { ...prev, isTalking: true, isMuted: false };
          sendSignal("spatial-move", next);
          return next;
        });

        toast.success("Audio active! Walk near your partner in the meadow to hear each other in 3D.");
      } catch (err: unknown) {
        toast.error("Microphone permission needed to speak in the lounge.");
      }
    }
  };

  // Switch microphone input device
  const handleSelectAudioDevice = async (deviceId: string) => {
    setSelectedAudioDeviceId(deviceId);
    if (isMicActive) {
      try {
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach((t) => t.stop());
        }
        const constraints: MediaStreamConstraints = {
          audio: deviceId === "default" ? true : { deviceId: { exact: deviceId } },
          video: false,
        };
        const newStream = await navigator.mediaDevices.getUserMedia(constraints);
        localStreamRef.current = newStream;
        const newTrack = newStream.getAudioTracks()[0];

        if (peerConnectionRef.current && newTrack) {
          const senders = peerConnectionRef.current.getSenders();
          const audioSender = senders.find((s) => s.track?.kind === "audio");
          if (audioSender) {
            await audioSender.replaceTrack(newTrack);
          }
        }
        if (livekitRoomRef.current?.state === "connected" && newTrack) {
          await livekitRoomRef.current.localParticipant.publishTrack(newTrack);
        }
        if (isSidetoneActive && audioManagerRef.current) {
          audioManagerRef.current.enableSidetone(newStream, 0.7);
        }
        toast.success("Microphone updated!");
      } catch (err) {
        console.warn("Failed to switch audio input device:", err);
      }
    }
  };

  // Toggle Ambient Radio
  const handleToggleAmbient = () => {
    if (audioManagerRef.current) {
      const active = audioManagerRef.current.toggleAmbientSpeaker(localParticipant.x, localParticipant.y);
      setIsAmbientPlaying(active);
      toast(active ? "Zen Meadow Radio turned on 🎵" : "Zen Meadow Radio turned off");
    }
  };

  // Send Chat message
  const handleSendChatMessage = (text: string) => {
    const newMessage: LoungeChatMessage = {
      id: `msg-${Date.now()}`,
      senderId: localParticipant.id,
      senderName: localParticipant.name,
      avatar: localParticipant.avatar,
      text,
      timestamp: "Just now",
      isLocal: true,
    };

    setChatMessages((prev) => [...prev, newMessage]);
    setLocalParticipant((prev) => ({
      ...prev,
      speechText: text,
      speechExpiry: Date.now() + 6000,
    }));

    setTimeout(() => {
      setLocalParticipant((prev) => (prev.speechText === text ? { ...prev, speechText: undefined } : prev));
    }, 6000);

    if (supabaseChannelRef.current) {
      void supabaseChannelRef.current.send({
        type: "broadcast",
        event: "spatial-chat",
        payload: {
          senderId: localParticipant.id,
          senderName: localParticipant.name,
          text,
        },
      });
    }

    if (livekitRoomRef.current?.state === "connected") {
      try {
        const payload = JSON.stringify({
          type: "chat",
          text,
          name: localParticipant.name,
        });
        void livekitRoomRef.current.localParticipant.publishData(
          new TextEncoder().encode(payload),
          { reliable: true }
        );
      } catch (err) {
        console.warn("Publish chat error:", err);
      }
    }
  };

  // Send Floating Reaction
  const handleSendReaction = (emoji: string) => {
    const newReaction: FloatingReaction = {
      id: `rx-${Date.now()}-${Math.random()}`,
      emoji,
      x: localParticipant.x + (Math.random() * 40 - 20),
      y: localParticipant.y - 30,
      createdAt: Date.now(),
    };

    setFloatingReactions((prev) => [...prev, newReaction]);
    setTimeout(() => {
      setFloatingReactions((prev) => prev.filter((r) => r.id !== newReaction.id));
    }, 2500);

    if (supabaseChannelRef.current) {
      void supabaseChannelRef.current.send({
        type: "broadcast",
        event: "spatial-reaction",
        payload: {
          senderId: localParticipant.id,
          emoji,
        },
      });
    }

    if (livekitRoomRef.current?.state === "connected") {
      try {
        const payload = JSON.stringify({
          type: "reaction",
          emoji,
        });
        void livekitRoomRef.current.localParticipant.publishData(
          new TextEncoder().encode(payload),
          { reliable: false }
        );
      } catch (err) {
        console.warn("Publish reaction error:", err);
      }
    }
  };

  // Profile alias & avatar customization
  const handleSaveProfile = (newName: string, newAvatar: AvatarStyle) => {
    setLocalParticipant((prev) => ({
      ...prev,
      name: newName,
      avatar: newAvatar,
    }));
    toast.success(`Appearance updated as ${newName}!`);
  };

  // Calculate nearby participants within hearing circle
  const nearbyPeers = participants.filter((p) => {
    const d = Math.hypot(p.x - localParticipant.x, p.y - localParticipant.y);
    return d <= 450;
  });

  return (
    <div className={`min-h-screen bg-slate-950 text-slate-100 ${isFullscreen ? "p-0" : ""}`}>
      {/* Sidebar rendered only for peer counselor when not fullscreen */}
      {!isFullscreen && isPeerCounselor && (
        <DashboardSidebar
          items={peerCounselorNavItems}
          userType="peer"
          userName={localParticipant.name}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
      )}

      {/* Main Content Area */}
      <div className={isFullscreen || !isPeerCounselor ? "w-full" : "lg:pl-72 pl-0"}>
        <header className="sticky top-0 z-40 flex h-14 sm:h-16 shrink-0 items-center justify-between border-b border-white/10 bg-slate-950/90 px-3 sm:px-4 backdrop-blur-md">
          <div className="flex items-center gap-2 sm:gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBackToChat}
              className="text-slate-300 hover:text-white hover:bg-slate-900 gap-1.5 text-xs font-semibold"
            >
              <ArrowLeft className="w-4 h-4 text-emerald-400" />
              <span className="hidden sm:inline">Back to Chat</span>
            </Button>
            <div className="h-4 w-px bg-slate-800 hidden sm:block" />
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <Heart className="w-4 h-4 fill-emerald-500/30" />
              </div>
              <div>
                <h1 className="text-xs sm:text-sm font-bold text-white flex items-center gap-1.5">
                  <span>Heart-to-Heart Meadow</span>
                  {sessionId && (
                    <span className="text-[10px] font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full hidden md:inline">
                      Private 1-on-1
                    </span>
                  )}
                </h1>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isPeerCounselor && (
              <Button
                onClick={() => setShowLinkerModal(true)}
                variant="outline"
                size="sm"
                className="bg-emerald-950/40 border-emerald-500/30 text-emerald-300 hover:text-white hover:bg-emerald-900/60 text-xs gap-1.5 rounded-xl font-medium"
              >
                <Users className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden sm:inline">
                  {partnerInfo ? `Linked: ${partnerInfo.name}` : "Link Student"}
                </span>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded-full border border-emerald-500/30">
                  Switch
                </span>
              </Button>
            )}

            {/* Meadow Chat Button */}
            <Button
              onClick={() => setShowChatHistory(!showChatHistory)}
              variant="outline"
              size="sm"
              className={`transition-all rounded-xl text-xs gap-1.5 font-medium shadow-sm ${
                showChatHistory
                  ? "bg-emerald-500/20 border-emerald-500/60 text-emerald-300 font-semibold shadow-[0_0_12px_rgba(52,211,153,0.25)]"
                  : "bg-slate-900/90 border-slate-800 text-slate-300 hover:text-white hover:border-slate-700"
              }`}
              title="Toggle Meadow Chat conversation history"
            >
              <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
              <span>Meadow Chat</span>
              {conversationMessages.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/25 text-emerald-300 text-[10px] font-bold border border-emerald-500/40">
                  {conversationMessages.length}
                </span>
              )}
            </Button>

            {/* Full Screen Toggle Button */}
            <Button
              onClick={handleToggleFullscreen}
              variant="outline"
              size="sm"
              className={`transition-all rounded-xl text-xs gap-1.5 font-medium shadow-sm ${
                isFullscreen
                  ? "bg-emerald-950/60 border-emerald-500/50 text-emerald-300 font-semibold"
                  : "bg-slate-900/90 border-slate-800 text-slate-300 hover:text-white hover:border-slate-700"
              }`}
              title={isFullscreen ? "Exit Fullscreen (or press Esc)" : "Enter Fullscreen"}
            >
              {isFullscreen ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="hidden sm:inline">Exit Fullscreen</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="hidden sm:inline">Full Screen</span>
                </>
              )}
            </Button>
          </div>
        </header>

        <main className={`p-3 lg:p-5 space-y-4 max-w-7xl mx-auto ${isFullscreen ? "h-screen flex flex-col justify-between" : ""}`}>
          {/* Top Session Partner Banner */}
          {!isFullscreen && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gradient-to-r from-emerald-950/60 to-slate-900 border border-emerald-500/20 rounded-2xl p-4 shadow-lg">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
                  <Radio className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base font-bold text-white">
                      {partnerInfo ? (
                        <>Paired with <span className="text-emerald-400 font-extrabold">{partnerInfo.name}</span></>
                      ) : (
                        "Heart-to-Heart Meadow"
                      )}
                    </h2>
                    <span className="text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Shield className="w-2.5 h-2.5" />
                      Strictly Confidential 1-on-1
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {partnerInfo
                      ? "Walk your avatar closer using WASD or Arrow Keys to hear each other in spatial 3D audio."
                      : "Private proximity audio space. Link an assigned student to invite them into the meadow."}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {isLoadingSession && (
                  <div className="flex items-center gap-2 text-xs text-emerald-400 mr-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Connecting private lounge...</span>
                  </div>
                )}

                {isPeerCounselor && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowLinkerModal(true)}
                    className="bg-emerald-950/50 border-emerald-500/30 text-emerald-300 hover:text-white hover:bg-emerald-900/50 text-xs rounded-xl gap-1.5"
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>{partnerInfo ? "Switch Student" : "Link Assigned Student"}</span>
                  </Button>
                )}
              </div>
            </div>
          )}



          {/* Main Spatial Audio Meadow Canvas */}
          <div className="relative">
            {/* Waiting for partner prompt overlay */}
            {sessionId && partnerInfo && participants.length === 0 && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 w-full max-w-lg px-4 pointer-events-auto">
                <div className="bg-slate-950/95 backdrop-blur-md border border-emerald-500/50 rounded-2xl p-3.5 shadow-2xl flex items-center justify-between gap-3 text-slate-100 animate-in fade-in slide-in-from-top-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
                      <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white truncate">
                        Waiting for <span className="text-emerald-400 font-bold">{partnerInfo.name}</span> to enter...
                      </p>
                      <p className="text-[11px] text-slate-400 truncate">
                        An invite is active. You can re-ping them anytime.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isPeerCounselor && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleResendInvite}
                        disabled={isSendingInvite}
                        className="h-7 text-[11px] px-2.5 bg-emerald-950/70 border-emerald-500/40 text-emerald-300 hover:bg-emerald-900/60 hover:text-white rounded-lg font-medium gap-1"
                      >
                        {isSendingInvite ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Send className="w-3 h-3" />
                        )}
                        <span>Ping Student</span>
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowLinkerModal(true)}
                      className="h-7 text-[11px] px-2 text-slate-400 hover:text-white"
                    >
                      Switch
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <SpatialMeadow
              participants={participants}
              localParticipant={localParticipant}
              onMove={handleLocalMove}
              maxHearableDistance={450}
              isSpeakerPlaying={isAmbientPlaying}
              onToggleSpeaker={handleToggleAmbient}
              floatingReactions={floatingReactions}
            />

            {/* In-meadow floating stats bar */}
            <div className="absolute bottom-4 left-4 z-20 flex items-center gap-2 pointer-events-none">
              <div className="bg-slate-950/85 backdrop-blur-xl border border-emerald-500/30 px-3.5 py-1.5 rounded-2xl text-xs text-slate-200 flex items-center gap-2.5 shadow-2xl">
                <span className="relative flex h-2 w-2">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${nearbyPeers.length > 0 ? "bg-emerald-400" : "bg-amber-400"}`} />
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${nearbyPeers.length > 0 ? "bg-emerald-500" : "bg-amber-500"}`} />
                </span>
                <Users className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-medium text-slate-100">
                  {partnerInfo ? (
                    participants.length > 0 ? (
                      <span>Partner in Meadow</span>
                    ) : (
                      <span className="text-amber-300">Waiting for partner...</span>
                    )
                  ) : (
                    <span>Private Session</span>
                  )}
                </span>
                <span className="text-slate-600">|</span>
                <span className={`font-semibold flex items-center gap-1.5 ${nearbyPeers.length > 0 ? "text-emerald-300" : "text-slate-300"}`}>
                  {nearbyPeers.length > 0 ? (
                    <>
                      <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Within Hearing Aura</span>
                    </>
                  ) : (
                    <>
                      <Headphones className="w-3.5 h-3.5 text-slate-400" />
                      <span>Walk Closer to Hear</span>
                    </>
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* Bottom Controls Bar */}
          <SpatialAudioControls
            isMicActive={isMicActive}
            onToggleMic={handleToggleMic}
            audioInputDevices={audioInputDevices}
            selectedAudioDeviceId={selectedAudioDeviceId}
            onSelectAudioDevice={handleSelectAudioDevice}
            isAmbientPlaying={isAmbientPlaying}
            onToggleAmbient={handleToggleAmbient}
            onSendChatMessage={handleSendChatMessage}
            onSendReaction={handleSendReaction}
            onOpenProfileSettings={() => setShowProfileModal(true)}
            nearbyCount={nearbyPeers.length}
            totalParticipants={participants.length + 1}
            micLevel={micLevel}
            isSidetoneActive={isSidetoneActive}
            onToggleSidetone={handleToggleSidetone}
            onTestSound={handleTestSound}
          />

          {/* Floating Glassmorphic Meadow Chat Drawer */}
          {showChatHistory && (
            <div className="fixed top-18 right-4 sm:right-6 z-50 w-80 sm:w-96 max-w-[calc(100vw-2rem)] bg-slate-950/95 backdrop-blur-2xl border border-emerald-500/30 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.7)] p-4 flex flex-col gap-3 animate-in fade-in slide-in-from-right-4 duration-200">
              <div className="flex items-center justify-between border-b border-emerald-500/20 pb-2.5">
                <h3 className="text-sm font-bold flex items-center gap-2 text-white">
                  <MessageSquare className="w-4 h-4 text-emerald-400" />
                  <span>Meadow Chat Logs</span>
                  {conversationMessages.length > 0 && (
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded-full border border-emerald-500/30 font-semibold">
                      {conversationMessages.length}
                    </span>
                  )}
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowChatHistory(false)}
                  className="h-7 w-7 p-0 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
                  title="Close Chat Logs"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              {/* Chat message history list */}
              <div className="max-h-72 overflow-y-auto space-y-2 pr-1 text-xs">
                {chatMessages.length === 0 ? (
                  <div className="py-8 text-center text-slate-400 text-xs">
                    No conversation messages yet. Type in the bar below to talk!
                  </div>
                ) : (
                  chatMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`p-2.5 rounded-xl flex items-start gap-2.5 ${
                        msg.senderId === "system"
                          ? "bg-slate-900/60 border border-slate-800 text-slate-400 text-[11px]"
                          : msg.isLocal
                          ? "bg-emerald-950/70 border border-emerald-500/40 text-emerald-100 ml-4 shadow-sm"
                          : "bg-slate-900/90 border border-slate-800 text-slate-200 mr-4 shadow-sm"
                      }`}
                    >
                      <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-[11px] shrink-0 text-emerald-300">
                        {msg.senderName.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-semibold text-white truncate text-[11px]">{msg.senderName}</span>
                          <span className="text-[10px] text-slate-400 shrink-0">{msg.timestamp}</span>
                        </div>
                        <p className="mt-0.5 text-xs break-words">{msg.text}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Quick thought chat input inside drawer */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const formEl = e.currentTarget;
                  const inputEl = formEl.elements.namedItem("drawerChatInput") as HTMLInputElement;
                  if (inputEl?.value.trim()) {
                    handleSendChatMessage(inputEl.value.trim());
                    inputEl.value = "";
                  }
                }}
                className="flex items-center gap-2 pt-2 border-t border-emerald-500/20"
              >
                <input
                  name="drawerChatInput"
                  placeholder="Type a thought..."
                  className="flex-1 bg-slate-900/90 border border-slate-800 focus:border-emerald-500/50 rounded-xl px-3 py-1.5 text-xs text-white placeholder:text-slate-400 outline-none"
                />
                <Button
                  type="submit"
                  size="sm"
                  className="h-8 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs gap-1 font-semibold"
                >
                  <Send className="w-3 h-3" />
                  <span>Send</span>
                </Button>
              </form>
            </div>
          )}
        </main>
      </div>

      {/* Avatar & Display Name Modal */}
      <PeerProfileAliasModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        currentName={localParticipant.name}
        currentAvatar={localParticipant.avatar}
        onSave={handleSaveProfile}
      />

      {/* Assigned Student Linker Modal for Peer Counselor */}
      {isPeerCounselor && (
        <PeerStudentLinkerModal
          isOpen={showLinkerModal}
          onClose={() => setShowLinkerModal(false)}
          assignedStudents={assignedStudents}
          currentSessionId={sessionId}
          isLoading={isLoadingAssigned}
          onSelectStudent={handleSelectStudent}
          onRefresh={() => void fetchAssignedStudents(false)}
        />
      )}
    </div>
  );
};

export default PeerSpatialLounge;
