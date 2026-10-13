import { useEffect, useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  AlertTriangle,
  Building,
  Clock,
  Calendar,
  FileText,
  Loader2,
  Check,
  Search,
  UserPlus,
  ShieldAlert,
} from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface StudentOption {
  id: number;
  email?: string;
  profile?: {
    full_name?: string;
  };
}

interface WalkInConsultationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (createdSession: any) => void;
}

type ConsultationMode =
  | "in_person_walkin"
  | "physical_emergency"
  | "unscheduled_visit"
  | "follow_up_in_person";

type RiskLevel = "low" | "medium" | "high" | "critical";

const CHIEF_COMPLAINT_PRESETS = [
  "Acute Panic / Anxiety Attack",
  "Exam Stress & Breakdown",
  "Grief, Bereavement & Loss",
  "Depressive Mood & Withdrawal",
  "Suicidal Ideation / Crisis",
  "Interpersonal / Roommate Conflict",
  "Academic Probation Distress",
  "Physical Illness / Health Concern",
  "Family Crisis & Domestic Emergency",
];

export function WalkInConsultationModal({
  open,
  onOpenChange,
  onSuccess,
}: WalkInConsultationModalProps) {
  const [clientType, setClientType] = useState<"registered" | "walkin_visitor">("registered");
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [isLoadingStudents, setIsLoadingStudents] = useState(false);
  const [studentSearch, setStudentSearch] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);

  // Unregistered visitor fields
  const [visitorName, setVisitorName] = useState("");
  const [visitorIdentifier, setVisitorIdentifier] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);

  // Consultation fields
  const [consultationMode, setConsultationMode] = useState<ConsultationMode>("in_person_walkin");
  const [riskLevel, setRiskLevel] = useState<RiskLevel>("low");
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [startedAt, setStartedAt] = useState(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  });
  const [durationMinutes, setDurationMinutes] = useState(45);
  const [notes, setNotes] = useState("");
  const [actionTaken, setActionTaken] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch students list when opened
  useEffect(() => {
    if (open) {
      let isMounted = true;
      setIsLoadingStudents(true);
      api
        .getStudents({ limit: 500 })
        .then((res: any) => {
          if (!isMounted) return;
          const list = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
          setStudents(list);
        })
        .catch(() => {
          if (isMounted) setStudents([]);
        })
        .finally(() => {
          if (isMounted) setIsLoadingStudents(false);
        });

      return () => {
        isMounted = false;
      };
    }
  }, [open]);

  // Filter students
  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return students.slice(0, 15);
    return students
      .filter((s) => {
        const name = (s.profile?.full_name || "").toLowerCase();
        const email = (s.email || "").toLowerCase();
        const idStr = String(s.id);
        return name.includes(q) || email.includes(q) || idStr.includes(q);
      })
      .slice(0, 20);
  }, [students, studentSearch]);

  const selectedStudent = useMemo(() => {
    return students.find((s) => s.id === selectedStudentId) || null;
  }, [students, selectedStudentId]);

  const insertTemplate = (type: "soap" | "dap" | "crisis" | "mse") => {
    const templates = {
      soap: "S (Subjective): \n- Client stated: \n\nO (Objective): \n- Physical presentation, affect, and behavior: \n\nA (Assessment): \n- Clinical impressions and diagnosis/triage: \n\nP (Plan): \n- Interventions, safety steps, follow-up: ",
      dap: "D (Data / Observed): \n- Presentation and client disclosures: \n\nA (Assessment): \n- Psychological status and safety factors: \n\nP (Plan): \n- Immediate interventions, homework, next contact: ",
      crisis: "EMERGENCY CRISIS ASSESSMENT:\n- Presenting Crisis: \n- Mental Status & Orientation: \n- Suicide / Self-Harm Risk Assessment: \n- Protective Factors & Support Network: \n- Immediate Safety Interventions Conducted: \n- Referrals (Clinic, Warden, Security, Hospital): \n- Safety Agreement & De-escalation Plan: ",
      mse: "MENTAL STATUS EXAMINATION (MSE):\n- Appearance & Behavior: \n- Speech & Thought Process: \n- Mood & Affect: \n- Cognition & Sensorium: \n- Insight & Judgment: ",
    };
    setNotes((prev) => (prev ? prev + "\n\n" + templates[type] : templates[type]));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (clientType === "registered" && !selectedStudentId) {
      toast.error("Please select a registered student or switch to Unregistered Walk-In.");
      return;
    }

    if (clientType === "walkin_visitor" && !visitorName.trim() && !visitorIdentifier.trim() && !isAnonymous) {
      toast.error("Please provide a visitor name, identifier, or check Anonymous Walk-In.");
      return;
    }

    const trimmedNotes = notes.trim();
    if (!trimmedNotes) {
      toast.error("Clinical notes cannot be empty.");
      return;
    }

    try {
      setIsSubmitting(true);
      const payload = {
        student_id: clientType === "registered" ? selectedStudentId : null,
        visitor_name: clientType === "walkin_visitor" ? visitorName.trim() || undefined : undefined,
        visitor_identifier: clientType === "walkin_visitor" ? visitorIdentifier.trim() || undefined : undefined,
        consultation_mode: consultationMode,
        chief_complaint: chiefComplaint.trim() || undefined,
        risk_level: riskLevel,
        notes: trimmedNotes,
        action_taken: actionTaken.trim() || undefined,
        started_at: startedAt ? new Date(startedAt).toISOString() : new Date().toISOString(),
        duration_minutes: durationMinutes,
        is_anonymous: clientType === "walkin_visitor" ? isAnonymous : false,
      };

      const res = await api.recordWalkInSession(payload) as any;
      toast.success(
        consultationMode === "physical_emergency"
          ? "Physical emergency consultation documented successfully"
          : "In-person walk-in consultation recorded successfully"
      );
      onSuccess(res?.session);
      onOpenChange(false);

      // Reset form
      setNotes("");
      setActionTaken("");
      setChiefComplaint("");
      setSelectedStudentId(null);
      setVisitorName("");
      setVisitorIdentifier("");
    } catch {
      toast.error("Failed to document walk-in consultation. Please check required fields.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto p-6 sm:rounded-2xl">
        <DialogHeader className="space-y-1 text-left pb-2 border-b border-border/30">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Building className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold flex items-center gap-2">
                Document Walk-In / Physical Consultation
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Record an unscheduled in-person visit, physical walk-in, or acute campus emergency.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 pt-3">
          {/* Section 1: Client Type & Identification */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Client / Student Identification
              </label>
              <div className="flex items-center p-0.5 rounded-lg bg-secondary/40 border border-border/40 text-xs">
                <button
                  type="button"
                  onClick={() => setClientType("registered")}
                  className={cn(
                    "px-3 py-1 rounded-md font-medium transition-all",
                    clientType === "registered"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Registered Student
                </button>
                <button
                  type="button"
                  onClick={() => setClientType("walkin_visitor")}
                  className={cn(
                    "px-3 py-1 rounded-md font-medium transition-all",
                    clientType === "walkin_visitor"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Unregistered / Visitor
                </button>
              </div>
            </div>

            {clientType === "registered" ? (
              <div className="space-y-2">
                {selectedStudent ? (
                  <div className="flex items-center justify-between p-3 rounded-xl border border-primary/30 bg-primary/5">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-primary/20 text-primary font-bold flex items-center justify-center text-sm">
                        {selectedStudent.profile?.full_name?.charAt(0) || "S"}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {selectedStudent.profile?.full_name || "Student"}
                        </p>
                        <p className="text-xs text-muted-foreground">{selectedStudent.email}</p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedStudentId(null)}
                      className="text-xs text-muted-foreground hover:text-foreground h-8"
                    >
                      Change
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search student by name, matric no, or email..."
                        value={studentSearch}
                        onChange={(e) => setStudentSearch(e.target.value)}
                        className="pl-9 bg-secondary/20 h-10 text-sm"
                      />
                    </div>
                    {isLoadingStudents ? (
                      <div className="p-3 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" /> Loading student directory...
                      </div>
                    ) : filteredStudents.length === 0 ? (
                      <div className="p-3 text-center text-xs text-muted-foreground bg-secondary/10 rounded-xl">
                        No students found. You can switch to "Unregistered / Visitor" to record any walk-in.
                      </div>
                    ) : (
                      <div className="max-h-36 overflow-y-auto space-y-1 p-1 rounded-xl border border-border/30 bg-background/50">
                        {filteredStudents.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => setSelectedStudentId(s.id)}
                            className="w-full flex items-center justify-between p-2 rounded-lg text-left hover:bg-secondary/40 transition-colors text-xs"
                          >
                            <span className="font-medium text-foreground">
                              {s.profile?.full_name || s.email?.split("@")[0] || `Student #${s.id}`}
                            </span>
                            <span className="text-[11px] text-muted-foreground">{s.email}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl border border-border/40 bg-secondary/15">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Visitor / Student Name</label>
                  <Input
                    placeholder="e.g. Tendai Moyo or Anonymous Walk-In"
                    value={visitorName}
                    onChange={(e) => setVisitorName(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">ID / Matric / National ID</label>
                  <Input
                    placeholder="e.g. AU-2024-4412 (optional)"
                    value={visitorIdentifier}
                    onChange={(e) => setVisitorIdentifier(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
                <div className="sm:col-span-2 pt-1 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="anonWalkIn"
                    checked={isAnonymous}
                    onChange={(e) => setIsAnonymous(e.target.checked)}
                    className="rounded border-border text-primary focus:ring-primary/20 h-4 w-4"
                  />
                  <label htmlFor="anonWalkIn" className="text-xs text-muted-foreground select-none cursor-pointer">
                    Keep visitor identity confidential / anonymous in clinical reporting logs
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Section 2: Mode & Triage */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Consultation Setting
              </label>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setConsultationMode("in_person_walkin")}
                  className={cn(
                    "p-2.5 rounded-xl border text-left flex flex-col gap-1 transition-all",
                    consultationMode === "in_person_walkin"
                      ? "border-primary bg-primary/10 text-foreground font-semibold shadow-sm"
                      : "border-border/40 bg-secondary/10 hover:bg-secondary/20 text-muted-foreground"
                  )}
                >
                  <span className="flex items-center gap-1.5 font-bold">
                    <Building className="h-3.5 w-3.5 text-primary" /> Walk-In
                  </span>
                  <span className="text-[10px] opacity-75 font-normal">Physical office arrival</span>
                </button>

                <button
                  type="button"
                  onClick={() => setConsultationMode("physical_emergency")}
                  className={cn(
                    "p-2.5 rounded-xl border text-left flex flex-col gap-1 transition-all",
                    consultationMode === "physical_emergency"
                      ? "border-destructive bg-destructive/15 text-destructive font-semibold shadow-sm"
                      : "border-border/40 bg-secondary/10 hover:bg-secondary/20 text-muted-foreground"
                  )}
                >
                  <span className="flex items-center gap-1.5 font-bold text-destructive">
                    <ShieldAlert className="h-3.5 w-3.5" /> Emergency
                  </span>
                  <span className="text-[10px] opacity-75 font-normal">Acute crisis / triage</span>
                </button>

                <button
                  type="button"
                  onClick={() => setConsultationMode("unscheduled_visit")}
                  className={cn(
                    "p-2.5 rounded-xl border text-left flex flex-col gap-1 transition-all",
                    consultationMode === "unscheduled_visit"
                      ? "border-primary bg-primary/10 text-foreground font-semibold shadow-sm"
                      : "border-border/40 bg-secondary/10 hover:bg-secondary/20 text-muted-foreground"
                  )}
                >
                  <span className="flex items-center gap-1.5 font-bold">
                    <Clock className="h-3.5 w-3.5 text-amber-500" /> Unscheduled
                  </span>
                  <span className="text-[10px] opacity-75 font-normal">Brief check-in</span>
                </button>

                <button
                  type="button"
                  onClick={() => setConsultationMode("follow_up_in_person")}
                  className={cn(
                    "p-2.5 rounded-xl border text-left flex flex-col gap-1 transition-all",
                    consultationMode === "follow_up_in_person"
                      ? "border-primary bg-primary/10 text-foreground font-semibold shadow-sm"
                      : "border-border/40 bg-secondary/10 hover:bg-secondary/20 text-muted-foreground"
                  )}
                >
                  <span className="flex items-center gap-1.5 font-bold">
                    <Check className="h-3.5 w-3.5 text-emerald-500" /> Follow-Up
                  </span>
                  <span className="text-[10px] opacity-75 font-normal">Routine in-person</span>
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Triage Risk Level
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {(["low", "medium", "high", "critical"] as RiskLevel[]).map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setRiskLevel(lvl)}
                    className={cn(
                      "py-2 rounded-xl text-xs font-bold uppercase transition-all border",
                      riskLevel === lvl
                        ? lvl === "critical"
                          ? "bg-destructive text-destructive-foreground border-destructive"
                          : lvl === "high"
                            ? "bg-orange-500 text-white border-orange-500"
                            : lvl === "medium"
                              ? "bg-amber-500 text-white border-amber-500"
                              : "bg-emerald-600 text-white border-emerald-600"
                        : "bg-secondary/20 text-muted-foreground border-border/40 hover:bg-secondary/40"
                    )}
                  >
                    {lvl}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">Consultation Time</label>
                  <Input
                    type="datetime-local"
                    value={startedAt}
                    onChange={(e) => setStartedAt(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">Duration</label>
                  <select
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(Number(e.target.value))}
                    className="w-full h-8 rounded-md border border-border/40 bg-background px-2 text-xs focus:ring-1 focus:ring-primary"
                  >
                    <option value={15}>15 minutes</option>
                    <option value={30}>30 minutes</option>
                    <option value={45}>45 minutes</option>
                    <option value={60}>60 minutes</option>
                    <option value={90}>90 minutes</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Presenting Concern */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Chief Concern / Presenting Complaint
            </label>
            <div className="flex flex-wrap gap-1.5">
              {CHIEF_COMPLAINT_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setChiefComplaint(preset)}
                  className={cn(
                    "text-[11px] px-2.5 py-1 rounded-full border transition-all",
                    chiefComplaint === preset
                      ? "bg-primary text-primary-foreground border-primary font-medium"
                      : "bg-secondary/20 text-muted-foreground border-border/40 hover:bg-secondary/50"
                  )}
                >
                  {preset}
                </button>
              ))}
            </div>
            <Input
              placeholder="Or type specific presenting issue / reason for arrival..."
              value={chiefComplaint}
              onChange={(e) => setChiefComplaint(e.target.value)}
              className="text-xs h-9 bg-secondary/20"
            />
          </div>

          {/* Section 4: Clinical Notes & Templates */}
          <div className="space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Clinical Documentation & Observations *
              </label>
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-[10px] text-muted-foreground">Insert template:</span>
                <button
                  type="button"
                  onClick={() => insertTemplate("soap")}
                  className="px-2 py-0.5 rounded bg-secondary/60 hover:bg-secondary text-foreground text-[10px] font-mono border border-border/40"
                >
                  SOAP
                </button>
                <button
                  type="button"
                  onClick={() => insertTemplate("dap")}
                  className="px-2 py-0.5 rounded bg-secondary/60 hover:bg-secondary text-foreground text-[10px] font-mono border border-border/40"
                >
                  DAP
                </button>
                <button
                  type="button"
                  onClick={() => insertTemplate("crisis")}
                  className="px-2 py-0.5 rounded bg-destructive/15 hover:bg-destructive/25 text-destructive text-[10px] font-mono border border-destructive/20 font-bold"
                >
                  Crisis Triage
                </button>
                <button
                  type="button"
                  onClick={() => insertTemplate("mse")}
                  className="px-2 py-0.5 rounded bg-secondary/60 hover:bg-secondary text-foreground text-[10px] font-mono border border-border/40"
                >
                  MSE
                </button>
              </div>
            </div>

            <Textarea
              rows={7}
              placeholder="Record detailed clinical notes, student affect, interventions made, and mental status..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="text-sm font-sans leading-relaxed bg-secondary/20 border-border/40 focus:bg-background"
              maxLength={10000}
              required
            />
            <div className="text-right text-[10px] text-muted-foreground tabular-nums">
              {notes.length}/10000 characters
            </div>
          </div>

          {/* Section 5: Action Taken & Safety Plan */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Immediate Interventions & Next Steps
            </label>
            <Input
              placeholder="e.g. Grounding exercises practiced, safety contract signed, follow-up scheduled for Friday..."
              value={actionTaken}
              onChange={(e) => setActionTaken(e.target.value)}
              className="text-xs h-9 bg-secondary/20"
              maxLength={1000}
            />
          </div>

          <DialogFooter className="pt-2 border-t border-border/30 gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
              className="text-xs h-10"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || notes.trim() === ""}
              className="text-xs h-10 font-bold gap-2 px-5"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving...
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4" /> Save & Record Consultation
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
