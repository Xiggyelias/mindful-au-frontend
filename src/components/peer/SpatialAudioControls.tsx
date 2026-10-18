import React, { useState, useEffect } from "react";
import {
  Mic,
  MicOff,
  Radio,
  Smile,
  Send,
  Volume2,
  VolumeX,
  UserCheck,
  Settings2,
  Headphones,
  Sparkles,
  MessageCircle,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SpatialAudioControlsProps {
  isMicActive: boolean;
  onToggleMic: () => void;
  audioInputDevices: MediaDeviceInfo[];
  selectedAudioDeviceId: string;
  onSelectAudioDevice: (deviceId: string) => void;
  isAmbientPlaying: boolean;
  onToggleAmbient: () => void;
  onSendChatMessage: (text: string) => void;
  onSendReaction: (emoji: string) => void;
  onOpenProfileSettings: () => void;
  nearbyCount: number;
  totalParticipants: number;
  micLevel?: number;
  isSidetoneActive?: boolean;
  onToggleSidetone?: () => void;
  onTestSound?: () => void;
}

export const SpatialAudioControls: React.FC<SpatialAudioControlsProps> = ({
  isMicActive,
  onToggleMic,
  audioInputDevices,
  selectedAudioDeviceId,
  onSelectAudioDevice,
  isAmbientPlaying,
  onToggleAmbient,
  onSendChatMessage,
  onSendReaction,
  onOpenProfileSettings,
  nearbyCount,
  totalParticipants,
  micLevel = 0,
  isSidetoneActive = false,
  onToggleSidetone,
  onTestSound,
}) => {
  const [chatText, setChatText] = useState("");

  const EMOJI_OPTIONS = [
    { emoji: "💖", label: "Heart" },
    { emoji: "👋", label: "Wave" },
    { emoji: "😊", label: "Smile" },
    { emoji: "☕", label: "Tea" },
    { emoji: "🌿", label: "Leaf" },
    { emoji: "🧘", label: "Calm" },
    { emoji: "👂", label: "Listening" },
    { emoji: "✨", label: "Sparkles" },
  ];

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (chatText.trim() === "") return;
    onSendChatMessage(chatText.trim());
    setChatText("");
  };

  // Keyboard shortcut: Spacebar to toggle mic if not typing in text input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        onToggleMic();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onToggleMic]);

  // Compute 5-step VU meter activity bars from micLevel
  const clampedLevel = Math.min(1, Math.max(0, micLevel * 3.5));
  const activeBars = Math.round(clampedLevel * 5);

  return (
    <div className="w-full bg-slate-950/85 backdrop-blur-2xl border border-emerald-500/20 rounded-2xl p-3.5 lg:p-4 shadow-[0_10px_35px_rgba(0,0,0,0.5)] flex flex-col gap-3.5 transition-all">
      {/* Top row: Quick thought bubble chat & floating emojis */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-500/10 pb-3">
        {/* Chat input */}
        <form onSubmit={handleChatSubmit} className="flex-1 min-w-[260px] flex items-center gap-2">
          <div className="relative flex-1 flex items-center">
            <MessageCircle className="absolute left-3 w-4 h-4 text-emerald-400/80 pointer-events-none" />
            <Input
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              placeholder="Share a thought... (appears as speech bubble over your avatar)"
              className="bg-slate-900/90 border-slate-800 text-white placeholder:text-slate-400 text-xs h-9 pl-9 pr-3 rounded-xl focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500/60"
            />
          </div>
          <Button
            type="submit"
            size="sm"
            variant="default"
            className="h-9 px-4 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl gap-1.5 shadow-md shadow-emerald-950/50"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Send</span>
          </Button>
        </form>

        {/* Reaction Emojis Bar */}
        <div className="flex items-center gap-1 bg-slate-900/90 px-2 py-1 rounded-xl border border-slate-800/80 shadow-inner">
          {EMOJI_OPTIONS.map(({ emoji, label }) => (
            <button
              key={emoji}
              onClick={() => onSendReaction(emoji)}
              className="p-1 hover:scale-130 transition-transform active:scale-95 text-base hover:bg-emerald-500/20 rounded-lg"
              title={`Express ${label} (${emoji})`}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      {/* Bottom row: Audio Device Selector + Main "Request Audio to Talk" Button + Ambiance */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* Left: Audio Device Selector & Mic Sound Checks */}
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <div className="flex items-center gap-2 bg-slate-900/90 border border-slate-800 hover:border-slate-700 px-3 py-1.5 rounded-xl text-xs text-slate-300 max-w-[230px] truncate shadow-sm transition-colors">
            <Mic className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <select
              value={selectedAudioDeviceId}
              onChange={(e) => onSelectAudioDevice(e.target.value)}
              className="bg-transparent text-white border-none outline-none cursor-pointer truncate text-xs w-full font-medium"
            >
              {audioInputDevices.length > 0 ? (
                audioInputDevices.map((device, idx) => (
                  <option key={device.deviceId || idx} value={device.deviceId} className="bg-slate-900 text-white">
                    {device.label || `Microphone ${idx + 1}`}
                  </option>
                ))
              ) : (
                <option value="default" className="bg-slate-900 text-white">
                  Default Microphone
                </option>
              )}
            </select>
          </div>

          {/* Sidetone / Instant Mic Loopback Toggle */}
          {onToggleSidetone && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onToggleSidetone}
              className={`h-8 px-2.5 text-[11px] rounded-xl border transition-all ${
                isSidetoneActive
                  ? "border-emerald-500 bg-emerald-500/20 text-emerald-300 font-semibold shadow-[0_0_12px_rgba(52,211,153,0.3)] animate-pulse"
                  : "border-slate-800 bg-slate-900/90 text-slate-300 hover:text-white hover:border-slate-700"
              }`}
              title="Hear your own microphone live in your speakers or headphones"
            >
              <Headphones className="w-3.5 h-3.5 mr-1 text-emerald-400" />
              <span>{isSidetoneActive ? "🔊 Hearing Myself (Live)" : "Hear Myself"}</span>
            </Button>
          )}

          {/* Test Speakers Sound Check */}
          {onTestSound && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onTestSound}
              className="h-8 px-2.5 text-[11px] rounded-xl border border-slate-800 bg-slate-900/90 text-slate-300 hover:text-white hover:border-slate-700"
              title="Play a test chime to verify your speakers/headphones"
            >
              <Volume2 className="w-3.5 h-3.5 mr-1 text-emerald-400" />
              <span>Test Speakers</span>
            </Button>
          )}
        </div>

        {/* Center: Main "Request Audio to Talk" / Mic Pill + Live Visualizer */}
        <div className="flex flex-col items-center gap-1.5 my-1 sm:my-0">
          <div className="flex items-center gap-2">
            <Button
              onClick={onToggleMic}
              size="lg"
              className={`h-11 px-6 rounded-full font-bold transition-all shadow-xl flex items-center gap-2.5 text-sm ${
                isMicActive
                  ? "bg-gradient-to-r from-emerald-400 to-emerald-500 hover:from-emerald-300 hover:to-emerald-400 text-slate-950 ring-4 ring-emerald-500/30 shadow-[0_0_20px_rgba(52,211,153,0.4)] animate-pulse"
                  : "bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.25)]"
              }`}
            >
              {isMicActive ? (
                <>
                  <Mic className="w-4 h-4 animate-bounce text-slate-950" />
                  <span>Microphone Active (Speaking)</span>
                </>
              ) : (
                <>
                  <MicOff className="w-4 h-4 text-emerald-200" />
                  <span>Request Audio to Talk</span>
                </>
              )}
            </Button>
            <span className="text-[11px] text-slate-400 hidden lg:inline">
              (or press <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[10px]">Space</kbd>)
            </span>
          </div>

          {/* Live Mic Level Audio Activity Bar / Status */}
          {isMicActive ? (
            <div className="flex items-center gap-2 text-[11px] text-slate-300 animate-in fade-in">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Mic Level:</span>
              {/* 5-bar live LED visualizer */}
              <div className="flex items-center gap-1">
                {[0, 1, 2, 3, 4].map((barIdx) => (
                  <div
                    key={barIdx}
                    className={`w-1.5 rounded-full transition-all duration-75 ${
                      barIdx < activeBars
                        ? barIdx === 4
                          ? "h-3.5 bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]"
                          : "h-3 bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]"
                        : "h-1.5 bg-slate-800"
                    }`}
                  />
                ))}
              </div>
              <span className={micLevel > 0.04 ? "text-emerald-400 font-semibold" : "text-slate-400 font-normal"}>
                {micLevel > 0.04 ? "Sound Detected 🎙️" : "Speak to talk..."}
              </span>
              {isSidetoneActive && (
                <span className="ml-1 text-[10px] text-emerald-300 bg-emerald-950/80 border border-emerald-500/40 px-2 py-0.5 rounded-full font-semibold">
                  Loopback On
                </span>
              )}
            </div>
          ) : (
            <span className="text-[11px] text-slate-400 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-emerald-400/70" />
              <span>Click &quot;Hear Myself&quot; or &quot;Request Audio&quot; to begin talking</span>
            </span>
          )}
        </div>

        {/* Right: Ambient Radio Toggle & Profile Settings */}
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          {/* Zen Radio Ambiance Button */}
          <Button
            onClick={onToggleAmbient}
            variant="outline"
            size="sm"
            className={`h-9 px-3 rounded-xl border text-xs gap-1.5 font-medium transition-all ${
              isAmbientPlaying
                ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.2)]"
                : "border-slate-800 bg-slate-900/90 text-slate-400 hover:text-white hover:border-slate-700"
            }`}
            title="Toggle Meadow Zen Radio (Spatial Ambient Music)"
          >
            {isAmbientPlaying ? (
              <>
                <Volume2 className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                <span>Zen Radio On</span>
              </>
            ) : (
              <>
                <VolumeX className="w-3.5 h-3.5" />
                <span>Zen Radio Off</span>
              </>
            )}
          </Button>

          {/* Edit Alias / Avatar Profile */}
          <Button
            onClick={onOpenProfileSettings}
            variant="outline"
            size="sm"
            className="h-9 px-3 rounded-xl border-slate-800 bg-slate-900/90 text-slate-300 hover:text-white hover:border-slate-700 text-xs gap-1.5 font-medium"
            title="Change your alias or character sprite"
          >
            <Settings2 className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Customize Avatar</span>
            <span className="sm:hidden">Avatar</span>
          </Button>

          {/* Nearby Count Badge */}
          <div className="px-2.5 py-1.5 rounded-xl bg-slate-900/90 border border-emerald-500/30 text-[11px] text-slate-300 flex items-center gap-1.5 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-semibold text-emerald-300">{nearbyCount}</span>
            <span className="text-slate-400">in range</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SpatialAudioControls;
