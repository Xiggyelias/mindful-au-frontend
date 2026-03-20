import { useNavigate, Link } from "react-router-dom";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { BackgroundEffects } from "@/components/BackgroundEffects";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const AdminRegister = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background relative">
      <BackgroundEffects />

      <div className="relative z-10 min-h-screen flex flex-col">
        <header className="p-6 lg:p-8 flex items-center justify-between">
          <Logo size="md" />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="ghost" onClick={() => navigate("/admin/login")} className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center px-4 py-8">
          <Card variant="glass" className="w-full max-w-md">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 p-4 rounded-full bg-warning/20 w-fit">
                <ShieldAlert className="h-8 w-8 text-warning" />
              </div>
              <CardTitle className="text-2xl">Admin Access Required</CardTitle>
              <CardDescription>
                Self-service administrator registration is disabled.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">
                Ask an existing administrator to provision your admin role through institutional account management.
              </p>
              <Button className="w-full" onClick={() => navigate("/admin/login")}>
                Go To Admin Login
              </Button>
              <p className="text-sm text-muted-foreground">
                Need a different portal?{" "}
                <Link to="/" className="text-primary hover:underline font-medium">
                  Return to home
                </Link>
              </p>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default AdminRegister;
