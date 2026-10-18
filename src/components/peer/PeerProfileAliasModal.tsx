import React, { useState } from "react";
import { AvatarStyle } from "@/types/spatialLounge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { User, Sparkles } from "lucide-react";

interface PeerProfileAliasModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentName: string;
  currentAvatar: AvatarStyle;
  onSave: (newName: string, newAvatar: AvatarStyle) => void;
}

const AVATAR_OPTIONS: Array<{ id: AvatarStyle; label: string; desc: string; color: string }> = [
  { id: "dino-green", label: "Green Dino", desc: "Friendly & Calm", color: "bg-emerald-500/20 border-emerald-500" },
  { id: "dino-blue", label: "Blue Dino", desc: "Cool & Focused", color: "bg-blue-500/20 border-blue-500" },
  { id: "dino-red", label: "Red Dino", desc: "Energetic & Bold", color: "bg-red-500/20 border-red-500" },
  { id: "fox-amber", label: "Amber Fox", desc: "Clever & Warm", color: "bg-amber-500/20 border-amber-500" },
  { id: "owl-violet", label: "Violet Owl", desc: "Wise & Attentive", color: "bg-purple-500/20 border-purple-500" },
  { id: "panda-emerald", label: "Zen Panda", desc: "Peaceful & Grounded", color: "bg-teal-500/20 border-teal-500" },
];

export const PeerProfileAliasModal: React.FC<PeerProfileAliasModalProps> = ({
  isOpen,
  onClose,
  currentName,
  currentAvatar,
  onSave,
}) => {
  const [name, setName] = useState(currentName);
  const [selectedAvatar, setSelectedAvatar] = useState<AvatarStyle>(currentAvatar);

  const handleSave = () => {
    const trimmed = name.trim();
    if (trimmed) {
      onSave(trimmed, selectedAvatar);
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[460px] bg-slate-950 border border-emerald-500/30 text-white shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2 text-emerald-400">
            <Sparkles className="w-5 h-5 text-emerald-400" />
            Customize Spatial Lounge Avatar
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-3">
          {/* Display Name Input */}
          <div className="space-y-2">
            <Label htmlFor="alias" className="text-xs font-semibold text-slate-300">
              Display Name or Peer Alias
            </Label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <Input
                id="alias"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your lounge display name"
                className="pl-9 bg-slate-900 border-slate-700 text-white text-sm"
              />
            </div>
            <p className="text-[11px] text-slate-400">
              Auto-filled from your authenticated session. You can change it anytime for comfort.
            </p>
          </div>

          {/* Avatar Character Style Selector */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-slate-300">
              Choose Avatar Character
            </Label>
            <div className="grid grid-cols-2 gap-2.5">
              {AVATAR_OPTIONS.map((opt) => {
                const isSelected = selectedAvatar === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSelectedAvatar(opt.id)}
                    className={`flex items-center gap-3 p-2.5 rounded-xl border text-left transition-all ${
                      isSelected
                        ? `${opt.color} ring-2 ring-emerald-400 shadow-md`
                        : "bg-slate-900/60 border-slate-800 hover:border-slate-700"
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center font-bold text-sm shrink-0">
                      {opt.id.startsWith("dino") ? "🦖" : opt.id.startsWith("fox") ? "🦊" : opt.id.startsWith("owl") ? "🦉" : "🐼"}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-white">{opt.label}</p>
                      <p className="text-[10px] text-slate-400">{opt.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={onClose} className="text-slate-400 hover:text-white">
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
          >
            Save & Enter Meadow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
