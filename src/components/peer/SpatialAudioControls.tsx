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
}) => {
  const [chatText, setChatText] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const EMOJI_OPTIONS = ["💖", "👋", "😊", "☕", "🌿", "🧘", "👂", "✨"];

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (chatText.trim() === "") return;
    onSendChatMessage(chatText.trim());
    setChatText("");
  };

  // Keyboard shortcut: Spacebar to toggle mic if not in text input
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

  return (
    <div className="w-full bg-slate-950/90 backdrop-blur-xl border border-white/10 rounded-2xl p-3 lg:p-4 shadow-xl flex flex-col gap-3">
      {/* Top row: Quick chat bubble & floating emojis */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
        {/* Chat input */}
        <form onSubmit={handleChatSubmit} className="flex-1 min-w-[240px] flex items-center gap-2">
          <Input
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
            placeholder="Type a thought... (shows as speech bubble over avatar)"
            className="bg-slate-900/80 border-slate-700/80 text-white placeholder:text-slate-400 text-xs h-9"
          />
          <Button
            type="submit"
            size="sm"
            variant="default"
            className="h-9 px-3 bg-emerald-600 hover:bg-emerald-500 text-white text-xs gap-1"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Send</span>
          </Button>
        </form>

        {/* Reaction Emojis Bar */}
        <div className="flex items-center gap-1 bg-slate-900/80 px-2 py-1 rounded-xl border border-slate-800">
          {EMOJI_OPTIONS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => onSendReaction(emoji)}
              className="p-1 hover:scale-125 transition-transform text-base hover:bg-white/10 rounded-lg"
              title={`React with ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      {/* Bottom row: Audio Device Selector + Main "Request Audio to Talk" Button + Ambiance */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* Left: Audio Device Selector (matches screenshot bottom-left) */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="flex items-center gap-2 bg-slate-900/90 border border-slate-700 px-3 py-1.5 rounded-xl text-xs text-slate-300 max-w-[260px] truncate">
            <Mic className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <select
              value={selectedAudioDeviceId}
              onChange={(e) => onSelectAudioDevice(e.target.value)}
              className="bg-transparent text-white border-none outline-none cursor-pointer truncate text-xs w-full"
            >
              {audioInputDevices.length > 0 ? (
                audioInputDevices.map((device, idx) => (
                  <option key={device.deviceId || idx} value={device.deviceId} className="bg-slate-900 text-white">
                    {device.label || `Microphone ${idx + 1}`}
                  </option>
                ))
              ) : (
                <option value="default" className="bg-slate-900 text-white">Default Microphone</option>
              )}
            </select>
          </div>
        </div>

        {/* Center: Main "Request Audio to Talk" / Mic Pill */}
        <div className="flex items-center gap-2">
          <Button
            onClick={onToggleMic}
            size="lg"
            className={`h-11 px-6 rounded-full font-semibold transition-all shadow-lg flex items-center gap-2 text-sm ${
              isMicActive
                ? "bg-emerald-500 hover:bg-emerald-400 text-slate-950 ring-4 ring-emerald-500/30 animate-pulse"
                : "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white"
            }`}
          >
            {isMicActive ? (
              <>
                <Mic className="w-4 h-4 animate-bounce text-slate-950" />
                <span>Microphone Active (Speaking)</span>
              </>
            ) : (
              <>
                <MicOff className="w-4 h-4 text-white/80" />
                <span>Request Audio to Talk</span>
              </>
            )}
          </Button>
          <span className="text-[11px] text-slate-400 hidden md:inline">
            (or press <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">Space</kbd>)
          </span>
        </div>

        {/* Right: Ambient Radio Toggle & Profile Settings */}
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          {/* Zen Radio Ambiance Button */}
          <Button
            onClick={onToggleAmbient}
            variant="outline"
            size="sm"
            className={`h-9 px-3 rounded-xl border text-xs gap-1.5 ${
              isAmbientPlaying
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                : "border-slate-800 bg-slate-900/80 text-slate-400 hover:text-white"
            }`}
            title="Toggle Meadow Zen Radio (Spatial Ambient Music)"
          >
            {isAmbientPlaying ? (
              <>
                <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
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
            className="h-9 px-3 rounded-xl border-slate-800 bg-slate-900/80 text-slate-300 hover:text-white text-xs gap-1.5"
            title="Change your alias or character sprite"
          >
            <Settings2 className="w-3.5 h-3.5" />
            <span>Customize Avatar</span>
          </Button>

          {/* Nearby Count Badge */}
          <div className="px-2.5 py-1.5 rounded-xl bg-slate-900/80 border border-slate-800 text-[11px] text-slate-300 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>{nearbyCount} in range</span>
          </div>
        </div>
      </div>
    </div>
  );
};
