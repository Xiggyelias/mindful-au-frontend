import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { studentNavItems } from "@/config/studentNavItems";
import { DashboardHeader } from "@/components/DashboardHeader";
import { useAuth } from "@/hooks/useAuth";
import { WellnessCheckInIntro, type AssessmentMode } from "@/components/assessment/WellnessCheckInIntro";
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

const FREQ_OPTIONS: QuestionOption[] = [
  { value: "1", label: "Never", score: 0 },
  { value: "2", label: "Rarely", score: 1 },
  { value: "3", label: "Sometimes", score: 2 },
  { value: "4", label: "Often", score: 3 },
  { value: "5", label: "Almost always", score: 4 },
];

const AGREEMENT_OPTIONS_POSITIVE: QuestionOption[] = [
  { value: "1", label: "Strongly disagree", score: 4 },
  { value: "2", label: "Disagree", score: 3 },
  { value: "3", label: "Mixed / neutral", score: 2 },
  { value: "4", label: "Agree", score: 1 },
  { value: "5", label: "Strongly agree", score: 0 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Mode 1: Quick Campus Check-In (7 high-impact questions)
// ─────────────────────────────────────────────────────────────────────────────
const QUICK_CHECKIN_QUESTIONS: Question[] = [
  {
    id: "ctx_year_level",
    category: "context",
    section: "1",
    section_title: "Personal Context & Study Load",
    type: "single_choice",
    question: "What best describes where you are in your studies?",
    description: "Choose one",
    options: [
      { value: "first_year", label: "First year", severity: 10 },
      { value: "undergrad_mid", label: "Undergraduate — mid-years", severity: 10 },
      { value: "undergrad_final", label: "Undergraduate — final year", severity: 15 },
      { value: "postgrad", label: "Postgraduate coursework", severity: 12 },
      { value: "research", label: "Research degree (e.g. PhD, MPhil)", severity: 18 },
      { value: "other", label: "Other / prefer not to say", severity: 10 },
    ],
    required: true,
  },
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

// ─────────────────────────────────────────────────────────────────────────────
// Mode 2: Full Campus Life Assessment (10 domains across university wellbeing)
// ─────────────────────────────────────────────────────────────────────────────
const CAMPUS_LIFE_QUESTIONS: Question[] = [
  {
    id: "univ_school_engagement",
    category: "academic_engagement",
    section: "1",
    section_title: "Academic Engagement & Workload",
    type: "frequency_5",
    question: "I feel connected to and motivated in my university classes and coursework.",
    description: "Think about the past 2–3 weeks",
    options: AGREEMENT_OPTIONS_POSITIVE,
    required: true,
    scoring: { polarity: "positive" },
  },
  {
    id: "univ_acad_overload",
    category: "academic_stress",
    section: "1",
    section_title: "Academic Engagement & Workload",
    type: "frequency_5",
    question: "How often has your coursework, assignments, or exam load felt overwhelming?",
    description: "Think about the past 2–3 weeks",
    options: FREQ_OPTIONS,
    required: true,
    scoring: { polarity: "negative" },
  },
  {
    id: "univ_mood_lowness",
    category: "emotional_wellbeing",
    section: "2",
    section_title: "Emotional & Mental Wellbeing",
    type: "frequency_5",
    question: "How often have you felt low, down, or unmotivated in your day-to-day life?",
    description: "Think about the past 2–3 weeks",
    options: FREQ_OPTIONS,
    required: true,
    scoring: { polarity: "negative" },
  },
  {
    id: "univ_anxiety_tension",
    category: "anxiety_stress",
    section: "2",
    section_title: "Emotional & Mental Wellbeing",
    type: "frequency_5",
    question: "How often have you felt anxious, tense, or unable to stop worrying?",
    description: "Think about the past 2–3 weeks",
    options: FREQ_OPTIONS,
    required: true,
    scoring: { polarity: "negative" },
  },
  {
    id: "univ_sleep_quality",
    category: "sleep_energy",
    section: "3",
    section_title: "Sleep & Physical Wellbeing",
    type: "frequency_5",
    question: "I wake up feeling rested and get enough quality sleep on most nights.",
    description: "Think about the past 2–3 weeks",
    options: AGREEMENT_OPTIONS_POSITIVE,
    required: true,
    scoring: { polarity: "positive" },
  },
  {
    id: "univ_physical_selfcare",
    category: "physical_wellbeing",
    section: "3",
    section_title: "Sleep & Physical Wellbeing",
    type: "frequency_5",
    question: "I am keeping up with regular meals, hydration, and basic physical self-care.",
    description: "Think about the past 2–3 weeks",
    options: AGREEMENT_OPTIONS_POSITIVE,
    required: true,
    scoring: { polarity: "positive" },
  },
  {
    id: "univ_social_belonging",
    category: "social_connection",
    section: "4",
    section_title: "Social Connection & Campus Life",
    type: "frequency_5",
    question: "I feel a sense of belonging and have supportive peers or friends on campus.",
    description: "Think about the past 2–3 weeks",
    options: AGREEMENT_OPTIONS_POSITIVE,
    required: true,
    scoring: { polarity: "positive" },
  },
  {
    id: "univ_campus_finances",
    category: "life_admin",
    section: "4",
    section_title: "Social Connection & Campus Life",
    type: "frequency_5",
    question: "How often do finances, housing, or practical life pressures cause you stress?",
    description: "Think about the past 2–3 weeks",
    options: FREQ_OPTIONS,
    required: true,
    scoring: { polarity: "negative" },
  },
  {
    id: "univ_identity_confidence",
    category: "self_concept",
    section: "5",
    section_title: "Confidence & Coping Resilience",
    type: "frequency_5",
    question: "I feel confident in my abilities and proud of the progress I am making.",
    description: "Think about the past 2–3 weeks",
    options: AGREEMENT_OPTIONS_POSITIVE,
    required: true,
    scoring: { polarity: "positive" },
  },
  {
    id: "univ_coping_manage",
    category: "coping_resilience",
    section: "5",
    section_title: "Confidence & Coping Resilience",
    type: "frequency_5",
    question: "When setbacks happen, I have healthy ways to cope and bounce back.",
    description: "Think about the past 2–3 weeks",
    options: AGREEMENT_OPTIONS_POSITIVE,
    required: true,
    scoring: { polarity: "positive" },
  },
];

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
  const [searchParams, setSearchParams] = useSearchParams();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, refreshUser, markAssessmentComplete } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || "Student";

  const initialModeParam = searchParams.get("mode");
  const initialMode: AssessmentMode =
    initialModeParam === "full_university" || initialModeParam === "clinical_intake"
      ? initialModeParam
      : "quick";

  const [assessmentMode, setAssessmentMode] = useState<AssessmentMode>(initialMode);
  const [step, setStep] = useState<"intro" | "form" | "results">("intro");
  const [questions, setQuestions] = useState<Question[]>(QUICK_CHECKIN_QUESTIONS);
  const [remoteQuestions, setRemoteQuestions] = useState<Question[]>([]);
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
  const hasAutoLoadedResultRef = useRef(false);

  const resolveQuestionsForMode = useCallback(
    (mode: AssessmentMode, fetchedQuestions: Question[]): Question[] => {
      if (mode === "quick") {
        return QUICK_CHECKIN_QUESTIONS;
      }
      if (mode === "full_university") {
        const hasRemoteUniv = fetchedQuestions.some((q) => String(q.id).startsWith("univ_"));
        return hasRemoteUniv ? fetchedQuestions : CAMPUS_LIFE_QUESTIONS;
      }
      // clinical_intake
      return fetchedQuestions.length > 0 ? fetchedQuestions : QUICK_CHECKIN_QUESTIONS;
    },
    []
  );

  // Sync active questions whenever mode or remote questions change
  useEffect(() => {
    const nextList = resolveQuestionsForMode(assessmentMode, remoteQuestions);
    setQuestions(nextList);
  }, [assessmentMode, remoteQuestions, resolveQuestionsForMode]);

  // Load questionnaire metadata and optionally pre-populate latest result once on initial mount
  useEffect(() => {
    if (!user?.id) return;

    const wantsRetake = searchParams.get("retake") === "1" || Boolean(searchParams.get("mode"));

    if (user.needs_assessment === false && !wantsRetake && !hasAutoLoadedResultRef.current) {
      hasAutoLoadedResultRef.current = true;
      api
        .getLatestDiagnostic()
        .then((data) => {
          const wrapped = (data as { diagnostic?: DiagnosticResult })?.diagnostic;
          const direct = (data as DiagnosticResult)?.id ? (data as DiagnosticResult) : null;
          const diag = wrapped ?? direct ?? null;
          if (diag) {
            setResult(diag);
            setStep("results");
          }
        })
        .catch(() => {
          // No prior result on the server yet — stay on intro.
        });
    }

    void loadQuestionnaire();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (step === "results") {
      void loadHistory();
      void loadTrends();
    }
  }, [step]);

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
      const id =
        typeof (data as Record<string, unknown>)?.id === "number"
          ? (data as { id: number }).id
          : Number((data as { id?: unknown })?.id ?? 0);

      const extracted = extractQuestionList(data);
      setRemoteQuestions(extracted);
      setQuestionnaireId(Number.isFinite(id) && id > 0 ? id : null);
    } catch (error: unknown) {
      if (import.meta.env.DEV) {
        console.error("Failed to load questionnaire metadata:", error);
      }
      // Local question banks remain available so students can still complete Quick / Campus check-ins
      setQuestionnaireId(null);
      if (assessmentMode === "clinical_intake" && remoteQuestions.length === 0) {
        const message = getApiErrorMessage(
          error,
          "Could not load the full clinical questionnaire from the server. Using standard check-in questions instead."
        );
        setQuestionnaireError(message);
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
    }
  };

  const handleModeChange = (nextMode: AssessmentMode) => {
    setAssessmentMode(nextMode);
    setResponses({});
    setCurrentQuestionIndex(0);
    setQuestionnaireError(null);
  };

  const handleRetakeAssessment = () => {
    hasAutoLoadedResultRef.current = true;
    setResponses({});
    setCurrentQuestionIndex(0);
    setStep("intro");
    setSearchParams({ retake: "1" }, { replace: true });
  };

  const isHardError = questionnaireError !== null && questions.length === 0;

  const handleStartAssessment = () => {
    if (isQuestionnaireLoading && questions.length === 0) {
      toast.info("Still loading the questionnaire — please wait.");
      return;
    }
    if (isHardError) {
      toast.error("The assessment is not ready yet. Use Retry or refresh the page.");
      return;
    }
    if (questions.length === 0) {
      toast.error("No questions loaded yet. Please wait or refresh the page.");
      return;
    }
    setCurrentQuestionIndex(0);
    setStep("form");
  };

  const handleResponseChange = (value: unknown) => {
    const currentQuestion = questions[currentQuestionIndex];
    if (!currentQuestion) return;
    setResponses((prev) => ({
      ...prev,
      [currentQuestion.id]: value,
    }));
  };

  const toggleMultiSelect = (optionValue: string) => {
    const currentQuestion = questions[currentQuestionIndex];
    if (!currentQuestion) return;
    const raw = responses[currentQuestion.id];
    const current: string[] = Array.isArray(raw) ? raw.map(String) : [];

    let next: string[];
    if (optionValue === "none_above") {
      next = current.includes("none_above") ? [] : ["none_above"];
    } else {
      const withoutNone = current.filter((v) => v !== "none_above");
      next = withoutNone.includes(optionValue)
        ? withoutNone.filter((v) => v !== optionValue)
        : [...withoutNone, optionValue];
    }

    setResponses((prev) => ({
      ...prev,
      [currentQuestion.id]: next,
    }));
  };

  const validateResponses = (map: Record<string, unknown>): boolean => {
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!isRequired(q)) continue;
      if (!isAnswered(q, map[q.id])) {
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
    if (!q) return;
    if (isRequired(q)) {
      toast.error("This question is required.");
      return;
    }
    const copy = { ...responses };
    delete copy[q.id];
    setResponses(copy);
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex((i) => Math.min(questions.length - 1, i + 1));
      return;
    }
    if (validateResponses(copy)) {
      void runSubmit(copy);
    }
  };

  /** Scale / choice taps: save answer and advance in one update (clamped to valid question bounds). */
  const handleAnswerAndAdvance = (value: unknown) => {
    const q = questions[currentQuestionIndex];
    if (!q) return;
    setResponses((prev) => ({ ...prev, [q.id]: value }));
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex((i) => Math.min(questions.length - 1, i + 1));
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
      setCurrentQuestionIndex((i) => Math.min(questions.length - 1, i + 1));
    }
  };

  const handlePreviousQuestion = () => {
    setCurrentQuestionIndex((i) => Math.max(0, i - 1));
  };

  const runSubmit = async (payload: Record<string, any>) => {
    const normalized = normalizeResponses(payload);

    setIsLoading(true);
    try {
      const data = await api.submitDiagnosticAssessment(
        normalized,
        questionnaireId,
        false,
        assessmentMode
      );
      const diag: DiagnosticResult | null =
        (data as { diagnostic?: DiagnosticResult })?.diagnostic ??
        ((data as DiagnosticResult)?.id ? (data as DiagnosticResult) : null);
      if (!diag) {
        toast.error("Assessment submitted but your results could not be loaded. Please reload.");
        markAssessmentComplete();
        await refreshUser();
        return;
      }
      hasAutoLoadedResultRef.current = true;
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
        items={studentNavItems}
        userType="student"
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-72 pl-0">
        <DashboardHeader
          title="Wellness check-in"
          onMenuClick={() => setSidebarOpen(true)}
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
              isLoading={isQuestionnaireLoading && questions.length === 0}
              questionCount={questions.length}
              error={questionnaireError}
              isHardError={isHardError}
              selectedMode={assessmentMode}
              onSelectMode={handleModeChange}
              onStart={handleStartAssessment}
              onRetry={() => void loadQuestionnaire()}
              canGoBack={true}
              onBack={() => navigate("/student/dashboard")}
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
              onRetake={handleRetakeAssessment}
            />
          )}
        </main>
      </div>
    </div>
  );
};

export default StudentDiagnosticAssessment;
