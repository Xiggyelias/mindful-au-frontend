import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard,
  MessageSquare,
  Calendar,
  Users,
  Loader2,
  CheckCircle2,
  Trash2,
} from "lucide-react";
import { format } from "date-fns";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

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

const CounselorNotes = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessions, setSessions] = useState<any[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  
  // Note content state
  const [noteText, setNoteText] = useState("");
  const [sessionDate, setSessionDate] = useState(format(new Date(), "yyyy-MM-dd"));

  const { user } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || "Counselor";

  const loadSessions = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await api.getCounselorSessions();
      setSessions(data);
    } catch (error) {
      toast.error("Failed to load sessions");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId),
    [sessions, selectedSessionId]
  );

  useEffect(() => {
    if (selectedSession) {
      setNoteText(selectedSession.noteText || "");
      setSessionDate(
        selectedSession.sessionDate 
          ? format(new Date(selectedSession.sessionDate), "yyyy-MM-dd") 
          : format(new Date(), "yyyy-MM-dd")
      );
    } else {
      setNoteText("");
      setSessionDate(format(new Date(), "yyyy-MM-dd"));
    }
  }, [selectedSession]);

  const filteredSessions = useMemo(() => {
    return sessions.filter((s) =>
      s.studentName?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [sessions, searchQuery]);

  const saveNote = async (status: "draft" | "final") => {
    if (!selectedSessionId) return;
    try {
      setIsSaving(true);
      await api.updateSessionNote(selectedSessionId, {
        noteText,
        sessionDate,
        status,
      });
      toast.success(status === "final" ? "Note saved successfully" : "Draft saved");
      await loadSessions();
    } catch (error) {
      toast.error("Failed to save note");
    } finally {
      setIsSaving(false);
    }
  };

  const deleteNote = async (sessionId: string) => {
    if (!confirm("Are you sure you want to delete this note?")) return;
    try {
      setIsDeleting(true);
      await api.updateSessionNote(sessionId, {
        noteText: "",
        status: "draft",
      });
      toast.success("Note cleared");
      await loadSessions();
    } catch (error) {
      toast.error("Failed to delete note");
    } finally {
      setIsDeleting(false);
    }
  };

  const insertTemplate = (type: "soap" | "dap" | "basic") => {
    const templates = {
      soap: "S (Subjective): \nO (Objective): \nA (Assessment): \nP (Plan): ",
      dap: "D (Data): \nA (Assessment): \nP (Plan): ",
      basic: "Observations: \n\nInterventions: \n\nPlan: ",
    };
    setNoteText((prev) => (prev ? prev + "\n\n" + templates[type] : templates[type]));
  };

  const handleNewNote = () => {
    setSelectedSessionId(null);
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
                              {session.sessionType === "physical" ? (
                                <Users className="h-3 w-3 text-emerald-500" />
                              ) : session.sessionType === "chat" ? (
                                <MessageSquare className="h-3 w-3 text-blue-500" />
                              ) : (
                                <Video className="h-3 w-3 text-purple-500" />
                              )}
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
            <div className="xl:col-span-9 space-y-4">
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
                          className="min-h-[550px] bg-background/30 border-border/40 focus:bg-background/60 transition-all text-base leading-relaxed resize-none p-4"
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
          </div>
        </main>
      </div>
    </div>
  );
};

export default CounselorNotes;
