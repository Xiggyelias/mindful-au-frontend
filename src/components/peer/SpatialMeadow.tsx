import React, { useEffect, useRef, useState, useCallback } from "react";
import { AvatarStyle, FloatingReaction, LoungeParticipant } from "@/types/spatialLounge";
import { Radio, Volume2, Sparkles } from "lucide-react";

interface SpatialMeadowProps {
  participants: LoungeParticipant[];
  localParticipant: LoungeParticipant;
  onMove: (x: number, y: number) => void;
  maxHearableDistance?: number;
  speakerPos?: { x: number; y: number };
  isSpeakerPlaying?: boolean;
  onToggleSpeaker?: () => void;
  floatingReactions?: FloatingReaction[];
}

export const SpatialMeadow: React.FC<SpatialMeadowProps> = ({
  participants,
  localParticipant,
  onMove,
  maxHearableDistance = 240,
  speakerPos = { x: 340, y: 190 },
  isSpeakerPlaying = false,
  onToggleSpeaker,
  floatingReactions = [],
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [clickIndicator, setClickIndicator] = useState<{ x: number; y: number } | null>(null);

  // Field dimensions (responsive virtual meadow coordinates)
  const WORLD_WIDTH = 1000;
  const WORLD_HEIGHT = 650;

  // Handle keyboard movement
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is currently typing in an input or textarea
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }

      const step = e.shiftKey ? 28 : 16;
      let newX = localParticipant.x;
      let newY = localParticipant.y;
      let moved = false;

      switch (e.key.toLowerCase()) {
        case "arrowup":
        case "w":
          newY = Math.max(50, newY - step);
          moved = true;
          break;
        case "arrowdown":
        case "s":
          newY = Math.min(WORLD_HEIGHT - 60, newY + step);
          moved = true;
          break;
        case "arrowleft":
        case "a":
          newX = Math.max(50, newX - step);
          moved = true;
          break;
        case "arrowright":
        case "d":
          newX = Math.min(WORLD_WIDTH - 60, newX + step);
          moved = true;
          break;
      }

      if (moved) {
        e.preventDefault();
        onMove(newX, newY);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [localParticipant.x, localParticipant.y, onMove]);

  // Handle click / tap to move
  const handleMeadowClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      // Scale to internal world coordinates
      const scaleX = WORLD_WIDTH / rect.width;
      const scaleY = WORLD_HEIGHT / rect.height;

      const targetX = Math.max(50, Math.min(WORLD_WIDTH - 60, clickX * scaleX));
      const targetY = Math.max(50, Math.min(WORLD_HEIGHT - 60, clickY * scaleY));

      setClickIndicator({ x: clickX, y: clickY });
      setTimeout(() => setClickIndicator(null), 800);

      onMove(targetX, targetY);
    },
    [onMove]
  );

  // Render SVG avatar sprite based on chosen style
  const renderAvatarSprite = (avatar: AvatarStyle, isTalking: boolean, isLocal: boolean) => {
    switch (avatar) {
      case "dino-green":
        return (
          <svg className="w-12 h-12 filter drop-shadow-md transition-transform" viewBox="0 0 48 48">
            {/* Green Dino body */}
            <rect x="14" y="10" width="20" height="22" rx="4" fill="#4ade80" />
            <rect x="24" y="6" width="14" height="12" rx="3" fill="#22c55e" />
            {/* Eye */}
            <circle cx="32" cy="11" r="2.5" fill="#ffffff" />
            <circle cx="33" cy="11" r="1.2" fill="#0f172a" />
            {/* Cheeks / Belly */}
            <rect x="18" y="20" width="8" height="10" rx="2" fill="#bbf7d0" />
            {/* Mouth */}
            <rect x="30" y="15" width="6" height="2" fill={isTalking ? "#ef4444" : "#15803d"} />
            {/* Legs */}
            <rect x="16" y="32" width="6" height="8" rx="2" fill="#16a34a" />
            <rect x="26" y="32" width="6" height="8" rx="2" fill="#15803d" />
            {/* Tail */}
            <polygon points="14,24 6,28 14,30" fill="#22c55e" />
            {/* Back spikes */}
            <polygon points="12,14 10,12 14,12" fill="#facc15" />
            <polygon points="12,18 10,16 14,16" fill="#facc15" />
          </svg>
        );
      case "dino-blue":
        return (
          <svg className="w-12 h-12 filter drop-shadow-md transition-transform" viewBox="0 0 48 48">
            {/* Blue Dino body */}
            <rect x="14" y="10" width="20" height="22" rx="4" fill="#60a5fa" />
            <rect x="24" y="6" width="14" height="12" rx="3" fill="#3b82f6" />
            <circle cx="32" cy="11" r="2.5" fill="#ffffff" />
            <circle cx="33" cy="11" r="1.2" fill="#0f172a" />
            <rect x="18" y="20" width="8" height="10" rx="2" fill="#dbeafe" />
            <rect x="30" y="15" width="6" height="2" fill={isTalking ? "#ef4444" : "#1d4ed8"} />
            <rect x="16" y="32" width="6" height="8" rx="2" fill="#2563eb" />
            <rect x="26" y="32" width="6" height="8" rx="2" fill="#1d4ed8" />
            <polygon points="14,24 6,28 14,30" fill="#3b82f6" />
            <polygon points="12,14 10,12 14,12" fill="#38bdf8" />
            <polygon points="12,18 10,16 14,16" fill="#38bdf8" />
          </svg>
        );
      case "dino-red":
        return (
          <svg className="w-12 h-12 filter drop-shadow-md transition-transform" viewBox="0 0 48 48">
            {/* Red Dino body */}
            <rect x="14" y="10" width="20" height="22" rx="4" fill="#f87171" />
            <rect x="24" y="6" width="14" height="12" rx="3" fill="#ef4444" />
            <circle cx="32" cy="11" r="2.5" fill="#ffffff" />
            <circle cx="33" cy="11" r="1.2" fill="#0f172a" />
            <rect x="18" y="20" width="8" height="10" rx="2" fill="#fee2e2" />
            <rect x="30" y="15" width="6" height="2" fill={isTalking ? "#f59e0b" : "#b91c1c"} />
            <rect x="16" y="32" width="6" height="8" rx="2" fill="#dc2626" />
            <rect x="26" y="32" width="6" height="8" rx="2" fill="#b91c1c" />
            <polygon points="14,24 6,28 14,30" fill="#ef4444" />
            <polygon points="12,14 10,12 14,12" fill="#fbbf24" />
            <polygon points="12,18 10,16 14,16" fill="#fbbf24" />
          </svg>
        );
      case "fox-amber":
        return (
          <svg className="w-12 h-12 filter drop-shadow-md" viewBox="0 0 48 48">
            <rect x="14" y="14" width="20" height="18" rx="4" fill="#fb923c" />
            <polygon points="14,14 12,6 20,12" fill="#ea580c" />
            <polygon points="34,14 36,6 28,12" fill="#ea580c" />
            <circle cx="20" cy="20" r="2" fill="#1e293b" />
            <circle cx="28" cy="20" r="2" fill="#1e293b" />
            <polygon points="24,24 22,26 26,26" fill="#1e293b" />
            <rect x="18" y="32" width="4" height="8" rx="2" fill="#c2410c" />
            <rect x="26" y="32" width="4" height="8" rx="2" fill="#c2410c" />
          </svg>
        );
      case "owl-violet":
        return (
          <svg className="w-12 h-12 filter drop-shadow-md" viewBox="0 0 48 48">
            <ellipse cx="24" cy="24" rx="14" ry="16" fill="#a855f7" />
            <circle cx="19" cy="20" r="4.5" fill="#f3e8ff" />
            <circle cx="29" cy="20" r="4.5" fill="#f3e8ff" />
            <circle cx="19" cy="20" r="2" fill="#3b0764" />
            <circle cx="29" cy="20" r="2" fill="#3b0764" />
            <polygon points="24,23 21,27 27,27" fill="#fbbf24" />
            <rect x="18" y="36" width="3" height="4" fill="#d97706" />
            <rect x="27" y="36" width="3" height="4" fill="#d97706" />
          </svg>
        );
      case "panda-emerald":
      default:
        return (
          <svg className="w-12 h-12 filter drop-shadow-md" viewBox="0 0 48 48">
            <ellipse cx="24" cy="25" rx="14" ry="15" fill="#f8fafc" />
            <circle cx="13" cy="13" r="4" fill="#1e293b" />
            <circle cx="35" cy="13" r="4" fill="#1e293b" />
            <ellipse cx="19" cy="21" rx="3.5" ry="4" fill="#1e293b" />
            <ellipse cx="29" cy="21" rx="3.5" ry="4" fill="#1e293b" />
            <circle cx="19" cy="20" r="1.5" fill="#ffffff" />
            <circle cx="29" cy="20" r="1.5" fill="#ffffff" />
            <ellipse cx="24" cy="26" rx="2" ry="1.5" fill="#0f172a" />
            <rect x="17" y="36" width="4" height="6" rx="2" fill="#1e293b" />
            <rect x="27" y="36" width="4" height="6" rx="2" fill="#1e293b" />
          </svg>
        );
    }
  };

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border-2 border-emerald-600/30 shadow-2xl bg-[#5aa846] select-none">
      {/* 2D Meadow Viewport */}
      <div
        ref={containerRef}
        onClick={handleMeadowClick}
        style={{ aspectRatio: `${WORLD_WIDTH} / ${WORLD_HEIGHT}` }}
        className="relative w-full cursor-crosshair overflow-hidden"
      >
        {/* Meadow Ground Texture */}
        <div
          className="absolute inset-0 bg-[#5ca846]"
          style={{
            backgroundImage: `
              radial-gradient(circle, rgba(255,255,255,0.08) 1px, transparent 1px),
              radial-gradient(circle, rgba(0,0,0,0.04) 1px, transparent 1px)
            `,
            backgroundSize: "28px 28px, 56px 56px",
          }}
        />

        {/* Garden Path (horizontal stepping stones) */}
        <div className="absolute top-[48%] left-0 right-0 h-14 bg-[#d4b483]/30 pointer-events-none transform -skew-y-1 border-y border-[#c29f6d]/40" />

        {/* Campfire / Gazebo Circle */}
        <div className="absolute top-[68%] left-[22%] w-24 h-24 rounded-full border-4 border-dashed border-amber-800/40 bg-amber-900/10 flex items-center justify-center pointer-events-none">
          <div className="w-10 h-10 rounded-full bg-amber-600/30 flex items-center justify-center animate-pulse">
            <span className="text-xl">🪵</span>
          </div>
        </div>

        {/* Trees & Meadow Props (like in the LiveKit screenshot) */}
        <div className="absolute top-[8%] right-[16%] flex flex-col items-center pointer-events-none">
          <div className="w-20 h-24 rounded-full bg-emerald-700/90 shadow-lg border-4 border-emerald-800/40 relative">
            <div className="absolute top-3 left-4 w-6 h-6 rounded-full bg-emerald-500/40" />
          </div>
          <div className="w-4 h-6 bg-amber-950/80 -mt-1 rounded-sm" />
        </div>

        <div className="absolute bottom-[10%] left-[8%] flex flex-col items-center pointer-events-none">
          <div className="w-16 h-20 rounded-full bg-emerald-800/90 shadow-md border-2 border-emerald-900/50" />
          <div className="w-3 h-5 bg-amber-950/80 -mt-1" />
        </div>

        <div className="absolute bottom-[12%] right-[6%] flex flex-col items-center pointer-events-none">
          <div className="w-16 h-20 rounded-full bg-emerald-700/80 shadow-md border-2 border-emerald-900/40" />
          <div className="w-3 h-5 bg-amber-950/80 -mt-1" />
        </div>

        {/* Wooden Fence Line on the right (screenshot matching) */}
        <div className="absolute top-0 bottom-0 right-[28%] w-2 flex flex-col justify-between py-2 pointer-events-none">
          {Array.from({ length: 14 }).map((_, i) => (
            <div key={i} className="w-2 h-7 bg-amber-800/70 rounded-xs shadow-xs" />
          ))}
        </div>

        {/* Flowers / Bushes scattered */}
        <div className="absolute top-[25%] left-[12%] text-lg pointer-events-none">🌸</div>
        <div className="absolute top-[80%] left-[55%] text-lg pointer-events-none">🌼</div>
        <div className="absolute top-[35%] right-[40%] text-lg pointer-events-none">🌿</div>
        <div className="absolute top-[75%] left-[82%] text-lg pointer-events-none">🍄</div>
        <div className="absolute top-[18%] left-[62%] text-lg pointer-events-none">🍃</div>

        {/* Ambient Radio / Speaker Object ("Neil's Speaker") */}
        <div
          onClick={(e) => {
            e.stopPropagation();
            onToggleSpeaker?.();
          }}
          style={{
            left: `${(speakerPos.x / WORLD_WIDTH) * 100}%`,
            top: `${(speakerPos.y / WORLD_HEIGHT) * 100}%`,
          }}
          className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer z-10 group"
          title="Mindful AU Zen Meadow Speaker (Click to toggle peaceful ambiance)"
        >
          <div className="flex flex-col items-center">
            <span className="text-[11px] font-semibold text-slate-800 bg-white/70 px-2 py-0.5 rounded-full shadow-xs mb-1 backdrop-blur-xs flex items-center gap-1 group-hover:scale-105 transition-transform">
              <Radio className="w-3 h-3 text-emerald-700" />
              Zen Radio
              {isSpeakerPlaying && (
                <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-600 animate-ping" />
              )}
            </span>
            <div
              className={`p-2.5 rounded-xl border-2 transition-all shadow-md flex items-center justify-center ${
                isSpeakerPlaying
                  ? "bg-slate-900 border-emerald-400 text-emerald-400 scale-105 animate-pulse"
                  : "bg-slate-800 border-slate-700 text-slate-300 hover:scale-105"
              }`}
            >
              <Volume2 className="w-6 h-6" />
            </div>
            {isSpeakerPlaying && (
              <span className="text-[9px] text-emerald-950 font-medium mt-0.5 animate-bounce">
                🎵 Spatial 3D sound on
              </span>
            )}
          </div>
        </div>

        {/* Proximity / Hearing Range Circle (Around Local Participant) */}
        <div
          style={{
            left: `${(localParticipant.x / WORLD_WIDTH) * 100}%`,
            top: `${(localParticipant.y / WORLD_HEIGHT) * 100}%`,
            width: `${((maxHearableDistance * 2) / WORLD_WIDTH) * 100}%`,
            height: `${((maxHearableDistance * 2) / WORLD_HEIGHT) * 100}%`,
          }}
          className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-emerald-300/40 bg-emerald-400/10 pointer-events-none transition-all duration-150 ease-out z-5"
        >
          {/* Subtle inner pulse */}
          <div className="w-full h-full rounded-full bg-emerald-300/5 animate-pulse" />
        </div>

        {/* Click indicator ripple */}
        {clickIndicator && (
          <div
            style={{ left: clickIndicator.x, top: clickIndicator.y }}
            className="absolute -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full border-2 border-emerald-200 bg-white/30 pointer-events-none animate-ping z-20"
          />
        )}

        {/* Remote Participants */}
        {participants
          .filter((p) => p.id !== localParticipant.id)
          .map((peer) => {
            const dx = peer.x - localParticipant.x;
            const dy = peer.y - localParticipant.y;
            const distance = Math.hypot(dx, dy);
            const inRange = distance <= maxHearableDistance;

            return (
              <div
                key={peer.id}
                style={{
                  left: `${(peer.x / WORLD_WIDTH) * 100}%`,
                  top: `${(peer.y / WORLD_HEIGHT) * 100}%`,
                }}
                className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none transition-all duration-300 ease-out z-10"
              >
                {/* Speech Bubble */}
                {peer.speechText && (
                  <div className="absolute -top-12 bg-white text-slate-800 text-xs font-medium px-3 py-1.5 rounded-2xl shadow-lg border border-slate-200 whitespace-nowrap animate-in fade-in slide-in-from-bottom-2 duration-200 z-30 flex items-center gap-1">
                    <span>{peer.speechText}</span>
                    <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white rotate-45 border-r border-b border-slate-200" />
                  </div>
                )}

                {/* Reaction Emoji */}
                {peer.reactionEmoji && (
                  <div className="absolute -top-14 text-2xl animate-bounce z-40">
                    {peer.reactionEmoji}
                  </div>
                )}

                {/* Participant Name Tag */}
                <div
                  className={`text-[11px] font-bold px-2 py-0.5 rounded-full shadow-xs mb-1 whitespace-nowrap flex items-center gap-1 border ${
                    inRange
                      ? "bg-slate-900/80 text-emerald-300 border-emerald-400/40"
                      : "bg-slate-800/60 text-slate-300 border-slate-700/30"
                  }`}
                >
                  <span>{peer.name}</span>
                  {inRange && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="Audible in 3D" />
                  )}
                  {peer.isTalking && (
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                  )}
                </div>

                {/* Avatar Sprite */}
                <div
                  className={`relative ${
                    peer.isTalking ? "scale-110 drop-shadow-[0_0_12px_rgba(34,197,94,0.6)]" : ""
                  } ${!inRange ? "opacity-80" : "opacity-100"}`}
                >
                  {renderAvatarSprite(peer.avatar, peer.isTalking, false)}
                </div>
              </div>
            );
          })}

        {/* Local Participant Avatar */}
        <div
          style={{
            left: `${(localParticipant.x / WORLD_WIDTH) * 100}%`,
            top: `${(localParticipant.y / WORLD_HEIGHT) * 100}%`,
          }}
          className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none transition-all duration-75 ease-out z-20"
        >
          {/* Local Speech Bubble */}
          {localParticipant.speechText && (
            <div className="absolute -top-12 bg-emerald-950 text-white text-xs font-semibold px-3 py-1.5 rounded-2xl shadow-xl border border-emerald-500 whitespace-nowrap animate-in fade-in slide-in-from-bottom-2 duration-200 z-30">
              <span>{localParticipant.speechText}</span>
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-emerald-950 rotate-45 border-r border-b border-emerald-500" />
            </div>
          )}

          {/* Local Reaction Emoji */}
          {localParticipant.reactionEmoji && (
            <div className="absolute -top-14 text-2xl animate-bounce z-40">
              {localParticipant.reactionEmoji}
            </div>
          )}

          {/* Local Highlighted Name Tag (Green, matching screenshot "Neil") */}
          <div className="text-[11px] font-extrabold px-2.5 py-0.5 rounded-full shadow-md mb-1 whitespace-nowrap bg-emerald-500 text-slate-950 border border-emerald-300 flex items-center gap-1">
            <span>{localParticipant.name} (You)</span>
            {localParticipant.isTalking && (
              <span className="w-2 h-2 rounded-full bg-white animate-ping" />
            )}
          </div>

          {/* Local Sprite */}
          <div
            className={`relative ${
              localParticipant.isTalking
                ? "scale-110 drop-shadow-[0_0_16px_rgba(74,222,128,0.9)]"
                : "drop-shadow-[0_4px_8px_rgba(0,0,0,0.3)]"
            }`}
          >
            {renderAvatarSprite(localParticipant.avatar, localParticipant.isTalking, true)}
          </div>
        </div>

        {/* Floating global reactions */}
        {floatingReactions.map((fr) => (
          <div
            key={fr.id}
            style={{ left: `${(fr.x / WORLD_WIDTH) * 100}%`, top: `${(fr.y / WORLD_HEIGHT) * 100}%` }}
            className="absolute text-3xl pointer-events-none animate-float-fade z-30"
          >
            {fr.emoji}
          </div>
        ))}
      </div>

      {/* Movement helper bar overlay */}
      <div className="absolute top-3 left-3 bg-slate-950/70 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 text-[11px] text-white flex items-center gap-2 pointer-events-none shadow-md">
        <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
        <span>Use <b>WASD</b>, <b>Arrow keys</b>, or <b>Click</b> to walk. Proximity connects your voice!</span>
      </div>
    </div>
  );
};
