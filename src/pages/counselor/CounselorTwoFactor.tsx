import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, KeyRound, ArrowLeft } from "lucide-react";
import { BackgroundEffects } from "@/components/BackgroundEffects";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

const CounselorTwoFactor = () => {
  const navigate = useNavigate();
  const {
    user,
    role,
    twoFactor,
    refreshTwoFactorStatus,
    setupTwoFactor,
    verifyTwoFactor,
    signOut,
  } = useAuth();

  const [code, setCode] = useState("");
  const [setupSecret, setSetupSecret] = useState("");
  const [setupUri, setSetupUri] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSettingUp, setIsSettingUp] = useState(false);

  const nextPath = useMemo(() => {
    return role === "peer_counselor" ? "/peer/dashboard" : "/counselor/dashboard";
  }, [role]);

  useEffect(() => {
    if (!user) {
      navigate("/counselor/login", { replace: true });
      return;
    }

    const loadStatus = async () => {
      const status = await refreshTwoFactorStatus();
      if (!status.required) {
        navigate(nextPath, { replace: true });
      }
    };

    void loadStatus();
  }, [nextPath, navigate, refreshTwoFactorStatus, user]);

  const handleSetup = async () => {
    try {
      setIsSettingUp(true);
      const setup = await setupTwoFactor();
      setSetupSecret(setup.secret ?? "");
      setSetupUri(setup.otpauth_uri ?? "");
      toast.success("2FA secret generated. Add it to your authenticator app.");
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to generate 2FA setup details.");
    } finally {
      setIsSettingUp(false);
    }
  };

  const handleVerify = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!code.trim()) {
      toast.error("Enter the 6-digit code from your authenticator app.");
      return;
    }

    setIsLoading(true);
    const { error } = await verifyTwoFactor(code.trim());
    if (error) {
      toast.error(error.message || "Failed to verify authentication code.");
      setIsLoading(false);
      return;
    }

    toast.success("Two-factor verification complete.");
    navigate(nextPath, { replace: true });
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
              onClick={() => navigate("/counselor/login")}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center px-4 py-8">
          <Card variant="glass" className="w-full max-w-lg opacity-0 animate-slide-up">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 p-4 rounded-full bg-info/20 w-fit">
                <ShieldCheck className="h-8 w-8 text-info" />
              </div>
              <CardTitle className="text-2xl">Two-Factor Verification</CardTitle>
              <CardDescription>
                Counselor access requires a second authentication factor.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {twoFactor.setupRequired && (
                <div className="rounded-xl border border-border/60 bg-secondary/20 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <KeyRound className="h-4 w-4" />
                      Setup Required
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleSetup}
                      disabled={isSettingUp}
                    >
                      {isSettingUp ? "Generating..." : "Generate Secret"}
                    </Button>
                  </div>
                  {setupSecret && (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Add this secret in your authenticator app:
                      </p>
                      <code className="block rounded bg-background px-3 py-2 text-sm break-all">
                        {setupSecret}
                      </code>
                    </div>
                  )}
                  {setupUri && (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        OTP URI (for QR generators):
                      </p>
                      <code className="block rounded bg-background px-3 py-2 text-xs break-all">
                        {setupUri}
                      </code>
                    </div>
                  )}
                </div>
              )}

              <form onSubmit={handleVerify} className="space-y-3">
                <Label htmlFor="totp-code">Authenticator Code</Label>
                <Input
                  id="totp-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\s+/g, ""))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  placeholder="Enter 6-digit code"
                  required
                />
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? "Verifying..." : "Verify and Continue"}
                </Button>
              </form>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => void signOut()}
              >
                Sign out
              </Button>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default CounselorTwoFactor;
