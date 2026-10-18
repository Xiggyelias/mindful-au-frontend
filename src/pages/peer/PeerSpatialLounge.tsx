import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Radio,
  Users,
  MessageSquare,
  Sparkles,
  Maximize2,
  Minimize2,
  Info,
  ArrowLeft,
  Volume2,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { api, getApiErrorMessage } from "@/lib/api";
import { toast } from "sonner";
import { peerCounselorNavItems } from "@/config/counselorNavItems";
import { SpatialMeadow } from "@/components/peer/SpatialMeadow";
import { SpatialAudioControls } from "@/components/peer/SpatialAudioControls";
import { PeerProfileAliasModal } from "@/components/peer/PeerProfileAliasModal";
import { SpatialAudioManager } from "@/lib/spatialAudio";
import { AvatarStyle, FloatingReaction, LoungeChatMessage, LoungeParticipant } from "@/types/spatialLounge";
import { Room, RoomEvent, RemoteTrack, Track } from "livekit-client";

export const PeerSpatialLounge = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showChatHistory, setShowChatHistory] = useState(false);

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
  const defaultName = user?.profile?.full_name || user?.email?.split("@")[0] || "Peer Counselor";
  const [localParticipant, setLocalParticipant] = useState<LoungeParticipant>({
    id: `local-${user?.id ?? "guest"}`,
    name: defaultName,
    role: "peer_counselor",
    avatar: "dino-blue",
    x: 480,
    y: 320,
    isTalking: false,
    isMuted: true,
    isLocal: true,
  });

  // Remote participants on the meadow (initially seeded with friendly peer counselors like the LiveKit example)
  const [participants, setParticipants] = useState<LoungeParticipant[]>([
    {
      id: "peer-don",
      name: "Don",
      role: "peer_counselor",
      avatar: "dino-green",
      x: 380,
      y: 280,
      isTalking: false,
      isMuted: false,
      speechText: "Welcome to the meadow!",
    },
    {
      id: "peer-noah",
      name: "Noah",
      role: "peer_counselor",
      avatar: "dino-red",
      x: 410,
      y: 370,
      isTalking: false,
      isMuted: false,
    },
    {
      id: "peer-elena",
      name: "Elena",
      role: "peer_counselor",
      avatar: "owl-violet",
      x: 640,
      y: 240,
      isTalking: false,
      isMuted: false,
      speechText: "Here for heart-to-heart chat 💖",
    },
  ]);

  const [chatMessages, setChatMessages] = useState<LoungeChatMessage[]>([
    {
      id: "msg-1",
      senderId: "peer-don",
      senderName: "Don",
      avatar: "dino-green",
      text: "Welcome to the meadow! Walk closer to talk via proximity voice.",
      timestamp: "Just now",
    },
  ]);

  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);

  // Initialize Spatial Audio Manager & enumerate devices
  useEffect(() => {
    const manager = new SpatialAudioManager(240);
    audioManagerRef.current = manager;

    // Enumerate microphones
    if (navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then((devices) => {
        const audioInputs = devices.filter((d) => d.kind === "audioinput");
        setAudioInputDevices(audioInputs);
        if (audioInputs[0]?.deviceId) {
          setSelectedAudioDeviceId(audioInputs[0].deviceId);
        }
      }).catch((err) => console.warn("Failed to enumerate devices:", err));
    }

    // Auto-start ambient radio on initial position
    setTimeout(() => {
      manager.startAmbientSpeaker(localParticipant.x, localParticipant.y);
      setIsAmbientPlaying(manager.isAmbientActive());
    }, 600);

    return () => {
      manager.cleanup();
      if (livekitRoomRef.current) {
        livekitRoomRef.current.disconnect();
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // Connect to LiveKit if backend token is available
  useEffect(() => {
    let isCancelled = false;

    const connectLiveKit = async () => {
      try {
        const res = await api.getSpatialLoungeToken({
          name: localParticipant.name,
          avatar: localParticipant.avatar,
        });

        if (isCancelled) return;

        if (res?.mode === "livekit" && res?.token && res?.url) {
          const room = new Room({
            adaptiveStream: true,
            dynacast: true,
          });

          livekitRoomRef.current = room;

          room.on(RoomEvent.Connected, () => {
            setLivekitConnected(true);
            toast.success("Connected to LiveKit Spatial Audio room!");
          });

          room.on(RoomEvent.Disconnected, () => {
            setLivekitConnected(false);
          });

          // Handle incoming audio tracks
          room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, publication, participant) => {
            if (track.kind === Track.Kind.Audio) {
              const mediaStreamTrack = track.mediaStreamTrack;
              if (mediaStreamTrack && audioManagerRef.current) {
                // Find or create participant entry
                const found = participants.find((p) => p.id === participant.identity);
                const targetX = found?.x ?? 500;
                const targetY = found?.y ?? 300;

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
                        name: data.name || participant.name || "Peer",
                        role: "peer_counselor",
                        avatar: data.avatar || "dino-green",
                        x: data.x,
                        y: data.y,
                        isTalking: Boolean(data.talking),
                        isMuted: !data.talking,
                      },
                    ];
                  }
                });

                // Update audio spatial node
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
          toast.info("Meadow ready in offline proximity mode.");
        }
      } catch (err: unknown) {
        console.warn("LiveKit lounge token connection fallback:", err);
      }
    };

    void connectLiveKit();

    return () => {
      isCancelled = true;
    };
  }, []);

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
    [participants, localParticipant.name, localParticipant.avatar, isMicActive]
  );

  // Toggle Microphone / Request Audio to Talk
  const handleToggleMic = async () => {
    audioManagerRef.current?.ensureContext();

    if (isMicActive) {
      // Mute
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach((track) => (track.enabled = false));
      }
      setIsMicActive(false);
      setLocalParticipant((prev) => ({ ...prev, isTalking: false, isMuted: true }));
      toast.info("Microphone muted.");
    } else {
      // Unmute / Request Audio to Talk
      try {
        if (!localStreamRef.current) {
          const constraints: MediaStreamConstraints = {
            audio: selectedAudioDeviceId === "default" ? true : { deviceId: { exact: selectedAudioDeviceId } },
            video: false,
          };
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          localStreamRef.current = stream;

          // If LiveKit room is active, publish audio track
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
        toast.success("Audio active! People nearby in the meadow can hear you in 3D.");
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

    // Broadcast via LiveKit DataChannel
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
    toast.success(`Profile updated as ${newName}!`);
  };

  // Calculate nearby participants within hearing circle
  const nearbyPeers = participants.filter((p) => {
    const d = Math.hypot(p.x - localParticipant.x, p.y - localParticipant.y);
    return d <= 240;
  });

  return (
    <div className={`min-h-screen bg-slate-950 text-slate-100 ${isFullscreen ? "p-0" : ""}`}>
      {!isFullscreen && (
        <DashboardSidebar
          items={peerCounselorNavItems}
          userType="peer"
          userName={localParticipant.name}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
      )}

      <div className={isFullscreen ? "w-full" : "lg:pl-72 pl-0"}>
        {!isFullscreen && (
          <DashboardHeader
            title="Heart-to-Heart Spatial Lounge"
            onMenuClick={() => setSidebarOpen(true)}
          />
        )}

        <main className={`p-3 lg:p-5 space-y-4 max-w-7xl mx-auto ${isFullscreen ? "h-screen flex flex-col justify-between" : ""}`}>
          {/* Top Info Banner */}
          {!isFullscreen && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gradient-to-r from-emerald-950/60 to-slate-900 border border-emerald-500/20 rounded-2xl p-4 shadow-lg">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                  <Radio className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h1 className="text-lg font-bold text-white flex items-center gap-2">
                    Peer Heart-to-Heart Meadow
                    <span className="text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded-full">
                      Spatial 3D Audio Active
                    </span>
                  </h1>
                  <p className="text-xs text-slate-400">
                    Walk near colleagues to talk naturally. Distance reduces volume; left/right stereo pans based on position.
                  </p>
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
                  <span>Chat Logs ({chatMessages.length})</span>
                </Button>
                <Button
                  onClick={() => setIsFullscreen(!isFullscreen)}
                  variant="outline"
                  size="sm"
                  className="bg-slate-900 border-slate-800 text-slate-300 hover:text-white text-xs gap-1.5"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>Full Screen</span>
                </Button>
              </div>
            </div>
          )}

          {/* Fullscreen top exit pill */}
          {isFullscreen && (
            <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
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
                  <b>{participants.length + 1}</b> Peers in Lounge
                </span>
                <span className="text-slate-600">|</span>
                <span className="text-emerald-300">
                  <b>{nearbyPeers.length}</b> In Audible Reach
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
