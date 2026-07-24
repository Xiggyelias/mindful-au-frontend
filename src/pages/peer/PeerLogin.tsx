import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Eye, EyeOff, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/Logo";
import { BackgroundEffects } from "@/components/BackgroundEffects";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

const PeerLogin = () => {
  const navigate = useNavigate();
  const { user, role, twoFactor, signInWithEmail, signOut, isLoading: authLoading } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  useEffect(() => {
    if (user && role === "peer_counselor" && twoFactor.required) {
      navigate("/peer/2fa", { replace: true });
      return;
    }

    if (user && role === "peer_counselor") {
      navigate("/peer/dashboard", { replace: true });
    }
  }, [user, role, twoFactor.required, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    const {
      error,
      user: loggedInUser,
      twoFactorRequired,
      twoFactorSetupRequired,
    } = await signInWithEmail(formData.email, formData.password);

    if (error) {
      toast.error(error.message || "Failed to sign in");
      setIsLoading(false);
      return;
    }

    const hasPeerRole = loggedInUser?.roles?.some((r) => r.role === "peer_counselor");
    if (!hasPeerRole) {
      toast.error("Access denied. Peer counselor privileges required.");
      setIsLoading(false);
      await signOut();
      return;
    }

    if (twoFactorRequired) {
      toast.success(
        twoFactorSetupRequired
          ? "Set up two-factor authentication to continue."
          : "Enter your two-factor verification code."
      );
      navigate("/peer/2fa", { replace: true });
      setIsLoading(false);
      return;
    }

    toast.success("Welcome back! Redirecting to your workspace...");
    navigate("/peer/dashboard", { replace: true });
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-background relative">
      <BackgroundEffects />

      <div className="relative z-10 min-h-screen flex flex-col">
        <header className="p-6 lg:p-8 flex items-center justify-between">
          <Logo size="md" />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button
              variant="ghost"
              onClick={() => navigate("/")}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center px-4 py-8">
          <Card variant="glass" className="w-full max-w-md opacity-0 animate-slide-up">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 p-4 rounded-full bg-info/20 w-fit">
                <Users className="h-8 w-8 text-info" />
              </div>
              <CardTitle className="text-2xl">Peer Counselor Portal</CardTitle>
              <CardDescription>
                Sign in to manage assigned peer support sessions and escalations
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="Enter your email"
                    value={formData.email}
                    onChange={(e) =>
                      setFormData({ ...formData, email: e.target.value })
                    }
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter your password"
                      value={formData.password}
                      onChange={(e) =>
                        setFormData({ ...formData, password: e.target.value })
                      }
                      required
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Button>
                  </div>
                </div>

                <Button
                  type="submit"
                  variant="hero"
                  size="lg"
                  className="w-full"
                  disabled={isLoading || authLoading}
                >
                  {isLoading ? (
                    <div className="flex items-center gap-2">
                      <svg
                        className="animate-spin h-4 w-4"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                          fill="none"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      Signing in...
                    </div>
                  ) : (
                    "Sign In"
                  )}
                </Button>
              </form>

              <div className="mt-6 text-center space-y-4">
                <p className="text-sm text-muted-foreground">
                  New peer counselor?{" "}
                  <Link
                    to="/counselor/register?role=peer_counselor"
                    className="inline-block -my-2 py-2 text-primary hover:underline font-medium"
                  >
                    Register here
                  </Link>
                </p>
                <p className="text-sm text-muted-foreground">
                  Counselor account?{" "}
                  <Link
                    to="/counselor/login"
                    className="inline-block -my-2 py-2 text-info hover:underline font-medium"
                  >
                    Counselor Login
                  </Link>
                </p>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default PeerLogin;
