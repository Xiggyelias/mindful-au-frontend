import {
  AlertTriangle,
  ArrowRightLeft,
  BarChart3,
  Brain,
  FileText,
  LayoutDashboard,
  Settings,
  ShieldAlert,
  UserCheck,
  Users,
} from "lucide-react";
import { useState } from "react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { IntakeScreen } from "@/components/workflows/IntakeScreen";
import { useAuth } from "@/hooks/useAuth";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/admin/dashboard" },
  { label: "Students", icon: Users, path: "/admin/students" },
  { label: "Counselors", icon: UserCheck, path: "/admin/counselors" },
  { label: "Analytics", icon: BarChart3, path: "/admin/analytics" },
  { label: "Intake", icon: ShieldAlert, path: "/admin/intake" },
  { label: "Referrals", icon: ArrowRightLeft, path: "/admin/referrals" },
  { label: "AI Reports", icon: Brain, path: "/admin/ai-reports" },
  { label: "Alerts", icon: AlertTriangle, path: "/admin/alerts" },
  { label: "Logs", icon: FileText, path: "/admin/logs" },
  { label: "Settings", icon: Settings, path: "/admin/settings" },
];

const AdminIntake = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || "Admin";

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar
        items={navItems}
        userType="admin"
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-72">
        <DashboardHeader title="Intake Oversight" onMenuClick={() => setSidebarOpen(true)} />
        <main className="p-4 lg:p-6">
          <IntakeScreen role="admin" />
        </main>
      </div>
    </div>
  );
};

export default AdminIntake;
