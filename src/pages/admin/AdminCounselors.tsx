import { useEffect, useMemo, useState } from "react";
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
  FilterX,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

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

const getStaffRoles = (user: any) =>
  (user?.roles ?? []).filter((role: any) =>
    role?.role === "counselor" || role?.role === "peer_counselor"
  );

const isStaffApproved = (user: any) =>
  getStaffRoles(user).some((role: any) => Boolean(role?.approved));

const getPrimaryStaffRole = (user: any) => {
  const roles = getStaffRoles(user);
  if (roles.some((role: any) => role?.role === "counselor")) return "counselor";
  if (roles.some((role: any) => role?.role === "peer_counselor")) return "peer_counselor";
  return null;
};

const formatStaffRole = (role: string | null) => {
  if (role === "peer_counselor") return "Peer Counselor";
  if (role === "counselor") return "Counselor";
  return "Staff";
};

const AdminCounselors = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split('@')[0] || "Admin";

  const [counselors, setCounselors] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "approved" | "pending" | "online">("all");

  useEffect(() => {
    const loadCounselors = async () => {
      try {
        setIsLoading(true);
        const data = await api.getCounselors();
        setCounselors(data || []);
      } catch (error) {
        console.error("Failed to load counselors:", error);
        toast.error("Failed to load counselors");
      } finally {
        setIsLoading(false);
      }
    };

    if (user) loadCounselors();
  }, [user]);

  const refreshCounselors = async () => {
    const data = await api.getCounselors();
    setCounselors(data || []);
    setSelectedIds(new Set());
  };

  const stats = useMemo(() => {
    const total = counselors.length;
    const approved = counselors.filter((c) => isStaffApproved(c)).length;
    const pending = total - approved;
    const online = counselors.filter((c) => c.is_online).length;
    return {
      total,
      approved,
      pending,
      online,
    };
  }, [counselors]);

  const handleApprove = async (id: number) => {
    try {
      setIsSaving(true);
      await api.approveCounselor(id);
      toast.success("Account approved");
      await refreshCounselors();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to approve account");
    } finally {
      setIsSaving(false);
    }
  };

  const handleReject = async (id: number) => {
    const confirmed = window.confirm("Remove this staff account?");
    if (!confirmed) return;

    try {
      setIsSaving(true);
      await api.rejectCounselor(id);
      toast.success("Account removed");
      await refreshCounselors();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to remove account");
    } finally {
      setIsSaving(false);
    }
  };

  const handleApproveSelected = async () => {
    if (selectedIds.size === 0) return;
    try {
      setIsSaving(true);
      await api.approveCounselorsBulk(Array.from(selectedIds));
      toast.success("Selected accounts approved");
      await refreshCounselors();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to approve selected accounts");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRejectSelected = async () => {
    if (selectedIds.size === 0) return;

    const confirmed = window.confirm(
      `Remove ${selectedIds.size} selected staff account(s)?`
    );
    if (!confirmed) return;

    try {
      setIsSaving(true);
      await Promise.all(Array.from(selectedIds).map((id) => api.rejectCounselor(id)));
      toast.success("Selected accounts removed");
      await refreshCounselors();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to remove selected accounts");
    } finally {
      setIsSaving(false);
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredCounselors = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();
    return counselors.filter((counselor) => {
      const name = String(counselor.profile?.full_name || counselor.name || "").toLowerCase();
      const email = String(counselor.email || "").toLowerCase();
      const idText = String(counselor.id || "");
      const staffRole = getPrimaryStaffRole(counselor);
      const roleText = formatStaffRole(staffRole).toLowerCase();
      const approved = isStaffApproved(counselor);
      const isOnline = Boolean(counselor.is_online);

      const matchesSearch =
        search.length === 0 ||
        name.includes(search) ||
        email.includes(search) ||
        idText.includes(search) ||
        roleText.includes(search);

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "approved" && approved) ||
        (statusFilter === "pending" && !approved) ||
        (statusFilter === "online" && isOnline);

      return matchesSearch && matchesStatus;
    });
  }, [counselors, searchQuery, statusFilter]);

  const allVisibleCounselorIds = useMemo(
    () => filteredCounselors.map((c) => c.id),
    [filteredCounselors]
  );

  const toggleSelectAllCounselors = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected =
        allVisibleCounselorIds.length > 0 && allVisibleCounselorIds.every((id) => next.has(id));
      if (allSelected) {
        allVisibleCounselorIds.forEach((id) => next.delete(id));
      } else {
        allVisibleCounselorIds.forEach((id) => next.add(id));
      }
      return next;
    });
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
          title="Staff Account Management"
          onMenuClick={() => setSidebarOpen(true)}
        />

        <main className="p-4 lg:p-6 space-y-6">
          <div className="grid gap-4 md:grid-cols-4">
            <Card variant="glass" className="text-center">
              <CardContent className="pt-6">
                <p className="text-4xl font-bold text-primary">{stats.total}</p>
                <p className="text-muted-foreground">Total Staff Accounts</p>
              </CardContent>
            </Card>
            <Card variant="glass" className="text-center">
              <CardContent className="pt-6">
                <p className="text-4xl font-bold text-success">{stats.online}</p>
                <p className="text-muted-foreground">Online Now</p>
              </CardContent>
            </Card>
            <Card variant="glass" className="text-center">
              <CardContent className="pt-6">
                <p className="text-4xl font-bold text-warning">{stats.pending}</p>
                <p className="text-muted-foreground">Pending Approval</p>
              </CardContent>
            </Card>
            <Card variant="glass" className="text-center">
              <CardContent className="pt-6">
                <p className="text-4xl font-bold text-info">{stats.approved}</p>
                <p className="text-muted-foreground">Approved</p>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative max-w-md w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search staff by name, email, role, or ID..."
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={statusFilter === "all" ? "default" : "outline"}
                onClick={() => setStatusFilter("all")}
              >
                All
              </Button>
              <Button
                size="sm"
                variant={statusFilter === "approved" ? "default" : "outline"}
                onClick={() => setStatusFilter("approved")}
              >
                Approved
              </Button>
              <Button
                size="sm"
                variant={statusFilter === "pending" ? "default" : "outline"}
                onClick={() => setStatusFilter("pending")}
              >
                Pending
              </Button>
              <Button
                size="sm"
                variant={statusFilter === "online" ? "default" : "outline"}
                onClick={() => setStatusFilter("online")}
              >
                Online
              </Button>
              {(statusFilter !== "all" || searchQuery.trim().length > 0) && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setStatusFilter("all");
                    setSearchQuery("");
                  }}
                >
                  <FilterX className="h-4 w-4 mr-1" />
                  Clear
                </Button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-3 items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {filteredCounselors.length} of {counselors.length} staff accounts
            </p>
            <div className="flex flex-wrap gap-3 items-center">
            <Checkbox
              checked={
                allVisibleCounselorIds.length > 0 &&
                allVisibleCounselorIds.every((id) => selectedIds.has(id))
              }
              onCheckedChange={toggleSelectAllCounselors}
              disabled={isLoading || isSaving || allVisibleCounselorIds.length === 0}
            />
            <span className="text-sm text-muted-foreground">
              Select visible ({allVisibleCounselorIds.length})
            </span>
            <Button
              size="sm"
              onClick={handleApproveSelected}
              disabled={isLoading || isSaving || selectedIds.size === 0}
            >
              Accept Selected
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleRejectSelected}
              disabled={isLoading || isSaving || selectedIds.size === 0}
            >
              Remove Selected
            </Button>
            </div>
          </div>

          <Card variant="glass">
            <CardHeader>
              <CardTitle className="text-lg">All Staff Accounts</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading staff accounts...</p>
              ) : (
                <div className="space-y-4">
                  {filteredCounselors.map((counselor) => {
                    const name = counselor.profile?.full_name || counselor.name || "Unknown";
                    const email = counselor.email || "N/A";
                    const staffRole = getPrimaryStaffRole(counselor);
                    const roleLabel = formatStaffRole(staffRole);
                    const approved = isStaffApproved(counselor);
                    const status = approved ? "approved" : "pending";
                    const isChecked = selectedIds.has(counselor.id);
                    const presence = counselor.is_online ? "online" : "offline";
                    return (
                      <div
                        key={counselor.id}
                        className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl bg-secondary/30"
                      >
                        <div className="flex items-center gap-4">
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={() => toggleSelect(counselor.id)}
                            disabled={isSaving}
                          />
                          <div className="h-12 w-12 rounded-full bg-info/20 flex items-center justify-center relative">
                            <span className="text-info font-medium">
                              {name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{name}</p>
                            <p className="text-sm text-muted-foreground">{email}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-sm text-muted-foreground">ID: {counselor.id}</span>
                          <Badge variant="outline" className="capitalize">
                            {roleLabel}
                          </Badge>
                          <Badge
                            variant="secondary"
                            className={
                              status === "approved"
                                ? "capitalize border-success/40 bg-success/15 text-success"
                                : "capitalize border-warning/40 bg-warning/15 text-warning"
                            }
                          >
                            {status}
                          </Badge>
                          <Badge
                            variant="secondary"
                            className={
                              presence === "online"
                                ? "capitalize border-success/40 bg-success/15 text-success"
                                : "capitalize border-muted bg-muted/60 text-muted-foreground"
                            }
                          >
                            {presence}
                          </Badge>
                          {status === "pending" ? (
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => handleApprove(counselor.id)}
                              disabled={isSaving}
                            >
                              Accept
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant={status === "pending" ? "ghost" : "outline"}
                            onClick={() => handleReject(counselor.id)}
                            disabled={isSaving}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  {filteredCounselors.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No staff accounts match the current search or filter.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default AdminCounselors;
