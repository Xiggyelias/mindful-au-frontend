import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, ShieldAlert } from "lucide-react";
import { api, getApiErrorMessage } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type IntakeRole = "counselor" | "admin";

interface IntakeScreenProps {
  role: IntakeRole;
}

const intakeRiskQuestions = [
  { key: "immediate_danger", label: "Immediate danger right now" },
  { key: "self_harm_thoughts", label: "Self-harm thoughts" },
  { key: "panic_attacks", label: "Panic attacks" },
  { key: "sleep_disruption", label: "Severe sleep disruption" },
  { key: "academic_decline", label: "Academic/work decline" },
  { key: "social_withdrawal", label: "Social withdrawal" },
] as const;

const intakeStatusOptions = ["new", "routed", "escalated", "closed"] as const;
const intakeRiskLevels = ["low", "moderate", "high"] as const;

const toRows = (payload: any): any[] => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

const toMeta = (payload: any) => {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if (payload.meta && typeof payload.meta === "object") {
    return payload.meta;
  }
  return null;
};

const toBadgeVariant = (value?: string) => {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "high" || normalized === "escalated") return "destructive" as const;
  if (normalized === "moderate" || normalized === "routed") return "secondary" as const;
  if (normalized === "resolved" || normalized === "closed") return "default" as const;
  return "outline" as const;
};

export const IntakeScreen = ({ role }: IntakeScreenProps) => {
  const canAcknowledge = role === "admin" || role === "counselor";
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isActioningAlertId, setIsActioningAlertId] = useState<number | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [meta, setMeta] = useState<any | null>(null);
  const [concernsText, setConcernsText] = useState("");
  const [summary, setSummary] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [consentAcknowledged, setConsentAcknowledged] = useState(true);
  const [submitterType, setSubmitterType] = useState<"student" | "staff">("staff");
  const [riskAnswers, setRiskAnswers] = useState<Record<string, boolean>>({});

  const loadRows = useCallback(async () => {
    try {
      setIsLoading(true);
      const payload = await api.getIntakeSubmissions({
        status: statusFilter === "all" ? undefined : statusFilter,
        risk_level: riskFilter === "all" ? undefined : riskFilter,
        page,
        per_page: perPage,
      });
      setRows(toRows(payload));
      setMeta(toMeta(payload));
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to load intake submissions."));
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, riskFilter, page, perPage]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const totalPages = useMemo(() => {
    const lastPage = Number(meta?.last_page);
    if (Number.isFinite(lastPage) && lastPage > 0) {
      return Math.floor(lastPage);
    }
    return 1;
  }, [meta]);

  const handleCreateIntake = async () => {
    const presentingConcerns = concernsText
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    if (presentingConcerns.length === 0) {
      toast.error("Please enter at least one presenting concern.");
      return;
    }
    if (!consentAcknowledged) {
      toast.error("Consent acknowledgement is required.");
      return;
    }

    try {
      setIsSubmitting(true);
      const payload = await api.createIntakeSubmission({
        submitter_type: submitterType,
        is_anonymous: isAnonymous,
        presenting_concerns: presentingConcerns,
        risk_answers: riskAnswers,
        consent_acknowledged: true,
        summary: summary.trim() || null,
      });

      const riskLevel = String(payload?.risk_level || "low").toLowerCase();
      toast.success(
        riskLevel === "high"
          ? "Intake submitted and marked high-risk for urgent review."
          : "Intake submitted successfully."
      );

      setConcernsText("");
      setSummary("");
      setIsAnonymous(false);
      setRiskAnswers({});
      setConsentAcknowledged(true);
      setPage(1);
      void loadRows();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to submit intake."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRiskToggle = (key: string, checked: boolean) => {
    setRiskAnswers((previous) => ({
      ...previous,
      [key]: checked,
    }));
  };

  const handleAcknowledgeAlert = async (alertId: number, status: "acknowledged" | "resolved") => {
    try {
      setIsActioningAlertId(alertId);
      await api.acknowledgeRiskAlert(alertId, status);
      toast.success(
        status === "resolved" ? "Risk alert marked resolved." : "Risk alert acknowledged."
      );
      void loadRows();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to update risk alert."));
    } finally {
      setIsActioningAlertId(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card variant="glass">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-primary" />
            New Intake Submission
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-2 text-sm">
              <span className="text-muted-foreground">Submitter Type</span>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm w-full"
                value={submitterType}
                onChange={(event) => setSubmitterType(event.target.value as "student" | "staff")}
              >
                <option value="student">Student</option>
                <option value="staff">Staff</option>
              </select>
            </label>

            <label className="flex items-center gap-2 text-sm mt-8">
              <input
                type="checkbox"
                checked={isAnonymous}
                onChange={(event) => setIsAnonymous(event.target.checked)}
              />
              Anonymous submission
            </label>

            <label className="flex items-center gap-2 text-sm mt-8">
              <input
                type="checkbox"
                checked={consentAcknowledged}
                onChange={(event) => setConsentAcknowledged(event.target.checked)}
              />
              Consent acknowledged
            </label>
          </div>

          <label className="space-y-2 text-sm block">
            <span className="text-muted-foreground">
              Presenting concerns (comma or new line separated)
            </span>
            <Textarea
              value={concernsText}
              onChange={(event) => setConcernsText(event.target.value)}
              placeholder="e.g. anxiety, exam stress, sleep issues"
              rows={3}
            />
          </label>

          <label className="space-y-2 text-sm block">
            <span className="text-muted-foreground">Additional summary (optional)</span>
            <Textarea
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="Any context that can help triage this intake..."
              rows={3}
            />
          </label>

          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Risk screening</p>
            <div className="grid gap-2 md:grid-cols-2">
              {intakeRiskQuestions.map((question) => (
                <label
                  key={question.key}
                  className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(riskAnswers[question.key])}
                    onChange={(event) => handleRiskToggle(question.key, event.target.checked)}
                  />
                  {question.label}
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleCreateIntake} disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Submitting
                </>
              ) : (
                "Submit Intake"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card variant="glass">
        <CardHeader className="space-y-4">
          <CardTitle className="text-lg">Intake Queue</CardTitle>
          <div className="grid gap-3 md:grid-cols-4">
            <label className="space-y-2 text-sm">
              <span className="text-muted-foreground">Status</span>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm w-full"
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All</option>
                {intakeStatusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2 text-sm">
              <span className="text-muted-foreground">Risk Level</span>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm w-full"
                value={riskFilter}
                onChange={(event) => {
                  setRiskFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All</option>
                {intakeRiskLevels.map((risk) => (
                  <option key={risk} value={risk}>
                    {risk}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2 text-sm">
              <span className="text-muted-foreground">Rows per page</span>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm w-full"
                value={String(perPage)}
                onChange={(event) => {
                  setPerPage(Number(event.target.value));
                  setPage(1);
                }}
              >
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="50">50</option>
              </select>
            </label>

            <div className="flex items-end">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => void loadRows()}
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Refreshing
                  </>
                ) : (
                  "Refresh"
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading intake submissions...</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No intake submissions found.</p>
          ) : (
            <div className="space-y-3">
              {rows.map((item) => {
                const alerts = Array.isArray(item?.risk_alerts) ? item.risk_alerts : [];
                const openAlerts = alerts.filter((alert: any) => String(alert?.status) === "open");
                const concernSummary = Array.isArray(item?.presenting_concerns)
                  ? item.presenting_concerns.join(", ")
                  : "No concerns provided";
                const assignedText =
                  typeof item?.assigned_to === "number"
                    ? `Assigned: #${item.assigned_to}`
                    : item?.assigned_to?.profile?.full_name || "Unassigned";

                return (
                  <div key={item.id} className="rounded-xl border border-border/60 p-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2 justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline">Intake #{item.id}</Badge>
                        <Badge variant={toBadgeVariant(item?.risk_level)}>
                          Risk: {String(item?.risk_level || "low")}
                        </Badge>
                        <Badge variant={toBadgeVariant(item?.status)}>
                          Status: {String(item?.status || "new")}
                        </Badge>
                        {item?.is_anonymous ? <Badge variant="secondary">Anonymous</Badge> : null}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {item?.created_at ? new Date(item.created_at).toLocaleString() : ""}
                      </p>
                    </div>

                    <p className="text-sm text-foreground">{concernSummary}</p>
                    <p className="text-xs text-muted-foreground">{assignedText}</p>
                    {item?.summary ? (
                      <p className="text-xs text-muted-foreground">Summary: {item.summary}</p>
                    ) : null}

                    {alerts.length > 0 ? (
                      <div className="space-y-2">
                        {alerts.map((alert: any) => (
                          <div
                            key={alert.id}
                            className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm text-destructive font-medium flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4" />
                                Alert #{alert.id} - {String(alert.status || "open")}
                              </p>

                              {canAcknowledge && String(alert?.status) === "open" ? (
                                <div className="flex items-center gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      void handleAcknowledgeAlert(Number(alert.id), "acknowledged")
                                    }
                                    disabled={isActioningAlertId === Number(alert.id)}
                                  >
                                    Acknowledge
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    onClick={() =>
                                      void handleAcknowledgeAlert(Number(alert.id), "resolved")
                                    }
                                    disabled={isActioningAlertId === Number(alert.id)}
                                  >
                                    Resolve
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : openAlerts.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No open risk alerts.</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between pt-4">
            <p className="text-xs text-muted-foreground">
              Page {page} of {totalPages} {meta?.total ? `• ${meta.total} total` : ""}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((previous) => Math.max(1, previous - 1))}
                disabled={page <= 1 || isLoading}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((previous) => previous + 1)}
                disabled={page >= totalPages || isLoading}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
