import {
  AlertTriangle,
  LayoutDashboard,
  MessageSquare,
  ShieldCheck,
  UserCircle2,
} from "lucide-react";

export const peerNavItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/peer/dashboard" },
  { label: "Active Chats", icon: MessageSquare, path: "/peer/chats" },
  { label: "Escalated Cases", icon: AlertTriangle, path: "/peer/escalations" },
  { label: "Ethics Guidelines", icon: ShieldCheck, path: "/peer/ethics" },
  { label: "Profile", icon: UserCircle2, path: "/peer/profile" },
];

