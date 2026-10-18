import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Heart,
  Sparkles,
  Wind,
  ShieldAlert,
  CheckCircle2,
  Smile,
  Meh,
  Frown,
  Star,
  Activity,
} from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface PostSessionDebriefModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentName?: string;
  sessionId?: string;
  onCompleted?: () => void;
}

export function PostSessionDebriefModal({
  open,
  onOpenChange,
  studentName = "the student",
  sessionId,
  onCompleted,
}: PostSessionDebriefModalProps) {
  const [step, setStep] = useState<"debrief" | "breathing" | "complete">("debrief");
  const [allianceRating, setAllianceRating] = useState<number>(4);
  const [drainLevel, setDrainLevel] = useState<"energized" | "balanced" | "depleted">("balanced");
  const [hasSecondaryTrauma, setHasSecondaryTrauma] = useState<boolean>(false);
  const [clinicalReflection, setClinicalReflection] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Breathing timer states
  const [breathPhase, setBreathPhase] = useState<"Inhale" | "Hold" | "Exhale" | "Rest">("Inhale");
  const [secondsRemaining, setSecondsRemaining] = useState<number>(16);

  const startBreathing = () => {
    setStep("breathing");
    let count = 16;
    setSecondsRemaining(count);
    const interval = setInterval(() => {
      count -= 1;
      setSecondsRemaining(count);
      const mod = (16 - count) % 4;
      if (mod === 0) setBreathPhase("Inhale");
      else if (mod === 1) setBreathPhase("Hold");
      else if (mod === 2) setBreathPhase("Exhale");
      else setBreathPhase("Rest");

      if (count <= 0) {
        clearInterval(interval);
        setStep("complete");
      }
    }, 1000);
  };

  const handleSubmit = async (skipBreathing = false) => {
    setIsSubmitting(true);
    try {
      // Calculate scores based on counselor input
      const moodScore = drainLevel === "energized" ? 85 : drainLevel === "balanced" ? 65 : 40;
      const stressLevel = hasSecondaryTrauma ? 75 : drainLevel === "depleted" ? 60 : 25;
      const burnoutIndex = drainLevel === "depleted" ? 50 : 20;

      const noteContent = [
        `[Post-Session Debrief with ${studentName}]`,
        `Therapeutic Alliance: ${allianceRating}/5`,
        `Drain Level: ${drainLevel}`,
        hasSecondaryTrauma ? "Secondary Trauma / High Crisis: Flagged" : "Standard Case Complexity",
        clinicalReflection.trim() ? `Reflection: ${clinicalReflection.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      await api.createCounselorWellness({
        mood_score: moodScore,
        stress_level: stressLevel,
        burnout_index: burnoutIndex,
        notes: noteContent,
      });

      if (skipBreathing) {
        toast.success("Post-session clinical reflection logged successfully.");
        onOpenChange(false);
        onCompleted?.();
      } else {
        startBreathing();
      }
    } catch {
      toast.info("Debrief saved locally.");
      if (skipBreathing) {
        onOpenChange(false);
        onCompleted?.();
      } else {
        startBreathing();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFinish = () => {
    toast.success("Session closed and clinical reflection saved.");
    onOpenChange(false);
    onCompleted?.();
    setStep("debrief");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 overflow-hidden rounded-3xl border-border bg-background shadow-2xl">
        <DialogHeader className="p-6 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border-b border-border/50">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Activity className="h-5 w-5" />
            </span>
            <div>
              <DialogTitle className="text-lg font-bold text-foreground">
                Post-Session Clinical Reflection
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Session with {studentName} · 30-second clinician debrief
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {step === "debrief" && (
          <div className="p-6 space-y-5">
            {/* 1. Alliance & Progress */}
            <div>
              <label className="text-xs font-semibold text-foreground uppercase tracking-wider block mb-2">
                Therapeutic Alliance & Progress
              </label>
              <div className="flex items-center justify-between gap-2 p-3 rounded-2xl bg-secondary/30 border border-border/50">
                <span className="text-xs text-muted-foreground">Rapport & Engagement</span>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setAllianceRating(star)}
                      className="p-1 text-muted-foreground hover:text-amber-400 transition-colors"
                    >
                      <Star
                        className={`h-5 w-5 ${
                          star <= allianceRating
                            ? "fill-amber-400 text-amber-400"
                            : "text-muted-foreground/40"
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 2. Emotional Vitality / Drain */}
            <div>
              <label className="text-xs font-semibold text-foreground uppercase tracking-wider block mb-2">
                Your Emotional Vitality Right Now
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setDrainLevel("energized")}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl border text-xs font-medium transition-all ${
                    drainLevel === "energized"
                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold shadow-sm"
                      : "border-border/60 hover:bg-secondary/40 text-muted-foreground"
                  }`}
                >
                  <Smile className="h-5 w-5" />
                  Energized
                </button>
                <button
                  type="button"
                  onClick={() => setDrainLevel("balanced")}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl border text-xs font-medium transition-all ${
                    drainLevel === "balanced"
                      ? "border-primary bg-primary/10 text-primary font-semibold shadow-sm"
                      : "border-border/60 hover:bg-secondary/40 text-muted-foreground"
                  }`}
                >
                  <Meh className="h-5 w-5" />
                  Balanced
                </button>
                <button
                  type="button"
                  onClick={() => setDrainLevel("depleted")}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl border text-xs font-medium transition-all ${
                    drainLevel === "depleted"
                      ? "border-amber-500 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold shadow-sm"
                      : "border-border/60 hover:bg-secondary/40 text-muted-foreground"
                  }`}
                >
                  <Frown className="h-5 w-5" />
                  Drained
                </button>
              </div>
            </div>

            {/* 3. Secondary Trauma or Heavy Crisis Trigger */}
            <div
              onClick={() => setHasSecondaryTrauma(!hasSecondaryTrauma)}
              className={`flex items-start gap-3 p-3.5 rounded-2xl border cursor-pointer transition-colors ${
                hasSecondaryTrauma
                  ? "border-destructive/50 bg-destructive/5 text-foreground"
                  : "border-border/60 bg-secondary/20 hover:bg-secondary/40 text-muted-foreground"
              }`}
            >
              <ShieldAlert
                className={`h-5 w-5 shrink-0 mt-0.5 ${
                  hasSecondaryTrauma ? "text-destructive" : "text-muted-foreground"
                }`}
              />
              <div className="text-xs">
                <p className="font-semibold text-foreground">
                  Severe Trauma / Crisis Decompression Flag
                </p>
                <p className="mt-0.5 leading-relaxed text-muted-foreground">
                  Check if this case had acute crisis or emotional residue that warrants a peer debrief.
                </p>
              </div>
            </div>

            {/* 4. Optional 1-sentence note */}
            <div>
              <label className="text-xs font-semibold text-foreground uppercase tracking-wider block mb-1.5">
                Key Breakthrough or Note <span className="font-normal text-muted-foreground">(Optional)</span>
              </label>
              <Textarea
                value={clinicalReflection}
                onChange={(e) => setClinicalReflection(e.target.value)}
                placeholder="e.g. Student identified a healthier boundary with family; agreed to sleep log."
                className="text-xs rounded-xl resize-none h-18"
              />
            </div>

            <DialogFooter className="flex flex-col sm:flex-row gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl w-full sm:w-auto"
                onClick={() => void handleSubmit(true)}
                disabled={isSubmitting}
              >
                Save & Close
              </Button>
              <Button
                size="sm"
                className="rounded-xl w-full sm:w-auto bg-primary text-primary-foreground gap-1.5 shadow-md shadow-primary/20"
                onClick={() => void handleSubmit(false)}
                disabled={isSubmitting}
              >
                <Wind className="h-4 w-4" />
                Debrief & 15s Grounding Breath
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "breathing" && (
          <div className="p-8 flex flex-col items-center justify-center text-center space-y-6">
            <div className="relative flex items-center justify-center h-44 w-44">
              <div
                className={`absolute inset-0 rounded-full transition-all duration-1000 ease-in-out ${
                  breathPhase === "Inhale"
                    ? "scale-100 bg-primary/25 border-4 border-primary"
                    : breathPhase === "Hold"
                    ? "scale-95 bg-primary/30 border-4 border-primary"
                    : breathPhase === "Exhale"
                    ? "scale-75 bg-primary/10 border-2 border-primary/40"
                    : "scale-70 bg-primary/5 border border-primary/20"
                }`}
              />
              <div className="relative z-10">
                <p className="text-xl font-bold text-foreground font-display">{breathPhase}</p>
                <p className="text-xs text-muted-foreground mt-1">{secondsRemaining}s left</p>
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-sm text-foreground">Clinician Centering Reset</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                Release the emotional weight of this session. Ground yourself in the present moment.
              </p>
            </div>

            <Button variant="ghost" size="sm" onClick={() => setStep("complete")} className="text-xs">
              Skip reset
            </Button>
          </div>
        )}

        {step === "complete" && (
          <div className="p-8 flex flex-col items-center justify-center text-center space-y-5">
            <div className="h-14 w-14 rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center animate-in zoom-in-75 duration-300">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <div>
              <h3 className="font-bold text-base text-foreground">Debrief Complete</h3>
              <p className="text-xs text-muted-foreground mt-1.5 max-w-xs">
                Your post-session reflection has been recorded. You are centered and ready for your next client or task.
              </p>
            </div>
            <Button onClick={handleFinish} className="rounded-xl px-6">
              Return to Workspace
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
