import { useAuth } from "@/hooks/useAuth";
import { StudentIncomingCallBanner } from "@/components/student/StudentIncomingCallBanner";
import { CounselorIncomingCallBanner } from "@/components/counselor/CounselorIncomingCallBanner";

/**
 * Global incoming-call listener (all authenticated routes).
 * Polls fast + Supabase wake so ring/UI are not limited to dashboard pages.
 */
export function IncomingCallHost() {
  const { user, role, isLoading } = useAuth();

  if (isLoading || !user?.id) {
    return null;
  }

  if (role === "student") {
    return <StudentIncomingCallBanner enabled />;
  }

  if (role === "counselor") {
    return <CounselorIncomingCallBanner enabled />;
  }

  return null;
}
