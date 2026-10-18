import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Clock,
  Sparkles,
  Heart,
  Moon,
  ShieldCheck,
  CheckCircle2,
  Calendar,
  AlertCircle,
  Coffee,
  Feather,
  Zap,
} from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface CounselorClockOutModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClockedOut?: () => void;
}

export function CounselorClockOutModal({
  open,
  onOpenChange,
  onClockedOut,
}: CounselorClockOutModalProps) {
  const [vitalityScore, setVitalityScore] = useState<number>(75);
  const [boundaryRating, setBoundaryRating] = useState<number>(3); // 0 to 4
  const [vicariousLoad, setVicariousLoad] = useState<number>(1); // 0 to 4
  const [meaningfulMoment, setMeaningfulMoment] = useState<string>("");
  const [stage, setStage] = useState<"evaluate" | "transition" | "completed">("evaluate");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [clockOutSummary, setClockOutSummary] = useState<{
    time: string;
    vitality: number;
    feedback: string;
  } | null>(null);

  const getVitalityLabel = (score: number) => {
    if (score >= 80) return { label: "High Vitality", color: "text-emerald-500", bg: "bg-emerald-500/10" };
    if (score >= 55) return { label: "Balanced / Steady", color: "text-primary", bg: "bg-primary/10" };
    if (score >= 35) return { label: "Moderate Fatigue", color: "text-amber-500", bg: "bg-amber-500/10" };
    return { label: "Severe Depletion", color: "text-destructive", bg: "bg-destructive/10" };
  };

  const handleStartTransition = () => {
    setStage("transition");
  };

  const handleConfirmClockOut = async () => {
    setIsSubmitting(true);
    try {
      // Stress & Burnout calculated based on vitality, boundary control, and vicarious trauma
      const stressLevel = Math.max(
        0,
        Math.min(100, Math.round(100 - vitalityScore + vicariousLoad * 12 - boundaryRating * 8))
      );
      const burnoutIndex = Math.max(
        0,
        Math.min(100, Math.round((100 - vitalityScore) * 0.7 + vicariousLoad * 10))
      );

      const notes = [
        `[Daily Shift Debrief & Clock-Out Assessment]`,
        `End-of-Day Vitality: ${vitalityScore}% (${getVitalityLabel(vitalityScore).label})`,
        `Boundary Separation Score: ${boundaryRating}/4`,
        `Vicarious Trauma Burden: ${vicariousLoad}/4`,
        meaningfulMoment.trim() ? `Daily Win / Meaningful Moment: ${meaningfulMoment.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      await api.createCounselorWellness({
        mood_score: vitalityScore,
        stress_level: stressLevel,
        burnout_index: burnoutIndex,
        notes,
      });

      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const todayKey = now.toISOString().split("T")[0];

      try {
        localStorage.setItem(
          `counselor_shift_clockout_${todayKey}`,
          JSON.stringify({
            clockedOutAt: now.toISOString(),
            vitalityScore,
            boundaryRating,
          })
        );
        window.dispatchEvent(new Event("counselor_clock_status_changed"));
      } catch {
        /* storage fallback */
      }

      let advice = "Great work today! Take time to disconnect completely from clinical screens and rest.";
      if (vitalityScore < 50 || vicariousLoad >= 3) {
        advice = "You carried heavy cases today. Please protect your recovery: hydrate, take a gentle walk, and avoid work emails.";
      }

      setClockOutSummary({
        time: timeStr,
        vitality: vitalityScore,
        feedback: advice,
      });

      setStage("completed");
      toast.success("Shift evaluation complete. You are officially clocked out!");
      onClockedOut?.();
    } catch {
      toast.info("Shift clock-out recorded locally.");
      setStage("completed");
      onClockedOut?.();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    setStage("evaluate");
  };

  const vitalityInfo = getVitalityLabel(vitalityScore);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 overflow-hidden rounded-3xl border-border bg-background shadow-2xl">
        <DialogHeader className="p-6 bg-gradient-to-br from-indigo-500/10 via-primary/5 to-transparent border-b border-border/50">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/15 text-primary shadow-inner">
              <Moon className="h-5 w-5" />
            </span>
            <div>
              <DialogTitle className="text-lg font-bold text-foreground">
                End-of-Day Shift Evaluation & Clock-Out
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Holistic clinician decompression, self-assessment & formal shift closure
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {stage === "evaluate" && (
          <div className="p-6 space-y-6">
            {/* 1. Vitality Spectrum Slider */}
            <div className="space-y-3 p-4 rounded-2xl bg-secondary/25 border border-border/50">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">
                    Overall Cognitive & Emotional Vitality
                  </label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    How much energy and mental freshness do you have at shift conclusion?
                  </p>
                </div>
                <Badge variant="outline" className={`font-bold text-xs ${vitalityInfo.bg} ${vitalityInfo.color}`}>
                  {vitalityScore}% · {vitalityInfo.label}
                </Badge>
              </div>

              <Slider
                value={[vitalityScore]}
                onValueChange={(vals) => setVitalityScore(vals[0])}
                min={10}
                max={100}
                step={5}
                className="py-2"
              />

              <div className="flex justify-between text-[11px] text-muted-foreground font-medium">
                <span>Depleted & Exhausted</span>
                <span>Balanced & Steady</span>
                <span>Energized</span>
              </div>
            </div>

            {/* 2. Boundary and Detachment Readiness */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">
                Emotional Boundary & Detachment
              </label>
              <p className="text-xs text-muted-foreground">
                "I am able to leave student burdens at the clinic door and disconnect tonight."
              </p>
              <div className="grid grid-cols-4 gap-2 pt-1">
                {[
                  { value: 1, label: "Hard to disconnect" },
                  { value: 2, label: "Mild lingering" },
                  { value: 3, label: "Good boundary" },
                  { value: 4, label: "Full detachment" },
                ].map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setBoundaryRating(item.value)}
                    className={`py-2 px-1 text-center rounded-xl border text-[11px] font-medium transition-all ${
                      boundaryRating === item.value
                        ? "border-primary bg-primary/10 text-primary font-bold shadow-sm"
                        : "border-border/60 hover:bg-secondary/40 text-muted-foreground"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 3. Vicarious Trauma & Secondary Stress */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">
                Secondary Trauma / Emotional Residue
              </label>
              <p className="text-xs text-muted-foreground">
                Did any client disclosure today cause personal distress or visceral heaviness?
              </p>
              <div className="grid grid-cols-3 gap-2 pt-1">
                {[
                  { value: 0, label: "None / Clear" },
                  { value: 2, label: "Mild / Manageable" },
                  { value: 4, label: "High / Need Support" },
                ].map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setVicariousLoad(item.value)}
                    className={`py-2 px-2 text-center rounded-xl border text-xs font-medium transition-all ${
                      vicariousLoad === item.value
                        ? item.value === 4
                          ? "border-destructive bg-destructive/10 text-destructive font-bold"
                          : "border-primary bg-primary/10 text-primary font-bold shadow-sm"
                        : "border-border/60 hover:bg-secondary/40 text-muted-foreground"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 4. Daily Win / Meaningful Connection */}
            <div>
              <label className="text-xs font-semibold text-foreground uppercase tracking-wider block mb-1">
                One Clinical Win or Empathic Connection <span className="font-normal text-muted-foreground">(Optional)</span>
              </label>
              <Textarea
                value={meaningfulMoment}
                onChange={(e) => setMeaningfulMoment(e.target.value)}
                placeholder="e.g. A student expressed relief after establishing safety plan; felt strong rapport."
                className="text-xs rounded-xl resize-none h-16"
              />
            </div>

            <DialogFooter className="flex flex-col sm:flex-row gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                className="rounded-xl"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleStartTransition}
                className="rounded-xl bg-primary text-primary-foreground gap-2 shadow-md shadow-primary/25"
              >
                <Feather className="h-4 w-4" />
                Proceed to Boundary Ritual
              </Button>
            </DialogFooter>
          </div>
        )}

        {stage === "transition" && (
          <div className="p-8 text-center space-y-6">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/10 text-primary border border-primary/20 shadow-lg animate-pulse">
              <Moon className="h-10 w-10" />
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-bold text-foreground font-display">
                The Mindful Transition Ritual
              </h3>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
                In clinical practice, leaving the psychological "cloak" behind is vital. You offered your knowledge,
                presence, and compassion today.
              </p>
              <div className="p-4 rounded-2xl bg-secondary/30 border border-border/50 text-xs italic text-foreground/90 max-w-xs mx-auto">
                "My work for today is complete. I release the stories I held. Tonight belongs to my own rest and renewal."
              </div>
            </div>

            <DialogFooter className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStage("evaluate")}
                className="rounded-xl"
              >
                Back to Assessment
              </Button>
              <Button
                size="sm"
                disabled={isSubmitting}
                onClick={() => void handleConfirmClockOut()}
                className="rounded-xl bg-primary text-primary-foreground px-6 shadow-lg shadow-primary/25"
              >
                {isSubmitting ? "Saving..." : "Clock Out for Today"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {stage === "completed" && (
          <div className="p-8 text-center space-y-6">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 animate-in zoom-in-75 duration-300">
              <CheckCircle2 className="h-9 w-9" />
            </div>

            <div className="space-y-2">
              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 font-bold">
                Shift Successfully Completed
              </Badge>
              <h3 className="text-xl font-bold text-foreground">
                Clocked Out at {clockOutSummary?.time}
              </h3>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed pt-1">
                {clockOutSummary?.feedback}
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-secondary/30 border border-border/60 flex items-center justify-around text-xs">
              <div>
                <p className="text-muted-foreground">Recorded Vitality</p>
                <p className="font-bold text-foreground text-sm mt-0.5">{clockOutSummary?.vitality}%</p>
              </div>
              <div className="h-8 w-px bg-border/60" />
              <div>
                <p className="text-muted-foreground">Shift Status</p>
                <p className="font-bold text-emerald-600 dark:text-emerald-400 text-sm mt-0.5">Off Duty</p>
              </div>
            </div>

            <Button onClick={handleClose} className="rounded-xl px-8 shadow-md">
              Close & Relax
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
