import {
  ArrowRightLeft,
  Bot,
  Calendar,
  Heart,
  History,
  LayoutDashboard,
  MessageSquare,
  Video,
} from "lucide-react";
import { useState } from "react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { ReferralScreen } from "@/components/workflows/ReferralScreen";
import { useAuth } from "@/hooks/useAuth";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/student/dashboard" },
  { label: "Chat", icon: MessageSquare, path: "/student/chat" },
  { label: "Appointments", icon: Calendar, path: "/student/appointments" },
  { label: "Referrals", icon: ArrowRightLeft, path: "/student/referrals" },
  { label: "AI Support", icon: Bot, path: "/student/ai-support" },
  { label: "Video Call", icon: Video, path: "/student/video-call" },
  { label: "Past Sessions", icon: History, path: "/student/history" },
  { label: "Wellness", icon: Heart, path: "/student/wellness" },
];

const StudentReferrals = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || "Student";

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar
        items={navItems}
        userType="student"
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-72">
        <DashboardHeader title="Referrals" onMenuClick={() => setSidebarOpen(true)} />
        <main className="p-4 lg:p-6">
          <ReferralScreen role="student" />
        </main>
      </div>
    </div>
  );
};

export default StudentReferrals;
