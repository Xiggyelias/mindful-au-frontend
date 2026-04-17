import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard,
  Users,
  UserCheck,
  BarChart3,
  Brain,
  AlertTriangle,
  FileText,
  Settings,
  Search,
  Download,
  RefreshCcw,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { toast } from "sonner";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/admin/dashboard" },
  { label: "Students", icon: Users, path: "/admin/students" },
  { label: "Counselors", icon: UserCheck, path: "/admin/counselors" },
  { label: "Analytics", icon: BarChart3, path: "/admin/analytics" },
  { label: "AI Reports", icon: Brain, path: "/admin/ai-reports" },
  { label: "Alerts", icon: AlertTriangle, path: "/admin/alerts" },
  { label: "Logs", icon: FileText, path: "/admin/logs" },
  { label: "Settings", icon: Settings, path: "/admin/settings" },
];

type LogType = "all" | "auth" | "session" | "alert" | "system";

const typeFilters: Array<{ label: string; value: LogType }> = [
  { label: "All", value: "all" },
  { label: "Auth", value: "auth" },
  { label: "Session", value: "session" },
  { label: "Alert", value: "alert" },
  { label: "System", value: "system" },
];

const csvEscape = (value: unknown): string => {
  const stringValue = String(value ?? "");
  return `"${stringValue.replace(/"/g, '""')}"`;
};

const AdminLogs = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || "Admin";

  const [logs, setLogs] = useState<any[]>([]);
  const [stats, setStats] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<LogType>("all");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    try {
      setIsLoading(true);
      setErrorMessage(null);

      const params: any = {};
      if (filterType !== "all") {
        params.type = filterType;
      }
      if (searchQuery.trim().length > 0) {
        params.search = searchQuery.trim();
      }

      const [logData, statsData] = await Promise.all([
        api.getActivityLogs(params),
        api.getActivityLogStats().catch(() => null),
      ]);

      setLogs(Array.isArray(logData) ? logData : []);
      setStats(statsData);
    } catch (error: any) {
      const message = error?.response?.data?.message || "Failed to load activity logs";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [filterType, searchQuery]);

  useEffect(() => {
    if (user) {
      void loadLogs();
    }
  }, [user, loadLogs]);

  const handleSearch = () => {
    const nextQuery = searchInput.trim();
    if (nextQuery === searchQuery) {
      void loadLogs();
      return;
    }
    setSearchQuery(nextQuery);
  };

  const getLogTypeColor = (type: string) => {
    switch (type) {
      case "auth":
        return "text-info";
      case "session":
        return "text-success";
      case "alert":
        return "text-destructive";
      case "system":
        return "text-warning";
      default:
        return "text-muted-foreground";
    }
  };

  const visibleTypeCounts = useMemo(() => {
    return logs.reduce((acc: Record<string, number>, log) => {
      const type = String(log.type || "unknown");
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});
  }, [logs]);

  const handleExportLogs = () => {
    if (logs.length === 0) {
      toast.error("No logs available to export");
      return;
    }

    const header = ["Timestamp", "Action", "Description", "User", "Type", "IP Address"];
    const rows = logs.map((log) => [
      log.timestamp,
      log.action,
      log.description ?? "",
      log.user,
      log.type,
      log.ip_address ?? "",
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map((cell) => csvEscape(cell)).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `activity-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);

    toast.success("Logs exported");
  };

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar
        items={navItems}
        userType="admin"
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-72">
        <DashboardHeader
          title="System Logs"
          onMenuClick={() => setSidebarOpen(true)}
        />

        <main className="p-4 lg:p-6 space-y-6">
          {errorMessage && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {errorMessage}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            <Card variant="glass">
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Total Logs</p>
                <p className="text-3xl font-bold text-foreground">{stats?.total_logs ?? logs.length}</p>
              </CardContent>
            </Card>
            <Card variant="glass">
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Today</p>
                <p className="text-3xl font-bold text-foreground">{stats?.today_logs ?? 0}</p>
              </CardContent>
            </Card>
            <Card variant="glass">
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Visible Alerts</p>
                <p className="text-3xl font-bold text-destructive">{visibleTypeCounts.alert ?? 0}</p>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {typeFilters.map((filter) => (
                <Button
                  key={filter.value}
                  size="sm"
                  variant={filterType === filter.value ? "default" : "outline"}
                  onClick={() => setFilterType(filter.value)}
                >
                  {filter.label}
                </Button>
              ))}
            </div>

            <div className="flex flex-col md:flex-row gap-4 justify-between">
              <div className="flex flex-col md:flex-row gap-4 flex-1">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search logs..."
                    className="pl-9"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  />
                </div>
                <Button variant="outline" className="gap-2" onClick={handleSearch}>
                  <Search className="h-4 w-4" />
                  Search
                </Button>
              </div>

              <div className="flex gap-3">
                <Button variant="outline" className="gap-2" onClick={() => void loadLogs()} disabled={isLoading}>
                  <RefreshCcw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
                <Button variant="outline" className="gap-2" onClick={handleExportLogs}>
                  <Download className="h-4 w-4" />
                  Export Logs
                </Button>
              </div>
            </div>
          </div>

          <Card variant="glass">
            <CardHeader>
              <CardTitle className="text-lg">Activity Logs</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading logs...</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border/50">
                        <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Timestamp</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Action</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Description</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">User</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                            No logs found
                          </td>
                        </tr>
                      ) : (
                        logs.map((log) => (
                          <tr key={log.id} className="border-b border-border/30 hover:bg-secondary/20">
                            <td className="py-3 px-4 text-sm text-muted-foreground font-mono">{log.timestamp}</td>
                            <td className="py-3 px-4 text-sm text-foreground">{log.action}</td>
                            <td className="py-3 px-4 text-sm text-muted-foreground">{log.description || "--"}</td>
                            <td className="py-3 px-4 text-sm text-foreground">{log.user}</td>
                            <td className="py-3 px-4">
                              <span className={`text-sm font-medium capitalize ${getLogTypeColor(log.type)}`}>
                                {log.type}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default AdminLogs;
