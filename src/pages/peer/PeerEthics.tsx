import { ShieldCheck, TriangleAlert } from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useState } from "react";
import { peerNavItems } from "./navItems";

const PeerEthics = () => {
  const { user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || "Peer Counselor";

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar
        items={peerNavItems}
        userType="peer"
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-72 pl-0 pl-0">
        <DashboardHeader title="Ethics Guidelines" onMenuClick={() => setSidebarOpen(true)} />

        <main className="p-4 lg:p-6 space-y-6">
          <Card variant="glass" className="border-primary/20">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                Peer Support Boundaries
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>Protect anonymity at all times. Never request identifying details from students.</p>
              <p>Provide supportive listening and coping guidance for low-risk concerns only.</p>
              <p>Escalate immediately for any urgent, self-harm, or violence-related indicators.</p>
              <p>Do not provide diagnosis, medication advice, or legal instructions.</p>
              <p>Document clear, factual notes when escalating a case.</p>
            </CardContent>
          </Card>

          <Card variant="glass" className="border-warning/30">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <TriangleAlert className="h-5 w-5 text-warning" />
                Immediate Escalation Triggers
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>Mentions of self-harm, suicide intent, or plans.</p>
              <p>Threats toward others, abuse disclosures, or panic indicators.</p>
              <p>Repeated high-risk language or severe emotional deterioration.</p>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default PeerEthics;
