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
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/sonner";
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
  studentName: string;
  studentEmail: string;
  status: string;
  sessionType: string;
  updatedAt: string;
  noteText: string;
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

  const loadSessions = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await api.getSessions({ limit: 300 });
      const normalized = (Array.isArray(response) ? response : [])
        .map((session: any): SessionNoteItem => {
          const updatedAt = String(session?.updated_at || session?.created_at || "");
          return {
            id: Number(session?.id),
            studentName: buildStudentName(session),
            studentEmail: String(session?.student?.email || ""),
            status: String(session?.status || "pending"),
            sessionType: String(session?.session_type || "chat"),
            updatedAt,
            noteText: String(session?.notes || ""),
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
      return;
    }
    setNoteText(selectedSession.noteText);
    setSessionDate(toDateInputValue(selectedSession.updatedAt));
  }, [selectedSession]);

  const notesWithContent = useMemo(
    () => sessions.filter((session) => session.noteText.trim() !== ""),
    [sessions]
  );

  const filteredNotes = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    if (!needle) return notesWithContent;
    return notesWithContent.filter((session) => {
      return (
        session.studentName.toLowerCase().includes(needle) ||
        session.studentEmail.toLowerCase().includes(needle) ||
        session.noteText.toLowerCase().includes(needle) ||
        String(session.id).includes(needle)
      );
    });
  }, [notesWithContent, searchQuery]);

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

        <main className="p-4 lg:p-6 space-y-6">
          <div className="flex flex-col md:flex-row gap-4 justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search notes..."
                className="pl-9"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Button variant="hero" className="gap-2" onClick={handleNewNote}>
              <Plus className="h-4 w-4" />
              New Note
            </Button>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card variant="glass">
              <CardHeader>
                <CardTitle className="text-lg">Recent Notes ({filteredNotes.length})</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading notes...
                  </div>
                ) : filteredNotes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No saved notes yet.</p>
                ) : (
                  <div className="space-y-4">
                    {filteredNotes.map((session) => (
                      <div
                        key={session.id}
                        className={`p-4 rounded-xl border transition-colors ${
                          selectedSessionId === session.id
                            ? "border-primary/50 bg-secondary/45"
                            : "border-border/40 bg-secondary/25 hover:bg-secondary/40"
                        }`}
                      >
                        <button
                          type="button"
                          className="w-full text-left"
                          onClick={() => setSelectedSessionId(session.id)}
                        >
                          <div className="flex justify-between items-start mb-2 gap-3">
                            <div className="min-w-0">
                              <p className="font-medium text-foreground truncate">{session.studentName}</p>
                              <p className="text-xs text-muted-foreground capitalize">
                                {session.sessionType} session - {session.status}
                              </p>
                            </div>
                            <span className="text-xs text-muted-foreground flex items-center gap-1 whitespace-nowrap">
                              <Clock className="h-3 w-3" />
                              {session.updatedAt
                                ? format(new Date(session.updatedAt), "MMM d, yyyy")
                                : "Recently"}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-2">{session.noteText}</p>
                        </button>
                        <div className="mt-3 flex justify-end">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="gap-2"
                            onClick={() => void deleteNote(session.id)}
                            disabled={isDeleting}
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card variant="glass">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary" />
                  Note Editor
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={selectedSessionId ?? ""}
                  onChange={(e) => setSelectedSessionId(Number(e.target.value) || null)}
                  disabled={sessions.length === 0}
                >
                  {sessions.length === 0 ? (
                    <option value="">No sessions available</option>
                  ) : (
                    sessions.map((session) => (
                      <option key={session.id} value={session.id}>
                        #{session.id} - {session.studentName} - {session.sessionType}
                      </option>
                    ))
                  )}
                </select>

                <Input value={sessionDate} type="date" onChange={(e) => setSessionDate(e.target.value)} />

                <Textarea
                  placeholder="Write your session notes here..."
                  className="min-h-[220px]"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  disabled={!selectedSessionId}
                />

                <div className="flex flex-col sm:flex-row gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => void saveNote("draft")}
                    disabled={!selectedSessionId || isSaving || isDeleting}
                  >
                    {isSaving ? "Saving..." : "Save Draft"}
                  </Button>
                  <Button
                    type="button"
                    variant="hero"
                    className="flex-1"
                    onClick={() => void saveNote("final")}
                    disabled={!selectedSessionId || isSaving || isDeleting}
                  >
                    {isSaving ? "Saving..." : "Save Note"}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    className="sm:w-auto"
                    onClick={() => selectedSessionId && void deleteNote(selectedSessionId)}
                    disabled={
                      !selectedSessionId ||
                      selectedSession?.noteText.trim() === "" ||
                      isSaving ||
                      isDeleting
                    }
                  >
                    {isDeleting ? "Deleting..." : "Delete"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
};

export default CounselorNotes;
