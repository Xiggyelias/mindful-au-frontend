import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { BackgroundEffects } from "@/components/BackgroundEffects";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

const StudentLogin = () => {
  const navigate = useNavigate();
  const { user, role, signInWithGoogle, isLoading: authLoading } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!user || !role) return;

    if (role === "admin") {
      navigate("/admin/dashboard", { replace: true });
      return;
    }

    if (role === "counselor") {
      navigate("/counselor/dashboard", { replace: true });
      return;
    }

    if (role === "peer_counselor") {
      navigate("/peer/dashboard", { replace: true });
      return;
    }

    navigate("/student/dashboard", { replace: true });
  }, [navigate, role, user]);

  const handleGoogleSignIn = async () => {
    setIsSubmitting(true);
    const { error } = await signInWithGoogle("student");
    if (error) {
      toast.error(error.message || "Unable to start Google sign-in.");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background relative">
      <BackgroundEffects />

      <div className="relative z-10 min-h-screen flex flex-col">
        <header className="p-6 lg:p-8 flex items-center justify-between">
          <Logo size="md" />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="ghost" onClick={() => navigate("/")} className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center px-4 py-8">
          <Card variant="glass" className="w-full max-w-md opacity-0 animate-slide-up">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 p-4 rounded-full bg-primary/20 w-fit">
                <svg
                  className="h-8 w-8 text-primary"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 14l9-5-9-5-9 5 9 5z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z"
                  />
                </svg>
              </div>
              <CardTitle className="text-2xl">Student &amp; Staff Portal</CardTitle>
              <CardDescription>
                Students and staff can sign in with official university Google accounts.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                type="button"
                className="w-full"
                size="lg"
                onClick={handleGoogleSignIn}
                disabled={isSubmitting || authLoading}
              >
                {isSubmitting || authLoading ? "Redirecting..." : "Continue with Google"}
              </Button>

              <p className="text-xs text-muted-foreground text-center">
                Only institutional accounts are allowed (for example: <code>@africau.edu</code>).
              </p>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default StudentLogin;
