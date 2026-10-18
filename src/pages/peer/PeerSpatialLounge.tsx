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
import { SpatialAudioManager } from "@/lib/spatialAudio";
import { AvatarStyle, FloatingReaction, LoungeChatMessage, LoungeParticipant } from "@/types/spatialLounge";
import { Room, RoomEvent, RemoteTrack, Track } from "livekit-client";

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

  // Audio & LiveKit State
  const [isMicActive, setIsMicActive] = useState(false);
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState<string>("default");
  const [isAmbientPlaying, setIsAmbientPlaying] = useState(true);
  const [livekitConnected, setLivekitConnected] = useState(false);

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

  // Assigned Partner State - strictly 1-on-1, NO dummy mock bots
  const [partnerInfo, setPartnerInfo] = useState<{
    id: number;
    name: string;
    role: string;
    avatar: string;
  } | null>(null);

  const [participants, setParticipants] = useState<LoungeParticipant[]>([]);

  const [chatMessages, setChatMessages] = useState<LoungeChatMessage[]>([
    {
      id: "msg-init",
      senderId: "system",
      senderName: "Heart-to-Heart Meadow",
      avatar: "dino-green",
      text: "Welcome to the private Heart-to-Heart Spatial Meadow. Proximity 3D audio is enabled.",
      timestamp: "Just now",
    },
  ]);

  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);

  // Navigation back to chat
  const handleBackToChat = useCallback(() => {
    if (isPeerCounselor) {
      navigate(sessionId ? `/peer/chats?session_id=${sessionId}` : "/peer/chats");
    } else {
      navigate(sessionId ? `/student/chat?session_id=${sessionId}` : "/student/chat");
    }
  }, [isPeerCounselor, navigate, sessionId]);

  // Initialize Spatial Audio Manager & enumerate devices
  useEffect(() => {
    const manager = new SpatialAudioManager(240);
    audioManagerRef.current = manager;

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

    // Auto-start ambient radio on initial position
    const ambientTimer = setTimeout(() => {
      manager.startAmbientSpeaker(localParticipant.x, localParticipant.y);
      setIsAmbientPlaying(manager.isAmbientActive());
    }, 600);

    return () => {
      clearTimeout(ambientTimer);
      manager.cleanup();
      if (livekitRoomRef.current) {
        livekitRoomRef.current.disconnect();
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // Connect to LiveKit / Session Spatial Lounge Token
  useEffect(() => {
    let isCancelled = false;

    const connectSessionLounge = async () => {
      try {
        setIsLoadingSession(true);

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
          const partnerParticipant: LoungeParticipant = {
            id: String(res.assigned_partner.id),
            name: res.assigned_partner.name,
            role: res.assigned_partner.role,
            avatar: partnerAvatar,
            x: res.assigned_partner.initial_x ?? (isPeerCounselor ? 600 : 400),
            y: res.assigned_partner.initial_y ?? 320,
            isTalking: false,
            isMuted: false,
          };
          setParticipants([partnerParticipant]);

          setChatMessages((prev) => [
            ...prev,
            {
              id: `msg-partner-${Date.now()}`,
              senderId: "system",
              senderName: "Heart-to-Heart Meadow",
              avatar: partnerAvatar,
              text: `Paired with ${res.assigned_partner.name}. Walk closer to talk via proximity voice!`,
              timestamp: "Just now",
            },
          ]);
        } else if (!sessionId) {
          // If standalone and no partner, start clean (no fake bots)
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
          // Simulated proximity lounge mode active
          toast.info("Heart-to-Heart Meadow ready in simulated proximity mode.");
        }
      } catch (err: unknown) {
        console.warn("LiveKit lounge connection fallback:", err);
        toast.error("Could not initialize live audio room. Offline proximity active.");
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

  // Broadcast local movements to LiveKit and update audio manager
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

      // Publish move data to LiveKit room
      if (livekitRoomRef.current?.state === "connected") {
        try {
          const payload = JSON.stringify({
            type: "move",
            x: newX,
            y: newY,
            name: localParticipant.name,
            role: localParticipant.role,
            avatar: localParticipant.avatar,
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
    [participants, localParticipant.name, localParticipant.role, localParticipant.avatar, isMicActive]
  );

  // Toggle Microphone / Request Audio to Talk
  const handleToggleMic = async () => {
    audioManagerRef.current?.ensureContext();

    if (isMicActive) {
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach((track) => (track.enabled = false));
      }
      setIsMicActive(false);
      setLocalParticipant((prev) => ({ ...prev, isTalking: false, isMuted: true }));
      toast.info("Microphone muted.");
    } else {
      try {
        if (!localStreamRef.current) {
          const constraints: MediaStreamConstraints = {
            audio: selectedAudioDeviceId === "default" ? true : { deviceId: { exact: selectedAudioDeviceId } },
            video: false,
          };
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          localStreamRef.current = stream;

          if (livekitRoomRef.current?.state === "connected") {
            const audioTrack = stream.getAudioTracks()[0];
            if (audioTrack) {
              await livekitRoomRef.current.localParticipant.publishTrack(audioTrack);
            }
          }
        } else {
          localStreamRef.current.getAudioTracks().forEach((track) => (track.enabled = true));
        }

        setIsMicActive(true);
        setLocalParticipant((prev) => ({ ...prev, isTalking: true, isMuted: false }));
        toast.success("Audio active! Walk near your partner in the meadow to hear each other in 3D.");
      } catch (err: unknown) {
        toast.error("Microphone permission needed to speak in the lounge.");
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

  const handleReceiveChatMessage = (senderId: string, senderName: string, text: string) => {
    const senderAvatar = participants.find((p) => p.id === senderId)?.avatar || "dino-green";

    setChatMessages((prev) => [
      ...prev,
      {
        id: `msg-${Date.now()}-${Math.random()}`,
        senderId,
        senderName,
        avatar: senderAvatar,
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

  const handleReceiveReaction = (senderId: string, emoji: string) => {
    const sender = participants.find((p) => p.id === senderId);
    if (!sender) return;

    const newReaction: FloatingReaction = {
      id: `rx-${Date.now()}-${Math.random()}`,
      emoji,
      x: sender.x,
      y: sender.y - 30,
      createdAt: Date.now(),
    };

    setFloatingReactions((prev) => [...prev, newReaction]);
    setTimeout(() => {
      setFloatingReactions((prev) => prev.filter((r) => r.id !== newReaction.id));
    }, 2500);
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
    return d <= 240;
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
        {!isFullscreen && (
          <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between border-b border-white/10 bg-slate-950/90 px-4 backdrop-blur-md">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBackToChat}
                className="text-slate-300 hover:text-white hover:bg-slate-900 gap-1.5 text-xs font-semibold"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back to Chat</span>
              </Button>
              <div className="h-4 w-px bg-slate-800" />
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <Heart className="w-4 h-4 fill-emerald-500/30" />
                </div>
                <div>
                  <h1 className="text-sm font-bold text-white flex items-center gap-2">
                    Heart-to-Heart Meadow
                    {sessionId && (
                      <span className="text-[10px] font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.2 rounded-full">
                        Private 1-on-1
                      </span>
                    )}
                  </h1>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={() => setShowChatHistory(!showChatHistory)}
                variant="outline"
                size="sm"
                className="bg-slate-900 border-slate-800 text-slate-300 hover:text-white text-xs gap-1.5"
              >
                <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden sm:inline">Meadow Chat</span>
                <span>({chatMessages.length})</span>
              </Button>
              <Button
                onClick={() => setIsFullscreen(!isFullscreen)}
                variant="outline"
                size="sm"
                className="bg-slate-900 border-slate-800 text-slate-300 hover:text-white text-xs gap-1.5"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Full Screen</span>
              </Button>
            </div>
          </header>
        )}

        <main className={`p-3 lg:p-5 space-y-4 max-w-7xl mx-auto ${isFullscreen ? "h-screen flex flex-col justify-between" : ""}`}>
          {/* Top Session Partner Banner */}
          {!isFullscreen && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gradient-to-r from-emerald-950/60 to-slate-900 border border-emerald-500/20 rounded-2xl p-4 shadow-lg">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                  <Radio className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-white">
                      {partnerInfo ? (
                        <>Paired with <span className="text-emerald-400">{partnerInfo.name}</span></>
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
                    Walk your avatar closer using <b>WASD</b> or <b>Arrow Keys</b> to hear your partner in spatial 3D.
                  </p>
                </div>
              </div>

              {isLoadingSession && (
                <div className="flex items-center gap-2 text-xs text-emerald-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Connecting private lounge...</span>
                </div>
              )}
            </div>
          )}

          {/* Fullscreen top exit pill */}
          {isFullscreen && (
            <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
              <Button
                onClick={handleBackToChat}
                size="sm"
                variant="secondary"
                className="bg-slate-900/90 hover:bg-slate-800 text-white border border-white/20 shadow-xl gap-1 text-xs backdrop-blur-md"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Return to Chat</span>
              </Button>
              <Button
                onClick={() => setIsFullscreen(false)}
                size="sm"
                variant="secondary"
                className="bg-slate-900/90 hover:bg-slate-800 text-white border border-white/20 shadow-xl gap-1 text-xs backdrop-blur-md"
              >
                <Minimize2 className="w-3.5 h-3.5" />
                <span>Exit Fullscreen</span>
              </Button>
            </div>
          )}

          {/* Main Spatial Audio Meadow Canvas */}
          <div className="relative">
            <SpatialMeadow
              participants={participants}
              localParticipant={localParticipant}
              onMove={handleLocalMove}
              maxHearableDistance={240}
              isSpeakerPlaying={isAmbientPlaying}
              onToggleSpeaker={handleToggleAmbient}
              floatingReactions={floatingReactions}
            />

            {/* In-meadow floating stats bar */}
            <div className="absolute bottom-4 left-4 z-20 flex items-center gap-2 pointer-events-none">
              <div className="bg-slate-950/80 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-xl text-xs text-slate-200 flex items-center gap-2 shadow-lg">
                <Users className="w-3.5 h-3.5 text-emerald-400" />
                <span>
                  {partnerInfo ? (
                    <b>{participants.length > 0 ? "Partner in Meadow" : "Waiting for partner to enter..."}</b>
                  ) : (
                    <b>Private Session</b>
                  )}
                </span>
                <span className="text-slate-600">|</span>
                <span className="text-emerald-300">
                  <b>{nearbyPeers.length > 0 ? "Within Hearing Aura 🔊" : "Walk Closer to Hear 🎧"}</b>
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
            onSelectAudioDevice={setSelectedAudioDeviceId}
            isAmbientPlaying={isAmbientPlaying}
            onToggleAmbient={handleToggleAmbient}
            onSendChatMessage={handleSendChatMessage}
            onSendReaction={handleSendReaction}
            onOpenProfileSettings={() => setShowProfileModal(true)}
            nearbyCount={nearbyPeers.length}
            totalParticipants={participants.length + 1}
          />

          {/* Chat History Drawer */}
          {showChatHistory && (
            <Card className="bg-slate-900/90 border-slate-800 text-white shadow-xl">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <h3 className="text-sm font-bold flex items-center gap-2 text-emerald-400">
                    <MessageSquare className="w-4 h-4" />
                    Heart-to-Heart Conversation Logs
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowChatHistory(false)}
                    className="text-xs text-slate-400 hover:text-white"
                  >
                    Close
                  </Button>
                </div>
                <div className="max-h-48 overflow-y-auto space-y-2 pr-2 text-xs">
                  {chatMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`p-2 rounded-xl flex items-start gap-2 ${
                        msg.isLocal ? "bg-emerald-950/50 border border-emerald-800/40 ml-4" : "bg-slate-800/60 mr-4"
                      }`}
                    >
                      <div className="w-5 h-5 rounded-full bg-slate-700 flex items-center justify-center font-bold text-[10px] shrink-0">
                        {msg.senderName.charAt(0)}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-200">{msg.senderName}</span>
                          <span className="text-[10px] text-slate-500">{msg.timestamp}</span>
                        </div>
                        <p className="text-slate-300 mt-0.5">{msg.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
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
    </div>
  );
};

export default PeerSpatialLounge;
