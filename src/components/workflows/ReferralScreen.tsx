import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Loader2, NotebookPen } from "lucide-react";
import { api, getApiErrorMessage } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type ReferralRole = "student" | "counselor" | "admin";

interface ReferralScreenProps {
  role: ReferralRole;
}

const referralStatuses = ["pending", "accepted", "completed", "declined", "cancelled"] as const;
const referralDirections = ["internal", "external"] as const;

const toRows = (payload: any): any[] => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

const toMeta = (payload: any) => {
  if (payload && typeof payload === "object" && payload.meta) {
    return payload.meta;
  }
  return null;
};

const badgeVariantForStatus = (status?: string) => {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "completed") return "default" as const;
  if (normalized === "declined" || normalized === "cancelled") return "destructive" as const;
  if (normalized === "accepted") return "secondary" as const;
  return "outline" as const;
};

const toStudentRows = (payload: any) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

export const ReferralScreen = ({ role }: ReferralScreenProps) => {
  const canManage = role === "admin" || role === "counselor";
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isUpdatingId, setIsUpdatingId] = useState<number | null>(null);
  const [isEventId, setIsEventId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState<any | null>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [statusFilter, setStatusFilter] = useState("all");
  const [directionFilter, setDirectionFilter] = useState("all");

  const [studentId, setStudentId] = useState("");
  const [direction, setDirection] = useState<"internal" | "external">("internal");
  const [targetService, setTargetService] = useState("");
  const [destinationDetails, setDestinationDetails] = useState("");
  const [consentGranted, setConsentGranted] = useState(true);
  const [sharedFieldsText, setSharedFieldsText] = useState("");
  const [createNotes, setCreateNotes] = useState("");

  const [statusDraftById, setStatusDraftById] = useState<Record<number, string>>({});
  const [outcomeDraftById, setOutcomeDraftById] = useState<Record<number, string>>({});
  const [eventDraftById, setEventDraftById] = useState<Record<number, string>>({});

  const loadRows = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      const payload = await api.getReferrals({
        status: statusFilter === "all" ? undefined : statusFilter,
        direction: directionFilter === "all" ? undefined : (directionFilter as "internal" | "external"),
        page,
        per_page: perPage,
      });
      setRows(toRows(payload));
      setMeta(toMeta(payload));
    } catch (error) {
      setRows([]);
      setMeta(null);
      if (canManage) {
        setLoadError(getApiErrorMessage(error, "Unable to load referrals right now."));
      }
    } finally {
      setIsLoading(false);
    }
  }, [canManage, statusFilter, directionFilter, page, perPage]);

  const loadStudents = useCallback(async () => {
    if (!canManage) return;
    try {
      const payload = await api.getStudents({ page: 1, per_page: 100 });
      setStudents(toStudentRows(payload));
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to load students for referrals."));
    }
  }, [canManage]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    void loadStudents();
  }, [loadStudents]);

  const totalPages = useMemo(() => {
    const lastPage = Number(meta?.last_page);
    if (Number.isFinite(lastPage) && lastPage > 0) return Math.floor(lastPage);
    return 1;
  }, [meta]);

  const parseSharedFields = (): Record<string, unknown> | null => {
    const raw = sharedFieldsText.trim();
    if (raw === "") {
      return null;
    }
    try {
      const value = JSON.parse(raw);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Shared fields must be a JSON object.");
      }
      return value as Record<string, unknown>;
    } catch {
      throw new Error("Shared fields must be valid JSON object.");
    }
  };

  const handleCreate = async () => {
    if (!canManage) {
      return;
    }

    if (!studentId) {
      toast.error("Please select a student.");
      return;
    }
    if (targetService.trim() === "") {
      toast.error("Target service is required.");
      return;
    }

    let sharedFields: Record<string, unknown> | null = null;
    try {
      sharedFields = parseSharedFields();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Invalid shared fields JSON.");
      return;
    }

    if (!consentGranted && sharedFields) {
      toast.error("Cannot share fields when consent is not granted.");
      return;
    }

    try {
      setIsCreating(true);
      await api.createReferral({
        student_id: Number(studentId),
        direction,
        target_service: targetService.trim(),
        destination_details: destinationDetails.trim() || null,
        consent_granted: consentGranted,
        shared_fields: sharedFields,
        notes: createNotes.trim() || null,
      });
      toast.success("Referral created successfully.");
      setTargetService("");
      setDestinationDetails("");
      setSharedFieldsText("");
      setCreateNotes("");
      setConsentGranted(true);
      setDirection("internal");
      setPage(1);
      void loadRows();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to create referral."));
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdate = async (id: number) => {
    const status = statusDraftById[id];
    const outcomeNotes = (outcomeDraftById[id] || "").trim();
    if (!status && outcomeNotes.length === 0) {
      toast.error("Select a status or provide outcome notes.");
      return;
    }

    try {
      setIsUpdatingId(id);
      await api.updateReferral(id, {
        status: status as any,
        outcome_notes: outcomeNotes.length > 0 ? outcomeNotes : null,
      });
      toast.success("Referral updated.");
      void loadRows();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to update referral."));
    } finally {
      setIsUpdatingId(null);
    }
  };

  const handleAddFollowUp = async (id: number) => {
    const notes = (eventDraftById[id] || "").trim();
    if (notes.length === 0) {
      toast.error("Enter follow-up notes first.");
      return;
    }

    try {
      setIsEventId(id);
      await api.addReferralEvent(id, {
        event_type: "follow_up",
        notes,
      });
      toast.success("Referral event logged.");
      setEventDraftById((previous) => ({
        ...previous,
        [id]: "",
      }));
      void loadRows();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to log referral event."));
    } finally {
      setIsEventId(null);
    }
  };

  return (
    <div className="space-y-6">
      {canManage ? (
        <Card variant="glass">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-primary" />
              Create Referral
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span className="text-muted-foreground">Student</span>
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm w-full"
                  value={studentId}
                  onChange={(event) => setStudentId(event.target.value)}
                >
                  <option value="">Select student</option>
                  {students.map((student) => (
                    <option key={student.id} value={String(student.id)}>
                      {student?.profile?.full_name || student?.email || `Student #${student.id}`}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2 text-sm">
                <span className="text-muted-foreground">Direction</span>
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm w-full"
                  value={direction}
                  onChange={(event) => setDirection(event.target.value as "internal" | "external")}
                >
                  <option value="internal">Internal</option>
                  <option value="external">External</option>
                </select>
              </label>

              <label className="space-y-2 text-sm">
                <span className="text-muted-foreground">Target service</span>
                <Input
                  value={targetService}
                  onChange={(event) => setTargetService(event.target.value)}
                  placeholder="e.g. chaplaincy, medical, psychiatry"
                />
              </label>

              <label className="space-y-2 text-sm">
                <span className="text-muted-foreground">Destination details</span>
                <Input
                  value={destinationDetails}
                  onChange={(event) => setDestinationDetails(event.target.value)}
                  placeholder="Optional details"
                />
              </label>
            </div>

            <label className="space-y-2 text-sm block">
              <span className="text-muted-foreground">Shared fields JSON (optional)</span>
              <Textarea
                value={sharedFieldsText}
                onChange={(event) => setSharedFieldsText(event.target.value)}
                placeholder='{"summary":"brief summary","risk_level":"moderate"}'
                rows={2}
              />
            </label>

            <label className="space-y-2 text-sm block">
              <span className="text-muted-foreground">Creation notes</span>
              <Textarea
                value={createNotes}
                onChange={(event) => setCreateNotes(event.target.value)}
                placeholder="Optional note for referral event log"
                rows={2}
              />
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={consentGranted}
                onChange={(event) => setConsentGranted(event.target.checked)}
              />
              Consent granted for information sharing
            </label>

            <div className="flex justify-end">
              <Button onClick={handleCreate} disabled={isCreating}>
                {isCreating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating
                  </>
                ) : (
                  "Create Referral"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card variant="glass">
        <CardHeader className="space-y-4">
          <CardTitle className="text-lg">Referral Tracking</CardTitle>
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
                {referralStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2 text-sm">
              <span className="text-muted-foreground">Direction</span>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm w-full"
                value={directionFilter}
                onChange={(event) => {
                  setDirectionFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All</option>
                {referralDirections.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
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
            <p className="text-sm text-muted-foreground">Loading referrals...</p>
          ) : loadError ? (
            <p className="text-sm text-muted-foreground">{loadError}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No referrals found.</p>
          ) : (
            <div className="space-y-4">
              {rows.map((row) => {
                const rowId = Number(row.id);
                const studentName =
                  row?.student?.profile?.full_name ||
                  row?.student?.email ||
                  (row?.student_id ? `Student #${row.student_id}` : "Not linked");
                const eventCount = Array.isArray(row?.events) ? row.events.length : 0;

                return (
                  <div key={row.id} className="rounded-xl border border-border/60 p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline">Referral #{row.id}</Badge>
                        <Badge variant={badgeVariantForStatus(row?.status)}>
                          {String(row?.status || "pending")}
                        </Badge>
                        <Badge variant="secondary">{String(row?.direction || "internal")}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {row?.referred_at ? new Date(row.referred_at).toLocaleString() : ""}
                      </p>
                    </div>

                    <p className="text-sm font-medium text-foreground">{row?.target_service}</p>
                    <p className="text-xs text-muted-foreground">{studentName}</p>
                    {row?.destination_details ? (
                      <p className="text-xs text-muted-foreground">
                        Destination: {row.destination_details}
                      </p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      Consent: {row?.consent_granted ? "Granted" : "Not granted"} • Events: {eventCount}
                    </p>

                    {canManage ? (
                      <div className="grid gap-2 md:grid-cols-3">
                        <select
                          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                          value={statusDraftById[rowId] ?? String(row?.status || "pending")}
                          onChange={(event) =>
                            setStatusDraftById((previous) => ({
                              ...previous,
                              [rowId]: event.target.value,
                            }))
                          }
                        >
                          {referralStatuses.map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                        <Input
                          placeholder="Outcome notes"
                          value={outcomeDraftById[rowId] ?? ""}
                          onChange={(event) =>
                            setOutcomeDraftById((previous) => ({
                              ...previous,
                              [rowId]: event.target.value,
                            }))
                          }
                        />
                        <Button
                          variant="outline"
                          onClick={() => void handleUpdate(rowId)}
                          disabled={isUpdatingId === rowId}
                        >
                          {isUpdatingId === rowId ? "Updating..." : "Update"}
                        </Button>
                      </div>
                    ) : null}

                    {canManage ? (
                      <div className="grid gap-2 md:grid-cols-3">
                        <Input
                          placeholder="Follow-up event notes"
                          value={eventDraftById[rowId] ?? ""}
                          onChange={(event) =>
                            setEventDraftById((previous) => ({
                              ...previous,
                              [rowId]: event.target.value,
                            }))
                          }
                        />
                        <div className="md:col-span-2">
                          <Button
                            variant="secondary"
                            onClick={() => void handleAddFollowUp(rowId)}
                            disabled={isEventId === rowId}
                          >
                            {isEventId === rowId ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Logging
                              </>
                            ) : (
                              <>
                                <NotebookPen className="h-4 w-4 mr-2" />
                                Log Follow-Up Event
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
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
