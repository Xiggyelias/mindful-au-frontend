import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { resolveApiBaseUrl } from "@/lib/runtimeConfig";
import { getStudentHomePath } from "@/lib/studentRoutes";

const OAuthCallback = () => {
  const navigate = useNavigate();
  const { completeOAuthLoginWithTicket } = useAuth();
  const hasProcessedRef = useRef(false);

  const redirectByRole = useCallback(
    (resolvedRole: string | null | undefined, authUser?: { needs_assessment?: boolean } | null) => {
      if (resolvedRole === "admin") {
        navigate("/admin/dashboard", { replace: true });
        return;
      }

      if (resolvedRole === "counselor") {
        navigate("/counselor/dashboard", { replace: true });
        return;
      }

      if (resolvedRole === "peer_counselor") {
        navigate("/peer/dashboard", { replace: true });
        return;
      }

      navigate(getStudentHomePath(authUser), { replace: true });
    },
    [navigate]
  );

  useEffect(() => {
    if (hasProcessedRef.current) {
      return;
    }
    hasProcessedRef.current = true;

    let isCancelled = false;

    const finalize = async () => {
      const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
      const search = window.location.search.startsWith("?") ? window.location.search.slice(1) : "";

      const hashQueryString = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : hash;
      const hashParams = new URLSearchParams(hashQueryString);
      const searchParams = new URLSearchParams(search);

      const readParam = (...keys: string[]) => {
        for (const key of keys) {
          const fromHash = hashParams.get(key);
          if (fromHash && fromHash.trim() !== "") return fromHash;
          const fromSearch = searchParams.get(key);
          if (fromSearch && fromSearch.trim() !== "") return fromSearch;
        }
        return null;
      };

      const error = readParam("error", "message");
      const ticket = readParam("ticket", "login_ticket", "oauth_ticket");

      if (error) {
        if (isCancelled) return;
        toast.error(error);
        navigate("/", { replace: true });
        return;
      }

      if (!ticket) {
        const authCode = readParam("code");
        if (authCode) {
          const apiBase = resolveApiBaseUrl().replace(/\/+$/, "");
          const passthroughParams = new URLSearchParams();

          const state = readParam("state");
          const scope = readParam("scope");
          const prompt = readParam("prompt");
          if (authCode) passthroughParams.set("code", authCode);
          if (state) passthroughParams.set("state", state);
          if (scope) passthroughParams.set("scope", scope);
          if (prompt) passthroughParams.set("prompt", prompt);

          const callbackUrl = `${apiBase}/auth/google/callback${passthroughParams.toString() ? `?${passthroughParams.toString()}` : ""}`;
          window.location.replace(callbackUrl);
          return;
        }

        if (isCancelled) return;
        toast.error("Google sign-in did not return a valid login ticket.");
        navigate("/", { replace: true });
        return;
      }

      const result = await completeOAuthLoginWithTicket(ticket);
      if (isCancelled) return;

      if (result.error || !result.role) {
        toast.error(result.error?.message || "Unable to complete sign-in.");
        navigate("/", { replace: true });
        return;
      }

      // Remove sensitive callback params from URL only after successful completion.
      if (window.location.search || window.location.hash) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      redirectByRole(result.role, result.user);
    };

    void finalize();

    return () => {
      isCancelled = true;
    };
  }, [completeOAuthLoginWithTicket, navigate, redirectByRole]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Completing secure Google sign-in...</p>
      </div>
    </div>
  );
};

export default OAuthCallback;
