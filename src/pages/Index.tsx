import { useNavigate } from "react-router-dom";
import { GraduationCap, Stethoscope, Shield, Users } from "lucide-react";
import { Logo } from "@/components/Logo";
import { PortalCard } from "@/components/PortalCard";
import { BackgroundEffects } from "@/components/BackgroundEffects";
import { ThemeToggle } from "@/components/ThemeToggle";
import { resolveCrisisHotlineTelHref, resolveInstitutionName } from "@/lib/runtimeConfig";

const INSTITUTION_NAME = resolveInstitutionName();

/** Institutional default when `VITE_CRISIS_HOTLINE_*` is not set (Africa University / campus short code). */
const DEFAULT_CRISIS_TEL_HREF = "tel:393";
const DEFAULT_CRISIS_HEADLINE = "Youth Advocates Helpline";
const DEFAULT_CRISIS_LINK_CTA = "Call 393";

const Index = () => {
  const navigate = useNavigate();
  const crisisTel = resolveCrisisHotlineTelHref() ?? DEFAULT_CRISIS_TEL_HREF;

  const nameEnv = String(import.meta.env.VITE_CRISIS_HOTLINE_NAME ?? "").trim();
  const labelLegacy = String(import.meta.env.VITE_CRISIS_HOTLINE_LABEL ?? "").trim();
  const crisisHeadline =
    nameEnv ||
    (labelLegacy.includes(":")
      ? labelLegacy.split(":")[0]?.trim() || DEFAULT_CRISIS_HEADLINE
      : labelLegacy || DEFAULT_CRISIS_HEADLINE);

  const ctaEnv = String(import.meta.env.VITE_CRISIS_HOTLINE_CTA ?? "").trim();
  const crisisLinkText =
    ctaEnv ||
    (labelLegacy.includes(":") ? labelLegacy.split(":").slice(1).join(":").trim() : "") ||
    DEFAULT_CRISIS_LINK_CTA;

  const crisisTelPlain = crisisTel.replace(/^tel:/i, "").replace(/\s+/g, "");
  const crisisAriaLabel = `${crisisHeadline}, ${crisisLinkText} (${crisisTelPlain})`;

  return (
    <div className="min-h-[100dvh] bg-background relative">
      <BackgroundEffects />

      <div className="relative z-10 min-h-[100dvh] flex flex-col">
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
              <p className="text-sm text-muted-foreground mb-2">In case of emergency</p>
              <p className="text-base text-foreground font-medium mb-3">{crisisHeadline}</p>
              <a
                href={crisisTel}
                aria-label={crisisAriaLabel}
                className="inline-flex items-center justify-center gap-2 text-primary hover:text-primary/80 transition-colors font-semibold text-base"
              >
                <svg
                  className="h-4 w-4 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                  />
                </svg>
                <span>{crisisLinkText}</span>
              </a>
              <p className="mt-2 text-xs text-muted-foreground">
                Life-threatening emergencies: use your national emergency number or seek immediate in-person help.
              </p>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="p-6 text-center">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} {INSTITUTION_NAME}. All rights reserved.
          </p>
        </footer>
      </div>
    </div>
  );
};

export default Index;
