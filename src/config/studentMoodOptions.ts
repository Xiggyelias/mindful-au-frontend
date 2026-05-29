import { Frown, Meh, Smile } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const studentMoodValues = ["great", "okay", "low", "stressed", "tired"] as const;
export type StudentMood = (typeof studentMoodValues)[number];

export type StudentMoodOption = {
  value: StudentMood;
  label: string;
  display: string;
  icon: LucideIcon;
  iconClass: string;
  bgClass: string;
};

/** Shared mood options for dashboard quick check-in and wellness page. */
export const studentMoodOptions: StudentMoodOption[] = [
  {
    value: "great",
    label: "Great",
    display: "\u{1F60A} Great",
    icon: Smile,
    iconClass: "text-success",
    bgClass: "bg-success/10",
  },
  {
    value: "okay",
    label: "Okay",
    display: "\u{1F610} Okay",
    icon: Meh,
    iconClass: "text-warning",
    bgClass: "bg-warning/10",
  },
  {
    value: "low",
    label: "Low",
    display: "\u{1F614} Low",
    icon: Frown,
    iconClass: "text-destructive",
    bgClass: "bg-destructive/10",
  },
  {
    value: "stressed",
    label: "Stressed",
    display: "\u{1F62B} Stressed",
    icon: Meh,
    iconClass: "text-orange-600",
    bgClass: "bg-orange-500/10",
  },
  {
    value: "tired",
    label: "Tired",
    display: "\u{1F634} Tired",
    icon: Frown,
    iconClass: "text-slate-600",
    bgClass: "bg-slate-500/10",
  },
];

export const studentMoodLabel = (mood: string) =>
  studentMoodOptions.find((item) => item.value === mood)?.label ?? mood;
