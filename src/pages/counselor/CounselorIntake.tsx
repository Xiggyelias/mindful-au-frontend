import {
  ArrowRightLeft,
  Brain,
  Calendar,
  FileText,
  Heart,
  LayoutDashboard,
  MessageSquare,
  ShieldAlert,
  Users,
  Video,
} from "lucide-react";
import { useState } from "react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { IntakeScreen } from "@/components/workflows/IntakeScreen";
import { useAuth } from "@/hooks/useAuth";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/counselor/dashboard" },
  { label: "Messages", icon: MessageSquare, path: "/counselor/messages" },
  { label: "Appointments", icon: Calendar, path: "/counselor/appointments" },
  { label: "Intake", icon: ShieldAlert, path: "/counselor/intake" },
  { label: "Referrals", icon: ArrowRightLeft, path: "/counselor/referrals" },
  { label: "Students", icon: Users, path: "/counselor/students" },
  { label: "AI Insights", icon: Brain, path: "/counselor/ai-insights" },
  { label: "Video Sessions", icon: Video, path: "/counselor/video" },
  { label: "Session Notes", icon: FileText, path: "/counselor/notes" },
  { label: "Wellness", icon: Heart, path: "/counselor/wellness" },
];

const CounselorIntake = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || "Counselor";

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar
        items={navItems}
        userType="counselor"
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-72">
        <DashboardHeader title="Intake Triage" onMenuClick={() => setSidebarOpen(true)} />
        <main className="p-4 lg:p-6">
          <IntakeScreen role="counselor" />
        </main>
      </div>
    </div>
  );
};

export default CounselorIntake;
