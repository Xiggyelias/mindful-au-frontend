import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api, getApiErrorMessage } from "@/lib/api";
import { toast } from "sonner";
import {
  Sparkles,
  Heart,
  Battery,
  Zap,
  Copy,
  Check,
  RefreshCw,
  Send,
  Loader2,
  AlertTriangle,
} from "lucide-react";

export interface CounselorPreSessionCardProps {
  studentId?: number | string | null;
  appointmentId?: number | string | null;
  sessionId?: number | string | null;
  studentName?: string;
  onInsertToNotes?: (clinicalSummaryText: string) => void;
  className?: string;
}

export const CounselorPreSessionCard = ({
  studentId,
  appointmentId,
  sessionId,
  studentName = "Student",
  onInsertToNotes,
  className = "",
}: CounselorPreSessionCardProps) => {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadCheckIn = useCallback(async () => {
    if (!studentId && !appointmentId && !sessionId) return;
    try {
      setIsLoading(true);
      const res = await api.getLatestPreSessionCheckIn({
        student_id: studentId || undefined,
        appointment_id: appointmentId || undefined,
        session_id: sessionId || undefined,
      });
      setData(res);
    } catch {
      // optional
    } finally {
      setIsLoading(false);
    }
  }, [studentId, appointmentId, sessionId]);

  useEffect(() => {
    void loadCheckIn();
  }, [loadCheckIn]);

  const handleRequestCheckIn = async () => {
    if (!studentId) return;
    try {
      setIsRequesting(true);
      await api.requestPreSessionCheckIn({
        student_id: Number(studentId),
        appointment_id: appointmentId ? Number(appointmentId) : undefined,
      });
      toast.success(`Check-in request sent to ${studentName}`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to send check-in request."));
    } finally {
      setIsRequesting(false);
    }
  };

  const handleInsertNotes = () => {
    if (!data?.clinical_summary || !onInsertToNotes) return;
    onInsertToNotes(data.clinical_summary);
    setCopied(true);
    toast.success("Pre-session pulse inserted into notes! 📋");
    setTimeout(() => setCopied(false), 2000);
  };

  const checkIn = data?.check_in;

  if (isLoading) {
    return (
      <div className={`p-4 rounded-xl border border-border bg-card/50 flex items-center gap-2 text-xs text-muted-foreground ${className}`}>
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        Checking for student pre-session pulse...
      </div>
    );
  }

  if (!checkIn) {
    return (
      <Card variant="glass" className={`border-border/60 ${className}`}>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold text-foreground">Pre-Session Pulse</span>
            </div>
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              Not checked in yet
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {studentName} hasn't completed their 30-second check-in for this session yet.
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRequestCheckIn}
              disabled={isRequesting || !studentId}
              className="gap-1.5 text-xs h-8"
            >
              {isRequesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send 30s Check-In Ping
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={loadCheckIn}
              className="h-8 px-2 text-muted-foreground hover:text-foreground"
              title="Refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getMoodBadge = (moodStr: string) => {
    switch (moodStr) {
      case "great": return { label: "🌟 Great", variant: "default", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" };
      case "calm": return { label: "😊 Calm", variant: "default", cls: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30" };
      case "okay": return { label: "😐 Okay", variant: "outline", cls: "bg-slate-500/15 text-slate-600 dark:text-slate-400" };
      case "down": return { label: "😔 Down", variant: "default", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30" };
      case "anxious": return { label: "😰 Anxious", variant: "default", cls: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30" };
      case "crisis": return { label: "🚨 Crisis", variant: "destructive", cls: "bg-destructive text-destructive-foreground" };
      default: return { label: moodStr, variant: "outline", cls: "" };
    }
  };

  const moodBadge = getMoodBadge(checkIn.mood);

  return (
    <Card variant="glass" className={`border-primary/20 bg-primary/[0.02] shadow-sm ${className}`}>
      <CardHeader className="p-3.5 pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            Student Pre-Session Pulse
          </CardTitle>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className={`text-[10px] font-medium border ${moodBadge.cls}`}>
              {moodBadge.label}
            </Badge>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={loadCheckIn}
              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
              title="Refresh"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3.5 pt-0 space-y-3">
        {/* Mood & Stress Meters */}
        <div className="grid grid-cols-2 gap-2 text-xs bg-muted/40 p-2.5 rounded-xl border border-border/60">
          <div className="flex items-center gap-2">
            <Battery className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
            <div>
              <span className="text-[10px] uppercase text-muted-foreground block">Energy</span>
              <span className="font-semibold text-foreground">{checkIn.energy_level}/5</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Zap className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
            <div>
              <span className="text-[10px] uppercase text-muted-foreground block">Stress</span>
              <span className={`font-semibold ${checkIn.stress_level >= 4 ? "text-destructive" : "text-foreground"}`}>
                {checkIn.stress_level}/5
              </span>
            </div>
          </div>
        </div>

        {/* Primary Concerns */}
        {Array.isArray(checkIn.primary_concerns) && checkIn.primary_concerns.length > 0 && (
          <div className="space-y-1">
            <span className="text-[10px] uppercase font-semibold text-muted-foreground">Focus Topics</span>
            <div className="flex flex-wrap gap-1">
              {checkIn.primary_concerns.map((c: string) => (
                <span key={c} className="text-[11px] px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Desired Goal */}
        {checkIn.session_goal && (
          <div className="text-xs">
            <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Student Goal Today</span>
            <p className="text-foreground text-[11px] font-medium capitalize mt-0.5">
              {checkIn.session_goal.replace(/_/g, " ")}
            </p>
          </div>
        )}

        {/* Student Note */}
        {checkIn.student_notes && (
          <div className="text-xs p-2 rounded-lg bg-card border border-border/80">
            <span className="text-[10px] text-muted-foreground block font-medium">Student Note:</span>
            <p className="text-foreground text-[11px] italic mt-0.5">"{checkIn.student_notes}"</p>
          </div>
        )}

        {checkIn.is_crisis && (
          <div className="p-2 rounded-lg bg-destructive/10 border border-destructive/20 flex items-center gap-2 text-xs text-destructive font-medium">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            Elevated crisis risk indicated. Prioritize immediate safety de-escalation.
          </div>
        )}

        {/* Action: Insert into Session Notes */}
        {onInsertToNotes && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleInsertNotes}
            className="w-full gap-1.5 text-xs h-8 border border-border hover:bg-primary/10 hover:text-primary transition-all"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Inserted into Notes" : "Insert Pulse into Session Notes"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};
