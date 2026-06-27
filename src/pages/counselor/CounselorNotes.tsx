import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MessageSquare,
  Calendar,
  Video,
  FileText,
  Loader2,
  CheckCircle2,
  Trash2,
  Search,
  Mic,
  SlidersHorizontal,
} from "lucide-react";
import { counselorNavItems } from "@/config/counselorNavItems";
import { format, formatDistanceToNow } from "date-fns";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import {
  anonymousLabelForCounselor,
  isAnonymousSessionFlag,
  isAnonymousIdentityMaskedFromViewer
} from "@/lib/anonymousMode";
import { useAuth } from "@/hooks/useAuth";
import { useConfirm } from "@/hooks/useConfirm";
import { toast } from "sonner";

type ApiStudent = {
  profile?: { full_name?: string };
  email?: string;
};

type ApiSessionBlob = Record<string, unknown> & {
  id?: unknown;
  student_id?: unknown;
  student?: ApiStudent;
  is_anonymous?: unknown;
  anonymous_id?: string | null;
  anonymous_display_id?: string | null;
  notes?: unknown;
  session_type?: unknown;
  status?: unknown;
  current_risk_level?: unknown;
  updated_at?: unknown;
  started_at?: unknown;
  ended_at?: unknown;
  created_at?: unknown;
};

type CounselorSessionNoteRow = {
  id: string;
  studentLabel: string;
  notes: string;
  sessionType: string;
  status: string;
  riskLevel: string;
  updatedAtIso: string;
  sessionTimingLabel: string;
  hasClinicalNote: boolean;
};

type NotesFilter = "all" | "with_notes" | "without_notes" | "high_risk";

function extractSessionsPayload(data: unknown): ApiSessionBlob[] {
  if (Array.isArray(data)) return data as ApiSessionBlob[];
  if (data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data)) {
    return (data as { data: ApiSessionBlob[] }).data;
  }
  return [];
}

function coerceString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function formatSessionTimestamp(value: unknown): string {
  const raw = coerceString(value);
  if (!raw) return "—";
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return "—";
  return format(d, "MMM d, yyyy • h:mm a");
}

function formatRelativeUpdated(value: unknown): string {
  const raw = coerceString(value);
  if (!raw) return "—";
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return "—";
  return formatDistanceToNow(d, { addSuffix: true });
}

function sessionRowFromApi(s: ApiSessionBlob): CounselorSessionNoteRow {
  const id = String(s.id ?? "");
  const student = s.student;
  const isMasked = isAnonymousIdentityMaskedFromViewer(s as any);

  let studentLabel = "Student";
  if (isMasked) {
    const tag = coerceString(s.anonymous_display_id || s.anonymous_id).trim();
    studentLabel = tag ? `Anonymous (${tag})` : anonymousLabelForCounselor();
  } else {
    const isAnon = isAnonymousSessionFlag(s.is_anonymous);
    studentLabel =
      student?.profile?.full_name?.trim() ||
      student?.email?.split("@")[0]?.trim() ||
      (isAnon ? anonymousLabelForCounselor() : (s.student_id != null ? `Student #${s.student_id}` : "Student"));
  }

  const rawNotes =
    typeof s.notes === "string" ? s.notes : s.notes == null ? "" : coerceString(s.notes);
  const trimmedNotes = rawNotes.trim();
  const sessionTypeRaw = coerceString(s.session_type || "chat").toLowerCase() || "chat";
  const risk = coerceString(s.current_risk_level || "low").toLowerCase() || "low";
  const status = coerceString(s.status || "unknown").toLowerCase();

  const whenSource = s.started_at || s.created_at;
  const timing =
    coerceString(whenSource) !== ""
      ? formatSessionTimestamp(whenSource)
      : `${formatSessionTimestamp(s.created_at)} · not started`;

  const updatedIso = coerceString(s.updated_at) || coerceString(s.created_at) || "";

  return {
    id,
    studentLabel,
    notes: rawNotes,
    sessionType: sessionTypeRaw,
    status,
    riskLevel: risk,
    updatedAtIso: updatedIso,
    sessionTimingLabel: timing,
    hasClinicalNote: trimmedNotes.length > 0,
  };
}

const CounselorNotes = () => {
  const { confirm } = useConfirm();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessions, setSessions] = useState<CounselorSessionNoteRow[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [notesFilter, setNotesFilter] = useState<NotesFilter>("all");

  const { user, role } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || "Counselor";
  const canEditNotes = role === "counselor";

  const loadSessions = useCallback(async () => {
    try {
      setIsLoading(true);
      const payload = await api.getSessions({ limit: 300 });
      const raw = extractSessionsPayload(payload)
        .map(sessionRowFromApi)
        .filter((row) => row.id !== "");
      setSessions(raw);
    } catch {
      toast.error("Failed to load sessions");
      setSessions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId]
  );

  useEffect(() => {
    if (selectedSession) {
      setNoteText(selectedSession.notes || "");
    } else {
      setNoteText("");
    }
  }, [selectedSession]);

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sessions.filter((row) => {
      const haystack = `${row.studentLabel} ${row.notes} ${row.id} ${row.status} ${row.sessionType}`.toLowerCase();
      const matchesSearch = !q || haystack.includes(q);
      const isHighRisk = row.riskLevel === "high" || row.riskLevel === "critical";
      const matchesFilter =
        notesFilter === "all" ||
        (notesFilter === "with_notes" && row.hasClinicalNote) ||
        (notesFilter === "without_notes" && !row.hasClinicalNote) ||
        (notesFilter === "high_risk" && isHighRisk);

      return matchesSearch && matchesFilter;
    });
  }, [sessions, searchQuery, notesFilter]);

  const noteStats = useMemo(() => {
    const withNotes = sessions.filter((s) => s.hasClinicalNote).length;
    const highRisk = sessions.filter(
      (s) => s.riskLevel === "high" || s.riskLevel === "critical"
    ).length;
    return {
      total: sessions.length,
      withNotes,
      withoutNotes: Math.max(0, sessions.length - withNotes),
      highRisk,
    };
  }, [sessions]);

  const noteDraftDirty = useMemo(() => {
    if (!selectedSession) return false;
    return noteText.trim() !== selectedSession.notes.trim();
  }, [noteText, selectedSession]);

  const saveNote = async () => {
    if (!selectedSessionId || !canEditNotes) return;
    const trimmed = noteText.trim();
    if (trimmed === "") {
      toast.error("Notes cannot be empty.");
      return;
    }
    if (trimmed.length > 5000) {
      toast.error("Notes must be 5000 characters or less.");
      return;
    }

    try {
      setIsSaving(true);
      await api.updateSessionNote(selectedSessionId, trimmed);
      toast.success("Note saved");
      await loadSessions();
    } catch {
      toast.error("Failed to save note");
    } finally {
      setIsSaving(false);
    }
  };

  const deleteNote = async (sessionId: string) => {
    if (!canEditNotes) return;
    const confirmed = await confirm({
      title: "Clear clinical notes?",
      description: "This will permanently delete the notes for this session. This action cannot be undone.",
      confirmLabel: "Clear notes",
      variant: "destructive",
    });
    if (!confirmed) return;
    try {
      setIsDeleting(true);
      await api.deleteSessionNote(sessionId);
      toast.success("Note cleared");
      await loadSessions();
    } catch {
      toast.error("Failed to delete note");
    } finally {
      setIsDeleting(false);
    }
  };

  const insertTemplate = (type: "soap" | "dap" | "basic") => {
    const templates = {
      soap: "S (Subjective): \nO (Objective): \nA (Assessment): \nP (Plan): ",
      dap: "D (Data): \nA (Assessment): \nP (Plan): ",
      basic: "Observations: \n\nInterventions: \n\nPlan: ",
    };
    setNoteText((prev) => (prev ? prev + "\n\n" + templates[type] : templates[type]));
  };

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar
        items={counselorNavItems}
        userType="counselor"
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-72 pl-0">
        <DashboardHeader title="Session Notes" onMenuClick={() => setSidebarOpen(true)} />

        <main className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card variant="glass" className="border-border/40">
              <CardContent className="pt-5">
                <p className="text-2xl font-bold text-foreground">{noteStats.total}</p>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Total sessions</p>
              </CardContent>
            </Card>
            <Card variant="glass" className="border-border/40">
              <CardContent className="pt-5">
                <p className="text-2xl font-bold text-emerald-600">{noteStats.withNotes}</p>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">With note</p>
              </CardContent>
            </Card>
            <Card variant="glass" className="border-border/40">
              <CardContent className="pt-5">
                <p className="text-2xl font-bold text-amber-600">{noteStats.withoutNotes}</p>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Needs note</p>
              </CardContent>
            </Card>
            <Card variant="glass" className="border-border/40">
              <CardContent className="pt-5">
                <p className="text-2xl font-bold text-destructive">{noteStats.highRisk}</p>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">High/Critical risk</p>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="space-y-1">
              <h2 className="text-2xl font-bold tracking-tight">Session notes</h2>
              <p className="text-sm text-muted-foreground">
                Read and edit encrypted clinical notes tied to each counseling session (same field as Messages / video
                session metadata).
              </p>
            </div>
            <div className="flex items-center gap-3 w-full md:w-auto">
              <div className="relative flex-1 md:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by student, note text, or session ID..."
                  className="pl-9 bg-background/50 border-border/40 focus:bg-background transition-all"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <Button
                type="button"
                variant={notesFilter === "all" ? "default" : "outline"}
                className="shrink-0"
                onClick={() => setNotesFilter("all")}
              >
                <SlidersHorizontal className="h-4 w-4 mr-2" />
                All
              </Button>
              <Button
                type="button"
                variant={notesFilter === "with_notes" ? "default" : "outline"}
                className="shrink-0"
                onClick={() => setNotesFilter("with_notes")}
              >
                With notes
              </Button>
              <Button
                type="button"
                variant={notesFilter === "without_notes" ? "default" : "outline"}
                className="shrink-0"
                onClick={() => setNotesFilter("without_notes")}
              >
                Needs notes
              </Button>
              <Button
                type="button"
                variant={notesFilter === "high_risk" ? "default" : "outline"}
                className="shrink-0"
                onClick={() => setNotesFilter("high_risk")}
              >
                High risk
              </Button>
              {(searchQuery || notesFilter !== "all") && (
                <Button
                  type="button"
                  variant="ghost"
                  className="shrink-0"
                  onClick={() => {
                    setSearchQuery("");
                    setNotesFilter("all");
                  }}
                >
                  Clear
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={isLoading}
                className="shrink-0"
                onClick={() => void loadSessions()}
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
              </Button>
            </div>
          </div>

          {!canEditNotes ? (
            <Alert>
              <AlertTitle>View only</AlertTitle>
              <AlertDescription>
                {role === "admin"
                  ? "Administrators can review session metadata here; only the assigned counselor can add or change clinical notes (API policy)."
                  : "Only assigned counselors can edit session notes. If you are a peer counselor, open the session in Messages for context—note edits are limited to the lead counselor."}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            <div className="xl:col-span-3 space-y-4">
              <Card variant="glass" className="border-border/40 overflow-hidden">
                <CardHeader className="pb-3 border-b border-border/20 bg-secondary/10">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                      Sessions
                    </CardTitle>
                    <Badge variant="outline" className="bg-background/50">
                      {filteredSessions.length}
                    </Badge>
                  </div>
                </CardHeader>
                <ScrollArea className="h-[calc(100vh-280px)] xl:h-[700px]">
                  <CardContent className="p-2 space-y-1">
                    {isLoading ? (
                      <div className="p-8 text-center space-y-3">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
                        <p className="text-xs text-muted-foreground">Loading sessions...</p>
                      </div>
                    ) : filteredSessions.length === 0 ? (
                      <div className="p-8 text-center text-muted-foreground">
                        <p className="text-sm">
                          {sessions.length === 0 ? "No sessions yet." : "No sessions match your search."}
                        </p>
                      </div>
                    ) : (
                      filteredSessions.map((row) => (
                        <button
                          key={row.id}
                          type="button"
                          className={cn(
                            "w-full text-left p-3 rounded-xl transition-all group relative overflow-hidden",
                            selectedSessionId === row.id
                              ? "bg-primary/10 border border-primary/20"
                              : "hover:bg-secondary/40 border border-transparent"
                          )}
                          onClick={() => setSelectedSessionId(row.id)}
                        >
                          <div className="flex justify-between items-start mb-1 gap-2">
                            <span className="font-semibold text-sm truncate text-foreground group-hover:text-primary transition-colors">
                              {row.studentLabel}
                            </span>
                            <div className="flex flex-col items-end gap-0.5 shrink-0">
                              <Badge variant="outline" className="text-[9px] px-1.5 uppercase">
                                {row.status}
                              </Badge>
                              {row.hasClinicalNote ? (
                                <span className="text-[10px] text-success font-medium">Has note</span>
                              ) : (
                                <span className="text-[10px] text-muted-foreground">No clinical note</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                            <div className="flex items-center gap-1 min-w-0">
                              <Calendar className="h-3 w-3 shrink-0" />
                              <span className="truncate">{formatRelativeUpdated(row.updatedAtIso)}</span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {row.sessionType === "video" ? (
                                <Video className="h-3 w-3 text-purple-500" />
                              ) : row.sessionType === "voice" ? (
                                <Mic className="h-3 w-3 text-amber-500" />
                              ) : (
                                <MessageSquare className="h-3 w-3 text-blue-500" />
                              )}
                              <span className="capitalize">{row.sessionType}</span>
                            </div>
                          </div>
                          <Badge
                            className={cn(
                              "mt-2 text-[10px] px-1.5 py-0 uppercase font-bold w-fit border",
                              row.riskLevel === "critical"
                                ? "bg-destructive/20 text-destructive border-destructive/20"
                                : row.riskLevel === "high"
                                  ? "bg-orange-500/20 text-orange-500 border-orange-500/20"
                                  : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                            )}
                          >
                            Risk: {row.riskLevel || "low"}
                          </Badge>
                          {selectedSessionId === row.id ? (
                            <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />
                          ) : null}
                        </button>
                      ))
                    )}
                  </CardContent>
                </ScrollArea>
              </Card>
            </div>

            <div className="xl:col-span-9 space-y-4">
              <Card variant="glass" className="border-border/40 shadow-xl">
                <CardHeader className="pb-3 border-b border-border/20">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <FileText className="h-5 w-5 text-primary" />
                      Note editor
                    </CardTitle>
                    <Badge variant="secondary" className="bg-background/80 w-fit">
                      Session #{selectedSessionId ?? "—"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-6 space-y-5">
                  {!selectedSessionId ? (
                    <div className="py-20 text-center space-y-4">
                      <div className="h-16 w-16 bg-primary/5 rounded-full flex items-center justify-center mx-auto">
                        <FileText className="h-8 w-8 text-primary/40" />
                      </div>
                      <div className="space-y-1">
                        <p className="font-medium text-foreground">Select a session</p>
                        <p className="text-sm text-muted-foreground">
                          Choose a row on the left. Notes save to the counseling session record (visible here and in chat
                          context where your role allows).
                        </p>
                      </div>
                    </div>
                  ) : selectedSession ? (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                        <div className="rounded-lg border border-border/40 bg-secondary/10 p-3 space-y-1">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Student</p>
                          <p className="font-medium text-foreground">{selectedSession.studentLabel}</p>
                        </div>
                        <div className="rounded-lg border border-border/40 bg-secondary/10 p-3 space-y-1">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Timing</p>
                          <p className="font-medium text-foreground">{selectedSession.sessionTimingLabel}</p>
                          <p className="text-xs text-muted-foreground">
                            Last activity {formatRelativeUpdated(selectedSession.updatedAtIso)}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline" className="uppercase text-[10px]">{selectedSession.status}</Badge>
                        <Badge variant="outline" className="uppercase text-[10px]">{selectedSession.sessionType}</Badge>
                        <Badge
                          variant="outline"
                          className={cn(
                            "uppercase text-[10px]",
                            selectedSession.riskLevel === "critical"
                              ? "border-destructive/40 text-destructive"
                              : selectedSession.riskLevel === "high"
                                ? "border-orange-500/40 text-orange-500"
                                : "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                          )}
                        >
                          {selectedSession.riskLevel} risk
                        </Badge>
                        {noteDraftDirty && <Badge className="uppercase text-[10px]">Unsaved changes</Badge>}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          className="text-[10px] uppercase font-bold tracking-tight"
                          disabled={!canEditNotes}
                          onClick={() => insertTemplate("soap")}
                        >
                          SOAP
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          className="text-[10px] uppercase font-bold tracking-tight"
                          disabled={!canEditNotes}
                          onClick={() => insertTemplate("dap")}
                        >
                          DAP
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          className="text-[10px] uppercase font-bold tracking-tight"
                          disabled={!canEditNotes}
                          onClick={() => insertTemplate("basic")}
                        >
                          Basic
                        </Button>
                      </div>

                      <div className="space-y-1.5 relative">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex justify-between gap-2">
                          <span>Clinical notes</span>
                          <span className="font-normal text-muted-foreground">
                            {noteText.length} / 5000
                          </span>
                        </label>
                        <Textarea
                          placeholder="SOAP, interventions, safety planning, referrals..."
                          className="min-h-[420px] sm:min-h-[520px] bg-background/30 border-border/40 focus:bg-background/60 transition-all text-base leading-relaxed resize-y p-4"
                          value={noteText}
                          disabled={!canEditNotes}
                          onChange={(e) => setNoteText(e.target.value)}
                        />
                        <p className="text-[11px] text-muted-foreground">
                          Backend stores this in the session <code className="text-xs">notes</code> field. System lines
                          like &quot;Video appointment #123&quot; are still notes—add your clinical summary below them or
                          replace when appropriate.
                        </p>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-3 pt-2">
                        <Button
                          variant="hero"
                          type="button"
                          className="flex-1 sm:flex-none shadow-lg shadow-primary/20 h-12 sm:min-w-[200px]"
                          onClick={() => void saveNote()}
                          disabled={
                            !canEditNotes ||
                            isSaving ||
                            isDeleting ||
                            selectedSession.status === "cancelled" ||
                            !noteDraftDirty
                          }
                        >
                          {isSaving ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4 mr-2" />
                          )}
                          Save note
                        </Button>
                        <Button
                          variant="destructive"
                          size="icon"
                          type="button"
                          className="h-12 w-12 shrink-0 shadow-lg shadow-destructive/20 sm:ml-auto"
                          onClick={() => selectedSessionId && void deleteNote(selectedSessionId)}
                          disabled={
                            !canEditNotes ||
                            selectedSession.notes.trim() === "" ||
                            isSaving ||
                            isDeleting
                          }
                        >
                          <Trash2 className="h-5 w-5" />
                        </Button>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground py-12 text-center">Session could not be loaded.</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default CounselorNotes;
