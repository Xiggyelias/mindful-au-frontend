import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  MessageSquare,
  Calendar,
  Bot,
  Video,
  Heart,
  CheckCircle,
  AlertCircle,
  TrendingUp,
  Loader2,
  ClipboardCheck,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
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

/**
 * Reduce a full question bank to a concise assessment.
 * Strategy: take up to MAX_PER_CATEGORY questions from each category,
 * then cap the total at MAX_TOTAL. This preserves coverage across all
 * mental-health dimensions while keeping the form manageable.
 */
const MAX_TOTAL = 20;
const MAX_PER_CATEGORY = 3;

function selectRepresentativeQuestions(questions: Question[]): Question[] {
  const seenPerCategory = new Map<string, number>();
  const selected: Question[] = [];

  for (const q of questions) {
    if (selected.length >= MAX_TOTAL) break;
    const cat = q.category || "general";
    const count = seenPerCategory.get(cat) ?? 0;
    if (count < MAX_PER_CATEGORY) {
      selected.push(q);
      seenPerCategory.set(cat, count + 1);
    }
  }

  // If we're still under the cap, fill remaining slots with any skipped questions
  if (selected.length < MAX_TOTAL) {
    const selectedIds = new Set(selected.map((q) => q.id));
    for (const q of questions) {
      if (selected.length >= MAX_TOTAL) break;
      if (!selectedIds.has(q.id)) {
        selected.push(q);
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
      return typeof value === "number" && Number.isFinite(value);
    default:
      return String(value).trim() !== "";
  }
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

  useEffect(() => {
    if (!user?.id) return;
    loadQuestionnaire();
  }, [user?.id]);

  useEffect(() => {
    if (step === "results") {
      loadHistory();
      loadTrends();
    }
  }, [step]);

  const loadQuestionnaire = async () => {
    setQuestionnaireError(null);
    setIsQuestionnaireLoading(true);
    try {
      const data = await api.getDiagnosticQuestionnaire();
      const questionList = selectRepresentativeQuestions(extractQuestionList(data));
      const id = typeof (data as Record<string, unknown>)?.id === "number" ? (data as { id: number }).id : Number((data as { id?: unknown })?.id ?? 0);

      setQuestions(questionList);
      setQuestionnaireId(Number.isFinite(id) && id > 0 ? id : null);

      if (questionList.length === 0) {
        toast.error("No questions available for this questionnaire yet.");
      }
    } catch (error: unknown) {
      if (import.meta.env.DEV) {
        console.error("Failed to load questionnaire:", error);
      }
      const message = getApiErrorMessage(
        error,
        "Could not load the assessment. Try again or contact support if this continues.",
      );
      setQuestionnaireError(message);
      toast.error(message);
    } finally {
      setIsQuestionnaireLoading(false);
    }
  };

  const loadHistory = async () => {
    try {
      setIsHistoryLoading(true);
      const data = await api.getDiagnosticHistory();
      setHistory(data || []);
    } catch (error) {
      console.error("Failed to load diagnostic history:", error);
      toast.error("Failed to load diagnostic history");
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const loadTrends = async () => {
    try {
      const data = await api.getDiagnosticTrends(30);
      setTrends(data?.trends || []);
    } catch (error) {
      console.error("Failed to load diagnostic trends:", error);
      toast.error("Failed to load diagnostic trends");
    }
  };

  const handleStartAssessment = () => {
    if (isQuestionnaireLoading) {
      toast.info("Still loading the questionnaire — please wait.");
      return;
    }
    if (questionnaireError || questions.length === 0) {
      toast.error("The assessment is not ready yet. Use Retry or refresh the page.");
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
    for (const q of questions) {
      if (!isRequired(q)) {
        continue;
      }
      if (!isAnswered(q, map[q.id])) {
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
      toast.error("Questionnaire not loaded");
      return;
    }

    setIsLoading(true);
    try {
      const data = await api.submitDiagnosticAssessment(payload, questionnaireId, false);

      setResult(data.diagnostic);
      await refreshUser();
      setStep("results");
      toast.success("Assessment completed successfully!");
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

  const getRiskColor = (riskLevel: string) => {
    return {
      low: "text-green-600",
      medium: "text-yellow-600",
      high: "text-orange-600",
      critical: "text-red-600",
    }[riskLevel] || "text-gray-600";
  };

  const getRiskBgColor = (riskLevel: string) => {
    return {
      low: "bg-green-100",
      medium: "bg-yellow-100",
      high: "bg-orange-100",
      critical: "bg-red-100",
    }[riskLevel] || "bg-gray-100";
  };

  const trendPoints = trends.slice(-7);

  const renderQuestion = () => {
    if (questions.length === 0) return null;

    const question = questions[currentQuestionIndex];
    const response = responses[question.id];
    const prevQ = questions[currentQuestionIndex - 1];
    const sectionChanged =
      Boolean(question.section_title) &&
      (!prevQ || prevQ.section_title !== question.section_title);

    const isOptional = question.required === false;
    const isSafetySection =
      question.section === "10" || question.section_title?.toLowerCase().includes("safety");

    return (
      <div className="space-y-6">
        <div>
          <div className="flex flex-wrap items-center gap-2 justify-between mb-2">
            <h3 className="text-lg font-semibold text-foreground">
              Question {currentQuestionIndex + 1} of {questions.length}
            </h3>
            <div className="flex items-center gap-2">
              {isOptional && (
                <Badge variant="outline" className="text-muted-foreground font-normal">
                  Optional — you can skip
                </Badge>
              )}
              <span className="text-sm text-muted-foreground">
                {Math.round(((currentQuestionIndex + 1) / questions.length) * 100)}%
              </span>
            </div>
          </div>
          <Progress value={((currentQuestionIndex + 1) / questions.length) * 100} className="h-2" />
        </div>

        {sectionChanged ? (
          <div className="rounded-lg border border-border/70 bg-muted/40 px-3 py-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Section</p>
            <p className="font-medium text-foreground">{question.section_title}</p>
          </div>
        ) : null}

        {isSafetySection ? (
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-foreground">
            If you’re in immediate danger, contact local emergency services. Honest answers help us prioritise care.
          </div>
        ) : null}

        <div className="space-y-3">
          <h4 className="text-base font-medium text-foreground">{question.question}</h4>
          {question.description ? (
            <p className="text-sm text-muted-foreground">{question.description}</p>
          ) : null}
        </div>

        <div className="space-y-3">
          {(question.type === "scale" || question.type === "scale_1_5") && (
            <div className="flex gap-2 flex-wrap">
              {[1, 2, 3, 4, 5].map((value) => (
                <Button
                  key={value}
                  variant={response === value ? "default" : "outline"}
                  onClick={() => handleResponseChange(value)}
                  className="min-w-[2.5rem]"
                >
                  {value}
                </Button>
              ))}
            </div>
          )}

          {question.type === "scale_1_10" && (
            <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((value) => (
                <Button
                  key={value}
                  size="sm"
                  variant={response === value ? "default" : "outline"}
                  onClick={() => handleResponseChange(value)}
                  className="min-w-[2rem]"
                >
                  {value}
                </Button>
              ))}
            </div>
          )}

          {(question.type === "frequency_5" || question.type === "multiple_choice") && question.options?.length ? (
            <div className="space-y-2">
              {question.options.map((option) => (
                <Button
                  key={option.value}
                  variant={response === option.value ? "default" : "outline"}
                  onClick={() => handleResponseChange(option.value)}
                  className="w-full justify-start text-left h-auto whitespace-normal py-3"
                >
                  {option.label}
                </Button>
              ))}
            </div>
          ) : null}

          {question.type === "single_choice" && question.options?.length ? (
            <div className="space-y-2">
              {question.options.map((option) => (
                <Button
                  key={option.value}
                  variant={response === option.value ? "default" : "outline"}
                  onClick={() => handleResponseChange(option.value)}
                  className="w-full justify-start text-left h-auto whitespace-normal py-3"
                >
                  {option.label}
                </Button>
              ))}
            </div>
          ) : null}

          {question.type === "multi_select" && question.options?.length ? (
            <div className="space-y-3">
              {question.options.map((option) => {
                const selected = Array.isArray(response) && response.includes(option.value);
                return (
                  <label
                    key={option.value}
                    className="flex items-start gap-3 rounded-lg border border-border/80 bg-background/80 px-3 py-3 cursor-pointer"
                  >
                    <Checkbox
                      checked={selected}
                      onCheckedChange={() => toggleMultiSelect(option.value)}
                      className="mt-1"
                    />
                    <span className="text-sm text-foreground leading-snug">{option.label}</span>
                  </label>
                );
              })}
            </div>
          ) : null}

          {question.type === "yes_no" && (
            <div className="flex gap-2">
              <Button
                variant={response === "yes" ? "default" : "outline"}
                onClick={() => handleResponseChange("yes")}
                className="flex-1"
              >
                Yes
              </Button>
              <Button
                variant={response === "no" ? "default" : "outline"}
                onClick={() => handleResponseChange("no")}
                className="flex-1"
              >
                No
              </Button>
            </div>
          )}

          {(question.type === "text" || question.type === "textarea") && (
            <textarea
              value={(response as string) || ""}
              onChange={(e) => handleResponseChange(e.target.value)}
              placeholder="Type your response here..."
              className="w-full p-3 rounded-lg border border-border bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              rows={question.type === "textarea" ? 5 : 4}
            />
          )}
        </div>

        <div className="flex flex-wrap gap-2 justify-between items-center">
          <Button variant="outline" onClick={handlePreviousQuestion} disabled={currentQuestionIndex === 0}>
            Previous
          </Button>
          <div className="flex gap-2 flex-wrap justify-end">
            {isOptional ? (
              <Button type="button" variant="ghost" size="sm" onClick={handleSkipOptional}>
                Skip
              </Button>
            ) : null}
            {currentQuestionIndex === questions.length - 1 ? (
              <Button variant="hero" onClick={() => void handleSubmitAssessment()} disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Analyzing...
                  </>
                ) : (
                  "Submit Assessment"
                )}
              </Button>
            ) : (
              <Button variant="default" onClick={handleNextQuestion}>
                Next
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  };

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
          title="Mental Health Assessment"
          onMenuClick={user?.needs_assessment ? undefined : () => setSidebarOpen(true)}
        />

        <main className="p-4 lg:p-6">
          {step === "intro" && (
            <Card variant="glass" className="max-w-2xl mx-auto">
              <CardHeader>
                <CardTitle className="text-2xl flex items-center gap-3">
                  <Heart className="h-6 w-6 text-primary" />
                  Comprehensive Mental Health Assessment
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {user?.needs_assessment && (
                  <div className="flex items-start gap-3 p-4 rounded-lg bg-indigo-50 border border-indigo-200 dark:bg-indigo-950/20 dark:border-indigo-900/40 text-indigo-700 dark:text-indigo-400">
                    <ClipboardCheck className="h-5 w-5 flex-shrink-0 text-indigo-600 dark:text-indigo-400 mt-0.5" />
                    <p className="text-sm font-medium">
                      As a newly registered student (or because your counselor has requested it), completing this intake assessment is mandatory to access your dashboard, chat, and other features.
                    </p>
                  </div>
                )}

                <p className="text-muted-foreground">
                  This assessment is designed to help you understand your mental health and well-being. 
                  It takes approximately 5–7 minutes to complete and covers key aspects of your
                  emotional and psychological health across {MAX_TOTAL} focused questions.
                </p>

                <div className="space-y-3">
                  <h4 className="font-semibold text-foreground">What to expect:</h4>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                      <span>Structured sections from context and study load through coping, support, safety, and counselling goals</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                      <span>Immediate AI-powered analysis and recommendations</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                      <span>Personalized insights based on your responses</span>
                    </li>
                  </ul>
                </div>

                <div className="flex items-center gap-3 p-4 rounded-lg bg-info/10 border border-info/20">
                  <AlertCircle className="h-5 w-5 text-info flex-shrink-0" />
                  <p className="text-sm text-info">
                    Your responses are confidential and secure. If you're in crisis, please contact emergency services.
                  </p>
                </div>

                {isQuestionnaireLoading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading questionnaire…
                  </div>
                )}

                {questionnaireError && !isQuestionnaireLoading && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    <p className="font-medium mb-2">{questionnaireError}</p>
                    <Button type="button" variant="outline" size="sm" onClick={() => void loadQuestionnaire()}>
                      Retry
                    </Button>
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <Button
                    variant="hero"
                    size="lg"
                    onClick={handleStartAssessment}
                    className="w-full"
                    disabled={isQuestionnaireLoading || questions.length === 0 || Boolean(questionnaireError)}
                  >
                    {isQuestionnaireLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Loading…
                      </>
                    ) : (
                      "Start Assessment"
                    )}
                  </Button>
                  
                  {!user?.needs_assessment && (
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={() => navigate("/student/dashboard")}
                      className="w-full"
                    >
                      Back to Dashboard
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {step === "form" && (
            <Card variant="glass" className="max-w-2xl mx-auto">
              <CardHeader>
                <CardTitle>Mental Health Assessment</CardTitle>
              </CardHeader>
              <CardContent>{renderQuestion()}</CardContent>
            </Card>
          )}

          {step === "results" && result && (
            <div className="max-w-2xl mx-auto space-y-6">
              <Card variant="glass">
                <CardHeader>
                  <CardTitle className="text-2xl">Your Assessment Results</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className={`p-6 rounded-lg ${getRiskBgColor(result.risk_level)}`}>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-foreground">Overall Risk Level</h3>
                      <span className={`text-3xl font-bold ${getRiskColor(result.risk_level)}`}>
                        {result.total_score}%
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div
                        className={`h-3 w-3 rounded-full ${
                          result.risk_level === "low"
                            ? "bg-green-600"
                            : result.risk_level === "medium"
                            ? "bg-yellow-600"
                            : result.risk_level === "high"
                            ? "bg-orange-600"
                            : "bg-red-600"
                        }`}
                      />
                      <span className="font-semibold text-foreground capitalize">{result.risk_level}</span>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h4 className="font-semibold text-foreground">Category Breakdown</h4>
                    {Object.entries(result.category_scores).map(([category, score]) => (
                      <div key={category} className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground capitalize">{category}</span>
                          <span className="font-medium">{score}%</span>
                        </div>
                        <Progress value={score as number} className="h-2" />
                      </div>
                    ))}
                  </div>

                  {result.ai_recommendations.counselor_summary ? (
                    <div className="space-y-2 p-4 rounded-lg border border-border bg-background/60">
                      <h4 className="font-semibold text-foreground text-sm">Counselor-oriented summary</h4>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {result.ai_recommendations.counselor_summary}
                      </p>
                    </div>
                  ) : null}

                  {result.ai_recommendations.focus_areas && result.ai_recommendations.focus_areas.length > 0 ? (
                    <div className="space-y-2">
                      <h4 className="font-semibold text-foreground text-sm">Suggested focus areas</h4>
                      <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                        {result.ai_recommendations.focus_areas.map((area) => (
                          <li key={area}>{area}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {result.ai_recommendations.risk_flags && result.ai_recommendations.risk_flags.length > 0 ? (
                    <div className="space-y-2 p-4 rounded-lg bg-destructive/10 border border-destructive/25">
                      <h4 className="font-semibold text-destructive text-sm">Follow-up flags</h4>
                      <ul className="list-disc pl-5 space-y-1 text-sm text-foreground">
                        {result.ai_recommendations.risk_flags.map((flag) => (
                          <li key={flag}>{flag}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="space-y-4 p-4 rounded-lg bg-secondary/30">
                    <h4 className="font-semibold text-foreground flex items-center gap-2">
                      <TrendingUp className="h-5 w-5" />
                      AI Recommendations
                    </h4>
                    <p className="text-foreground font-medium">{result.ai_recommendations.primary}</p>
                    <div className="space-y-2">
                      {result.ai_recommendations.actions.map((action, index) => (
                        <div key={index} className="flex items-start gap-2">
                          <CheckCircle className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                          <span className="text-sm text-muted-foreground">{action}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {result.ai_recommendations.category_alerts && (
                    <div className="space-y-3 p-4 rounded-lg bg-warning/10 border border-warning/20">
                      <h4 className="font-semibold text-foreground flex items-center gap-2">
                        <AlertCircle className="h-5 w-5 text-warning" />
                        Areas of Concern
                      </h4>
                      {Object.entries(result.ai_recommendations.category_alerts).map(([category, alert]) => (
                        <p key={category} className="text-sm text-muted-foreground">
                          <span className="font-medium capitalize">{category}:</span> {alert}
                        </p>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-col gap-3 pt-4">
                    <Button
                      variant="hero"
                      onClick={() => navigate("/student/dashboard")}
                      className="w-full text-base py-6 font-semibold"
                    >
                      Proceed to Dashboard
                    </Button>
                    <div className="flex gap-3">
                      <Button
                        variant="outline"
                        onClick={() => navigate("/student/wellness")}
                        className="flex-1"
                      >
                        View Wellness Dashboard
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => navigate("/student/appointments")}
                        className="flex-1"
                      >
                        Book Counseling Session
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card variant="glass">
                <CardHeader>
                  <CardTitle className="text-lg">Assessment History</CardTitle>
                </CardHeader>
                <CardContent>
                  {isHistoryLoading ? (
                    <p className="text-sm text-muted-foreground">Loading history...</p>
                  ) : history.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No previous assessments yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {history.slice(0, 5).map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between p-3 rounded-lg bg-secondary/30"
                        >
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              {new Date(item.created_at).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })}
                            </p>
                            <p className="text-xs text-muted-foreground capitalize">
                              {item.risk_level} risk
                            </p>
                          </div>
                          <span className={`text-sm font-semibold ${getRiskColor(item.risk_level)}`}>
                            {item.total_score}%
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card variant="glass">
                <CardHeader>
                  <CardTitle className="text-lg">30-Day Trend</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {trendPoints.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No trend data available yet.</p>
                  ) : (
                    trendPoints.map((trend) => (
                      <div key={trend.date} className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">
                            {new Date(trend.date).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                          <span className={`font-medium ${getRiskColor(trend.risk_level)}`}>
                            {trend.score}%
                          </span>
                        </div>
                        <Progress value={trend.score} className="h-2" />
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default StudentDiagnosticAssessment;
