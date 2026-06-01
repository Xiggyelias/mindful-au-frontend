import { cn } from "@/lib/utils";
import { Logo } from "./Logo";
import { Button } from "./ui/button";
import { useNavigate, useLocation } from "react-router-dom";
import { LucideIcon, LogOut, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { AnonymousModeIndicator } from "@/components/privacy/AnonymousModeIndicator";
import { isProfileAnonymousMode } from "@/lib/anonymousMode";
import { prefetchRoute } from "@/hooks/usePagePrefetch";

interface NavItem {
  label: string;
  icon: LucideIcon;
  path: string;
}

interface DashboardSidebarProps {
  items: NavItem[];
  userType: "student" | "counselor" | "admin" | "peer";
  userName?: string;
  isOpen?: boolean;
  onClose?: () => void;
  onNavigate?: (path: string) => void;
  className?: string;
}

export const DashboardSidebar = ({
  items,
  userType,
  userName = "User",
  isOpen = true,
  onClose,
  onNavigate,
  className,
}: DashboardSidebarProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut, user } = useAuth();
  const studentPrivacyAnonymous = userType === "student" && isProfileAnonymousMode(user?.profile?.anonymous_mode);
  const logoutPathByRole: Record<DashboardSidebarProps["userType"], string> = {
    student: "/student/login",
    counselor: "/counselor/login",
    peer: "/peer/login",
    admin: "/admin/login",
  };

  const handleLogout = async () => {
    await signOut();
    onClose?.();
    navigate(logoutPathByRole[userType], { replace: true });
  };

  const roleColors = {
    student: "bg-primary/20 text-primary",
    counselor: "bg-info/20 text-info",
    peer: "bg-info/20 text-info",
    admin: "bg-warning/20 text-warning",
  };

const roleLabels: Record<DashboardSidebarProps["userType"], string> = {
  student: "Student",
  counselor: "Counselor",
  peer: "Peer Counselor",
  admin: "Admin",
};

const isSecureChatPath = (path: string) =>
  path === "/student/chat" || path === "/counselor/messages" || path === "/peer/chats";

  return (
    <>
      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-0 h-full w-72 bg-sidebar border-r border-sidebar-border z-50 transition-transform duration-300 lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full",
          className
        )}
      >
        <div className="flex flex-col h-full p-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <Logo size="sm" />
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={onClose}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* User info */}
          <div className="mb-6 p-3.5 rounded-2xl bg-sidebar-accent/50 border border-sidebar-border/30 flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm select-none shrink-0 shadow-inner">
              {userName.substring(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-sidebar-foreground font-semibold truncate leading-tight">
                {userName}
              </p>
              <span
                className={cn(
                  "inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider",
                  roleColors[userType]
                )}
              >
                {roleLabels[userType]}
              </span>
              {studentPrivacyAnonymous && (
                <div className="mt-2">
                  <AnonymousModeIndicator variant="badge" className="w-full justify-center" />
                </div>
              )}
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-1.5">
            {items.map((item) => {
              const isActive =
                location.pathname === item.path ||
                (item.path !== "/" && location.pathname.startsWith(`${item.path}/`));
              return (
                <button
                  key={item.path}
                  onClick={() => {
                    onNavigate?.(item.path);
                    navigate(item.path, {
                      state: isSecureChatPath(item.path)
                        ? { secureChatPreflight: true, startedAt: Date.now() }
                        : undefined,
                    });
                    onClose?.();
                  }}
                  onMouseEnter={() => {
                    // Prefetch the route chunk on hover for instant navigation
                    // This is a no-op if already imported, but triggers network fetch if not
                    if (item.path === "/student/chat") {
                      prefetchRoute(() => import("@/pages/student/StudentChat"));
                    } else if (item.path === "/student/dashboard") {
                      prefetchRoute(() => import("@/pages/student/StudentDashboard"));
                    } else if (item.path === "/student/appointments") {
                      prefetchRoute(() => import("@/pages/student/StudentAppointments"));
                    } else if (item.path === "/student/ai-support") {
                      prefetchRoute(() => import("@/pages/student/StudentAISupport"));
                    } else if (item.path === "/student/video-call") {
                      prefetchRoute(() => import("@/pages/student/StudentVideoCall"));
                    } else if (item.path === "/student/history") {
                      prefetchRoute(() => import("@/pages/student/StudentHistory"));
                    } else if (item.path === "/student/wellness") {
                      prefetchRoute(() => import("@/pages/student/StudentWellness"));
                    } else if (item.path === "/counselor/dashboard") {
                      prefetchRoute(() => import("@/pages/counselor/CounselorDashboard"));
                    } else if (item.path === "/counselor/messages") {
                      prefetchRoute(() => import("@/pages/counselor/CounselorMessages"));
                    } else if (item.path === "/counselor/appointments") {
                      prefetchRoute(() => import("@/pages/counselor/CounselorAppointments"));
                    } else if (item.path === "/peer/dashboard") {
                      prefetchRoute(() => import("@/pages/peer/PeerDashboard"));
                    } else if (item.path === "/peer/chats") {
                      prefetchRoute(() => import("@/pages/counselor/CounselorMessages"));
                    }
                  }}
                  className={cn(
                    "w-full flex items-center gap-3.5 px-4 py-3 rounded-2xl text-sm font-medium transition-all duration-200 transform",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-md shadow-primary/20 ring-1 ring-primary/20 font-semibold"
                      : "text-sidebar-foreground/80 hover:text-foreground hover:bg-sidebar-accent/60 hover:translate-x-1"
                  )}
                >
                  <item.icon className="h-5 w-5 shrink-0" />
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Logout */}
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-muted-foreground hover:text-destructive"
            onClick={handleLogout}
          >
            <LogOut className="h-5 w-5" />
            Sign Out
          </Button>
        </div>
      </aside>
    </>
  );
};
