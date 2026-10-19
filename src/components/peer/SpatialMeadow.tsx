import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { AvatarStyle, FloatingReaction, LoungeParticipant } from "@/types/spatialLounge";
import { Radio, Volume2, Sparkles, Heart, Footprints, Music, Sun, CloudRain } from "lucide-react";

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
  maxHearableDistance = 450,
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

  // Handle keyboard movement (WASD or Arrow keys)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }

      const step = e.shiftKey ? 32 : 18;
      let newX = localParticipant.x;
      let newY = localParticipant.y;
      let moved = false;

      switch (e.key.toLowerCase()) {
        case "arrowup":
        case "w":
          newY = Math.max(60, newY - step);
          moved = true;
          break;
        case "arrowdown":
        case "s":
          newY = Math.min(WORLD_HEIGHT - 60, newY + step);
          moved = true;
          break;
        case "arrowleft":
        case "a":
          newX = Math.max(100, newX - step);
          moved = true;
          break;
        case "arrowright":
        case "d":
          newX = Math.min(WORLD_WIDTH - 100, newX + step);
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

  // Handle click / tap to move with smooth scaling
  const handleMeadowClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      const scaleX = WORLD_WIDTH / rect.width;
      const scaleY = WORLD_HEIGHT / rect.height;

      const targetX = Math.max(100, Math.min(WORLD_WIDTH - 100, clickX * scaleX));
      const targetY = Math.max(60, Math.min(WORLD_HEIGHT - 60, clickY * scaleY));

      setClickIndicator({ x: clickX, y: clickY });
      setTimeout(() => setClickIndicator(null), 800);

      onMove(targetX, targetY);
    },
    [onMove]
  );

  // Check if any partner is currently within proximity aura
  const isPartnerInRange = useMemo(() => {
    return participants.some((p) => {
      if (p.id === localParticipant.id) return false;
      const dist = Math.hypot(p.x - localParticipant.x, p.y - localParticipant.y);
      return dist <= maxHearableDistance;
    });
  }, [participants, localParticipant.id, localParticipant.x, localParticipant.y, maxHearableDistance]);

  // Render high-definition, super cute vector avatars
  const renderAvatarSprite = (avatar: AvatarStyle, isTalking: boolean, isLocal: boolean) => {
    switch (avatar) {
      case "dino-green":
        return (
          <div className="relative w-14 h-14 flex items-center justify-center">
            <svg className="w-14 h-14 filter drop-shadow-md" viewBox="0 0 64 64" fill="none">
              {/* Back Spikes */}
              <polygon points="18,18 12,14 18,12" fill="#fbbf24" />
              <polygon points="16,26 10,22 16,20" fill="#fbbf24" />
              <polygon points="16,34 10,30 16,28" fill="#fbbf24" />
              {/* Tail */}
              <path d="M18 36 C10 38, 8 46, 6 44 C8 38, 14 34, 18 32 Z" fill="#22c55e" />
              {/* Body */}
              <rect x="18" y="16" width="28" height="32" rx="12" fill="#4ade80" />
              {/* Soft Belly */}
              <ellipse cx="30" cy="34" rx="9" ry="11" fill="#bbf7d0" />
              {/* Head Crest */}
              <ellipse cx="36" cy="18" rx="14" ry="12" fill="#22c55e" />
              {/* Rosy Cheeks */}
              <circle cx="43" cy="24" r="2.5" fill="#f87171" opacity="0.65" />
              {/* Eye */}
              <ellipse cx="40" cy="16" rx="4" ry="4.5" fill="#ffffff" />
              <circle cx="42" cy="16" r="2.2" fill="#0f172a" />
              <circle cx="43" cy="15" r="0.9" fill="#ffffff" />
              {/* Friendly Mouth */}
              {isTalking ? (
                <ellipse cx="44" cy="22" rx="3" ry="2.5" fill="#ef4444" />
              ) : (
                <path d="M42 21 Q44 24 46 21" stroke="#15803d" strokeWidth="1.8" strokeLinecap="round" />
              )}
              {/* Cute Feet */}
              <rect x="22" y="44" width="8" height="6" rx="3" fill="#16a34a" />
              <rect x="34" y="44" width="8" height="6" rx="3" fill="#15803d" />
              {/* Tiny Hands */}
              <ellipse cx="38" cy="30" rx="3" ry="2" fill="#22c55e" />
            </svg>
          </div>
        );

      case "dino-blue":
        return (
          <div className="relative w-14 h-14 flex items-center justify-center">
            <svg className="w-14 h-14 filter drop-shadow-md" viewBox="0 0 64 64" fill="none">
              {/* Blue Spikes */}
              <polygon points="18,18 12,14 18,12" fill="#38bdf8" />
              <polygon points="16,26 10,22 16,20" fill="#38bdf8" />
              <polygon points="16,34 10,30 16,28" fill="#38bdf8" />
              {/* Tail */}
              <path d="M18 36 C10 38, 8 46, 6 44 C8 38, 14 34, 18 32 Z" fill="#3b82f6" />
              {/* Body */}
              <rect x="18" y="16" width="28" height="32" rx="12" fill="#60a5fa" />
              {/* Pastel Aqua Belly */}
              <ellipse cx="30" cy="34" rx="9" ry="11" fill="#dbeafe" />
              {/* Head Crest */}
              <ellipse cx="36" cy="18" rx="14" ry="12" fill="#3b82f6" />
              {/* Cheeks */}
              <circle cx="43" cy="24" r="2.5" fill="#fda4af" opacity="0.7" />
              {/* Eye */}
              <ellipse cx="40" cy="16" rx="4" ry="4.5" fill="#ffffff" />
              <circle cx="42" cy="16" r="2.2" fill="#0f172a" />
              <circle cx="43" cy="15" r="0.9" fill="#ffffff" />
              {/* Mouth */}
              {isTalking ? (
                <ellipse cx="44" cy="22" rx="3" ry="2.5" fill="#ef4444" />
              ) : (
                <path d="M42 21 Q44 24 46 21" stroke="#1d4ed8" strokeWidth="1.8" strokeLinecap="round" />
              )}
              {/* Cute Feet */}
              <rect x="22" y="44" width="8" height="6" rx="3" fill="#2563eb" />
              <rect x="34" y="44" width="8" height="6" rx="3" fill="#1d4ed8" />
              <ellipse cx="38" cy="30" rx="3" ry="2" fill="#3b82f6" />
            </svg>
          </div>
        );

      case "dino-red":
        return (
          <div className="relative w-14 h-14 flex items-center justify-center">
            <svg className="w-14 h-14 filter drop-shadow-md" viewBox="0 0 64 64" fill="none">
              {/* Golden Spikes */}
              <polygon points="18,18 12,14 18,12" fill="#fbbf24" />
              <polygon points="16,26 10,22 16,20" fill="#fbbf24" />
              <polygon points="16,34 10,30 16,28" fill="#fbbf24" />
              <path d="M18 36 C10 38, 8 46, 6 44 C8 38, 14 34, 18 32 Z" fill="#ef4444" />
              <rect x="18" y="16" width="28" height="32" rx="12" fill="#f87171" />
              <ellipse cx="30" cy="34" rx="9" ry="11" fill="#fee2e2" />
              <ellipse cx="36" cy="18" rx="14" ry="12" fill="#ef4444" />
              <circle cx="43" cy="24" r="2.5" fill="#fbcfe8" opacity="0.8" />
              <ellipse cx="40" cy="16" rx="4" ry="4.5" fill="#ffffff" />
              <circle cx="42" cy="16" r="2.2" fill="#0f172a" />
              <circle cx="43" cy="15" r="0.9" fill="#ffffff" />
              {isTalking ? (
                <ellipse cx="44" cy="22" rx="3" ry="2.5" fill="#f59e0b" />
              ) : (
                <path d="M42 21 Q44 24 46 21" stroke="#b91c1c" strokeWidth="1.8" strokeLinecap="round" />
              )}
              <rect x="22" y="44" width="8" height="6" rx="3" fill="#dc2626" />
              <rect x="34" y="44" width="8" height="6" rx="3" fill="#b91c1c" />
            </svg>
          </div>
        );

      case "fox-amber":
        return (
          <div className="relative w-14 h-14 flex items-center justify-center">
            <svg className="w-14 h-14 filter drop-shadow-md" viewBox="0 0 64 64" fill="none">
              {/* Fox Ears */}
              <polygon points="20,20 16,8 28,16" fill="#ea580c" />
              <polygon points="22,18 19,11 26,16" fill="#fed7aa" />
              <polygon points="44,20 48,8 36,16" fill="#ea580c" />
              <polygon points="42,18 45,11 38,16" fill="#fed7aa" />
              {/* Bushy Tail with White Tip */}
              <path d="M16 40 C6 38, 4 48, 8 52 C14 56, 18 48, 20 44 Z" fill="#ea580c" />
              <path d="M8 52 C6 50, 6 46, 8 44 C9 46, 11 48, 12 50 Z" fill="#ffffff" />
              {/* Head & Body */}
              <rect x="18" y="18" width="28" height="28" rx="12" fill="#fb923c" />
              <ellipse cx="32" cy="34" rx="9" ry="10" fill="#fff7ed" />
              {/* White muzzle cheeks */}
              <path d="M22 26 Q27 30 32 26 Q37 30 42 26 L32 35 Z" fill="#ffffff" />
              {/* Eyes */}
              <circle cx="26" cy="24" r="2.4" fill="#0f172a" />
              <circle cx="38" cy="24" r="2.4" fill="#0f172a" />
              <circle cx="27" cy="23" r="0.8" fill="#ffffff" />
              <circle cx="39" cy="23" r="0.8" fill="#ffffff" />
              {/* Cute nose */}
              <ellipse cx="32" cy="28" rx="2" ry="1.4" fill="#0f172a" />
              {isTalking && <ellipse cx="32" cy="32" rx="2.5" ry="2" fill="#ef4444" />}
              {/* Paws */}
              <rect x="22" y="44" width="7" height="6" rx="2.5" fill="#c2410c" />
              <rect x="35" y="44" width="7" height="6" rx="2.5" fill="#c2410c" />
            </svg>
          </div>
        );

      case "owl-violet":
        return (
          <div className="relative w-14 h-14 flex items-center justify-center">
            <svg className="w-14 h-14 filter drop-shadow-md" viewBox="0 0 64 64" fill="none">
              {/* Ear Tufts */}
              <polygon points="18,18 14,8 24,14" fill="#7e22ce" />
              <polygon points="46,18 50,8 40,14" fill="#7e22ce" />
              {/* Rounded Owl Body */}
              <ellipse cx="32" cy="32" rx="18" ry="20" fill="#a855f7" />
              {/* Wings */}
              <ellipse cx="16" cy="34" rx="5" ry="11" fill="#7e22ce" transform="rotate(-15 16 34)" />
              <ellipse cx="48" cy="34" rx="5" ry="11" fill="#7e22ce" transform="rotate(15 48 34)" />
              {/* Soft Belly with Crescent Feathers */}
              <ellipse cx="32" cy="37" rx="10" ry="12" fill="#f3e8ff" />
              <path d="M28 35 Q32 38 36 35" stroke="#9333ea" strokeWidth="1.5" fill="none" />
              <path d="M29 41 Q32 44 35 41" stroke="#9333ea" strokeWidth="1.5" fill="none" />
              {/* Big Wise Eyes */}
              <circle cx="25" cy="25" r="6" fill="#ffffff" />
              <circle cx="39" cy="25" r="6" fill="#ffffff" />
              <circle cx="26" cy="25" r="3.2" fill="#fbbf24" />
              <circle cx="38" cy="25" r="3.2" fill="#fbbf24" />
              <circle cx="26" cy="25" r="1.8" fill="#1e1b4b" />
              <circle cx="38" cy="25" r="1.8" fill="#1e1b4b" />
              {/* Beak */}
              <polygon points="32,27 29,32 35,32" fill="#f59e0b" />
              {/* Feet */}
              <rect x="25" y="50" width="5" height="4" rx="2" fill="#d97706" />
              <rect x="34" y="50" width="5" height="4" rx="2" fill="#d97706" />
            </svg>
          </div>
        );

      case "panda-emerald":
      default:
        return (
          <div className="relative w-14 h-14 flex items-center justify-center">
            <svg className="w-14 h-14 filter drop-shadow-md" viewBox="0 0 64 64" fill="none">
              {/* Ears */}
              <circle cx="19" cy="16" r="6.5" fill="#1e293b" />
              <circle cx="45" cy="16" r="6.5" fill="#1e293b" />
              {/* Body */}
              <ellipse cx="32" cy="34" rx="18" ry="19" fill="#ffffff" />
              {/* Black Vest / Shoulders */}
              <path d="M16 26 C20 32, 44 32, 48 26 C46 36, 18 36, 16 26 Z" fill="#1e293b" />
              {/* Dark Eye Patches */}
              <ellipse cx="24" cy="26" rx="5.5" ry="6.5" fill="#1e293b" transform="rotate(-15 24 26)" />
              <ellipse cx="40" cy="26" rx="5.5" ry="6.5" fill="#1e293b" transform="rotate(15 40 26)" />
              {/* Shiny Eyes */}
              <circle cx="25" cy="25" r="2.2" fill="#ffffff" />
              <circle cx="39" cy="25" r="2.2" fill="#ffffff" />
              <circle cx="25.5" cy="24.5" r="1.2" fill="#0f172a" />
              <circle cx="38.5" cy="24.5" r="1.2" fill="#0f172a" />
              {/* Nose & Mouth */}
              <ellipse cx="32" cy="31" rx="2.2" ry="1.5" fill="#0f172a" />
              {isTalking ? (
                <ellipse cx="32" cy="35" rx="2.5" ry="2" fill="#ef4444" />
              ) : (
                <path d="M30 33 Q32 35 34 33" stroke="#0f172a" strokeWidth="1.5" strokeLinecap="round" />
              )}
              {/* Rosy Cheeks */}
              <circle cx="20" cy="32" r="2.2" fill="#fda4af" opacity="0.6" />
              <circle cx="44" cy="32" r="2.2" fill="#fda4af" opacity="0.6" />
              {/* Paws */}
              <rect x="23" y="49" width="6" height="5" rx="2.5" fill="#1e293b" />
              <rect x="35" y="49" width="6" height="5" rx="2.5" fill="#1e293b" />
            </svg>
          </div>
        );
    }
  };

  return (
    <div className="relative w-full overflow-hidden rounded-3xl border-2 border-emerald-500/30 shadow-[0_20px_50px_rgba(0,0,0,0.5)] select-none">
      {/* 2D Meadow Canvas Viewport */}
      <div
        ref={containerRef}
        onClick={handleMeadowClick}
        style={{ aspectRatio: `${WORLD_WIDTH} / ${WORLD_HEIGHT}` }}
        className="relative w-full cursor-crosshair overflow-hidden"
      >
        {/* ======================================================== */}
        {/* Layer 1: Lush Painterly Ground Canvas with Rolling Hills */}
        {/* ======================================================== */}
        <div
          className="absolute inset-0"
          style={{
            background: "radial-gradient(ellipse at 50% 30%, #52b756 0%, #46a34a 45%, #388e3c 100%)",
          }}
        />

        {/* Ambient Sunlight Glow in top center */}
        <div
          className="absolute -top-24 left-1/2 -translate-x-1/2 w-[700px] h-[350px] rounded-full pointer-events-none opacity-40 blur-3xl"
          style={{
            background: "radial-gradient(circle, rgba(254,240,138,0.45) 0%, rgba(134,239,172,0.15) 60%, transparent 100%)",
          }}
        />

        {/* Soft grass texture overlay */}
        <div
          className="absolute inset-0 opacity-15 pointer-events-none"
          style={{
            backgroundImage: `
              radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px),
              radial-gradient(circle, rgba(20,83,45,0.5) 1.5px, transparent 1.5px)
            `,
            backgroundSize: "32px 32px, 64px 64px",
          }}
        />

        {/* Rolling Hill Contours (Gentle organic depth) */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-30" viewBox="0 0 1000 650" preserveAspectRatio="none">
          <path d="M0,180 Q300,140 600,190 T1000,160 L1000,0 L0,0 Z" fill="#60c365" />
          <path d="M0,480 Q250,520 550,470 T1000,510 L1000,650 L0,650 Z" fill="#2e7d32" opacity="0.4" />
        </svg>

        {/* ======================================================== */}
        {/* Layer 2: Cobblestone Path & Zen Lotus Pond */}
        {/* ======================================================== */}
        {/* Winding Curved River Pebble Path */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 1000 650" preserveAspectRatio="none">
          {/* Path Shadow / Bed */}
          <path
            d="M-20,380 C180,390 320,340 480,350 C650,360 820,310 1020,330"
            fill="none"
            stroke="#a68453"
            strokeWidth="38"
            strokeLinecap="round"
            opacity="0.35"
          />
          {/* Main Cobblestone Path */}
          <path
            d="M-20,380 C180,390 320,340 480,350 C650,360 820,310 1020,330"
            fill="none"
            stroke="#dfcaa3"
            strokeWidth="32"
            strokeLinecap="round"
            strokeDasharray="18, 8"
            opacity="0.9"
          />
          {/* River Pebble Highlights */}
          <path
            d="M-20,380 C180,390 320,340 480,350 C650,360 820,310 1020,330"
            fill="none"
            stroke="#fef3c7"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray="6, 26"
            opacity="0.85"
          />
        </svg>

        {/* Tranquil Zen Lotus Pond (Bottom Right) */}
        <div className="absolute bottom-6 right-8 w-64 h-44 pointer-events-none">
          {/* Pond Shore Border Stones */}
          <div className="absolute inset-0 rounded-[48%] bg-[#6c8672]/60 blur-[1px] transform rotate-3" />
          <div className="absolute inset-1.5 rounded-[46%] bg-[#84a98c]/80" />
          {/* Deep Crystal Water */}
          <div
            className="absolute inset-3 rounded-[44%] shadow-inner overflow-hidden"
            style={{
              background: "radial-gradient(ellipse at 50% 50%, #38bdf8 0%, #0284c7 60%, #0369a1 100%)",
            }}
          >
            {/* Shimmering Water Ripples */}
            <div className="absolute inset-0 opacity-40 animate-pulse bg-[radial-gradient(circle_at_40%_40%,rgba(255,255,255,0.7)_0%,transparent_60%)]" />
            
            {/* Lily Pads & Lotus Blossoms */}
            <div className="absolute top-4 left-6 w-8 h-8 rounded-full bg-emerald-600 border border-emerald-400 flex items-center justify-center shadow-xs">
              <span className="text-[10px]">🌸</span>
            </div>
            <div className="absolute bottom-6 left-16 w-10 h-10 rounded-full bg-emerald-500 border border-emerald-300 flex items-center justify-center shadow-xs">
              <span className="text-xs">🌺</span>
            </div>
            <div className="absolute top-8 right-10 w-7 h-7 rounded-full bg-emerald-600 border border-emerald-400 flex items-center justify-center shadow-xs">
              <span className="text-[9px]">🌸</span>
            </div>
            {/* Playful Swimming Koi Silhouette */}
            <div className="absolute bottom-4 right-14 text-sm opacity-70 animate-bounce">
              🐟
            </div>
          </div>
        </div>

        {/* ======================================================== */}
        {/* Layer 3: Cozy Heart-to-Heart Landmarks */}
        {/* ======================================================== */}
        {/* Cozy Campfire Sanctuary (Left Meadow) */}
        <div className="absolute top-[62%] left-[16%] flex flex-col items-center pointer-events-none select-none">
          {/* Warm Ambient Radial Firelight */}
          <div
            className="absolute -top-12 -left-12 w-48 h-48 rounded-full opacity-35 blur-xl pointer-events-none animate-pulse"
            style={{
              background: "radial-gradient(circle, rgba(245,158,11,0.6) 0%, rgba(239,68,68,0.2) 60%, transparent 100%)",
            }}
          />
          {/* Stone Ring */}
          <div className="w-24 h-20 rounded-full border-4 border-slate-600/60 bg-amber-950/40 shadow-xl flex items-center justify-center relative">
            {/* Charcoal / Embers */}
            <div className="w-14 h-12 rounded-full bg-amber-950/80 flex items-center justify-center relative overflow-hidden">
              <div className="w-8 h-8 rounded-full bg-amber-600/50 animate-ping opacity-60" />
              {/* Dancing Flame */}
              <span className="text-2xl z-10 animate-bounce drop-shadow-[0_0_8px_rgba(245,158,11,0.9)]">
                🔥
              </span>
            </div>
          </div>
          {/* Cozy Log Benches */}
          <div className="absolute -top-3 w-16 h-4 rounded-md bg-amber-900 border border-amber-950 shadow-md transform -rotate-6" />
          <div className="absolute -bottom-3 w-16 h-4 rounded-md bg-amber-900 border border-amber-950 shadow-md transform rotate-6" />
        </div>

        {/* Sakura / Cherry Blossom Tree (Top Right) */}
        <div className="absolute top-[6%] right-[14%] flex flex-col items-center pointer-events-none select-none">
          {/* Ground Tree Shadow */}
          <div className="w-24 h-6 bg-black/20 rounded-full blur-[2px] translate-y-28 translate-x-2" />
          {/* Fluffy Sakura Canopy */}
          <div className="relative z-10 flex flex-col items-center">
            {/* Cloud clusters of cherry blossoms */}
            <div className="relative w-28 h-24">
              <div className="absolute top-0 left-2 w-18 h-18 rounded-full bg-pink-300 shadow-md border-2 border-pink-200/80" />
              <div className="absolute top-2 right-1 w-16 h-16 rounded-full bg-pink-400 shadow-md border-2 border-pink-300/80" />
              <div className="absolute top-6 left-6 w-20 h-16 rounded-full bg-rose-300 shadow-md border-2 border-rose-200" />
              <div className="absolute top-3 left-10 text-xs opacity-90 animate-pulse">🌸</div>
              <div className="absolute top-10 right-4 text-xs opacity-90 animate-pulse">🌸</div>
            </div>
            {/* Slender Organic Trunk */}
            <div className="w-5 h-10 bg-amber-950 -mt-3 rounded-b-md shadow-xs relative">
              <div className="absolute top-0 -left-2 w-3 h-2 bg-amber-950 rounded-full" />
              <div className="absolute top-2 -right-2 w-3 h-2 bg-amber-950 rounded-full" />
            </div>
          </div>
        </div>

        {/* Ancient Shady Oak Tree (Bottom Left) */}
        <div className="absolute bottom-[8%] left-[6%] flex flex-col items-center pointer-events-none select-none">
          <div className="w-24 h-6 bg-black/20 rounded-full blur-[2px] translate-y-26" />
          <div className="relative z-10 flex flex-col items-center">
            <div className="relative w-26 h-22">
              <div className="absolute top-0 left-1 w-18 h-18 rounded-full bg-emerald-800 shadow-md border-2 border-emerald-700" />
              <div className="absolute top-2 right-1 w-16 h-16 rounded-full bg-emerald-700 shadow-md border-2 border-emerald-600" />
              <div className="absolute top-5 left-5 w-20 h-16 rounded-full bg-green-800 shadow-md border-2 border-green-700" />
              {/* Apple / Leaf highlight */}
              <span className="absolute top-4 left-8 text-xs">🍃</span>
            </div>
            <div className="w-6 h-9 bg-amber-950 -mt-2 rounded-b-md shadow-xs" />
          </div>
        </div>

        {/* Cozy Picnic Mat & Teapot Nook (Under Sakura Tree) */}
        <div className="absolute top-[28%] right-[22%] pointer-events-none flex items-center justify-center">
          <div className="w-16 h-12 rounded-lg bg-red-400/80 border border-red-300 shadow-md flex items-center justify-around px-1 transform -rotate-3">
            <span className="text-xs">🫖</span>
            <span className="text-xs">🍵</span>
          </div>
        </div>

        {/* Woodland Flower Clusters & Mushrooms */}
        <div className="absolute top-[20%] left-[10%] text-base pointer-events-none drop-shadow-xs">🌼</div>
        <div className="absolute top-[24%] left-[13%] text-xs pointer-events-none">🌸</div>
        <div className="absolute top-[78%] left-[44%] text-base pointer-events-none drop-shadow-xs">🍄</div>
        <div className="absolute top-[82%] left-[47%] text-xs pointer-events-none">🍄</div>
        <div className="absolute top-[42%] right-[42%] text-base pointer-events-none drop-shadow-xs">🌷</div>
        <div className="absolute top-[38%] right-[39%] text-sm pointer-events-none">🌾</div>
        <div className="absolute top-[15%] left-[54%] text-base pointer-events-none drop-shadow-xs">🌻</div>
        <div className="absolute bottom-[28%] left-[30%] text-sm pointer-events-none">🌿</div>

        {/* Handcrafted Wooden Trail Marker Signpost */}
        <div className="absolute top-[40%] left-[32%] pointer-events-none flex flex-col items-center">
          <div className="bg-amber-900 border border-amber-950 text-amber-100 text-[9px] font-bold px-2 py-0.5 rounded-sm shadow-md whitespace-nowrap transform -rotate-2">
            Meadow Sanctuary 🌿
          </div>
          <div className="w-1.5 h-6 bg-amber-950 -mt-0.5" />
        </div>

        {/* Floating Glowing Fireflies / Fairy Dust Particles */}
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={`firefly-${i}`}
            style={{
              top: `${15 + (i * 11) % 70}%`,
              left: `${8 + (i * 13) % 84}%`,
              animationDelay: `${i * 0.7}s`,
            }}
            className="absolute w-2 h-2 rounded-full bg-yellow-300/80 shadow-[0_0_8px_rgba(253,224,71,0.9)] pointer-events-none animate-ping"
          />
        ))}

        {/* ======================================================== */}
        {/* Layer 4: Zen Gramophone / Radio Speaker Station          */}
        {/* ======================================================== */}
        <div
          onClick={(e) => {
            e.stopPropagation();
            onToggleSpeaker?.();
          }}
          style={{
            left: `${(speakerPos.x / WORLD_WIDTH) * 100}%`,
            top: `${(speakerPos.y / WORLD_HEIGHT) * 100}%`,
          }}
          className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer z-15 group transition-transform hover:scale-105"
          title="Mindful AU Zen Meadow Gramophone (Click to toggle peaceful ambiance)"
        >
          {/* Ground Boulder Shadow */}
          <div className="w-16 h-5 bg-black/25 rounded-full blur-[2px] translate-y-10" />

          <div className="flex flex-col items-center relative">
            {/* Musical notes floating upwards when playing */}
            {isSpeakerPlaying && (
              <div className="absolute -top-7 flex items-center gap-1.5 text-xs animate-bounce pointer-events-none">
                <span className="text-amber-300 drop-shadow-sm">♪</span>
                <span className="text-emerald-300 drop-shadow-sm text-sm">♫</span>
                <span className="text-yellow-200 drop-shadow-sm">🎵</span>
              </div>
            )}

            {/* Pill Label */}
            <span className="text-[10px] font-bold text-slate-800 bg-white/90 px-2 py-0.5 rounded-full shadow-md mb-1.5 backdrop-blur-md flex items-center gap-1 border border-white/40">
              <Radio className="w-3 h-3 text-emerald-600" />
              Zen Radio
              {isSpeakerPlaying && (
                <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
              )}
            </span>

            {/* Charming Forest Lantern Speaker Housing */}
            <div
              className={`w-12 h-12 rounded-2xl border-2 transition-all shadow-xl flex items-center justify-center relative ${
                isSpeakerPlaying
                  ? "bg-gradient-to-br from-emerald-600 to-teal-800 border-emerald-300 text-white ring-4 ring-emerald-400/30 animate-pulse"
                  : "bg-gradient-to-br from-amber-900 to-amber-950 border-amber-700/80 text-amber-200 hover:border-amber-500"
              }`}
            >
              <Volume2 className="w-5 h-5 drop-shadow-sm" />
            </div>

            {/* Mossy stone base */}
            <div className="w-14 h-3 rounded-full bg-slate-700/80 border border-slate-600 -mt-1" />
          </div>
        </div>

        {/* ======================================================== */}
        {/* Layer 5: Luminous Spatial Proximity Hearing Aura         */}
        {/* ======================================================== */}
        <div
          style={{
            left: `${(localParticipant.x / WORLD_WIDTH) * 100}%`,
            top: `${(localParticipant.y / WORLD_HEIGHT) * 100}%`,
            width: `${((maxHearableDistance * 2) / WORLD_WIDTH) * 100}%`,
            height: `${((maxHearableDistance * 2) / WORLD_HEIGHT) * 100}%`,
          }}
          className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none transition-all duration-300 ease-out z-8 ${
            isPartnerInRange
              ? "border-2 border-emerald-400/70 shadow-[0_0_30px_rgba(52,211,153,0.35)]"
              : "border-2 border-dashed border-emerald-300/40"
          }`}
        >
          {/* Radial Aura Fill */}
          <div
            className="w-full h-full rounded-full transition-opacity duration-300"
            style={{
              background: isPartnerInRange
                ? "radial-gradient(circle, rgba(52,211,153,0.22) 0%, rgba(16,185,129,0.08) 60%, rgba(5,150,105,0.01) 85%, transparent 100%)"
                : "radial-gradient(circle, rgba(52,211,153,0.12) 0%, rgba(16,185,129,0.04) 65%, transparent 100%)",
            }}
          />
        </div>

        {/* Click indicator ripple animation */}
        {clickIndicator && (
          <div
            style={{ left: clickIndicator.x, top: clickIndicator.y }}
            className="absolute -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full border-2 border-emerald-200 bg-white/40 pointer-events-none animate-ping z-25"
          />
        )}

        {/* ======================================================== */}
        {/* Layer 6: Remote Participants                             */}
        {/* ======================================================== */}
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
                className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none transition-[left,top] duration-200 ease-out z-20"
              >
                {/* Speech Bubble */}
                {peer.speechText && (
                  <div className="absolute -top-14 bg-white/95 backdrop-blur-md text-slate-800 text-xs font-semibold px-3 py-1.5 rounded-2xl shadow-xl border border-slate-200 whitespace-nowrap animate-in fade-in slide-in-from-bottom-2 duration-200 z-40 flex items-center gap-1.5">
                    <span>{peer.speechText}</span>
                    <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-white/95 rotate-45 border-r border-b border-slate-200" />
                  </div>
                )}

                {/* Reaction Emoji */}
                {peer.reactionEmoji && (
                  <div className="absolute -top-16 text-3xl animate-bounce z-40">
                    {peer.reactionEmoji}
                  </div>
                )}

                {/* Participant Name Tag Pill with Glowing Speaking Indicator */}
                <div
                  className={`text-[11px] font-extrabold px-3 py-1 rounded-full whitespace-nowrap flex items-center gap-1.5 border select-none transition-all duration-200 ${
                    peer.isTalking
                      ? "bg-gradient-to-r from-emerald-400 via-green-300 to-emerald-400 text-slate-950 border-white shadow-[0_0_20px_rgba(52,211,153,1),0_0_38px_rgba(34,197,94,0.7)] ring-2 ring-emerald-300 animate-pulse scale-105"
                      : inRange
                      ? "bg-slate-900/90 text-emerald-300 border-emerald-400/50 shadow-emerald-500/10 shadow-md"
                      : "bg-slate-900/70 text-slate-400 border-slate-700/40 shadow-sm"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      peer.isTalking ? "bg-slate-950" : "bg-emerald-400"
                    }`}
                  />
                  <span>{peer.name}</span>
                  <span
                    className={`text-[9px] font-normal uppercase tracking-wider ${
                      peer.isTalking ? "text-slate-800 font-bold" : "text-slate-400"
                    }`}
                  >
                    {peer.role === "peer_counselor" ? "Counselor" : "Student"}
                  </span>
                  {peer.isTalking && (
                    <span className="flex items-center gap-0.5 ml-1 text-slate-950">
                      <span className="w-1 h-2.5 bg-slate-950 rounded-full animate-bounce [animation-delay:-0.3s]" />
                      <span className="w-1 h-3.5 bg-slate-950 rounded-full animate-bounce [animation-delay:-0.15s]" />
                      <span className="w-1 h-2 bg-slate-950 rounded-full animate-bounce" />
                    </span>
                  )}
                </div>

                {/* Avatar Sprite and Ground Shadow Container */}
                <div className="relative mt-0.5">
                  <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-11 h-3.5 bg-black/25 rounded-full blur-[1.5px] pointer-events-none" />
                  <div
                    className={`relative transition-transform duration-200 ${
                      peer.isTalking
                        ? "scale-110 drop-shadow-[0_0_16px_rgba(34,197,94,0.7)]"
                        : "drop-shadow-[0_4px_10px_rgba(0,0,0,0.3)]"
                    } ${!inRange ? "opacity-85" : "opacity-100"}`}
                  >
                    {renderAvatarSprite(peer.avatar, peer.isTalking, false)}
                  </div>
                </div>
              </div>
            );
          })}

        {/* ======================================================== */}
        {/* Layer 7: Local User Avatar                               */}
        {/* ======================================================== */}
        <div
          style={{
            left: `${(localParticipant.x / WORLD_WIDTH) * 100}%`,
            top: `${(localParticipant.y / WORLD_HEIGHT) * 100}%`,
          }}
          className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none transition-[left,top] duration-100 ease-out z-30"
        >
          {/* Local Speech Bubble */}
          {localParticipant.speechText && (
            <div className="absolute -top-14 bg-emerald-950/95 backdrop-blur-md text-white text-xs font-semibold px-3 py-1.5 rounded-2xl shadow-xl border border-emerald-500 whitespace-nowrap animate-in fade-in slide-in-from-bottom-2 duration-200 z-40">
              <span>{localParticipant.speechText}</span>
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-emerald-950/95 rotate-45 border-r border-b border-emerald-500" />
            </div>
          )}

          {/* Local Reaction Emoji */}
          {localParticipant.reactionEmoji && (
            <div className="absolute -top-16 text-3xl animate-bounce z-40">
              {localParticipant.reactionEmoji}
            </div>
          )}

          {/* Local Highlighted Name Tag with Glowing Speaking Indicator */}
          <div
            className={`text-[11px] font-extrabold px-3.5 py-1 rounded-full whitespace-nowrap flex items-center gap-1.5 border select-none transition-all duration-200 ${
              localParticipant.isTalking
                ? "bg-gradient-to-r from-emerald-400 via-green-300 to-emerald-400 text-slate-950 border-white shadow-[0_0_22px_rgba(52,211,153,1),0_0_42px_rgba(34,197,94,0.75)] ring-2 ring-emerald-300 animate-pulse scale-105"
                : "bg-emerald-500 text-slate-950 border-emerald-300 shadow-md"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full transition-colors ${
                localParticipant.isTalking ? "bg-slate-950" : "bg-slate-950/80"
              }`}
            />
            <span className="tracking-wide">{localParticipant.name} (You)</span>
            {localParticipant.isTalking && (
              <span className="flex items-center gap-0.5 ml-1 text-slate-950">
                <span className="w-1 h-2.5 bg-slate-950 rounded-full animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1 h-3.5 bg-slate-950 rounded-full animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1 h-2 bg-slate-950 rounded-full animate-bounce" />
              </span>
            )}
          </div>

          {/* Local Avatar Sprite and Ground Shadow Container */}
          <div className="relative mt-0.5">
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-12 h-3.5 bg-black/25 rounded-full blur-[1.5px] pointer-events-none" />
            <div
              className={`relative transition-transform duration-200 ${
                localParticipant.isTalking
                  ? "scale-115 drop-shadow-[0_0_20px_rgba(74,222,128,0.95)]"
                  : "drop-shadow-[0_6px_12px_rgba(0,0,0,0.35)]"
              }`}
            >
              {renderAvatarSprite(localParticipant.avatar, localParticipant.isTalking, true)}
            </div>
          </div>
        </div>

        {/* Floating global reactions */}
        {floatingReactions.map((fr) => (
          <div
            key={fr.id}
            style={{ left: `${(fr.x / WORLD_WIDTH) * 100}%`, top: `${(fr.y / WORLD_HEIGHT) * 100}%` }}
            className="absolute text-4xl pointer-events-none animate-float-fade z-40 drop-shadow-md"
          >
            {fr.emoji}
          </div>
        ))}
      </div>

      {/* Movement & Proximity HUD Overlay (Top Left Pill) */}
      <div className="absolute top-3.5 left-3.5 bg-slate-950/80 backdrop-blur-md px-3.5 py-1.5 rounded-2xl border border-white/15 text-xs text-slate-200 flex items-center gap-2 pointer-events-none shadow-xl">
        <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
        <span>
          Walk with <b>WASD</b>, <b>Arrow keys</b>, or <b>Clicking</b> on the grass.
        </span>
      </div>

      {/* Atmospheric Meadow Mood Pill (Top Right Pill) */}
      <div className="absolute top-3.5 right-3.5 bg-slate-950/80 backdrop-blur-md px-3 py-1.5 rounded-2xl border border-white/15 text-xs text-emerald-300 flex items-center gap-1.5 pointer-events-none shadow-xl">
        <Sun className="w-3.5 h-3.5 text-amber-400 animate-spin-slow" />
        <span>Serene Sunlit Meadow</span>
      </div>
    </div>
  );
};

export default SpatialMeadow;
