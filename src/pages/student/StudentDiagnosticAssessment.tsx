import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutDashboard, MessageSquare, Calendar, Bot, Video, ClipboardCheck } from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { WellnessCheckInIntro } from "@/components/assessment/WellnessCheckInIntro";
import { WellnessCheckInQuestion } from "@/components/assessment/WellnessCheckInQuestion";
import { WellnessCheckInResults } from "@/components/assessment/WellnessCheckInResults";
import { api, getApiErrorMessage } from "@/lib/api";
import { toast } from "sonner";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/student/dashboard" },
  { label: "Chat", icon: MessageSquare, path: "/student/chat" },
  { label: "Appointments", icon: Calendar, path: "/student/appointments" },
  { label: "AI Support", icon: Bot, path: "/student/ai-support" },
  { label: "Video Call", icon: Video, path: "/student/video-call" },
  { label: "Wellness", icon: Heart, path: "/student/wellness" },
  { label: "Assessment", icon: ClipboardCheck, path: "/student/diagnostic-assessment" },
];

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
// University-tailored question bank
// 30 questions across 10 campus-life categories.
// selectRepresentativeQuestions picks MAX_PER_CATEGORY (3) per category,
// capped at MAX_TOTAL (25), giving up to 25 focused questions.
// ─────────────────────────────────────────────────────────────────────────────

const FREQ_OPTIONS: QuestionOption[] = [
  { value: "1", label: "Never",        score: 0 },
  { value: "2", label: "Rarely",       score: 1 },
  { value: "3", label: "Sometimes",    score: 2 },
  { value: "4", label: "Often",        score: 3 },
  { value: "5", label: "Almost always",score: 4 },
];

const AGREE_OPTIONS: QuestionOption[] = [
  { value: "1", label: "Strongly disagree", score: 0 },
  { value: "2", label: "Disagree",           score: 1 },
  { value: "3", label: "Neutral",            score: 2 },
  { value: "4", label: "Agree",              score: 3 },
  { value: "5", label: "Strongly agree",     score: 4 },
];

const QUALITY_OPTIONS: QuestionOption[] = [
  { value: "1", label: "Very poor",    score: 0 },
  { value: "2", label: "Poor",         score: 1 },
  { value: "3", label: "Fair",         score: 2 },
  { value: "4", label: "Good",         score: 3 },
  { value: "5", label: "Excellent",    score: 4 },
];

const UNIVERSITY_QUESTIONS: Question[] = [

  // ── 1. School & Studying ───────────────────────────────────────────────────
  // Day-to-day classroom and study experience
  {
    id: "univ_school_engagement",
    category: "school",
    section_title: "School & Studying",
    type: "scale_1_5",
    question: "How engaged and interested do you feel in your lectures and coursework?",
    description: "Think about whether you find your studies meaningful and stimulating.",
    options: FREQ_OPTIONS,
    required: true,
    scoring: { polarity: "positive" },
  },
  {
    id: "univ_school_concentration",
    category: "school",
    section_title: "School & Studying",
    type: "scale_1_5",
    question: "How often do you struggle to concentrate or focus when studying?",
    description: "Mind wandering, difficulty retaining information or zoning out during lectures.",
    options: FREQ_OPTIONS,
    required: true,
  },
  {
    id: "univ_school_lecturers",
    category: "school",
    section_title: "School & Studying",
    type: "scale_1_5",
    question: "How comfortable do you feel approaching your lecturers or tutors when you need help?",
    description: "Asking questions, seeking clarification or requesting support.",
    options: FREQ_OPTIONS,
    required: true,
    scoring: { polarity: "positive" },
  },

  // ── 2. Academic Pressure ───────────────────────────────────────────────────
  // Stress from workload, deadlines and performance expectations
  {
    id: "univ_acad_overload",
    category: "academic",
    section_title: "Academic Pressure",
    type: "scale_1_5",
    question: "How overwhelmed do you feel by your academic workload right now?",
    description: "Assignments, readings, group projects and submission deadlines.",
    options: FREQ_OPTIONS,
    required: true,
  },
  {
    id: "univ_acad_exam_anxiety",
    category: "academic",
    section_title: "Academic Pressure",
    type: "scale_1_5",
    question: "How anxious do you feel about exams, tests or major assessments?",
    description: "Fear of failing, blanking out or not performing as expected.",
    options: FREQ_OPTIONS,
    required: true,
  },
  {
    id: "univ_acad_procrastination",
    category: "academic",
    section_title: "Academic Pressure",
    type: "scale_1_5",
    question: "How often do you procrastinate or struggle to start your work even when you know you should?",
    description: "Putting off tasks, spending time on distractions or feeling paralysed.",
    options: FREQ_OPTIONS,
    required: true,
  },

  // ── 3. Mood & Emotions ─────────────────────────────────────────────────────
  {
    id: "univ_mood_lowness",
    category: "mood",
    section_title: "Mood & Emotions",
    type: "scale_1_5",
    question: "Over the past two weeks, how often have you felt sad, low or hopeless?",
    description: "This includes feeling down without being able to explain why.",
    options: FREQ_OPTIONS,
    required: true,
  },
  {
    id: "univ_mood_motivation",
    category: "mood",
    section_title: "Mood & Emotions",
    type: "scale_1_5",
    question: "How hard is it to find the motivation to get through your day at university?",
    description: "Attending lectures, completing tasks, or simply getting up in the morning.",
    options: FREQ_OPTIONS,
    required: true,
  },
  {
    id: "univ_mood_enjoyment",
    category: "mood",
    section_title: "Mood & Emotions",
    type: "scale_1_5",
    question: "How much have you lost interest or pleasure in things you usually enjoy?",
    description: "Hobbies, socialising, sport, campus activities — things you used to look forward to.",
    options: FREQ_OPTIONS,
    required: true,
  },

  // ── 4. Anxiety & Worry ─────────────────────────────────────────────────────
  {
    id: "univ_anxiety_tension",
    category: "anxiety",
    section_title: "Anxiety & Worry",
    type: "scale_1_5",
    question: "How often do you feel nervous, tense or on edge in daily life?",
    description: "A general sense of unease or dread that is hard to shake.",
    options: FREQ_OPTIONS,
    required: true,
  },
  {
    id: "univ_anxiety_overwhelm",
    category: "anxiety",
    section_title: "Anxiety & Worry",
    type: "scale_1_5",
    question: "How often do you feel so overwhelmed that you don't know where to begin?",
    description: "A flooding or frozen feeling when faced with too many demands at once.",
    options: FREQ_OPTIONS,
    required: true,
  },
  {
    id: "univ_anxiety_worry",
    category: "anxiety",
    section_title: "Anxiety & Worry",
    type: "scale_1_5",
    question: "How much does worry take up mental space that should be used for studying or relaxing?",
    description: "Ruminating, replaying conversations or catastrophising about the future.",
    options: FREQ_OPTIONS,
    required: true,
  },

  // ── 5. Sleep & Energy ──────────────────────────────────────────────────────
  {
    id: "univ_sleep_quality",
    category: "sleep",
    section_title: "Sleep & Energy",
    type: "scale_1_5",
    question: "How would you rate the quality of your sleep over the past week?",
    description: "How rested you feel when you wake up.",
    options: QUALITY_OPTIONS,
    required: true,
    scoring: { polarity: "positive" },
  },
  {
    id: "univ_sleep_fatigue",
    category: "sleep",
    section_title: "Sleep & Energy",
    type: "scale_1_5",
    question: "How often does tiredness or low energy hold you back during the day?",
    description: "Struggling to stay awake in lectures, lacking energy to study or socialise.",
    options: FREQ_OPTIONS,
    required: true,
  },
  {
    id: "univ_sleep_disruption",
    category: "sleep",
    section_title: "Sleep & Energy",
    type: "scale_1_5",
    question: "How often do stress or racing thoughts prevent you from sleeping well?",
    description: "Lying awake worrying about exams, money, the future or relationships.",
    options: FREQ_OPTIONS,
    required: true,
  },

  // ── 6. Campus & Social Life ────────────────────────────────────────────────
  {
    id: "univ_social_belonging",
    category: "social",
    section_title: "Campus & Social Life",
    type: "scale_1_5",
    question: "How much do you feel a genuine sense of belonging on campus?",
    description: "Feeling accepted, included and part of your university community.",
    options: AGREE_OPTIONS,
    required: true,
    scoring: { polarity: "positive" },
  },
  {
    id: "univ_social_loneliness",
    category: "social",
    section_title: "Campus & Social Life",
    type: "scale_1_5",
    question: "How often do you feel lonely or isolated — even when surrounded by other students?",
    description: "A sense of disconnection from the people around you.",
    options: FREQ_OPTIONS,
    required: true,
  },
  {
    id: "univ_social_relationships",
    category: "social",
    section_title: "Campus & Social Life",
    type: "scale_1_5",
    question: "How satisfied are you with your friendships and social life at university?",
    description: "Quality of connection matters more than the number of friends.",
    options: QUALITY_OPTIONS,
    required: true,
    scoring: { polarity: "positive" },
  },

  // ── 7. Student Life Pressures ─────────────────────────────────────────────
  {
    id: "univ_campus_finances",
    category: "campus_life",
    section_title: "Student Life Pressures",
    type: "scale_1_5",
    question: "How much are financial pressures affecting your wellbeing or ability to study?",
    description: "Fees, accommodation, food, transport or general money worries.",
    options: FREQ_OPTIONS,
    required: true,
  },
  {
    id: "univ_campus_adjustment",
    category: "campus_life",
    section_title: "Student Life Pressures",
    type: "scale_1_5",
    question: "How well have you adjusted to the demands and lifestyle of university?",
    description: "Managing your own time, independence, new routines and expectations.",
    options: QUALITY_OPTIONS,
    required: true,
    scoring: { polarity: "positive" },
  },
  {
    id: "univ_campus_homesick",
    category: "campus_life",
    section_title: "Student Life Pressures",
    type: "scale_1_5",
    question: "How much do homesickness or distance from family affect your mood and focus?",
    description: "Missing home, family support or your familiar environment.",
    options: FREQ_OPTIONS,
    required: false,
  },

  // ── 8. Self-image & Purpose ────────────────────────────────────────────────
  {
    id: "univ_identity_confidence",
    category: "identity",
    section_title: "Self-image & Purpose",
    type: "scale_1_5",
    question: "How confident do you feel in your ability to succeed at university?",
    description: "Belief in your own intelligence, potential and ability to handle challenges.",
    options: AGREE_OPTIONS,
    required: true,
    scoring: { polarity: "positive" },
  },
  {
    id: "univ_identity_pressure",
    category: "identity",
    section_title: "Self-image & Purpose",
    type: "scale_1_5",
    question: "How much pressure do you feel to live up to expectations from family, peers or society?",
    description: "Pressure to succeed, choose the right career or be a certain kind of person.",
    options: FREQ_OPTIONS,
    required: true,
  },
  {
    id: "univ_identity_direction",
    category: "identity",
    section_title: "Self-image & Purpose",
    type: "scale_1_5",
    question: "How clear do you feel about your purpose and direction in life right now?",
    description: "Knowing why you are here, what you are working towards and what matters to you.",
    options: AGREE_OPTIONS,
    required: true,
    scoring: { polarity: "positive" },
  },

  // ── 9. Coping & Support ────────────────────────────────────────────────────
  {
    id: "univ_coping_manage",
    category: "coping",
    section_title: "Coping & Support",
    type: "scale_1_5",
    question: "How well are you managing stress in your day-to-day life as a student?",
    description: "Ability to bounce back, rest when needed and keep functioning.",
    options: QUALITY_OPTIONS,
    required: true,
    scoring: { polarity: "positive" },
  },
  {
    id: "univ_support_network",
    category: "coping",
    section_title: "Coping & Support",
    type: "scale_1_5",
    question: "How supported do you feel by the people around you — friends, family or university staff?",
    description: "Having someone to talk to when things get tough.",
    options: AGREE_OPTIONS,
    required: true,
    scoring: { polarity: "positive" },
  },
  {
    id: "univ_support_stigma",
    category: "coping",
    section_title: "Coping & Support",
    type: "scale_1_5",
    question: "How much does fear of judgement stop you from talking about your mental health or seeking help?",
    description: "Concern about being seen as weak, different or a burden.",
    options: FREQ_OPTIONS,
    required: true,
  },

  // ── 10. Physical Wellbeing ─────────────────────────────────────────────────
  {
    id: "univ_physical_selfcare",
    category: "physical",
    section_title: "Physical Wellbeing",
    type: "scale_1_5",
    question: "How well are you looking after your physical health — eating, moving and resting?",
    description: "Regular meals, physical activity, hydration and basic self-care.",
    options: QUALITY_OPTIONS,
    required: true,
    scoring: { polarity: "positive" },
  },
  {
    id: "univ_physical_symptoms",
    category: "physical",
    section_title: "Physical Wellbeing",
    type: "scale_1_5",
    question: "How often do physical symptoms like headaches, stomach problems or chest tightness affect your daily life?",
    description: "The body often signals that the mind is carrying too much.",
    options: FREQ_OPTIONS,
    required: true,
  },
  {
    id: "univ_physical_restlessness",
    category: "physical",
    section_title: "Physical Wellbeing",
    type: "scale_1_5",
    question: "How often do you feel physically restless, tense or unable to unwind — even when you have time to rest?",
    description: "Muscle tension, fidgeting, or a body that won't settle even when your mind wants to.",
    options: FREQ_OPTIONS,
    required: true,
  },
];

const MAX_TOTAL = 25;
const MAX_PER_CATEGORY = 3; // 3 per category × 10 categories = 30 in bank, shown 25 via round-robin

/**
 * Round-robin selection: pick questions one per category per round,
 * cycling through all categories evenly before taking a second from any.
 * This guarantees every section is represented even when MAX_TOTAL < (categories × MAX_PER_CATEGORY).
 */
function selectRepresentativeQuestions(questions: Question[]): Question[] {
  // Group questions by category, preserving their order within each group
  const byCategory = new Map<string, Question[]>();
  for (const q of questions) {
    const cat = q.category || "general";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(q);
  }

  const categories = Array.from(byCategory.keys());
  const selected: Question[] = [];
  const cursors = new Map<string, number>(categories.map((c) => [c, 0]));

  for (let round = 0; round < MAX_PER_CATEGORY && selected.length < MAX_TOTAL; round++) {
    for (const cat of categories) {
      if (selected.length >= MAX_TOTAL) break;
      const pool = byCategory.get(cat)!;
      const idx = cursors.get(cat)!;
      if (idx < pool.length) {
        selected.push(pool[idx]);
        cursors.set(cat, idx + 1);
      }
    }
  }

  return selected;
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
  const { user, refreshUser } = useAuth();
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
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
        // Soft warning — not a hard blocker
        setQuestionnaireError(
          "Could not connect to the server to register your session. Your answers will be saved when you submit — please ensure you are online."
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

  const handleStartAssessment = () => {
    if (isQuestionnaireLoading) {
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

  const handleNextQuestion = () => {
    const q = questions[currentQuestionIndex];
    if (!q) return;
    const v = responses[q.id];
    if (!isAnswered(q, v)) {
      toast.error("Please answer this question before continuing.");
      return;
    }
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
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
        void refreshUser();
        return;
      }
      setResult(diag);
      setStep("results");
      toast.success("Check-in complete — here are your insights.");
      // Refresh user after the results page is visible. Fire-and-forget so a
      // transient network error here can't roll back the results display or
      // trigger an unexpected sign-out mid-session.
      void refreshUser();
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
        items={user?.needs_assessment ? navItems.filter((item) => item.path === "/student/diagnostic-assessment") : navItems}
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
              ? "min-h-[calc(100dvh-4rem)] bg-gradient-to-b from-sky-50/50 via-background to-violet-50/40 p-4 pb-10 lg:p-8"
              : "p-4 lg:p-6"
          }
        >
          {step === "intro" && (
            <WellnessCheckInIntro
              needsAssessment={Boolean(user?.needs_assessment)}
              isLoading={isQuestionnaireLoading}
              questionCount={questions.length}
              error={questionnaireError}
              isHardError={isHardError}
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
