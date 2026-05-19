import { useState, useEffect, useCallback, useRef } from "react";
import {
  LayoutDashboard,
  MessageSquare,
  Calendar,
  Bot,
  Video,
  History,
  Heart,
  Clock,
  FileText,
  ClipboardCheck,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/student/dashboard" },
  { label: "Chat", icon: MessageSquare, path: "/student/chat" },
  { label: "Appointments", icon: Calendar, path: "/student/appointments" },
  { label: "AI Support", icon: Bot, path: "/student/ai-support" },
  { label: "Video Call", icon: Video, path: "/student/video-call" },
  { label: "Wellness", icon: Heart, path: "/student/wellness" },
  { label: "Assessment", icon: ClipboardCheck, path: "/student/diagnostic-assessment" },
];

const StudentHistory = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sessionPage, setSessionPage] = useState(1);
  const [sessionTotalPages, setSessionTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const { user } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split('@')[0] || "Student";

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
    [],
  );

  useEffect(() => {
    if (!user?.id) {
      setIsLoading(false);
      return;
    }
    void loadSessions(true, { force: true });
  }, [loadSessions, user?.id]);

  // Reload when user navigates to a different page via pagination
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

    window.addEventListener("focus", retryLoad);
    window.addEventListener("online", retryLoad);
    window.addEventListener(API_RECOVERED_EVENT, retryLoad as EventListener);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", retryLoad);
      window.removeEventListener("online", retryLoad);
      window.removeEventListener(API_RECOVERED_EVENT, retryLoad as EventListener);
    };
  }, [loadSessions, user]);

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

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar
        items={navItems}
        userType="student"
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-72 pl-0">
        <DashboardHeader
          title="Past Sessions"
          onMenuClick={() => setSidebarOpen(true)}
        />

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
                  <Button variant="outline" onClick={() => window.location.href = "/student/appointments"}>
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
                            <p className="font-medium text-foreground">{session.counselor?.profile?.full_name || session.counselor?.email || "Counselor"}</p>
                            <p className="text-sm text-muted-foreground">{session.session_type || "Session"}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            {session.created_at ? new Date(session.created_at).toLocaleDateString() : "Date TBD"}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-4 w-4" />
                            {session.duration_minutes ? `${session.duration_minutes} min` : "Duration TBD"}
                          </span>
                        </div>
                      </div>
                      {session.notes && (
                        <p className="text-sm text-muted-foreground pl-13">{session.notes}</p>
                      )}
                      <div className="flex gap-2 pl-13">
                        <Button variant="outline" size="sm" className="gap-1">
                          <FileText className="h-4 w-4" />
                          View Details
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
    </div>
  );
};

export default StudentHistory;
