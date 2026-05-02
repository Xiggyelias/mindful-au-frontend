import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard,
  MessageSquare,
  Calendar,
  Users,
  Brain,
  Video,
  FileText,
  Heart,
  Plus,
  Search,
  Clock,
  Trash2,
  Loader2,
  ChevronRight,
  History,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  FileJson,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { format } from "date-fns";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/counselor/dashboard" },
  { label: "Messages", icon: MessageSquare, path: "/counselor/messages" },
  { label: "Appointments", icon: Calendar, path: "/counselor/appointments" },
  { label: "Students", icon: Users, path: "/counselor/students" },
  { label: "AI Insights", icon: Brain, path: "/counselor/ai-insights" },
  { label: "Video Sessions", icon: Video, path: "/counselor/video" },
  { label: "Session Notes", icon: FileText, path: "/counselor/notes" },
  { label: "Wellness", icon: Heart, path: "/counselor/wellness" },
];

type SessionNoteItem = {
  id: number;
  studentId: number;
  studentName: string;
  studentEmail: string;
  status: string;
  sessionType: string;
  updatedAt: string;
  noteText: string;
  riskLevel?: string;
};

type ChatMessage = {
  id: number;
  sender: "student" | "counselor" | "system";
  content: string;
  created_at: string;
};

type AiDiagnostic = {
  id: number;
  risk_level: string;
  stress_level: number;
  anxiety_level: number;
  depression_level: number;
  mood: string;
  insights: string;
  recommendations: string;
  created_at: string;
};

const toDateInputValue = (iso?: string) => {
  if (!iso) return format(new Date(), "yyyy-MM-dd");
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return format(new Date(), "yyyy-MM-dd");
  return format(parsed, "yyyy-MM-dd");
};

const buildStudentName = (session: any) => {
  return (
    session?.student?.profile?.full_name ||
    session?.student?.email?.split("@")[0] ||
    `Student #${String(session?.student_id || session?.id || "").slice(-4)}`
  );
};

const CounselorNotes = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || "Counselor";

  const [sessions, setSessions] = useState<SessionNoteItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [noteText, setNoteText] = useState("");
  const [sessionDate, setSessionDate] = useState(format(new Date(), "yyyy-MM-dd"));

  // New state for AI and Context
  const [diagnostic, setDiagnostic] = useState<AiDiagnostic | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoadingContext, setIsLoadingContext] = useState(false);

  const loadSessions = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await api.getSessions({ limit: 300 });
      const normalized = (Array.isArray(response) ? response : [])
        .map((session: any): SessionNoteItem => {
          const updatedAt = String(session?.updated_at || session?.created_at || "");
          return {
            id: Number(session?.id),
            studentId: Number(session?.student_id),
            studentName: buildStudentName(session),
            studentEmail: String(session?.student?.email || ""),
            status: String(session?.status || "pending"),
            sessionType: String(session?.session_type || "chat"),
            updatedAt,
            noteText: String(session?.notes || ""),
            riskLevel: String(session?.risk_level || "low"),
          };
        })
        .filter((session) => Number.isFinite(session.id) && session.id > 0)
        .sort((a, b) => {
          const aTs = new Date(a.updatedAt || 0).getTime();
          const bTs = new Date(b.updatedAt || 0).getTime();
          return bTs - aTs;
        });

      setSessions(normalized);
      setSelectedSessionId((current) => {
        if (current && normalized.some((session) => session.id === current)) {
          return current;
        }
        return normalized[0]?.id ?? null;
      });
    } catch (err: any) {
      console.error("Failed to load notes:", err);
      toast.error(err?.response?.data?.message || "Failed to load session notes");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadSessions();
  }, [loadSessions, user]);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) || null,
    [selectedSessionId, sessions]
  );

  useEffect(() => {
    if (!selectedSession) {
      setNoteText("");
      setSessionDate(format(new Date(), "yyyy-MM-dd"));
      setDiagnostic(null);
      setMessages([]);
      return;
    }
    setNoteText(selectedSession.noteText);
    setSessionDate(toDateInputValue(selectedSession.updatedAt));
    void loadSessionContext(selectedSession.id);
  }, [selectedSession]);

  const loadSessionContext = async (sessionId: number) => {
    try {
      setIsLoadingContext(true);
      // Fetch diagnostics
      const diagnosticsResponse = await api.getAIDiagnostics({ limit: 10 });
      const sessionDiag = Array.isArray(diagnosticsResponse?.data) 
        ? diagnosticsResponse.data.find((d: any) => Number(d.session_id) === sessionId)
        : null;
      setDiagnostic(sessionDiag || null);

      // Fetch messages
      const messagesResponse = await api.getMessages(String(sessionId), { limit: 100 });
      setMessages(Array.isArray(messagesResponse) ? messagesResponse : []);
    } catch (err) {
      console.error("Failed to load session context:", err);
    } finally {
      setIsLoadingContext(false);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedSessionId) return;
    try {
      setIsAnalyzing(true);
      await api.analyzeSession(String(selectedSessionId));
      toast.success("AI analysis started. Results will appear shortly.");
      // Poll or wait a bit
      setTimeout(() => void loadSessionContext(selectedSessionId), 3000);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to start AI analysis");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const insertTemplate = (type: "soap" | "dap" | "basic") => {
    const templates = {
      soap: "SUBJECTIVE:\n\nOBJECTIVE:\n\nASSESSMENT:\n\nPLAN:",
      dap: "DESCRIPTION:\n\nASSESSMENT:\n\nPLAN:",
      basic: "SUMMARY:\n\nKEY POINTS:\n- \n\nNEXT STEPS:\n- ",
    };
    const content = templates[type];
    setNoteText((prev) => (prev ? `${prev}\n\n${content}` : content));
  };

  const filteredSessions = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    if (!needle) return sessions;
    return sessions.filter((session) => {
      return (
        session.studentName.toLowerCase().includes(needle) ||
        session.studentEmail.toLowerCase().includes(needle) ||
        session.noteText.toLowerCase().includes(needle) ||
        String(session.id).includes(needle)
      );
    });
  }, [sessions, searchQuery]);

  const saveNote = async (kind: "draft" | "final") => {
    if (!selectedSessionId) {
      toast.error("Select a session first.");
      return;
    }

    const trimmed = noteText.trim();
    if (trimmed === "") {
      toast.error("Write a note before saving.");
      return;
    }

    try {
      setIsSaving(true);
      await api.updateSessionNote(selectedSessionId, trimmed);

      const nowIso = new Date().toISOString();
      setSessions((previous) =>
        previous.map((session) =>
          session.id === selectedSessionId
            ? { ...session, noteText: trimmed, updatedAt: nowIso }
            : session
        )
      );
      setSessionDate(toDateInputValue(nowIso));
      toast.success(kind === "draft" ? "Draft saved." : "Note saved.");
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to save note.");
    } finally {
      setIsSaving(false);
    }
  };

  const deleteNote = async (sessionId: number) => {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session || session.noteText.trim() === "") {
      toast.error("No note to delete.");
      return;
    }

    const confirmed = window.confirm("Delete this note? This action cannot be undone.");
    if (!confirmed) return;

    try {
      setIsDeleting(true);
      await api.deleteSessionNote(sessionId);

      const nowIso = new Date().toISOString();
      setSessions((previous) =>
        previous.map((item) =>
          item.id === sessionId ? { ...item, noteText: "", updatedAt: nowIso } : item
        )
      );

      if (selectedSessionId === sessionId) {
        setNoteText("");
        setSessionDate(toDateInputValue(nowIso));
      }

      toast.success("Note deleted.");
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to delete note.");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleNewNote = () => {
    if (!sessions.length) {
      toast.error("No sessions found. Start a chat first.");
      return;
    }

    const candidate = sessions.find((session) => session.noteText.trim() === "") || sessions[0];
    setSelectedSessionId(candidate.id);
    setNoteText("");
    setSessionDate(format(new Date(), "yyyy-MM-dd"));
  };

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar
        items={navItems}
        userType="counselor"
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-72">
        <DashboardHeader title="Session Notes" onMenuClick={() => setSidebarOpen(true)} />

        <main className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto">
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="space-y-1">
              <h2 className="text-2xl font-bold tracking-tight">Clinical Workspace</h2>
              <p className="text-sm text-muted-foreground">Review sessions, analyze insights, and document outcomes.</p>
            </div>
            <div className="flex items-center gap-3 w-full md:w-auto">
              <div className="relative flex-1 md:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search sessions..."
                  className="pl-9 bg-background/50 border-border/40 focus:bg-background transition-all"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <Button variant="hero" className="gap-2 shadow-lg shadow-primary/20" onClick={handleNewNote}>
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">New Note</span>
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            {/* LEFT PANE: Session List */}
            <div className="xl:col-span-3 space-y-4">
              <Card variant="glass" className="border-border/40 overflow-hidden">
                <CardHeader className="pb-3 border-b border-border/20 bg-secondary/10">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                      Sessions
                    </CardTitle>
                    <Badge variant="outline" className="bg-background/50">
                      {filteredSessions.length}
                    </Badge>
                  </div>
                </CardHeader>
                <ScrollArea className="h-[calc(100vh-280px)] xl:h-[700px]">
                  <CardContent className="p-2 space-y-1">
                    {isLoading ? (
                      <div className="p-8 text-center space-y-3">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
                        <p className="text-xs text-muted-foreground">Loading session index...</p>
                      </div>
                    ) : filteredSessions.length === 0 ? (
                      <div className="p-8 text-center text-muted-foreground">
                        <p className="text-sm">No sessions found.</p>
                      </div>
                    ) : (
                      filteredSessions.map((session) => (
                        <button
                          key={session.id}
                          type="button"
                          className={cn(
                            "w-full text-left p-3 rounded-xl transition-all group relative overflow-hidden",
                            selectedSessionId === session.id
                              ? "bg-primary/10 border border-primary/20"
                              : "hover:bg-secondary/40 border border-transparent"
                          )}
                          onClick={() => setSelectedSessionId(session.id)}
                        >
                          <div className="flex justify-between items-start mb-1 gap-2">
                            <span className="font-semibold text-sm truncate text-foreground group-hover:text-primary transition-colors">
                              {session.studentName}
                            </span>
                            <Badge 
                              className={cn(
                                "text-[10px] px-1.5 py-0 uppercase font-bold",
                                session.riskLevel === "critical" ? "bg-destructive/20 text-destructive border-destructive/20" :
                                session.riskLevel === "high" ? "bg-orange-500/20 text-orange-500 border-orange-500/20" :
                                "bg-emerald-500/20 text-emerald-500 border-emerald-500/20"
                              )}
                            >
                              {session.riskLevel || "low"}
                            </Badge>
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {format(new Date(session.updatedAt), "MMM d")}
                            </div>
                            <div className="flex items-center gap-1">
                              {session.sessionType === "chat" ? <MessageSquare className="h-3 w-3" /> : <Video className="h-3 w-3" />}
                              <span className="capitalize">{session.sessionType}</span>
                            </div>
                          </div>
                          {selectedSessionId === session.id && (
                            <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />
                          )}
                        </button>
                      ))
                    )}
                  </CardContent>
                </ScrollArea>
              </Card>
            </div>

            {/* MIDDLE PANE: Editor */}
            <div className="xl:col-span-5 space-y-4">
              <Card variant="glass" className="border-border/40 shadow-xl">
                <CardHeader className="pb-3 border-b border-border/20">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <FileText className="h-5 w-5 text-primary" />
                      Note Editor
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="bg-background/80">
                        ID #{selectedSessionId || "---"}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-6 space-y-5">
                  {!selectedSessionId ? (
                    <div className="py-20 text-center space-y-4">
                      <div className="h-16 w-16 bg-primary/5 rounded-full flex items-center justify-center mx-auto">
                        <FileText className="h-8 w-8 text-primary/40" />
                      </div>
                      <div className="space-y-1">
                        <p className="font-medium text-foreground">No session selected</p>
                        <p className="text-sm text-muted-foreground">Select a session from the list to start documenting.</p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Session Date</label>
                          <Input 
                            value={sessionDate} 
                            type="date" 
                            onChange={(e) => setSessionDate(e.target.value)} 
                            className="bg-background/50 border-border/40 h-10"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Templates</label>
                          <div className="flex gap-1">
                            <Button variant="outline" size="sm" className="h-10 flex-1 text-[10px] uppercase font-bold tracking-tight" onClick={() => insertTemplate("soap")}>SOAP</Button>
                            <Button variant="outline" size="sm" className="h-10 flex-1 text-[10px] uppercase font-bold tracking-tight" onClick={() => insertTemplate("dap")}>DAP</Button>
                            <Button variant="outline" size="sm" className="h-10 flex-1 text-[10px] uppercase font-bold tracking-tight" onClick={() => insertTemplate("basic")}>Basic</Button>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-1.5 relative">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Clinical Observations & Plan</label>
                        <Textarea
                          placeholder="Document your observations, assessment, and care plan here..."
                          className="min-h-[450px] bg-background/30 border-border/40 focus:bg-background/60 transition-all text-base leading-relaxed resize-none p-4"
                          value={noteText}
                          onChange={(e) => setNoteText(e.target.value)}
                        />
                      </div>

                      <div className="flex gap-3 pt-2">
                        <Button
                          variant="hero"
                          className="flex-1 shadow-lg shadow-primary/20 h-12"
                          onClick={() => void saveNote("final")}
                          disabled={isSaving || isDeleting}
                        >
                          {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                          Save Note
                        </Button>
                        <Button
                          variant="outline"
                          className="h-12 px-6"
                          onClick={() => void saveNote("draft")}
                          disabled={isSaving || isDeleting}
                        >
                          Save Draft
                        </Button>
                        <Button
                          variant="destructive"
                          size="icon"
                          className="h-12 w-12 shrink-0 shadow-lg shadow-destructive/20"
                          onClick={() => selectedSessionId && void deleteNote(selectedSessionId)}
                          disabled={selectedSession?.noteText.trim() === "" || isSaving || isDeleting}
                        >
                          <Trash2 className="h-5 w-5" />
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* RIGHT PANE: Context & AI */}
            <div className="xl:col-span-4 space-y-4">
              <Tabs defaultValue="insights" className="w-full">
                <Card variant="glass" className="border-border/40 shadow-lg h-full overflow-hidden">
                  <CardHeader className="pb-0 border-b border-border/10 bg-secondary/5">
                    <div className="flex items-center justify-between mb-4">
                      <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                        Session Context
                      </CardTitle>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-8 text-[10px] uppercase font-bold tracking-tight text-primary hover:text-primary hover:bg-primary/10"
                        onClick={handleAnalyze}
                        disabled={!selectedSessionId || isAnalyzing}
                      >
                        {isAnalyzing ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <Sparkles className="h-3 w-3 mr-1.5" />}
                        Re-Analyze
                      </Button>
                    </div>
                    <TabsList className="grid w-full grid-cols-2 bg-background/50 p-1 h-12 mb-4">
                      <TabsTrigger value="insights" className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">
                        <Brain className="h-4 w-4 mr-2" />
                        AI Insights
                      </TabsTrigger>
                      <TabsTrigger value="transcript" className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">
                        <History className="h-4 w-4 mr-2" />
                        Transcript
                      </TabsTrigger>
                    </TabsList>
                  </CardHeader>
                  <CardContent className="p-0">
                    <TabsContent value="insights" className="m-0">
                      <ScrollArea className="h-[600px]">
                        {isLoadingContext ? (
                          <div className="p-20 text-center space-y-4">
                            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary/40" />
                            <p className="text-sm text-muted-foreground">Synthesizing insights...</p>
                          </div>
                        ) : !diagnostic ? (
                          <div className="p-12 text-center space-y-6">
                            <div className="h-20 w-20 bg-secondary/30 rounded-full flex items-center justify-center mx-auto">
                              <Sparkles className="h-10 w-10 text-muted-foreground/30" />
                            </div>
                            <div className="space-y-4">
                              <p className="text-sm text-muted-foreground leading-relaxed">
                                No AI analysis found for this session. Running an analysis can help detect underlying risks and patterns.
                              </p>
                              <Button 
                                variant="hero" 
                                className="w-full h-11"
                                onClick={handleAnalyze}
                                disabled={!selectedSessionId || isAnalyzing}
                              >
                                {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Brain className="h-4 w-4 mr-2" />}
                                Analyze Session
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="p-5 space-y-6">
                            {/* Risk Overview */}
                            <div className={cn(
                              "p-4 rounded-2xl border flex items-center justify-between",
                              diagnostic.risk_level === "critical" ? "bg-destructive/10 border-destructive/20" :
                              diagnostic.risk_level === "high" ? "bg-orange-500/10 border-orange-500/20" :
                              "bg-emerald-500/10 border-emerald-500/20"
                            )}>
                              <div className="space-y-1">
                                <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">Risk Assessment</p>
                                <p className={cn(
                                  "text-lg font-bold uppercase tracking-tight",
                                  diagnostic.risk_level === "critical" ? "text-destructive" :
                                  diagnostic.risk_level === "high" ? "text-orange-500" :
                                  "text-emerald-500"
                                )}>
                                  {diagnostic.risk_level} Priority
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="text-2xl font-black">{diagnostic.stress_level}%</p>
                                <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">Stress Index</p>
                              </div>
                            </div>

                            {/* Indicators */}
                            <div className="grid grid-cols-2 gap-3">
                              <div className="p-3 rounded-xl bg-secondary/20 border border-border/20">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Anxiety</p>
                                <p className="text-xl font-bold">{diagnostic.anxiety_level}%</p>
                              </div>
                              <div className="p-3 rounded-xl bg-secondary/20 border border-border/20">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Depression</p>
                                <p className="text-xl font-bold">{diagnostic.depression_level}%</p>
                              </div>
                            </div>

                            <Separator className="bg-border/10" />

                            {/* Analysis Text */}
                            <div className="space-y-4">
                              <div className="space-y-2">
                                <h4 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2 text-primary">
                                  <AlertCircle className="h-3.5 w-3.5" />
                                  Clinical Insights
                                </h4>
                                <p className="text-sm text-muted-foreground leading-relaxed">
                                  {diagnostic.insights}
                                </p>
                              </div>
                              <div className="space-y-2">
                                <h4 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2 text-emerald-500">
                                  <ClipboardList className="h-3.5 w-3.5" />
                                  AI Recommendations
                                </h4>
                                <p className="text-sm text-muted-foreground leading-relaxed italic bg-emerald-500/5 p-4 rounded-xl border border-emerald-500/10">
                                  "{diagnostic.recommendations}"
                                </p>
                              </div>
                            </div>

                            <div className="pt-4 text-center">
                              <p className="text-[10px] text-muted-foreground italic flex items-center justify-center gap-1.5">
                                <Sparkles className="h-3 w-3" />
                                Analyzed on {format(new Date(diagnostic.created_at), "MMM d, yyyy 'at' h:mm a")}
                              </p>
                            </div>
                          </div>
                        )}
                      </ScrollArea>
                    </TabsContent>

                    <TabsContent value="transcript" className="m-0">
                      <ScrollArea className="h-[600px]">
                        {!selectedSessionId ? (
                          <div className="p-20 text-center text-muted-foreground">
                            <p className="text-sm">Select a session to view transcript.</p>
                          </div>
                        ) : isLoadingContext ? (
                          <div className="p-20 text-center space-y-4">
                            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary/40" />
                            <p className="text-sm text-muted-foreground">Retrieving history...</p>
                          </div>
                        ) : messages.length === 0 ? (
                          <div className="p-20 text-center space-y-4">
                            <History className="h-10 w-10 mx-auto text-muted-foreground/20" />
                            <p className="text-sm text-muted-foreground">No message history found.</p>
                          </div>
                        ) : (
                          <div className="p-4 space-y-4">
                            {messages.map((msg, i) => (
                              <div key={msg.id} className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className={cn(
                                    "text-[10px] font-bold uppercase tracking-widest",
                                    msg.sender === "student" ? "text-primary" : "text-muted-foreground"
                                  )}>
                                    {msg.sender === "student" ? "Student" : "Counselor"}
                                  </span>
                                  <span className="text-[9px] text-muted-foreground/60">
                                    {format(new Date(msg.created_at), "h:mm a")}
                                  </span>
                                </div>
                                <div className={cn(
                                  "p-3 rounded-2xl text-sm leading-relaxed",
                                  msg.sender === "student" 
                                    ? "bg-secondary/40 rounded-tl-none border border-border/10" 
                                    : "bg-primary/5 rounded-tr-none border border-primary/10"
                                )}>
                                  {msg.content}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </ScrollArea>
                    </TabsContent>
                  </CardContent>
                </Card>
              </Tabs>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default CounselorNotes;
