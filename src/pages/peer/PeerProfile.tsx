import { useState } from "react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { peerNavItems } from "./navItems";

const PeerProfile = () => {
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

      <div className="lg:pl-72">
        <DashboardHeader title="Peer Profile" onMenuClick={() => setSidebarOpen(true)} />

        <main className="p-4 lg:p-6">
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="text-lg">Account Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                Name: <span className="text-foreground">{user?.profile?.full_name || "Not set"}</span>
              </p>
              <p className="text-muted-foreground">
                Email: <span className="text-foreground">{user?.email || "Not available"}</span>
              </p>
              <p className="text-muted-foreground">
                Student/ID Number: <span className="text-foreground">{user?.profile?.id_number || "Not set"}</span>
              </p>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default PeerProfile;
