import { cn } from "@/lib/utils";
import { Logo } from "./Logo";
import { Button } from "./ui/button";
import { useNavigate, useLocation } from "react-router-dom";
import { LucideIcon, LogOut, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

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
  className?: string;
}

export const DashboardSidebar = ({
  items,
  userType,
  userName = "User",
  isOpen = true,
  onClose,
  className,
}: DashboardSidebarProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut } = useAuth();
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
          <div className="mb-6 p-4 rounded-xl bg-sidebar-accent">
            <p className="text-sm text-sidebar-foreground font-medium truncate">
              {userName}
            </p>
            <span
              className={cn(
                "inline-block mt-1 text-xs px-2 py-0.5 rounded-full capitalize",
                roleColors[userType]
              )}
            >
              {roleLabels[userType]}
            </span>
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-1">
            {items.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <button
                  key={item.path}
                  onClick={() => {
                    navigate(item.path);
                    onClose?.();
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200",
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-lg shadow-primary/20 ring-1 ring-primary/30"
                      : "text-sidebar-foreground hover:bg-sidebar-accent"
                  )}
                >
                  <item.icon className="h-5 w-5" />
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
