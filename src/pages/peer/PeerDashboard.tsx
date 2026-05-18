import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Bell,
  Clock3,
  MessageSquare,
  Shield,
  UserCheck2,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { StatsCard } from "@/components/StatsCard";
import { DailyTipCard } from "@/components/DailyTipCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { useDailyTip } from "@/hooks/useDailyTip";
import { api, getApiErrorMessage } from "@/lib/api";
import { toast } from "sonner";
import { peerNavItems } from "./navItems";

type PeerDashboardResponse = {
  availability: boolean;
  stats: {
    active_chats: number;
    chat_history_count: number;
    escalated_cases: number;
    urgent_flags: number;
  };
  recent_sessions: Array<{
    id: number;
    student_label: string;
    status: string;
    session_type: string;
    updated_at: string;
  }>;
};

const PeerDashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || "Peer Counselor";

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingAvailability, setSavingAvailability] = useState(false);
  const [data, setData] = useState<PeerDashboardResponse | null>(null);
  const {
    tip: dailyTip,
    isLoading: tipLoading,
    error: tipError,
    toggleFavorite,
    isSavingFavorite,
  } = useDailyTip();

  const load = async () => {
    try {
      setLoading(true);
      const next = await api.getPeerDashboard();
      setData(next);
    } catch (error: unknown) {
      toast.error(getApiErrorMessage(error, "Failed to load peer dashboard"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user?.id) return;
    void load();
  }, [user?.id]);

  const handleAvailabilityToggle = async (available: boolean) => {
    try {
      setSavingAvailability(true);
      const result = await api.updatePeerAvailability(available);
      setData((prev) => (prev ? { ...prev, availability: Boolean(result?.available) } : prev));
      toast.success(`Availability set to ${available ? "online" : "offline"}`);
    } catch (error: unknown) {
      toast.error(getApiErrorMessage(error, "Failed to update availability"));
    } finally {
      setSavingAvailability(false);
    }
  };

  const stats = useMemo(() => {
    const base = data?.stats;
    return [
      { title: "Active Chats", value: base?.active_chats ?? 0, icon: MessageSquare },
      { title: "Escalated Cases", value: base?.escalated_cases ?? 0, icon: AlertTriangle },
      { title: "Urgent Flags", value: base?.urgent_flags ?? 0, icon: Bell },
      { title: "Chat History", value: base?.chat_history_count ?? 0, icon: Clock3 },
    ];
  }, [data?.stats]);

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar
        items={peerNavItems}
        userType="peer"
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-72 pl-0">
        <DashboardHeader title="Peer Support Dashboard" onMenuClick={() => setSidebarOpen(true)} />

        <main className="p-4 lg:p-6 space-y-6">
          <Card variant="glass" className="border-primary/20">
            <CardContent className="pt-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div>
                <h2 className="text-2xl font-display font-bold text-foreground">
                  First-line Support Center
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  You support anonymized students only. Escalate any urgent or high-risk concern immediately.
                </p>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-border/60 px-4 py-3 bg-secondary/20">
                <UserCheck2 className="h-4 w-4 text-primary" />
                <div className="text-sm">
                  <p className="font-medium text-foreground">Availability</p>
                  <p className="text-xs text-muted-foreground">
                    {data?.availability ? "Online for assignments" : "Offline"}
                  </p>
                </div>
                <Switch
                  checked={Boolean(data?.availability)}
                  onCheckedChange={handleAvailabilityToggle}
                  disabled={savingAvailability}
                />
              </div>
            </CardContent>
          </Card>

          <DailyTipCard
            tip={dailyTip}
            isLoading={tipLoading}
            error={tipError}
            title="Peer Support Tip of the Day"
            onToggleFavorite={() => void toggleFavorite()}
            isSavingFavorite={isSavingFavorite}
            actionLabel="Open Ethics Guidelines"
            onAction={() => navigate("/peer/ethics")}
          />

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {stats.map((item) => (
              <StatsCard key={item.title} title={item.title} value={item.value} icon={item.icon} />
            ))}
          </div>


          <div className="grid gap-6 lg:grid-cols-3">
            <Card variant="glass" className="lg:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg">Assigned Chats</CardTitle>
                <Button size="sm" onClick={() => navigate("/peer/chats")}>
                  Open Active Chats
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {loading ? (
                  <p className="text-sm text-muted-foreground">Loading assigned chats...</p>
                ) : !data?.recent_sessions?.length ? (
                  <p className="text-sm text-muted-foreground">No assigned chats yet.</p>
                ) : (
                  data.recent_sessions.map((row) => (
                    <button
                      key={row.id}
                      onClick={() => navigate(`/peer/chats?session=${row.id}`)}
                      className="w-full text-left rounded-xl border border-border/60 bg-secondary/20 p-4 hover:bg-secondary/40 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-foreground truncate">{row.student_label}</p>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary capitalize">
                          {row.status}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Last activity: {row.updated_at ? new Date(row.updated_at).toLocaleString() : "--"}
                      </p>
                    </button>
                  ))
                )}
              </CardContent>
            </Card>

            <Card variant="glass">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Shield className="h-5 w-5 text-primary" />
                  Safety Rules
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>Do not attempt to identify students.</p>
                <p>Use chat support only for low-risk cases.</p>
                <p>Escalate immediately for urgent concerns.</p>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => navigate("/peer/ethics")}
                >
                  Open Ethics Guidelines
                </Button>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
};

export default PeerDashboard;

