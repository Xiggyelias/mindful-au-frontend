import {
  AlertTriangle,
  BarChart3,
  Brain,
  FileText,
  LayoutDashboard,
  Settings,
  UserCheck,
  Users,
} from "lucide-react";

/** Shared admin sidebar nav — single module so icon imports survive code-splitting. */
export const adminNavItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/admin/dashboard" },
  { label: "Students", icon: Users, path: "/admin/students" },
  { label: "Counselors", icon: UserCheck, path: "/admin/counselors" },
  { label: "Analytics", icon: BarChart3, path: "/admin/analytics" },
  { label: "AI Reports", icon: Brain, path: "/admin/ai-reports" },
  { label: "Alerts", icon: AlertTriangle, path: "/admin/alerts" },
  { label: "Logs", icon: FileText, path: "/admin/logs" },
  { label: "Settings", icon: Settings, path: "/admin/settings" },
] as const;
