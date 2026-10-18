import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Bell,
  Clock3,
  MessageSquare,
  Radio,
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
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/hooks/useAuth";
import { useDailyTip } from "@/hooks/useDailyTip";
import { api, getApiErrorMessage } from "@/lib/api";
import { toast } from "sonner";
import { peerCounselorNavItems } from "@/config/counselorNavItems";

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

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!user?.id) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const load = async () => {
      try {
        setLoading(true);
        const next = await api.getPeerDashboard();
        if (!controller.signal.aborted) setData(next);
      } catch (error: unknown) {
        if (!controller.signal.aborted) {
          toast.error(getApiErrorMessage(error, "Failed to load peer dashboard"));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void load();
    return () => controller.abort();
  }, [user?.id]);

  const handleAvailabilityToggle = async (available: boolean) => {
    try {
      // Optimistic update
      setData((prev) => (prev ? { ...prev, availability: available } : prev));
      setSavingAvailability(true);
      
      const result = await api.updatePeerAvailability(available);
      
      // Confirm update with server response
      const serverAvailability = result?.available ?? result?.availability ?? available;
      setData((prev) => (prev ? { ...prev, availability: Boolean(serverAvailability) } : prev));
      toast.success(`Availability set to ${available ? "online" : "offline"}`);
    } catch (error: unknown) {
      // Restore previous state on error
      setData((prev) => (prev ? { ...prev, availability: !available } : prev));
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
        items={peerCounselorNavItems}
        userType="peer"
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-72 pl-0">
        <DashboardHeader title="Peer Support Dashboard" onMenuClick={() => setSidebarOpen(true)} />

        <main className="p-4 lg:p-6 space-y-6">
          <Card variant="glass" className="border-primary/20 relative z-10">
            <CardContent className="pt-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div>
                <h2 className="text-2xl font-display font-bold text-foreground">
                  First-line Support Center
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  You support anonymized students only. Escalate any urgent or high-risk concern immediately.
                </p>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-border/60 px-4 py-3 bg-secondary/20 whitespace-nowrap flex-shrink-0">
                <UserCheck2 className="h-4 w-4 text-primary flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-medium text-foreground">Availability</p>
                  <p className="text-xs text-muted-foreground min-h-[18px]">
                    {loading ? "Loading..." : data?.availability ? "Online for assignments" : "Offline"}
                  </p>
                </div>
                <Switch
                  checked={Boolean(data?.availability)}
                  onCheckedChange={handleAvailabilityToggle}
                  disabled={loading || savingAvailability}
                  aria-label="Toggle availability status"
                  className="flex-shrink-0"
                />
              </div>
            </CardContent>
          </Card>

          {/* Heart-to-Heart Spatial Lounge Hero Card */}
          <Card className="border-emerald-500/30 bg-gradient-to-r from-emerald-950/40 via-slate-900 to-teal-950/40 relative overflow-hidden shadow-xl">
            <div className="absolute right-0 top-0 bottom-0 w-1/3 opacity-15 pointer-events-none bg-[radial-gradient(circle_at_center,rgba(52,211,153,0.4)_0,transparent_70%)]" />
            <CardContent className="pt-6 flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400 animate-ping" />
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
                    Proximity Voice & Heart-to-Heart
                  </span>
                </div>
                <h3 className="text-xl font-display font-bold text-foreground">
                  Peer Spatial Meadow & Voice Lounge
                </h3>
                <p className="text-sm text-muted-foreground max-w-xl">
                  Step into the 2D audio meadow. Connect 1-on-1 with your assigned student to talk naturally with distance-based stereo sound, zen ambient music, and heart-to-heart voice chat.
                </p>
                <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground pt-1">
                  <span className="flex items-center gap-1.5 text-foreground font-medium">
                    🎧 3D Spatial Audio
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1.5 text-foreground font-medium">
                    🎙️ Request Audio to Talk
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1.5 text-foreground font-medium">
                    🦖 Custom Avatars & Emojis
                  </span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
                <Button
                  onClick={() => navigate("/peer/spatial-lounge")}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-6 h-11 rounded-xl shadow-lg shadow-emerald-950/50 flex items-center justify-center gap-2"
                >
                  <Radio className="w-4 h-4 animate-pulse" />
                  <span>Enter Spatial Lounge</span>
                </Button>
              </div>
            </CardContent>
          </Card>

          <DailyTipCard
            tip={dailyTip}
            isLoading={tipLoading}
            error={tipError}
            title="Your Wellness Corner"
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
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-16 rounded-xl bg-secondary/30 skeleton-shimmer" />
                    ))}
                  </div>
                ) : !data?.recent_sessions?.length ? (
                  <div className="text-center py-8 rounded-xl border border-dashed border-border/60 bg-secondary/10">
                    <p className="text-sm text-muted-foreground">No assigned chats yet.</p>
                  </div>
                ) : (
                  data.recent_sessions.map((row) => (
                    <button
                      key={row.id}
                      onClick={() => navigate(`/peer/chats?session=${row.id}`)}
                      className="w-full text-left rounded-xl border border-border/60 bg-secondary/20 p-4 hover:bg-secondary/40 glide-hover tap-spring transition-all duration-200"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-foreground truncate">{row.student_label}</p>
                        <span className={`text-xs px-2.5 py-0.5 rounded-full capitalize font-medium ${
                          row.status === "active"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                            : row.status === "pending"
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                            : "bg-muted text-muted-foreground"
                        }`}>
                          {row.status}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Last activity:{" "}
                        {row.updated_at
                          ? formatDistanceToNow(new Date(row.updated_at), { addSuffix: true })
                          : "--"}
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
                <Button
                  variant="outline"
                  className="w-full flex items-center justify-between"
                  onClick={() => navigate("/peer/escalations")}
                >
                  <span>View Escalation Trail</span>
                  {Boolean(data?.stats?.escalated_cases) && (
                    <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 px-2 py-0.5 rounded-full font-medium">
                      {data?.stats?.escalated_cases}
                    </span>
                  )}
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

