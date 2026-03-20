import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  MessageSquare,
  Calendar,
  Bot,
  Mic,
  Video,
  History,
  Heart,
  ArrowRightLeft,
  CheckCircle,
  AlertCircle,
  TrendingUp,
  Loader2,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { toast } from "sonner";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/student/dashboard" },
  { label: "Chat", icon: MessageSquare, path: "/student/chat" },
  { label: "Appointments", icon: Calendar, path: "/student/appointments" },
  { label: "Referrals", icon: ArrowRightLeft, path: "/student/referrals" },
  { label: "AI Support", icon: Bot, path: "/student/ai-support" },
  { label: "Voice Notes", icon: Mic, path: "/student/voice-notes" },
  { label: "Video Call", icon: Video, path: "/student/video-call" },
  { label: "Past Sessions", icon: History, path: "/student/history" },
  { label: "Wellness", icon: Heart, path: "/student/wellness" },
];

interface Question {
  id: string;
  category: string;
  type: string;
  question: string;
  description: string;
  options?: Array<{ value: string; label: string; score?: number }>;
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
  };
  created_at: string;
}

interface DiagnosticTrend {
  date: string;
  score: number;
  risk_level: string;
  categories: Record<string, number>;
}

const StudentDiagnosticAssessment = () => {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || "Student";

  const [step, setStep] = useState<"intro" | "form" | "results">("intro");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [responses, setResponses] = useState<Record<string, any>>({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const [questionnaireId, setQuestionnaireId] = useState<number | null>(null);
  const [history, setHistory] = useState<DiagnosticResult[]>([]);
  const [trends, setTrends] = useState<DiagnosticTrend[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  useEffect(() => {
    loadQuestionnaire();
  }, []);

  useEffect(() => {
    if (step === "results") {
      loadHistory();
      loadTrends();
    }
  }, [step]);

  const loadQuestionnaire = async () => {
    try {
      const data = await api.getDiagnosticQuestionnaire();
      const questionList = Array.isArray(data.questions?.questions)
        ? data.questions.questions
        : Array.isArray(data.questions)
        ? data.questions
        : [];
      setQuestions(questionList);
      setQuestionnaireId(data.id);
      if (questionList.length === 0) {
        toast.error("No questions available for this questionnaire yet.");
      }
    } catch (error) {
      console.error("Failed to load questionnaire:", error);
      toast.error("Failed to load diagnostic questionnaire");
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
    setStep("form");
    setCurrentQuestionIndex(0);
  };

  const handleResponseChange = (value: any) => {
    const currentQuestion = questions[currentQuestionIndex];
    setResponses({
      ...responses,
      [currentQuestion.id]: value,
    });
  };

  const handleNextQuestion = () => {
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
    }
  };

  const handlePreviousQuestion = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(currentQuestionIndex - 1);
    }
  };

  const handleSubmitAssessment = async () => {
    if (!questionnaireId) {
      toast.error("Questionnaire not loaded");
      return;
    }

    setIsLoading(true);
    try {
      const data = await api.submitDiagnosticAssessment(
        responses,
        questionnaireId,
        isAnonymous
      );

      setResult(data.diagnostic);
      setStep("results");
      toast.success("Assessment completed successfully!");
    } catch (error: any) {
      console.error("Failed to submit assessment:", error);
      toast.error(error.response?.data?.message || "Failed to submit assessment");
    } finally {
      setIsLoading(false);
    }
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

    return (
      <div className="space-y-6">
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-foreground">
              Question {currentQuestionIndex + 1} of {questions.length}
            </h3>
            <span className="text-sm text-muted-foreground">
              {Math.round(((currentQuestionIndex + 1) / questions.length) * 100)}%
            </span>
          </div>
          <Progress value={((currentQuestionIndex + 1) / questions.length) * 100} className="h-2" />
        </div>

        <div className="space-y-3">
          <h4 className="text-base font-medium text-foreground">{question.question}</h4>
          <p className="text-sm text-muted-foreground">{question.description}</p>
        </div>

        <div className="space-y-3">
          {question.type === "scale" && (
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((value) => (
                <Button
                  key={value}
                  variant={response === value ? "default" : "outline"}
                  onClick={() => handleResponseChange(value)}
                  className="flex-1"
                >
                  {value}
                </Button>
              ))}
            </div>
          )}

          {question.type === "multiple_choice" && (
            <div className="space-y-2">
              {question.options?.map((option) => (
                <Button
                  key={option.value}
                  variant={response === option.value ? "default" : "outline"}
                  onClick={() => handleResponseChange(option.value)}
                  className="w-full justify-start text-left"
                >
                  {option.label}
                </Button>
              ))}
            </div>
          )}

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

          {question.type === "text" && (
            <textarea
              value={response || ""}
              onChange={(e) => handleResponseChange(e.target.value)}
              placeholder="Type your response here..."
              className="w-full p-3 rounded-lg border border-border bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              rows={4}
            />
          )}
        </div>

        <div className="flex gap-2 justify-between">
          <Button
            variant="outline"
            onClick={handlePreviousQuestion}
            disabled={currentQuestionIndex === 0}
          >
            Previous
          </Button>
          {currentQuestionIndex === questions.length - 1 ? (
            <Button
              variant="hero"
              onClick={handleSubmitAssessment}
              disabled={isLoading}
            >
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
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar
        items={navItems}
        userType="student"
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-72">
        <DashboardHeader
          title="Mental Health Assessment"
          onMenuClick={() => setSidebarOpen(true)}
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
                <p className="text-muted-foreground">
                  This assessment is designed to help you understand your mental health and well-being. 
                  It takes approximately 10-15 minutes to complete and covers various aspects of your 
                  emotional and psychological health.
                </p>

                <div className="space-y-3">
                  <h4 className="font-semibold text-foreground">What to expect:</h4>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                      <span>15 questions covering anxiety, depression, stress, sleep, and more</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                      <span>Immediate AI-powered analysis and recommendations</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                      <span>Personalized insights based on your responses</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                      <span>Option to remain anonymous if you prefer</span>
                    </li>
                  </ul>
                </div>

                <div className="flex items-center gap-3 p-4 rounded-lg bg-info/10 border border-info/20">
                  <AlertCircle className="h-5 w-5 text-info flex-shrink-0" />
                  <p className="text-sm text-info">
                    Your responses are confidential and secure. If you're in crisis, please contact emergency services.
                  </p>
                </div>

                <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30">
                  <input
                    type="checkbox"
                    id="anonymous"
                    checked={isAnonymous}
                    onChange={(e) => setIsAnonymous(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="anonymous" className="text-sm text-foreground cursor-pointer">
                    Complete this assessment anonymously
                  </label>
                </div>

                <Button
                  variant="hero"
                  size="lg"
                  onClick={handleStartAssessment}
                  className="w-full"
                >
                  Start Assessment
                </Button>
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

                  <div className="flex gap-3 pt-4">
                    <Button
                      variant="outline"
                      onClick={() => navigate("/student/wellness")}
                      className="flex-1"
                    >
                      View Wellness Dashboard
                    </Button>
                    <Button
                      variant="hero"
                      onClick={() => navigate("/student/appointments")}
                      className="flex-1"
                    >
                      Book Counseling Session
                    </Button>
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
