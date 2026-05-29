import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Brain,
  Cloud,
  Heart,
  Home,
  Moon,
  Shield,
  Sparkles,
  Sun,
  Users,
  Waves,
} from "lucide-react";

/** Friendly emoji for scale / frequency labels (emotional, non-clinical). */
const OPTION_EMOJI: Record<string, string> = {
  Never: "😌",
  Rarely: "🙂",
  Sometimes: "😐",
  Often: "😔",
  "Almost always": "😟",
  "Strongly disagree": "👎",
  Disagree: "😕",
  Neutral: "😐",
  Agree: "🙂",
  "Strongly agree": "👍",
  "Very poor": "😞",
  Poor: "😕",
  Fair: "😐",
  Good: "🙂",
  Excellent: "😊",
  yes: "✅",
  no: "🙅",
};

export function optionEmoji(label: string, value?: string): string {
  if (label in OPTION_EMOJI) {
    return OPTION_EMOJI[label];
  }
  if (value === "yes" || value === "no") {
    return OPTION_EMOJI[value] ?? "💬";
  }
  return "💬";
}

const CATEGORY_META: Record<string, { emoji: string; icon: LucideIcon; tint: string }> = {
  school: { emoji: "🎓", icon: BookOpen, tint: "from-accent/80 to-accent/40" },
  academic: { emoji: "📚", icon: BookOpen, tint: "from-accent/80 to-accent/40" },
  mood: { emoji: "💭", icon: Cloud, tint: "from-accent/80 to-accent/40" },
  anxiety: { emoji: "🌊", icon: Waves, tint: "from-accent/80 to-accent/40" },
  sleep: { emoji: "😴", icon: Moon, tint: "from-accent/80 to-accent/40" },
  social: { emoji: "🤝", icon: Users, tint: "from-accent/80 to-accent/40" },
  campus_life: { emoji: "🏠", icon: Home, tint: "from-accent/80 to-accent/40" },
  identity: { emoji: "✨", icon: Sparkles, tint: "from-accent/80 to-accent/40" },
  coping: { emoji: "🛡️", icon: Shield, tint: "from-accent/80 to-accent/40" },
  physical: { emoji: "💪", icon: Sun, tint: "from-accent/80 to-accent/40" },
  safety: { emoji: "💙", icon: Heart, tint: "from-destructive/15 to-accent/40" },
  general: { emoji: "🌿", icon: Brain, tint: "from-accent/80 to-accent/40" },
};

export function categoryMeta(category: string) {
  return CATEGORY_META[category] ?? CATEGORY_META.general;
}

/** Short, warm section labels for the check-in (not "assessment"). */
export function friendlySectionTitle(title?: string, category?: string): string {
  if (title?.trim()) {
    return title;
  }
  const map: Record<string, string> = {
    school: "School & studying",
    academic: "Academic life",
    mood: "How you've been feeling",
    anxiety: "Worry & stress",
    sleep: "Rest & energy",
    social: "People & connection",
    campus_life: "Campus life",
    identity: "Confidence & direction",
    coping: "Support & coping",
    physical: "Body & energy",
  };
  return map[category ?? ""] ?? "A quick moment";
}
