import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Calendar, Clock, FileText, History, MessageSquare, Video } from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { studentNavItems } from "@/config/studentNavItems";
import { useAuth } from "@/hooks/useAuth";
import { api, getApiErrorMessage, API_RECOVERED_EVENT } from "@/lib/api";
import { toast } from "sonner";

const SESSIONS_PAGE_SIZE = 10;
const SESSIONS_REFRESH_MIN_GAP_MS = 5000;

type PagedMeta = {
  page?: number;
  per_page?: number;
  total?: number;
  total_pages?: number;
};

type SessionItem = {
  id: number;
  status?: string | null;
  session_type?: string | null;
  scheduled_at?: string | null;
  duration_minutes?: number | null;
  notes?: string | null;
  counselor?: {
    id?: number;
    email?: string;
    profile?: { full_name?: string };
  };
  created_at?: string;
};

type SessionListResponse = SessionItem[] | { data?: SessionItem[]; meta?: PagedMeta };

const formatSessionType = (type?: string | null) => {
  const raw = String(type || "session").toLowerCase();
  if (raw === "chat") return "Chat";
  if (raw === "video") return "Video";
  if (raw === "voice") return "Voice";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
};

// Booking metadata stored in notes — not meaningful to show students.
const BOOKING_NOTES_RE = /^(online|physical|audio|video)\b/i;

const isUserFacingNote = (notes: string | null | undefined): boolean => {
  const raw = String(notes ?? "").trim();
  return raw.length > 0 && !BOOKING_NOTES_RE.test(raw);
};

const StudentHistory = () => {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sessionPage, setSessionPage] = useState(1);
  const [sessionTotalPages, setSessionTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<SessionItem | null>(null);
  const { user } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split("@")[0] || "Student";

  const requestInFlightRef = useRef<Promise<void> | null>(null);
  const lastLoadAtRef = useRef(0);
  const sessionPageRef = useRef(sessionPage);

  useEffect(() => {
    setSessionPage(1);
    sessionPageRef.current = 1;
    setSessionTotalPages(1);
    requestInFlightRef.current = null;
    lastLoadAtRef.current = 0;
  }, [user?.id]);

  const loadSessions = useCallback(
    async (showErrorToast = true, options?: { force?: boolean }) => {
      if (requestInFlightRef.current) {
        await requestInFlightRef.current;
        return;
      }

      const force = Boolean(options?.force);
      if (!force && Date.now() - lastLoadAtRef.current < SESSIONS_REFRESH_MIN_GAP_MS) {
        return;
      }

      const requestPromise = (async () => {
        try {
          setIsLoading(true);
          const payload = (await api.getSessions({
            page: sessionPageRef.current,
            per_page: SESSIONS_PAGE_SIZE,
            timeout_ms: 15000,
          })) as SessionListResponse;

          const pagedPayload =
            !Array.isArray(payload) && payload && typeof payload === "object" ? payload : null;
          const normalized = (
            Array.isArray(payload)
              ? payload
              : Array.isArray(pagedPayload?.data)
              ? pagedPayload.data
              : []
          ) as SessionItem[];

          const receivedPage = Number(pagedPayload?.meta?.page);
          const receivedTotalPages = Number(pagedPayload?.meta?.total_pages);
          const nextPage =
            Number.isFinite(receivedPage) && receivedPage > 0 ? Math.floor(receivedPage) : 1;
          const nextTotalPages =
            Number.isFinite(receivedTotalPages) && receivedTotalPages > 0
              ? Math.floor(receivedTotalPages)
              : 1;
          setSessions(normalized);
          setSessionTotalPages(nextTotalPages);
          if (!pagedPayload && sessionPageRef.current !== 1) {
            sessionPageRef.current = 1;
            setSessionPage(1);
          } else if (pagedPayload && nextPage !== sessionPageRef.current) {
            sessionPageRef.current = nextPage;
            setSessionPage(nextPage);
          }
        } catch (err: unknown) {
          if (import.meta.env.DEV) {
            console.error("Failed to load sessions:", err);
          }
          if (showErrorToast) {
            toast.error(getApiErrorMessage(err, "Could not load session history"));
          }
        } finally {
          lastLoadAtRef.current = Date.now();
          setIsLoading(false);
        }
      })();

      requestInFlightRef.current = requestPromise;
      try {
        await requestPromise;
      } finally {
        requestInFlightRef.current = null;
      }
    },
    []
  );

  useEffect(() => {
    if (!user?.id) {
      setIsLoading(false);
      return;
    }
    void loadSessions(true, { force: true });
  }, [loadSessions, user?.id]);

  useEffect(() => {
    if (!user?.id || sessionPage === 1) return;
    sessionPageRef.current = sessionPage;
    void loadSessions(true, { force: true });
  }, [sessionPage, loadSessions, user?.id]);

  useEffect(() => {
    if (!user?.id) return;

    const retryLoad = () => {
      if (document.visibilityState !== "visible") return;
      void loadSessions(false);
    };

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      retryLoad();
    }, 30000);

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        retryLoad();
      }
    };

    window.addEventListener("focus", retryLoad);
    window.addEventListener("online", retryLoad);
    window.addEventListener("visibilitychange", onVisibility);
    window.addEventListener(API_RECOVERED_EVENT, retryLoad as EventListener);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", retryLoad);
      window.removeEventListener("online", retryLoad);
      window.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(API_RECOVERED_EVENT, retryLoad as EventListener);
    };
  }, [loadSessions, user?.id]);

  const canGoToPrevPage = sessionPage > 1;
  const canGoToNextPage = sessionPage < sessionTotalPages;

  const handlePrevPage = () => {
    if (!canGoToPrevPage || isLoading) return;
    const next = Math.max(1, sessionPage - 1);
    sessionPageRef.current = next;
    setSessionPage(next);
  };

  const handleNextPage = () => {
    if (!canGoToNextPage || isLoading) return;
    const next = Math.min(sessionTotalPages, sessionPage + 1);
    sessionPageRef.current = next;
    setSessionPage(next);
  };

  const openSessionFollowUp = (session: SessionItem) => {
    const type = String(session.session_type || "").toLowerCase();
    const status = String(session.status || "").toLowerCase();
    if (type === "chat") {
      navigate(`/student/chat?session=${session.id}`);
      return;
    }
    // Only active/pending video sessions can still be joined; completed ones go to appointments.
    if ((type === "video" || type === "voice") && (status === "active" || status === "pending")) {
      navigate("/student/video-call");
      return;
    }
    navigate("/student/appointments");
  };

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
        <DashboardHeader title="Past Sessions" onMenuClick={() => setSidebarOpen(true)} />

        <main className="p-4 lg:p-6 space-y-6">
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="text-lg">Session History</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground">Loading session history...</p>
                </div>
              ) : sessions.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground mb-4">No past sessions yet</p>
                  <Button variant="outline" onClick={() => navigate("/student/appointments")}>
                    Book your first session
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      className="p-4 rounded-xl bg-secondary/30 space-y-3"
                    >
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-info/20 flex items-center justify-center">
                            <History className="h-5 w-5 text-info" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground">
                              {session.counselor?.profile?.full_name ||
                                session.counselor?.email ||
                                "Counselor"}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {formatSessionType(session.session_type)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                          {session.status && (
                            <Badge variant="secondary" className="capitalize">
                              {session.status}
                            </Badge>
                          )}
                          <span className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            {(session.scheduled_at || session.created_at)
                              ? new Date(session.scheduled_at || session.created_at!).toLocaleDateString()
                              : "Date TBD"}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-4 w-4" />
                            {session.duration_minutes
                              ? `${session.duration_minutes} min`
                              : "Duration TBD"}
                          </span>
                        </div>
                      </div>
                      {isUserFacingNote(session.notes) && (
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {session.notes}
                        </p>
                      )}
                      <div className="flex gap-2 flex-wrap">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1"
                          onClick={() => setSelectedSession(session)}
                        >
                          <FileText className="h-4 w-4" />
                          View Details
                        </Button>
                        <Button
                          size="sm"
                          className="gap-1"
                          onClick={() => openSessionFollowUp(session)}
                        >
                          {String(session.session_type || "").toLowerCase() === "chat" ? (
                            <MessageSquare className="h-4 w-4" />
                          ) : (
                            <Video className="h-4 w-4" />
                          )}
                          Open session
                        </Button>
                      </div>
                    </div>
                  ))}

                  {sessionTotalPages > 1 && (
                    <div className="flex items-center justify-center gap-4 pt-4">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        onClick={handlePrevPage}
                        disabled={!canGoToPrevPage || isLoading}
                      >
                        Prev
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        Page {sessionPage} of {Math.max(1, sessionTotalPages)}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        onClick={handleNextPage}
                        disabled={!canGoToNextPage || isLoading}
                      >
                        Next
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </main>
      </div>

      <Dialog open={selectedSession !== null} onOpenChange={(open) => !open && setSelectedSession(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Session details</DialogTitle>
            <DialogDescription>
              {selectedSession
                ? `${formatSessionType(selectedSession.session_type)} with ${
                    selectedSession.counselor?.profile?.full_name ||
                    selectedSession.counselor?.email ||
                    "your counselor"
                  }`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {selectedSession && (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Status</span>
                <span className="font-medium capitalize">{selectedSession.status || "—"}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Date</span>
                <span className="font-medium">
                  {(selectedSession.scheduled_at || selectedSession.created_at)
                    ? new Date(selectedSession.scheduled_at || selectedSession.created_at!).toLocaleString()
                    : "—"}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Duration</span>
                <span className="font-medium">
                  {selectedSession.duration_minutes
                    ? `${selectedSession.duration_minutes} minutes`
                    : "—"}
                </span>
              </div>
              {isUserFacingNote(selectedSession.notes) && (
                <div className="rounded-lg bg-secondary/40 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Notes</p>
                  <p className="text-foreground">{selectedSession.notes}</p>
                </div>
              )}
              <Button className="w-full mt-2" onClick={() => openSessionFollowUp(selectedSession)}>
                Go to {formatSessionType(selectedSession.session_type)}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default StudentHistory;
