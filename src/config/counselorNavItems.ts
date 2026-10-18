import {
  AlertTriangle,
  Calendar,
  FileText,
  Heart,
  LayoutDashboard,
  MessageSquare,
  Radio,
  ShieldCheck,
  UserCircle2,
  Users,
  Video,
} from "lucide-react";

/** Shared counselor sidebar nav to avoid drift across pages. */
export const counselorNavItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/counselor/dashboard" },
  { label: "Messages", icon: MessageSquare, path: "/counselor/messages" },
  { label: "Appointments", icon: Calendar, path: "/counselor/appointments" },
  { label: "Students", icon: Users, path: "/counselor/students" },
  { label: "Video Sessions", icon: Video, path: "/counselor/video" },
  { label: "Session Notes", icon: FileText, path: "/counselor/notes" },
  { label: "Wellness", icon: Heart, path: "/counselor/wellness" },
  { label: "Alerts", icon: AlertTriangle, path: "/counselor/alerts" },
] as const;

export const peerCounselorNavItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/peer/dashboard" },
  { label: "Spatial Lounge", icon: Radio, path: "/peer/spatial-lounge" },
  { label: "Active Chats", icon: MessageSquare, path: "/peer/chats" },
  { label: "Escalated Cases", icon: AlertTriangle, path: "/peer/escalations" },
  { label: "Ethics Guidelines", icon: ShieldCheck, path: "/peer/ethics" },
  { label: "Profile", icon: UserCircle2, path: "/peer/profile" },
] as const;
