import { useEffect, useState } from "react";
import { AlertTriangle, Clock3 } from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { api, getApiErrorMessage } from "@/lib/api";
import { toast } from "sonner";
import { peerCounselorNavItems } from "@/config/counselorNavItems";

type EscalationRow = {
  id: number;
  session_id: number;
  student_label: string;
  escalation_type: "peer_to_counselor" | "urgent_flag" | "panic";
  severity: "low" | "medium" | "high" | "critical";
  reason?: string;
  escalated_to?: string;
  created_at: string;
};

const severityClass: Record<string, string> = {
  low: "bg-success/15 text-success",
  medium: "bg-warning/15 text-warning",
  high: "bg-orange-500/15 text-orange-600",
  critical: "bg-destructive/15 text-destructive",
};

const PeerEscalatedCases = () => {
  const { user } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || "Peer Counselor";
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [rows, setRows] = useState<EscalationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const response = await api.getPeerEscalations();
      setRows(Array.isArray(response) ? response : []);
    } catch (error: unknown) {
      const msg = getApiErrorMessage(error, "Failed to load escalated cases");
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar
        items={[...peerCounselorNavItems]}
        userType="peer"
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-72 pl-0">
        <DashboardHeader title="Escalated Cases" onMenuClick={() => setSidebarOpen(true)} />

        <main className="p-4 lg:p-6">
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-warning" />
                Escalation Audit Trail
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading escalations...</p>
              ) : loadError ? (
                <div className="flex flex-col items-center gap-3 py-4">
                  <p className="text-sm text-destructive">{loadError}</p>
                  <Button size="sm" variant="outline" onClick={() => void load()}>
                    Retry
                  </Button>
                </div>
              ) : rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No escalated cases yet.</p>
              ) : (
                rows.map((row) => (
                  <div
                    key={row.id}
                    className="rounded-xl border border-border/60 bg-secondary/20 p-4 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-foreground">{row.student_label}</p>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="capitalize">
                          {row.escalation_type.replace(/_/g, " ")}
                        </Badge>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full capitalize ${severityClass[row.severity] || ""}`}
                        >
                          {row.severity}
                        </span>
                      </div>
                    </div>
                    {row.reason && <p className="text-sm text-muted-foreground">{row.reason}</p>}
                    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                      <span>Session #{row.session_id}</span>
                      <span>Escalated to: {row.escalated_to || "Counselor"}</span>
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="h-3 w-3" />
                        {row.created_at ? new Date(row.created_at).toLocaleString() : "--"}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default PeerEscalatedCases;

