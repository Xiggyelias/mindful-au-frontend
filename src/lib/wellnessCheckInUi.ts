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
  school: { emoji: "🎓", icon: BookOpen, tint: "from-sky-100/90 to-blue-50/80" },
  academic: { emoji: "📚", icon: BookOpen, tint: "from-violet-100/90 to-purple-50/80" },
  mood: { emoji: "💭", icon: Cloud, tint: "from-indigo-100/90 to-blue-50/80" },
  anxiety: { emoji: "🌊", icon: Waves, tint: "from-cyan-100/90 to-teal-50/80" },
  sleep: { emoji: "😴", icon: Moon, tint: "from-slate-100/90 to-indigo-50/80" },
  social: { emoji: "🤝", icon: Users, tint: "from-emerald-100/90 to-green-50/80" },
  campus_life: { emoji: "🏠", icon: Home, tint: "from-amber-100/90 to-orange-50/80" },
  identity: { emoji: "✨", icon: Sparkles, tint: "from-fuchsia-100/90 to-purple-50/80" },
  coping: { emoji: "🛡️", icon: Shield, tint: "from-teal-100/90 to-emerald-50/80" },
  physical: { emoji: "💪", icon: Sun, tint: "from-lime-100/90 to-green-50/80" },
  safety: { emoji: "💙", icon: Heart, tint: "from-rose-100/90 to-red-50/80" },
  general: { emoji: "🌿", icon: Brain, tint: "from-sky-100/90 to-emerald-50/80" },
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
