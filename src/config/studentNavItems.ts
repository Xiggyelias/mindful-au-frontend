import {
  Bot,
  Calendar,
  ClipboardCheck,
  Heart,
  LayoutDashboard,
  MessageSquare,
  Video,
} from "lucide-react";

/** Shared student sidebar nav — single module so icon imports survive code-splitting. */
export const studentNavItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/student/dashboard" },
  { label: "Chat", icon: MessageSquare, path: "/student/chat" },
  { label: "Appointments", icon: Calendar, path: "/student/appointments" },
  { label: "AI Support", icon: Bot, path: "/student/ai-support" },
  { label: "Video Call", icon: Video, path: "/student/video-call" },
  { label: "Wellness", icon: Heart, path: "/student/wellness" },
  { label: "Assessment", icon: ClipboardCheck, path: "/student/diagnostic-assessment" },
] as const;
