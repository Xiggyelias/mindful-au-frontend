import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Users,
  UserCheck,
  BarChart3,
  Brain,
  AlertTriangle,
  FileText,
  Settings,
  Bell,
  Shield,
  Mail,
  Database,
  Loader2,
  ShieldCheck,
  RefreshCcw,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { DailyTip, api, getApiErrorMessage } from "@/lib/api";
import { toast } from "sonner";
import { CardDescription } from "@/components/ui/card";

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

const defaultSettings: Record<string, any> = {
  panic_alerts: true,
  ai_risk_alerts: true,
  daily_reports: false,
  new_registrations: true,
  two_factor_auth: false,
  session_timeout: false,
  audit_logging: true,
  data_encryption: true,
  anonymous_mode_default: false,
  ai_auto_analysis: true,
  auto_backup: false,
  admin_email: "",
  support_email: "",
  crisis_hotline: "",
};

const settingLabels: Record<string, string> = {
  panic_alerts: "Panic Button Alerts",
  ai_risk_alerts: "AI Risk Alerts",
  daily_reports: "Daily Reports",
  new_registrations: "New Registrations",
  two_factor_auth: "Two-Factor Authentication",
  session_timeout: "Session Timeout",
  audit_logging: "Audit Logging",
  data_encryption: "Data Encryption",
  anonymous_mode_default: "Anonymous Mode Default",
  ai_auto_analysis: "AI Auto-Analysis",
  auto_backup: "Auto Backup",
  admin_email: "Admin Email",
  support_email: "Support Email",
  crisis_hotline: "Crisis Hotline",
};

type TipDraft = {
  title: string;
  content: string;
  category: string;
  audience: "all" | "student" | "counselor" | "peer_counselor" | "admin";
  mood_tags: string;
  priority: number;
  is_active: boolean;
};

const defaultTipDraft = (): TipDraft => ({
  title: "",
  content: "",
  category: "Wellness",
  audience: "all",
  mood_tags: "",
  priority: 0,
  is_active: true,
});

const AdminSettings = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split('@')[0] || "Admin";

  const [settings, setSettings] = useState<Record<string, any>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savingSwitchKey, setSavingSwitchKey] = useState<string | null>(null);
  const [backupRuns, setBackupRuns] = useState<any[]>([]);
  const [isLoadingBackups, setIsLoadingBackups] = useState(false);
  const [isVerifyingBackup, setIsVerifyingBackup] = useState(false);
  const [isRunningDrill, setIsRunningDrill] = useState(false);
  const [drillPath, setDrillPath] = useState("");
  const [tips, setTips] = useState<DailyTip[]>([]);
  const [tipsLoading, setTipsLoading] = useState(false);
  const [isSavingTip, setIsSavingTip] = useState(false);
  const [editingTipId, setEditingTipId] = useState<number | null>(null);
  const [tipDraft, setTipDraft] = useState<TipDraft>(defaultTipDraft);

  const loadBackupRuns = async () => {
    try {
      setIsLoadingBackups(true);
      const runs = await api.getBackupRuns({ limit: 10 });
      setBackupRuns(Array.isArray(runs) ? runs : []);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to load backup runs"));
    } finally {
      setIsLoadingBackups(false);
    }
  };

  const loadTips = async () => {
    try {
      setTipsLoading(true);
      const nextTips = await api.getTips();
      setTips(Array.isArray(nextTips) ? nextTips : []);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to load tip library"));
    } finally {
      setTipsLoading(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        setIsLoading(true);
        const [data] = await Promise.all([
          api.getSettings(),
          loadBackupRuns(),
          loadTips(),
        ]);
        setSettings({
          ...defaultSettings,
          ...data,
        });
      } catch (err: any) {
        toast.error(err?.response?.data?.message || "Failed to load settings");
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const updateLocalSetting = (key: string, value: any) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const savePartialSettings = async (partial: Record<string, any>, successMessage?: string) => {
    try {
      setIsSaving(true);
      const updated = await api.updateSettings(partial);
      setSettings((prev) => ({
        ...prev,
        ...updated,
      }));

      if (successMessage) {
        toast.success(successMessage);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to save settings");
      throw err;
    } finally {
      setIsSaving(false);
    }
  };

  const handleSwitchChange = async (key: string, value: boolean) => {
    const previousValue = settings[key];
    updateLocalSetting(key, value);
    setSavingSwitchKey(key);

    try {
      await savePartialSettings(
        { [key]: value },
        `${settingLabels[key] || "Setting"} updated`
      );
    } catch {
      updateLocalSetting(key, previousValue);
    } finally {
      setSavingSwitchKey(null);
    }
  };

  const handleSave = async () => {
    await savePartialSettings(settings, "Settings saved");
  };

  const handleClearCache = async () => {
    try {
      setIsSaving(true);
      await api.clearCache();
      toast.success("Cache cleared successfully");
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to clear cache");
    } finally {
      setIsSaving(false);
    }
  };

  const handleVerifyBackups = async () => {
    try {
      setIsVerifyingBackup(true);
      await api.verifyBackups();
      toast.success("Backup verification executed");
      await loadBackupRuns();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Backup verification failed"));
    } finally {
      setIsVerifyingBackup(false);
    }
  };

  const handleRunDrill = async () => {
    try {
      setIsRunningDrill(true);
      await api.runBackupDrill(drillPath);
      toast.success("Backup restore drill executed");
      await loadBackupRuns();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Backup restore drill failed"));
    } finally {
      setIsRunningDrill(false);
    }
  };

  const resetTipEditor = () => {
    setEditingTipId(null);
    setTipDraft(defaultTipDraft());
  };

  const updateTipDraft = <K extends keyof TipDraft>(key: K, value: TipDraft[K]) => {
    setTipDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleEditTip = (tip: DailyTip) => {
    setEditingTipId(tip.id);
    setTipDraft({
      title: tip.title ?? "",
      content: tip.content ?? "",
      category: tip.category ?? "Wellness",
      audience: (tip.audience as TipDraft["audience"]) ?? "all",
      mood_tags: Array.isArray(tip.mood_tags) ? tip.mood_tags.join(", ") : "",
      priority: Number(tip.priority ?? 0),
      is_active: tip.is_active !== false,
    });
  };

  const handleSaveTip = async () => {
    const payload = {
      title: tipDraft.title.trim(),
      content: tipDraft.content.trim(),
      category: tipDraft.category.trim(),
      audience: tipDraft.audience,
      mood_tags: tipDraft.mood_tags
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      priority: Number.isFinite(Number(tipDraft.priority)) ? Number(tipDraft.priority) : 0,
      is_active: tipDraft.is_active,
    };

    if (!payload.title || !payload.content || !payload.category) {
      toast.error("Title, content, and category are required.");
      return;
    }

    try {
      setIsSavingTip(true);
      const savedTip = editingTipId
        ? await api.updateTip(editingTipId, payload)
        : await api.createTip(payload);

      setTips((prev) => {
        const next = editingTipId
          ? prev.map((tip) => (tip.id === savedTip.id ? savedTip : tip))
          : [savedTip, ...prev];
        return next;
      });

      toast.success(editingTipId ? "Tip updated." : "Tip created.");
      resetTipEditor();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to save tip"));
    } finally {
      setIsSavingTip(false);
    }
  };

  const handleDeleteTip = async (tipId: number) => {
    try {
      setIsSavingTip(true);
      await api.deleteTip(tipId);
      setTips((prev) => prev.filter((tip) => tip.id !== tipId));
      if (editingTipId === tipId) {
        resetTipEditor();
      }
      toast.success("Tip deleted.");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to delete tip"));
    } finally {
      setIsSavingTip(false);
    }
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
          title="Settings"
          onMenuClick={() => setSidebarOpen(true)}
        />

        <main className="p-4 lg:p-6 space-y-6">
          {isLoading && (
            <p className="text-sm text-muted-foreground">Loading settings...</p>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Notifications */}
            <Card variant="glass">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Bell className="h-5 w-5 text-primary" />
                  Notification Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Panic Button Alerts</Label>
                    <p className="text-sm text-muted-foreground">Receive immediate alerts</p>
                  </div>
                  <Switch
                    checked={!!settings.panic_alerts}
                    onCheckedChange={(v) => void handleSwitchChange("panic_alerts", v)}
                    disabled={isLoading || isSaving || savingSwitchKey === "panic_alerts"}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>AI Risk Alerts</Label>
                    <p className="text-sm text-muted-foreground">Get notified of high-risk cases</p>
                  </div>
                  <Switch
                    checked={!!settings.ai_risk_alerts}
                    onCheckedChange={(v) => void handleSwitchChange("ai_risk_alerts", v)}
                    disabled={isLoading || isSaving || savingSwitchKey === "ai_risk_alerts"}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Daily Reports</Label>
                    <p className="text-sm text-muted-foreground">Receive daily summary email</p>
                  </div>
                  <Switch
                    checked={!!settings.daily_reports}
                    onCheckedChange={(v) => void handleSwitchChange("daily_reports", v)}
                    disabled={isLoading || isSaving || savingSwitchKey === "daily_reports"}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>New Registrations</Label>
                    <p className="text-sm text-muted-foreground">Alert on new counselor registrations</p>
                  </div>
                  <Switch
                    checked={!!settings.new_registrations}
                    onCheckedChange={(v) => void handleSwitchChange("new_registrations", v)}
                    disabled={isLoading || isSaving || savingSwitchKey === "new_registrations"}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Security */}
            <Card variant="glass">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Shield className="h-5 w-5 text-success" />
                  Security Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Two-Factor Authentication</Label>
                    <p className="text-sm text-muted-foreground">Require 2FA for all admins</p>
                  </div>
                  <Switch
                    checked={!!settings.two_factor_auth}
                    onCheckedChange={(v) => void handleSwitchChange("two_factor_auth", v)}
                    disabled={isLoading || isSaving || savingSwitchKey === "two_factor_auth"}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Session Timeout</Label>
                    <p className="text-sm text-muted-foreground">Auto-logout after inactivity</p>
                  </div>
                  <Switch
                    checked={!!settings.session_timeout}
                    onCheckedChange={(v) => void handleSwitchChange("session_timeout", v)}
                    disabled={isLoading || isSaving || savingSwitchKey === "session_timeout"}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Audit Logging</Label>
                    <p className="text-sm text-muted-foreground">Track all admin actions</p>
                  </div>
                  <Switch
                    checked={!!settings.audit_logging}
                    onCheckedChange={(v) => void handleSwitchChange("audit_logging", v)}
                    disabled={isLoading || isSaving || savingSwitchKey === "audit_logging"}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Data Encryption</Label>
                    <p className="text-sm text-muted-foreground">End-to-end encryption</p>
                  </div>
                  <Switch
                    checked={!!settings.data_encryption}
                    onCheckedChange={(v) => void handleSwitchChange("data_encryption", v)}
                    disabled={isLoading || isSaving || savingSwitchKey === "data_encryption"}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Email Configuration */}
            <Card variant="glass">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Mail className="h-5 w-5 text-info" />
                  Email Configuration
                </CardTitle>
                <CardDescription>These are global contact addresses used in notifications.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Admin Email</Label>
                  <Input
                    value={settings.admin_email ?? ""}
                    onChange={(e) => updateLocalSetting("admin_email", e.target.value)}
                    className="mt-2"
                    disabled={isSaving}
                  />
                </div>
                <div>
                  <Label>Support Email</Label>
                  <Input
                    value={settings.support_email ?? ""}
                    onChange={(e) => updateLocalSetting("support_email", e.target.value)}
                    className="mt-2"
                    disabled={isSaving}
                  />
                </div>
                <div>
                  <Label>Crisis Hotline</Label>
                  <Input
                    value={settings.crisis_hotline ?? ""}
                    onChange={(e) => updateLocalSetting("crisis_hotline", e.target.value)}
                    className="mt-2"
                    disabled={isSaving}
                  />
                </div>
                <Button variant="outline" className="w-full" onClick={handleSave} disabled={isSaving || isLoading}>
                  {isSaving ? "Saving..." : "Save Changes"}
                </Button>
              </CardContent>
            </Card>

            {/* System */}
            <Card variant="glass">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Database className="h-5 w-5 text-warning" />
                  System Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Anonymous Mode Default</Label>
                    <p className="text-sm text-muted-foreground">Default student anonymity</p>
                  </div>
                  <Switch
                    checked={!!settings.anonymous_mode_default}
                    onCheckedChange={(v) => void handleSwitchChange("anonymous_mode_default", v)}
                    disabled={isLoading || isSaving || savingSwitchKey === "anonymous_mode_default"}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>AI Auto-Analysis</Label>
                    <p className="text-sm text-muted-foreground">Automatic session analysis</p>
                  </div>
                  <Switch
                    checked={!!settings.ai_auto_analysis}
                    onCheckedChange={(v) => void handleSwitchChange("ai_auto_analysis", v)}
                    disabled={isLoading || isSaving || savingSwitchKey === "ai_auto_analysis"}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Auto Backup</Label>
                    <p className="text-sm text-muted-foreground">Daily database backup</p>
                  </div>
                  <Switch
                    checked={!!settings.auto_backup}
                    onCheckedChange={(v) => void handleSwitchChange("auto_backup", v)}
                    disabled={isLoading || isSaving || savingSwitchKey === "auto_backup"}
                  />
                </div>
                <div className="rounded-lg border border-border/60 bg-secondary/30 p-3">
                  <Label>Video Call Timing Policy</Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Calls are allowed only during their scheduled appointment window.
                    Early joins and extra grace time are disabled.
                  </p>
                </div>
                <div className="rounded-lg border border-border/60 bg-secondary/30 p-3 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Label className="flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-success" />
                        Backup & Disaster Recovery
                      </Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Verify backup integrity and run periodic restore drills.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void loadBackupRuns()}
                      disabled={isLoadingBackups}
                    >
                      <RefreshCcw className={`h-4 w-4 ${isLoadingBackups ? "animate-spin" : ""}`} />
                    </Button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleVerifyBackups()}
                      disabled={isVerifyingBackup || isRunningDrill}
                    >
                      {isVerifyingBackup ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Verifying
                        </>
                      ) : (
                        "Verify Latest Backup"
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleRunDrill()}
                      disabled={isRunningDrill || isVerifyingBackup}
                    >
                      {isRunningDrill ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Running Drill
                        </>
                      ) : (
                        "Run Restore Drill"
                      )}
                    </Button>
                  </div>
                  <div>
                    <Label>Optional Drill Backup Path</Label>
                    <Input
                      value={drillPath}
                      onChange={(event) => setDrillPath(event.target.value)}
                      placeholder="backups/system-backup-YYYYmmdd-HHMMSS.json.enc"
                      className="mt-2"
                      disabled={isVerifyingBackup || isRunningDrill}
                    />
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Recent Backup Runs</p>
                    {isLoadingBackups ? (
                      <p className="text-xs text-muted-foreground">Loading backup history...</p>
                    ) : backupRuns.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No backup runs available.</p>
                    ) : (
                      <div className="space-y-1">
                        {backupRuns.slice(0, 5).map((run: any) => (
                          <div
                            key={String(run.id)}
                            className="flex items-center justify-between rounded-md border border-border/60 px-2 py-1 text-xs"
                          >
                            <span className="truncate">{run.file_path || "No file path recorded"}</span>
                            <span className="ml-2 text-muted-foreground">
                              {run.status} / {run.verification_status}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="grid gap-3">
                  <Button variant="outline" className="w-full" onClick={handleSave} disabled={isSaving || isLoading}>
                    {isSaving ? "Saving..." : "Save System Settings"}
                  </Button>
                  <Button
                    variant="destructive"
                    className="w-full"
                    type="button"
                    onClick={handleClearCache}
                    disabled={isSaving || isLoading}
                  >
                    Clear Cache
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card variant="glass">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Bell className="h-5 w-5 text-primary" />
                Wellness Tip Library
              </CardTitle>
              <CardDescription>
                Manage the supportive daily wellness tips shown across student, counselor, admin, and peer dashboards.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                <div className="space-y-4 rounded-2xl border border-border/60 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">
                        {editingTipId ? "Edit Tip" : "Create New Tip"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Tips rotate automatically by day and audience. Keep them short, supportive, and limited to 1 to 3 sentences.
                      </p>
                    </div>
                    {editingTipId ? (
                      <Button type="button" variant="ghost" size="sm" onClick={resetTipEditor}>
                        Reset
                      </Button>
                    ) : null}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <Label>Title</Label>
                      <Input
                        value={tipDraft.title}
                        onChange={(event) => updateTipDraft("title", event.target.value)}
                        className="mt-2"
                        disabled={isSavingTip}
                      />
                    </div>
                    <div>
                      <Label>Category</Label>
                      <Input
                        value={tipDraft.category}
                        onChange={(event) => updateTipDraft("category", event.target.value)}
                        placeholder="Stress Management"
                        className="mt-2"
                        disabled={isSavingTip}
                      />
                    </div>
                    <div>
                      <Label>Audience</Label>
                      <Select
                        value={tipDraft.audience}
                        onValueChange={(value) => updateTipDraft("audience", value as TipDraft["audience"])}
                        disabled={isSavingTip}
                      >
                        <SelectTrigger className="mt-2">
                          <SelectValue placeholder="Select audience" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All users</SelectItem>
                          <SelectItem value="student">Students</SelectItem>
                          <SelectItem value="counselor">Counselors</SelectItem>
                          <SelectItem value="peer_counselor">Peer counselors</SelectItem>
                          <SelectItem value="admin">Admins</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="sm:col-span-2">
                      <Label>Tip Content</Label>
                      <Textarea
                        value={tipDraft.content}
                        onChange={(event) => updateTipDraft("content", event.target.value)}
                        placeholder="Take 5 slow breaths and let your shoulders relax before your next task."
                        className="mt-2 min-h-[120px]"
                        disabled={isSavingTip}
                      />
                    </div>
                    <div>
                      <Label>Mood Tags</Label>
                      <Input
                        value={tipDraft.mood_tags}
                        onChange={(event) => updateTipDraft("mood_tags", event.target.value)}
                        placeholder="stressed, tired, low"
                        className="mt-2"
                        disabled={isSavingTip}
                      />
                    </div>
                    <div>
                      <Label>Priority</Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={String(tipDraft.priority)}
                        onChange={(event) => updateTipDraft("priority", Number(event.target.value || 0))}
                        className="mt-2"
                        disabled={isSavingTip}
                      />
                    </div>
                    <div className="sm:col-span-2 flex items-center justify-between rounded-xl border border-border/60 px-4 py-3">
                      <div>
                        <Label>Active</Label>
                        <p className="text-sm text-muted-foreground">Inactive tips stay in the library but stop rotating.</p>
                      </div>
                      <Switch
                        checked={tipDraft.is_active}
                        onCheckedChange={(value) => updateTipDraft("is_active", value)}
                        disabled={isSavingTip}
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Button type="button" onClick={() => void handleSaveTip()} disabled={isSavingTip}>
                      {isSavingTip ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Saving
                        </>
                      ) : editingTipId ? (
                        "Update Tip"
                      ) : (
                        "Create Tip"
                      )}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => void loadTips()} disabled={tipsLoading || isSavingTip}>
                      {tipsLoading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Refreshing
                        </>
                      ) : (
                        "Refresh Library"
                      )}
                    </Button>
                  </div>
                </div>

                <div className="space-y-3 rounded-2xl border border-border/60 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">Stored Tips</p>
                      <p className="text-sm text-muted-foreground">{tips.length} tip entries available.</p>
                    </div>
                  </div>

                  {tipsLoading ? (
                    <p className="text-sm text-muted-foreground">Loading tip library...</p>
                  ) : tips.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No tips have been created yet.</p>
                  ) : (
                    <div className="space-y-3 max-h-[32rem] overflow-y-auto pr-1">
                      {tips.map((tip) => (
                        <div key={tip.id} className="rounded-xl border border-border/60 bg-secondary/20 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-2">
                              <div className="flex flex-wrap gap-2">
                                <Badge variant={tip.is_active === false ? "outline" : "secondary"}>
                                  {tip.is_active === false ? "Inactive" : "Active"}
                                </Badge>
                                <Badge variant="outline">{tip.audience}</Badge>
                                <Badge variant="outline">{tip.category}</Badge>
                              </div>
                              <p className="font-medium text-foreground">{tip.title}</p>
                              <p className="text-sm text-muted-foreground line-clamp-3">{tip.content}</p>
                              {Array.isArray(tip.mood_tags) && tip.mood_tags.length > 0 ? (
                                <p className="text-xs text-muted-foreground">
                                  Mood tags: {tip.mood_tags.join(", ")}
                                </p>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button type="button" variant="outline" size="sm" onClick={() => handleEditTip(tip)} disabled={isSavingTip}>
                                Edit
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() => void handleDeleteTip(tip.id)}
                                disabled={isSavingTip}
                              >
                                Delete
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default AdminSettings;
