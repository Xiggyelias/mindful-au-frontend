import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { studentNavItems } from "@/config/studentNavItems";
import { DashboardHeader } from "@/components/DashboardHeader";
import { useAuth } from "@/hooks/useAuth";
import { WellnessCheckInIntro } from "@/components/assessment/WellnessCheckInIntro";
import { WellnessCheckInQuestion } from "@/components/assessment/WellnessCheckInQuestion";
import { WellnessCheckInResults } from "@/components/assessment/WellnessCheckInResults";
import { api, getApiErrorMessage } from "@/lib/api";
import { toast } from "sonner";

interface QuestionOption {
  value: string;
  label: string;
  score?: number;
  severity?: number;
  weight?: number;
}

interface Question {
  id: string;
  category: string;
  type: string;
  question: string;
  description: string;
  section?: string;
  section_title?: string;
  required?: boolean;
  options?: QuestionOption[];
  scoring?: { polarity?: string };
}

interface DiagnosticResult {
  id: number;
  total_score: number;
  risk_level: string;
  category_scores: Record<string, number>;
  ai_recommendations: {
    primary: string;
    actions: string[];
    category_alerts?: Record<string, string>;
    counselor_summary?: string;
    focus_areas?: string[];
    risk_flags?: string[];
    scoring_model?: string;
  };
  created_at: string;
}

interface DiagnosticTrend {
  date: string;
  score: number;
  risk_level: string;
  categories: Record<string, number>;
}

/** Normalize API `questions` shape: array, or { questions: [...] }. */
function extractQuestionList(data: unknown): Question[] {
  if (!data || typeof data !== "object") {
    return [];
  }
  const record = data as Record<string, unknown>;
  const nested = record.questions;
  if (Array.isArray(nested)) {
    return nested as Question[];
  }
  if (nested && typeof nested === "object" && Array.isArray((nested as Record<string, unknown>).questions)) {
    return (nested as Record<string, unknown>).questions as Question[];
  }
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// University-tailored question bank — 7 high-impact questions.
// Covers: personal context, emotional distress, functional impact,
// academic stress, safety screening and counselling goals.
// ─────────────────────────────────────────────────────────────────────────────

const FREQ_OPTIONS: QuestionOption[] = [
  { value: "1", label: "Never",        score: 0 },
  { value: "2", label: "Rarely",       score: 1 },
  { value: "3", label: "Sometimes",    score: 2 },
  { value: "4", label: "Often",        score: 3 },
  { value: "5", label: "Almost always",score: 4 },
];

const UNIVERSITY_QUESTIONS: Question[] = [

  // ── 1. Personal Context & Study Load ───────────────────────────────────────
  {
    id: "ctx_year_level",
    category: "context",
    section: "1",
    section_title: "Personal Context & Study Load",
    type: "single_choice",
    question: "What best describes where you are in your studies?",
    description: "Choose one",
    options: [
      { value: "first_year",     label: "First year",                           severity: 10 },
      { value: "undergrad_mid",  label: "Undergraduate — mid-years",            severity: 10 },
      { value: "undergrad_final",label: "Undergraduate — final year",           severity: 15 },
      { value: "postgrad",       label: "Postgraduate coursework",              severity: 12 },
      { value: "research",       label: "Research degree (e.g. PhD, MPhil)",    severity: 18 },
      { value: "other",          label: "Other / prefer not to say",            severity: 10 },
    ],
    required: true,
  },

  // ── 2. Emotional Patterns ──────────────────────────────────────────────────
  {
    id: "emo_low_mood",
    category: "emotional_distress",
    section: "2",
    section_title: "Emotional Patterns (past few weeks)",
    type: "frequency_5",
    question: "How often have you felt down, depressed, hopeless, nervous, or on edge?",
    description: "Think about the last 2–3 weeks",
    options: FREQ_OPTIONS,
    required: true,
    scoring: { polarity: "negative" },
  },

  // ── 3. Functional Impact ───────────────────────────────────────────────────
  {
    id: "fn_academic_impact",
    category: "functional_impact",
    section: "3",
    section_title: "Impact on Daily Life",
    type: "frequency_5",
    question: "How often has your mental health actively affected your academic or work performance?",
    description: "Think about the last 2–3 weeks",
    options: FREQ_OPTIONS,
    required: true,
    scoring: { polarity: "negative" },
  },

  // ── 4. Academic Stress ─────────────────────────────────────────────────────
  {
    id: "str_academic",
    category: "stress_load",
    section: "4",
    section_title: "Sources of Stress",
    type: "scale_1_10",
    question: "How intense is your academic pressure, deadlines, or general study-related stress right now?",
    description: "1 = very low stress · 10 = extremely high stress",
    required: true,
    scoring: { polarity: "negative" },
  },

  // ── 5. Safety Check — Self-harm ────────────────────────────────────────────
  {
    id: "risk_thoughts_harm",
    category: "safety",
    section: "5",
    section_title: "Brief Safety Check",
    type: "yes_no",
    question: "Are you having thoughts of hurting yourself or that you would be better off dead?",
    description: "Your honest answers help us support you",
    required: true,
    scoring: { polarity: "risk_screen" },
  },

  // ── 5. Safety Check — Urgent support ───────────────────────────────────────
  {
    id: "risk_want_urgent",
    category: "safety",
    section: "5",
    section_title: "Brief Safety Check",
    type: "yes_no",
    question: "Do you want a counsellor to reach out with urgent support?",
    description: "Your honest answers help us support you",
    required: true,
    scoring: { polarity: "risk_screen" },
  },

  // ── 6. Session Goals ──────────────────────────────────────────────────────
  {
    id: "sess_main_focus",
    category: "session_goals",
    section: "6",
    section_title: "Goals for Counselling",
    type: "textarea",
    question: "What would you most like support or guidance with in counselling?",
    description: "A short sentence or paragraph is enough",
    required: true,
    scoring: { polarity: "none" },
  },
];

/** No selection needed — all 7 questions are shown. */
function selectRepresentativeQuestions(questions: Question[]): Question[] {
  return questions;
}

function isRequired(question: Question): boolean {
  return question.required !== false;
}

function isAnswered(question: Question, value: unknown): boolean {
  if (!isRequired(question)) {
    return true;
  }

  if (value === undefined || value === null) {
    return false;
  }

  switch (question.type) {
    case "multi_select":
      return Array.isArray(value) && value.length > 0;
    case "text":
    case "textarea":
      return String(value).trim().length > 0;
    case "scale":
    case "scale_1_5":
    case "scale_1_10":
      // Accept both numeric values (legacy) and string values from labeled option buttons
      if (typeof value === "number") return Number.isFinite(value);
      if (typeof value === "string") return value.trim() !== "" && !Number.isNaN(Number(value));
      return false;
    case "frequency_5":
    case "single_choice":
    case "multiple_choice":
    case "yes_no":
      return String(value).trim() !== "";
    default:
      return String(value).trim() !== "";
  }
}

/**
 * Normalise response values before sending to the backend.
 * Labeled option buttons store values as strings ("1"–"5"); the backend
 * scoring engine expects plain numbers.
 */
function normalizeResponses(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
      out[key] = Number(value);
    } else if (Array.isArray(value)) {
      // multi_select: convert numeric strings inside arrays too
      out[key] = value.map((v) =>
        typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : v
      );
    } else {
      out[key] = value;
    }
  }
  return out;
}

const StudentDiagnosticAssessment = () => {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, refreshUser, markAssessmentComplete } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || "Student";

  const [step, setStep] = useState<"intro" | "form" | "results">("intro");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [responses, setResponses] = useState<Record<string, any>>({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const [questionnaireId, setQuestionnaireId] = useState<number | null>(null);
  const [history, setHistory] = useState<DiagnosticResult[]>([]);
  const [trends, setTrends] = useState<DiagnosticTrend[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [isQuestionnaireLoading, setIsQuestionnaireLoading] = useState(false);
  const [questionnaireError, setQuestionnaireError] = useState<string | null>(null);

  // ── One-time gate ──────────────────────────────────────────────────────────
  // Students who have already completed the intake assessment should see their
  // existing result, not a blank start screen.  Load the latest diagnostic on
  // mount; if found, jump straight to results.
  useEffect(() => {
    if (!user?.id) return;

    if (user.needs_assessment === false) {
      // Already completed — try to pre-populate results without blocking the UI.
      api.getLatestDiagnostic().then((data) => {
        // API may return { diagnostic: {...} } or the diagnostic object directly.
        const wrapped = (data as { diagnostic?: DiagnosticResult })?.diagnostic;
        const direct = (data as DiagnosticResult)?.id ? (data as DiagnosticResult) : null;
        const diag = wrapped ?? direct ?? null;
        if (diag) {
          setResult(diag);
          setStep("results");
        }
      }).catch(() => {
        // No prior result on the server yet — fall through to intro.
      });
    }

    loadQuestionnaire();
  }, [user?.id, user?.needs_assessment]);

  useEffect(() => {
    if (step === "results") {
      loadHistory();
      loadTrends();
    }
  }, [step]);

  // If questions become unavailable while the form is open, fall back to intro
  // so the user sees the error banner rather than a blank card.
  useEffect(() => {
    if (step === "form" && questions.length === 0 && !isQuestionnaireLoading) {
      setStep("intro");
    }
  }, [step, questions.length, isQuestionnaireLoading]);

  const loadQuestionnaire = async () => {
    setQuestionnaireError(null);
    setIsQuestionnaireLoading(true);
    try {
      const data = await api.getDiagnosticQuestionnaire();
      const id = typeof (data as Record<string, unknown>)?.id === "number"
        ? (data as { id: number }).id
        : Number((data as { id?: unknown })?.id ?? 0);

      // Always prefer the university-tailored local bank. Fall back to API list
      // only when the local bank is empty.
      const questionList = UNIVERSITY_QUESTIONS.length > 0
        ? selectRepresentativeQuestions(UNIVERSITY_QUESTIONS)
        : selectRepresentativeQuestions(extractQuestionList(data));

      setQuestions(questionList);
      setQuestionnaireId(Number.isFinite(id) && id > 0 ? id : null);

      if (questionList.length === 0) {
        toast.error("No questions available for this questionnaire yet.");
      }
    } catch (error: unknown) {
      if (import.meta.env.DEV) {
        console.error("Failed to load questionnaire metadata:", error);
      }
      // The local question bank is self-contained — load it even when the API
      // fails so the student can still take the assessment.  The questionnaire
      // ID will be missing, which means the backend will reject the submit, but
      // that error is surfaced at submit-time rather than blocking the form.
      if (UNIVERSITY_QUESTIONS.length > 0) {
        const questionList = selectRepresentativeQuestions(UNIVERSITY_QUESTIONS);
        setQuestions(questionList);
        setQuestionnaireId(null);
        setQuestionnaireError(
          "We could not connect to register your check-in. Tap Retry when you are back online — you cannot submit until then."
        );
      } else {
        const message = getApiErrorMessage(
          error,
          "Could not load the assessment. Try again or contact support if this continues.",
        );
        setQuestionnaireError(message);
        toast.error(message);
      }
    } finally {
      setIsQuestionnaireLoading(false);
    }
  };

  const loadHistory = async () => {
    try {
      setIsHistoryLoading(true);
      const data = await api.getDiagnosticHistory();
      setHistory(Array.isArray(data) ? data : data?.diagnostics ?? data?.history ?? []);
    } catch (error) {
      if (import.meta.env.DEV) console.error("Failed to load diagnostic history:", error);
      // History is supplementary — no toast needed, just silently fail.
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const loadTrends = async () => {
    try {
      const data = await api.getDiagnosticTrends(30);
      setTrends(data?.trends || []);
    } catch (error) {
      if (import.meta.env.DEV) console.error("Failed to load diagnostic trends:", error);
      // Trends are supplementary — silently fail.
    }
  };

  const isHardError = questionnaireError !== null && questions.length === 0;
  const isOfflineBlocked =
    !isQuestionnaireLoading && questions.length > 0 && questionnaireId === null;

  const handleStartAssessment = () => {
    if (isQuestionnaireLoading) {
      toast.info("Still loading the questionnaire — please wait.");
      return;
    }
    if (isHardError || isOfflineBlocked) {
      toast.error(
        isOfflineBlocked
          ? "Connect to the internet and tap Retry before starting your check-in."
          : "The assessment is not ready yet. Use Retry or refresh the page."
      );
      return;
    }
    if (questions.length === 0) {
      toast.error("No questions loaded yet. Please wait or refresh the page.");
      return;
    }
    setStep("form");
    setCurrentQuestionIndex(0);
  };

  const handleResponseChange = (value: unknown) => {
    const currentQuestion = questions[currentQuestionIndex];
    setResponses({
      ...responses,
      [currentQuestion.id]: value,
    });
  };

  const toggleMultiSelect = (optionValue: string) => {
    const currentQuestion = questions[currentQuestionIndex];
    const raw = responses[currentQuestion.id];
    const current: string[] = Array.isArray(raw) ? raw : [];
    const next = current.includes(optionValue)
      ? current.filter((v) => v !== optionValue)
      : [...current, optionValue];
    setResponses({
      ...responses,
      [currentQuestion.id]: next,
    });
  };

  const validateResponses = (map: Record<string, unknown>): boolean => {
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!isRequired(q)) continue;
      if (!isAnswered(q, map[q.id])) {
        // Jump directly to the unanswered question so the user can see it.
        setCurrentQuestionIndex(i);
        toast.error(`Please answer: ${q.question.slice(0, 80)}${q.question.length > 80 ? "…" : ""}`);
        return false;
      }
    }
    return true;
  };

  const validateAllRequired = (): boolean => validateResponses(responses);

  const handleSkipOptional = () => {
    const q = questions[currentQuestionIndex];
    if (isRequired(q)) {
      toast.error("This question is required.");
      return;
    }
    const copy = { ...responses };
    delete copy[q.id];
    setResponses(copy);
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      return;
    }
    if (validateResponses(copy)) {
      void runSubmit(copy);
    }
  };

  /** Scale / choice taps: save answer and advance in one update (avoids stale state vs delayed onNext). */
  const handleAnswerAndAdvance = (value: unknown) => {
    const q = questions[currentQuestionIndex];
    if (!q) return;
    setResponses((prev) => ({ ...prev, [q.id]: value }));
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex((i) => i + 1);
    }
  };

  const handleNextQuestion = () => {
    const q = questions[currentQuestionIndex];
    if (!q) return;
    const v = responses[q.id];
    if (!isAnswered(q, v)) {
      toast.error("Please answer this question before continuing.");
      return;
    }
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex((i) => i + 1);
    }
  };

  const handlePreviousQuestion = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(currentQuestionIndex - 1);
    }
  };

  const runSubmit = async (payload: Record<string, any>) => {
    if (!questionnaireId) {
      toast.error("Could not reach the server to register your assessment. Please check your connection and try again.");
      return;
    }

    // Convert string numeric values ("1"–"5") to numbers so the backend
    // scoring engine receives the correct types.
    const normalized = normalizeResponses(payload);

    setIsLoading(true);
    try {
      const data = await api.submitDiagnosticAssessment(normalized, questionnaireId, false);
      // API may return { diagnostic: {...} } or the diagnostic object directly.
      const diag: DiagnosticResult | null =
        (data as { diagnostic?: DiagnosticResult })?.diagnostic ??
        ((data as DiagnosticResult)?.id ? (data as DiagnosticResult) : null);
      if (!diag) {
        toast.error("Assessment submitted but your results could not be loaded. Please reload.");
        markAssessmentComplete();
        await refreshUser();
        return;
      }
      markAssessmentComplete();
      setResult(diag);
      setStep("results");
      toast.success("Check-in complete — here are your insights.");
      await refreshUser();
    } catch (error: unknown) {
      if (import.meta.env.DEV) {
        console.error("Failed to submit assessment:", error);
      }
      toast.error(getApiErrorMessage(error, "Failed to submit assessment"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitAssessment = async () => {
    if (!validateAllRequired()) {
      return;
    }
    await runSubmit(responses);
  };

  const currentQuestion = questions[currentQuestionIndex];
  const prevQuestion = questions[currentQuestionIndex - 1];
  const sectionChanged =
    Boolean(currentQuestion?.section_title) &&
    (!prevQuestion || prevQuestion.section_title !== currentQuestion.section_title);

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar
        items={
          user?.needs_assessment
            ? [...studentNavItems].filter((item) => item.path === "/student/diagnostic-assessment")
            : [...studentNavItems]
        }
        userType="student"
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-72 pl-0">
        <DashboardHeader
          title="Wellness check-in"
          onMenuClick={user?.needs_assessment ? undefined : () => setSidebarOpen(true)}
        />

        <main
          className={
            step === "intro" || step === "form"
              ? "min-h-[calc(100dvh-4rem)] bg-gradient-to-b from-accent/40 via-background to-muted/30 p-4 pb-10 lg:p-8"
              : "p-4 lg:p-6"
          }
        >
          {step === "intro" && (
            <WellnessCheckInIntro
              needsAssessment={Boolean(user?.needs_assessment)}
              isLoading={isQuestionnaireLoading}
              questionCount={questions.length}
              error={questionnaireError}
              isHardError={isHardError || isOfflineBlocked}
              onStart={handleStartAssessment}
              onRetry={() => void loadQuestionnaire()}
              canGoBack={!user?.needs_assessment}
              onBack={user?.needs_assessment ? undefined : () => navigate("/student/dashboard")}
            />
          )}

          {step === "form" && currentQuestion && (
            <WellnessCheckInQuestion
              question={currentQuestion}
              questionIndex={currentQuestionIndex}
              totalQuestions={questions.length}
              response={responses[currentQuestion.id]}
              showSection={sectionChanged}
              isLoading={isLoading}
              onResponse={handleResponseChange}
              onToggleMulti={toggleMultiSelect}
              onBack={handlePreviousQuestion}
              onAnswerAndAdvance={handleAnswerAndAdvance}
              onSkip={currentQuestion.required === false ? handleSkipOptional : undefined}
              onNext={handleNextQuestion}
              onSubmit={() => void handleSubmitAssessment()}
            />
          )}

          {step === "results" && result && (
            <WellnessCheckInResults
              result={result}
              history={history}
              trends={trends}
              isHistoryLoading={isHistoryLoading}
              onDashboard={() => navigate("/student/dashboard")}
              onWellness={() => navigate("/student/wellness")}
              onAppointments={() => navigate("/student/appointments")}
            />
          )}
        </main>
      </div>
    </div>
  );
};

export default StudentDiagnosticAssessment;
