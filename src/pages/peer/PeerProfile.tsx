import { useState } from "react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";

import { api, getApiErrorMessage } from "@/lib/api";
import { toast } from "sonner";
import { peerCounselorNavItems } from "@/config/counselorNavItems";

const PeerProfile = () => {
  const { user, refreshUser } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || "Peer Counselor";

  const [fullName, setFullName] = useState(user?.profile?.full_name || "");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      toast.error("Name cannot be empty.");
      return;
    }
    try {
      setIsSaving(true);
      await api.updateProfile({ full_name: fullName.trim() });
      await refreshUser();
      toast.success("Profile updated.");
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, "Failed to update profile."));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar
        items={peerCounselorNavItems}
        userType="peer"
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-72 pl-0">
        <DashboardHeader title="Peer Profile" onMenuClick={() => setSidebarOpen(true)} />

        <main className="p-4 lg:p-6 space-y-6">
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="text-lg">Account Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                Email: <span className="text-foreground">{user?.email || "Not available"}</span>
              </p>
              <p className="text-muted-foreground">
                ID Number: <span className="text-foreground">{user?.profile?.id_number || "Not set"}</span>
              </p>
            </CardContent>
          </Card>

          <Card variant="glass">
            <CardHeader>
              <CardTitle className="text-lg">Edit Profile</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSave} className="space-y-4 max-w-sm">
                <div className="space-y-2">
                  <Label htmlFor="full_name">Full Name</Label>
                  <Input
                    id="full_name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Your full name"
                    disabled={isSaving}
                  />
                </div>
                <Button type="submit" disabled={isSaving}>
                  {isSaving ? "Saving..." : "Save Changes"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default PeerProfile;
