import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

type AppRole = "admin" | "counselor" | "peer_counselor" | "student";

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: AppRole[];
  redirectTo?: string;
}

export const ProtectedRoute = ({ 
  children, 
  allowedRoles, 
  redirectTo = "/" 
}: ProtectedRouteProps) => {
  const { user, role, twoFactor, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 rounded-full border-4 border-primary border-t-transparent animate-spin" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to={redirectTo} replace />;
  }

  if (allowedRoles) {
    if (!role) {
      return <Navigate to={redirectTo} replace />;
    }

    if (!allowedRoles.includes(role)) {
      // Redirect to appropriate dashboard based on role
      const dashboardMap: Record<AppRole, string> = {
        student: "/student/dashboard",
        counselor: "/counselor/dashboard",
        peer_counselor: "/peer/dashboard",
        admin: "/admin/dashboard",
      };
      return <Navigate to={dashboardMap[role] || "/"} replace />;
    }
  }

  const isCounselingRole = role === "counselor" || role === "peer_counselor";
  const isTwoFactorPage = location.pathname === "/counselor/2fa";
  if (isCounselingRole && twoFactor.required && !isTwoFactorPage) {
    return <Navigate to="/counselor/2fa" replace />;
  }

  return <>{children}</>;
};
