import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api, getApiErrorMessage } from "@/lib/api";
import { toast } from "sonner";
import {
  Sparkles,
  Heart,
  Zap,
  Battery,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Check,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface PreSessionPulseModalProps {
  isOpen: boolean;
  onClose: () => void;
  appointmentId?: number | string | null;
  sessionId?: number | string | null;
  counselorName?: string;
  onSuccess?: (checkInData: any) => void;
}

const MOODS = [
  { id: "great", label: "Great / Hopeful", emoji: "🌟", score: 5, color: "hover:border-emerald-500/50 hover:bg-emerald-500/10" },
  { id: "calm", label: "Calm / Balanced", emoji: "😊", score: 4, color: "hover:border-blue-500/50 hover:bg-blue-500/10" },
  { id: "okay", label: "Okay / Neutral", emoji: "😐", score: 3, color: "hover:border-slate-500/50 hover:bg-slate-500/10" },
  { id: "down", label: "Down / Drained", emoji: "😔", score: 2, color: "hover:border-amber-500/50 hover:bg-amber-500/10" },
  { id: "anxious", label: "Anxious / Overwhelmed", emoji: "😰", score: 2, color: "hover:border-orange-500/50 hover:bg-orange-500/10" },
  { id: "crisis", label: "In Crisis / Struggling", emoji: "🚨", score: 1, color: "hover:border-rose-500/50 hover:bg-rose-500/10 text-destructive" },
];

const CONCERN_TAGS = [
  "📚 Academics & Deadlines",
  "😴 Sleep & Exhaustion",
  "👥 Relationships / Family",
  "🌊 Anxiety / Panic",
  "🔋 Motivation & Burnout",
  "🌧️ Low Mood / Sadness",
  "🏠 Home / Living Situation",
  "💭 Just Need to Vent",
];

const SESSION_GOALS = [
  { id: "coping_tools", label: "Practical coping tools & strategies", icon: "🛠️" },
  { id: "venting", label: "A safe space to talk & be heard", icon: "👂" },
  { id: "action_plan", label: "Guidance & problem-solving", icon: "🧭" },
  { id: "grounding", label: "Grounding and emotional relief", icon: "🧘" },
];

export const PreSessionPulseModal = ({
  isOpen,
  onClose,
  appointmentId,
  sessionId,
  counselorName,
  onSuccess,
}: PreSessionPulseModalProps) => {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [mood, setMood] = useState<string>("okay");
  const [moodScore, setMoodScore] = useState<number>(3);
  const [energyLevel, setEnergyLevel] = useState<number>(3);
  const [stressLevel, setStressLevel] = useState<number>(3);
  const [selectedConcerns, setSelectedConcerns] = useState<string[]>([]);
  const [sessionGoal, setSessionGoal] = useState<string>("coping_tools");
  const [studentNotes, setStudentNotes] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggleConcern = (tag: string) => {
    setSelectedConcerns((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleSelectMood = (m: (typeof MOODS)[0]) => {
    setMood(m.id);
    setMoodScore(m.score);
    // Smooth advance to next step
    setTimeout(() => setStep(2), 220);
  };

  const handleSubmit = async () => {
    try {
      setIsSubmitting(true);
      const res = await api.submitPreSessionCheckIn({
        mood,
        mood_score: moodScore,
        energy_level: energyLevel,
        stress_level: stressLevel,
        primary_concerns: selectedConcerns,
        session_goal: sessionGoal,
        student_notes: studentNotes.trim() || undefined,
        appointment_id: appointmentId ? Number(appointmentId) : undefined,
        session_id: sessionId ? Number(sessionId) : undefined,
      });

      toast.success("Pre-session check-in sent to your counselor! ✨");
      onSuccess?.(res);
      onClose();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to submit check-in. Please try again."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open && !isSubmitting) onClose(); }}>
      <DialogContent className="max-w-lg p-0 overflow-hidden border-border bg-background shadow-2xl rounded-2xl">
        {/* Header Banner */}
        <div className="bg-gradient-to-r from-rose-500/15 via-primary/10 to-violet-500/15 p-5 border-b border-border/60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-xl bg-primary/20 flex items-center justify-center text-primary">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle className="text-base font-semibold">Pre-Session Pulse</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  Takes 30 seconds · Helps {counselorName || "your counselor"} support you today
                </DialogDescription>
              </div>
            </div>
            {/* Step Indicator */}
            <div className="flex items-center gap-1.5 bg-background/80 px-2.5 py-1 rounded-full border border-border/60 text-[11px] font-medium text-muted-foreground">
              Step {step} of 4
            </div>
          </div>

          {/* Progress bar */}
          <div className="w-full bg-border/50 h-1 rounded-full mt-4 overflow-hidden">
            <motion.div
              className="bg-primary h-full rounded-full"
              initial={{ width: "25%" }}
              animate={{ width: `${step * 25}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </div>

        {/* Step Content */}
        <div className="p-6">
          <AnimatePresence mode="wait">
            {/* ── STEP 1: MOOD ── */}
            {step === 1 && (
              <motion.div
                key="step-1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div>
                  <h3 className="font-medium text-foreground text-sm flex items-center gap-1.5">
                    <Heart className="h-4 w-4 text-rose-500" />
                    How are you feeling right now today?
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Choose the one that best matches your headspace.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  {MOODS.map((m) => {
                    const isSelected = mood === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => handleSelectMood(m)}
                        className={cn(
                          "flex items-center gap-2.5 p-3 rounded-xl border text-left text-sm transition-all",
                          isSelected
                            ? "border-primary bg-primary/10 shadow-sm font-medium"
                            : "border-border bg-card hover:bg-muted/50",
                          m.color
                        )}
                      >
                        <span className="text-xl">{m.emoji}</span>
                        <span className="text-xs leading-tight">{m.label}</span>
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {/* ── STEP 2: ENERGY & STRESS ── */}
            {step === 2 && (
              <motion.div
                key="step-2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                {/* Energy Level */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground flex items-center gap-1.5">
                      <Battery className="h-4 w-4 text-emerald-500" />
                      Current Energy Level
                    </span>
                    <span className="text-muted-foreground font-semibold">
                      {energyLevel === 1 ? "Drained (1/5)" : energyLevel === 5 ? "Energized (5/5)" : `${energyLevel}/5`}
                    </span>
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    {[1, 2, 3, 4, 5].map((level) => (
                      <button
                        key={level}
                        type="button"
                        onClick={() => setEnergyLevel(level)}
                        className={cn(
                          "py-2.5 rounded-xl border text-xs font-semibold transition-all",
                          energyLevel === level
                            ? "border-primary bg-primary text-primary-foreground shadow-sm"
                            : "border-border bg-muted/40 hover:bg-muted text-muted-foreground"
                        )}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground px-0.5">
                    <span>Low / Exhausted</span>
                    <span>High / Energized</span>
                  </div>
                </div>

                {/* Stress Level */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground flex items-center gap-1.5">
                      <Zap className="h-4 w-4 text-amber-500" />
                      Stress & Pressure Level
                    </span>
                    <span className="text-muted-foreground font-semibold">
                      {stressLevel === 1 ? "Manageable (1/5)" : stressLevel === 5 ? "Overwhelming (5/5)" : `${stressLevel}/5`}
                    </span>
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    {[1, 2, 3, 4, 5].map((level) => (
                      <button
                        key={level}
                        type="button"
                        onClick={() => setStressLevel(level)}
                        className={cn(
                          "py-2.5 rounded-xl border text-xs font-semibold transition-all",
                          stressLevel === level
                            ? level >= 4
                              ? "border-destructive bg-destructive text-destructive-foreground shadow-sm"
                              : "border-primary bg-primary text-primary-foreground shadow-sm"
                            : "border-border bg-muted/40 hover:bg-muted text-muted-foreground"
                        )}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground px-0.5">
                    <span>Mild / Manageable</span>
                    <span>High / Heavy</span>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ── STEP 3: CONCERNS & NOTE ── */}
            {step === 3 && (
              <motion.div
                key="step-3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div>
                  <h3 className="font-medium text-foreground text-sm">
                    What is top of mind for you today?
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Tap any topics that apply (optional).
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {CONCERN_TAGS.map((tag) => {
                    const isSelected = selectedConcerns.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleConcern(tag)}
                        className={cn(
                          "px-3 py-1.5 rounded-full border text-xs transition-all flex items-center gap-1.5",
                          isSelected
                            ? "border-primary bg-primary/10 text-primary font-medium"
                            : "border-border bg-muted/30 text-muted-foreground hover:bg-muted"
                        )}
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                        {tag}
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-1 pt-1">
                  <label className="text-xs text-muted-foreground">
                    Anything specific you'd like your counselor to know? (Optional)
                  </label>
                  <Textarea
                    placeholder="e.g. Having a hard time focusing lately, or had a rough morning..."
                    value={studentNotes}
                    onChange={(e) => setStudentNotes(e.target.value)}
                    rows={2}
                    maxLength={500}
                    className="text-xs resize-none"
                  />
                </div>
              </motion.div>
            )}

            {/* ── STEP 4: GOAL & CONFIRM ── */}
            {step === 4 && (
              <motion.div
                key="step-4"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div>
                  <h3 className="font-medium text-foreground text-sm">
                    What would make today's session most helpful?
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Helps your counselor tailor the flow to what you need today.
                  </p>
                </div>

                <div className="space-y-2">
                  {SESSION_GOALS.map((goal) => {
                    const isSelected = sessionGoal === goal.id;
                    return (
                      <button
                        key={goal.id}
                        type="button"
                        onClick={() => setSessionGoal(goal.id)}
                        className={cn(
                          "w-full flex items-center gap-3 p-3 rounded-xl border text-left text-xs transition-all",
                          isSelected
                            ? "border-primary bg-primary/10 text-foreground font-medium"
                            : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/50"
                        )}
                      >
                        <span className="text-lg">{goal.icon}</span>
                        <span className="flex-1">{goal.label}</span>
                        {isSelected && <Check className="h-4 w-4 text-primary" />}
                      </button>
                    );
                  })}
                </div>

                {mood === "crisis" && (
                  <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 flex items-start gap-2 text-xs text-destructive">
                    <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>
                      You marked being in crisis. We have flagged this session for high-priority support. If you are in immediate danger, please dial local emergency services or campus security immediately.
                    </span>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer Navigation */}
        <div className="p-4 bg-muted/20 border-t border-border flex items-center justify-between">
          {step > 1 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setStep((prev) => (prev - 1) as any)}
              className="gap-1 text-xs"
              disabled={isSubmitting}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-xs text-muted-foreground"
              disabled={isSubmitting}
            >
              Skip for now
            </Button>
          )}

          {step < 4 ? (
            <Button
              type="button"
              size="sm"
              onClick={() => setStep((prev) => (prev + 1) as any)}
              className="gap-1 text-xs"
            >
              Next
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="gap-1.5 text-xs bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Send Check-In
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
