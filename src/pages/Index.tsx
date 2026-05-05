import { useNavigate } from "react-router-dom";
import { GraduationCap, Stethoscope, Shield, Users } from "lucide-react";
import { Logo } from "@/components/Logo";
import { PortalCard } from "@/components/PortalCard";
import { BackgroundEffects } from "@/components/BackgroundEffects";
import { ThemeToggle } from "@/components/ThemeToggle";
import { resolveCrisisHotlineTelHref } from "@/lib/runtimeConfig";

const Index = () => {
  const navigate = useNavigate();
  const crisisTel = resolveCrisisHotlineTelHref();
  const crisisLabel = String(import.meta.env.VITE_CRISIS_HOTLINE_LABEL ?? "").trim() || "24/7 Crisis Hotline";

  return (
    <div className="min-h-screen bg-background relative">
      <BackgroundEffects />

      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Header */}
        <header className="p-6 lg:p-8 flex items-center justify-between">
          <Logo size="md" />
          <ThemeToggle />
        </header>

        {/* Main Content */}
        <main className="flex-1 flex items-center justify-center px-4 py-8">
          <div className="w-full max-w-4xl">
            {/* Hero Section */}
            <div className="text-center mb-12 opacity-0 animate-fade-in">
              <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold text-foreground mb-4">
                Counseling{" "}
                <span className="text-gradient">Management System</span>
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
                Your mental health matters. Access confidential support,
                professional counseling, and wellness resources with secure institutional sign-in.
              </p>
            </div>

            {/* Portal Selection */}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <PortalCard
                title="Student & Staff Portal"
                description="Students and staff can sign in with institutional accounts to access support tools."
                icon={GraduationCap}
                color="red"
                onClick={() => navigate("/student/login")}
                delay={100}
              />
              <PortalCard
                title="Counselor Portal"
                description="Manage appointments, communicate with students, and access counselor tools."
                icon={Stethoscope}
                color="blue"
                onClick={() => navigate("/counselor/login")}
                delay={200}
              />
              <PortalCard
                title="Peer Counselor Portal"
                description="Peer supporters can sign in to handle assigned conversations and escalations."
                icon={Users}
                color="blue"
                onClick={() => navigate("/peer/login")}
                delay={250}
              />
              <PortalCard
                title="Admin Portal"
                description="System administration, analytics, user management, and oversight tools."
                icon={Shield}
                color="purple"
                onClick={() => navigate("/admin/login")}
                delay={300}
              />
            </div>

            <div className="mt-12 text-center opacity-0 animate-fade-in stagger-4">
              <p className="text-sm text-muted-foreground mb-2">
                In case of emergency
              </p>
              {crisisTel ? (
                <a
                  href={crisisTel}
                  className="inline-flex items-center gap-2 text-primary hover:text-primary/80 transition-colors font-medium"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                    />
                  </svg>
                  {crisisLabel}
                </a>
              ) : (
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  For a life-threatening emergency, contact your local emergency number. Set{" "}
                  <span className="font-mono text-xs">VITE_CRISIS_HOTLINE_TEL</span> to show an institutional crisis line on this page.
                </p>
              )}
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="p-6 text-center">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Africa University. All rights reserved.
          </p>
        </footer>
      </div>
    </div>
  );
};

export default Index;
