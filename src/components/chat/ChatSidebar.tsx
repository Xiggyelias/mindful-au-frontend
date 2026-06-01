import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Session, dedupeChatSessions, isSessionExpired, markSessionAsExpired } from "@/hooks/useChatSession";
import { 
  Search, 
  MessageSquare, 
  Users, 
  Shield, 
  ChevronLeft, 
  ChevronRight,
  Plus,
  Pin,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import { api } from "@/lib/api";
import { loadPreloadedSessionMessages, savePreloadedSessionMessages } from '@/lib/chatPreloadCache';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { isAnonymousSessionFlag } from "@/lib/anonymousMode";

interface ChatSidebarProps {
  sessions: Session[];
  activeSession: Session | null;
  counselors: any[];
  isCounselorsLoading: boolean;
  searchQuery: string;
  onSearchChange: (val: string) => void;
  onSelectSession: (id: string, session?: Session) => void;
  onStartSession: (id: number, isAnon: boolean) => void;
  anonymousStartMode: boolean;
  onToggleAnonymous: (val: boolean) => void;
  /** True while profile anonymous_mode is saving (sidebar switch only updated local state before). */
  anonymousToggleDisabled?: boolean;
  counselorPage: number;
  counselorTotalPages: number;
  onNextCounselorPage: () => void;
  onPrevCounselorPage: () => void;
  sessionPage: number;
  sessionTotalPages: number;
  onNextSessionPage: () => void;
  onPrevSessionPage: () => void;
  /**
   * The authenticated user's ID — used as ownerUserId for hover-preload cache
   * keying. Must come from useAuth(), NOT from activeSession (which is null
   * on cold start and would silently disable all hover prefetching).
   */
  ownerUserId?: string | null;
  activePeerParticipant?: {
    id?: number | null;
    name: string;
    email?: string;
  } | null;
}

export const ChatSidebar: React.FC<ChatSidebarProps> = ({
  sessions,
  activeSession,
  counselors,
  isCounselorsLoading,
  searchQuery,
  onSearchChange,
  onSelectSession,
  onStartSession,
  anonymousStartMode,
  onToggleAnonymous,
  anonymousToggleDisabled = false,
  counselorPage,
  counselorTotalPages,
  onNextCounselorPage,
  onPrevCounselorPage,
  sessionPage,
  sessionTotalPages,
  onNextSessionPage,
  onPrevSessionPage,
  ownerUserId,
  activePeerParticipant,
}) => {
  const [conversationFilter, setConversationFilter] = useState<"unread" | "active" | "pinned" | "archived">("active");
  const [pinnedSessionIds, setPinnedSessionIds] = useState<number[]>([]);
  const [archivedSessionIds, setArchivedSessionIds] = useState<number[]>([]);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const SIDEBAR_PREFS_KEY = "student_chat_sidebar_prefs_v1";

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_PREFS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { pinned?: number[]; archived?: number[] };
      if (Array.isArray(parsed?.pinned)) setPinnedSessionIds(parsed.pinned.map(Number).filter(Number.isFinite));
      if (Array.isArray(parsed?.archived)) setArchivedSessionIds(parsed.archived.map(Number).filter(Number.isFinite));
    } catch {
      // Ignore local preference parsing failures.
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_PREFS_KEY, JSON.stringify({ pinned: pinnedSessionIds, archived: archivedSessionIds }));
    } catch {
      // Ignore local preference persistence failures.
    }
  }, [pinnedSessionIds, archivedSessionIds]);

  const handleRowMouseEnter = (sessionId: string) => {
    // Use the explicit ownerUserId prop (from useAuth) — NOT activeSession?.student_id
    // because activeSession is null on cold start, silently disabling all hover preloads.
    const userId = String(ownerUserId || '').trim() || null;
    if (!userId) return;

    hoverTimerRef.current = setTimeout(async () => {
      const existing = await loadPreloadedSessionMessages(sessionId, {
        expectedOwnerUserId: userId,
      });
      if (!existing || existing.length === 0) {
        const rawMessages = await api.getMessages(sessionId, {
          limit: 40,
          mark_read: false,
          timeout_ms: 5000,
        }).catch((err: any) => {
          const status = err?.response?.status ?? err?.status;
          if (status === 410) {
            markSessionAsExpired(sessionId);
            return null;
          }
          return null;
        });
        if (rawMessages?.length) {
          await savePreloadedSessionMessages(sessionId, rawMessages, {
            ownerUserId: userId,
          });
        }
      }
    }, 200);
  };

  const handleRowMouseLeave = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
  };

  const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "??";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  };

  const getUserColor = (name: string) => {
    const colors = ["bg-blue-500", "bg-purple-500", "bg-emerald-500", "bg-orange-500", "bg-pink-500", "bg-indigo-500", "bg-cyan-500", "bg-rose-500"];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  const sessionActivityTime = useCallback((session: Session) => {
    const raw = session.updated_at || session.created_at;
    const timestamp = new Date(raw).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }, []);

  const peerParticipantForSession = useCallback((session: Session) => {
    const currentStudentId = Number(ownerUserId || session.chat_peer_student_id || session.student_id || 0);
    const isLivePeerAssignment =
      session.assigned_role === "peer_counselor" && Number(session.peer_counselor_id) > 0;

    if (!isLivePeerAssignment) {
      return null;
    }

    if (activeSession?.id === session.id && activePeerParticipant) {
      const activePeerId = Number(activePeerParticipant.id || 0);
      if (activePeerId > 0 && activePeerId === currentStudentId) {
        return null;
      }
      return activePeerParticipant;
    }
    const currentPeerName =
      session.peer_counselor?.profile?.full_name || session.peer_counselor?.email || "";
    if (Number(session.peer_counselor_id) > 0 || currentPeerName) {
      const peerId = Number(session.peer_counselor_id || session.peer_counselor?.id || 0) || null;
      if (peerId && peerId === currentStudentId) {
        return null;
      }
      return {
        id: peerId,
        name: currentPeerName || "Peer Counselor",
        email: session.peer_counselor?.email,
      };
    }
    return null;
  }, [activePeerParticipant, activeSession?.id, ownerUserId]);

  const isPeerSupportSession = useCallback(
    (session: Session) => Boolean(peerParticipantForSession(session)),
    [peerParticipantForSession]
  );

  const supportPersonName = useCallback(
    (session: Session) =>
      peerParticipantForSession(session)?.name ||
      session.counselor?.profile?.full_name ||
      session.counselor?.email ||
      "Counselor",
    [peerParticipantForSession]
  );

  const supportPersonId = useCallback(
    (session: Session) =>
      Number(peerParticipantForSession(session)?.id || session.counselor_id || 0),
    [peerParticipantForSession]
  );

  const supervisingCounselorName = useCallback(
    (session: Session) =>
      session.counselor?.profile?.full_name || session.counselor?.email || "Counselor",
    []
  );

  const visibleSessions = useMemo(
    () => dedupeChatSessions(sessions.filter(s => !isSessionExpired(String(s.id)))),
    [sessions]
  );

  const recentSupportRows = useMemo(() => {
    return visibleSessions
      .map((session) => ({
        supportId: supportPersonId(session),
        session,
        totalSessions: 1,
        unreadCount: Math.max(0, Number(session.unread_count || 0)),
      }))
      .sort((a, b) => {
        const byActivity = sessionActivityTime(b.session) - sessionActivityTime(a.session);
        if (byActivity !== 0) return byActivity;
        return Number(b.session.id || 0) - Number(a.session.id || 0);
      });
  }, [sessionActivityTime, supportPersonId, visibleSessions]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredRecentSupportRows = useMemo(() => {
    return recentSupportRows.filter(({ session, unreadCount }) => {
      const sessionNumericId = Number(session.id);
      const isArchived = archivedSessionIds.includes(sessionNumericId);
      const isPinned = pinnedSessionIds.includes(sessionNumericId);
      const name = (
        supportPersonName(session)
      ).toLowerCase();
      const bySearch = normalizedQuery === "" || name.includes(normalizedQuery);
      if (!bySearch) return false;
      if (conversationFilter === "archived") return isArchived;
      if (isArchived) return false;
      if (conversationFilter === "pinned") return isPinned;
      if (conversationFilter === "unread") return unreadCount > 0;
      if (conversationFilter === "active") return session.status !== "completed" && session.status !== "cancelled";
      return false;
    });
  }, [recentSupportRows, normalizedQuery, conversationFilter, archivedSessionIds, pinnedSessionIds, supportPersonName]);

  const filteredCounselors = useMemo(() => {
    return counselors.filter((c) =>
      normalizedQuery === "" ||
      String(c?.profile?.full_name || "Counselor").toLowerCase().includes(normalizedQuery)
    );
  }, [counselors, normalizedQuery]);

  const counselorSkeletons = Array.from({ length: 4 }, (_, idx) => idx);
  const hasRecentSupport = filteredRecentSupportRows.length > 0;
  const hasAnyRecentSupport = recentSupportRows.length > 0;
  const hasAvailableCounselors = filteredCounselors.length > 0;

  return (
    <div className="flex h-full w-full flex-col bg-gradient-to-b from-slate-50/90 via-background to-emerald-50/40">
      <div className="sticky top-0 z-20 border-b border-border/60 bg-background/80 px-4 pb-4 pt-4 backdrop-blur-xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-display font-bold tracking-tight text-slate-900 dark:text-slate-100">Counseling Inbox</h2>
            <p className="text-xs text-muted-foreground">Safe, private and real-time support</p>
          </div>
        </div>

        <div className="relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors duration-200" />
          <Input 
            placeholder="Search by support person or session..." 
            className="h-11 rounded-2xl border-slate-200/80 bg-white/90 pl-10 shadow-sm transition-all focus-visible:ring-2 focus-visible:ring-primary/20"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <div className="mt-3 flex items-center gap-1 rounded-xl border border-slate-200/80 bg-white/80 p-1">
          {[
            { id: "unread", label: "Unread" },
            { id: "active", label: "Active" },
            { id: "pinned", label: "Pinned" },
            { id: "archived", label: "Archived" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setConversationFilter(tab.id as "unread" | "active" | "pinned" | "archived")}
              className={cn(
                "rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors",
                conversationFilter === tab.id
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100"
              )}
              aria-pressed={conversationFilter === tab.id}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div
          className={cn(
            "mt-4 flex items-center justify-between rounded-2xl border p-3 shadow-sm transition-colors relative z-10",
            anonymousStartMode
              ? "border-rose-700 bg-slate-950 text-white shadow-[inset_0_0_0_1px_rgba(190,24,93,0.4)]"
              : "border-emerald-200/80 bg-emerald-50/70"
          )}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Shield className={cn("h-4 w-4 shrink-0", anonymousStartMode ? "text-red-500" : "text-primary")} />
            <Label
              htmlFor="anon-mode"
              className={cn(
                "cursor-pointer text-xs font-bold uppercase tracking-wider truncate",
                anonymousStartMode ? "text-white" : ""
              )}
            >
              Anonymous mode
            </Label>
          </div>
          <Switch 
            id="anon-mode" 
            checked={anonymousStartMode} 
            onCheckedChange={onToggleAnonymous}
            disabled={anonymousToggleDisabled}
            className="flex-shrink-0"
          />
        </div>
      </div>

      <ScrollArea className="min-w-0 flex-1">
        <div className="w-full min-w-0 max-w-full space-y-8 px-3 pb-8 pt-4">
          <div className="min-w-0 space-y-2">
            <div className="flex items-center justify-between px-3">
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/70">Recent Support</h3>
              {sessionTotalPages > 1 && (
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-6 w-6 rounded-lg" onClick={onPrevSessionPage} disabled={sessionPage === 1} aria-label="Previous sessions page"><ChevronLeft className="h-3 w-3" /></Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6 rounded-lg" onClick={onNextSessionPage} disabled={sessionPage === sessionTotalPages} aria-label="Next sessions page"><ChevronRight className="h-3 w-3" /></Button>
                </div>
              )}
            </div>
            
            <div className="min-w-0 space-y-1">
              {filteredRecentSupportRows.map(({ session, totalSessions, supportId, unreadCount }) => {
                const name = supportPersonName(session);
                const isActive = String(activeSession?.id ?? "") === String(session.id);
                const isPeer = isPeerSupportSession(session);
                const isAnon = isAnonymousSessionFlag(session.is_anonymous);
                const sessionNumericId = Number(session.id);
                const isPinned = pinnedSessionIds.includes(sessionNumericId);
                const isArchived = archivedSessionIds.includes(sessionNumericId);
                const supportSubtitleParts = isPeer
                  ? [
                      "Peer support",
                      supervisingCounselorName(session)
                        ? `Supervised by ${supervisingCounselorName(session)}`
                        : "",
                    ]
                  : ["Counselor"];
                if (isAnon) supportSubtitleParts.push("Anon");
                if (isPinned) supportSubtitleParts.push("Pinned");
                if (isArchived) supportSubtitleParts.push("Archived");
                const supportSubtitle = supportSubtitleParts.filter(Boolean).join(" / ");

                const handleRowClick = () => {
                  onSelectSession(String(session.id), session);
                };
                const togglePin = (e: React.MouseEvent<HTMLButtonElement>) => {
                  e.stopPropagation();
                  setPinnedSessionIds((prev) =>
                    prev.includes(sessionNumericId)
                      ? prev.filter((id) => id !== sessionNumericId)
                      : [...prev, sessionNumericId]
                  );
                };
                const toggleArchive = (e: React.MouseEvent<HTMLButtonElement>) => {
                  e.stopPropagation();
                  setArchivedSessionIds((prev) =>
                    prev.includes(sessionNumericId)
                      ? prev.filter((id) => id !== sessionNumericId)
                      : [...prev, sessionNumericId]
                  );
                };

                return (
                  <div
                    role="button"
                    tabIndex={0}
                    key={`recent-session-${session.id}`}
                    data-testid={`student-chat-session-card-${session.id}`}
                    data-session-id={String(session.id)}
                    data-support-id={supportId || undefined}
                    data-support-role={isPeer ? "peer" : "counselor"}
                    aria-label={`Open ${name} session ${session.id}`}
                    aria-pressed={isActive}
                    onClick={handleRowClick}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleRowClick();
                      }
                    }}
                    onMouseEnter={() => handleRowMouseEnter(String(session.id))}
                    onMouseLeave={handleRowMouseLeave}
                    className={cn(
                      "group w-full min-w-0 max-w-full overflow-hidden rounded-2xl border p-3 text-left shadow-sm transition-all duration-200",
                      "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                      isActive
                        ? "border-primary/20 bg-gradient-to-r from-primary/95 to-primary text-primary-foreground"
                        : isAnon
                        ? "border-rose-200/80 bg-rose-50/95 text-slate-950 hover:-translate-y-0.5 hover:border-rose-300 hover:bg-rose-50"
                        : "border-slate-200/80 bg-white/90 text-slate-950 hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-white"
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className={`h-11 w-11 rounded-full flex items-center justify-center shrink-0 font-bold text-sm shadow-sm ring-2 ring-white/50 ${
                        isActive ? "bg-white/20" : getUserColor(name) + " text-white"
                      }`}>
                        {getInitials(name)}
                      </div>
                      <div className="min-w-0 flex-1 text-left">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <p className={cn(
                            "min-w-0 max-w-full flex-1 truncate text-sm font-bold leading-tight",
                            isActive ? "text-white" : "text-slate-900"
                          )}>
                            {name}
                          </p>
                          <span className={cn(
                            "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none",
                            isActive
                              ? "bg-white/15 text-white/80"
                              : isAnon
                              ? "bg-rose-100 text-rose-700"
                              : "bg-slate-100 text-slate-600"
                          )}>
                            {totalSessions} {totalSessions === 1 ? "session" : "sessions"}
                          </span>
                        </div>
                        <p
                          className={cn(
                            "mt-1 flex min-w-0 items-start gap-1 text-[10px] font-black uppercase tracking-wider leading-snug",
                            isActive ? "text-white/80" : isAnon ? "text-rose-700/80" : "text-slate-500"
                          )}
                          title={supportSubtitle}
                        >
                          {isPeer && <Users className="h-2.5 w-2.5 shrink-0" />}
                          <span className="min-w-0 [overflow-wrap:anywhere]">{supportSubtitle}</span>
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-1">
                      {unreadCount > 0 && (
                        <span
                          className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-white tabular-nums shadow-sm shrink-0"
                          aria-label={`${unreadCount} unread message${unreadCount === 1 ? "" : "s"}`}
                        >
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={togglePin}
                        className={cn(
                          "rounded-md p-1 transition-colors",
                          isActive
                            ? "text-white/70 hover:bg-white/10 hover:text-white"
                            : "text-slate-400 hover:bg-slate-100 hover:text-slate-700",
                          isPinned && (isActive ? "text-white" : "text-emerald-700")
                        )}
                        aria-label={isPinned ? "Unpin conversation" : "Pin conversation"}
                      >
                        <Pin className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={toggleArchive}
                        className={cn(
                          "rounded-md p-1 transition-colors",
                          isActive
                            ? "text-white/70 hover:bg-white/10 hover:text-white"
                            : "text-slate-400 hover:bg-slate-100 hover:text-slate-700",
                          isArchived && (isActive ? "text-white" : "text-amber-700")
                        )}
                        aria-label={isArchived ? "Restore conversation" : "Archive conversation"}
                      >
                        {isArchived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                );
              })}
              {!hasRecentSupport && (
                <div className="rounded-2xl border border-dashed border-slate-300/70 bg-white/70 p-5 text-center shadow-sm">
                  <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-100/80 text-emerald-700">
                    <MessageSquare className="h-5 w-5" />
                  </div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {conversationFilter === "unread" && "No unread conversations"}
                    {conversationFilter === "active" && "No active sessions yet"}
                    {conversationFilter === "pinned" && "No pinned conversations"}
                    {conversationFilter === "archived" && "No archived conversations"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {conversationFilter === "unread" && "New messages will show up here."}
                    {conversationFilter === "active" && "Students will appear here once connected."}
                    {conversationFilter === "pinned" && "Pin a conversation to keep it easy to find."}
                    {conversationFilter === "archived" && "Archived conversations can be restored anytime."}
                  </p>
                  {hasAnyRecentSupport && conversationFilter !== "active" && (
                    <div className="mt-4">
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-xl"
                        onClick={() => setConversationFilter("active")}
                      >
                        View active conversations
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="px-3 flex items-center justify-between">
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/70">Available Now</h3>
              {counselorTotalPages > 1 && (
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-6 w-6 rounded-lg" onClick={onPrevCounselorPage} disabled={counselorPage === 1} aria-label="Previous counselors page"><ChevronLeft className="h-3 w-3" /></Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6 rounded-lg" onClick={onNextCounselorPage} disabled={counselorPage === counselorTotalPages} aria-label="Next counselors page"><ChevronRight className="h-3 w-3" /></Button>
                </div>
              )}
            </div>

            <div className="space-y-2">
              {isCounselorsLoading ? (
                counselorSkeletons.map((item) => (
                  <div key={item} className="animate-pulse rounded-2xl border border-slate-200/70 bg-white/80 p-3 shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-slate-200/80" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3 w-2/3 rounded bg-slate-200/80" />
                        <div className="h-2 w-1/2 rounded bg-slate-200/70" />
                      </div>
                      <div className="h-8 w-8 rounded-full bg-slate-200/80" />
                    </div>
                  </div>
                ))
              ) : (
                filteredCounselors.map((counselor) => {
                  const name = counselor.profile?.full_name || "Counselor";
                  return (
                    <div key={counselor.id} className="group rounded-2xl border border-slate-200/70 bg-white/85 p-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-white relative z-0">
                      <div className="flex items-center gap-3">
                        <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 font-bold text-xs text-white ${getUserColor(name)}`}>
                          {getInitials(name)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold truncate text-sm">{name}</p>
                          <div className="flex items-center gap-1.5">
                            <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${counselor.is_online ? "bg-success animate-pulse" : "bg-muted"}`} />
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{counselor.is_online ? "Online" : "Offline"}</span>
                          </div>
                        </div>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-8 w-8 rounded-full bg-emerald-100/80 text-emerald-700 hover:bg-emerald-600 hover:text-white transition-all flex-shrink-0"
                          onClick={() => onStartSession(counselor.id, anonymousStartMode)}
                          aria-label={`Start session with ${counselor.profile?.full_name || "counselor"}`}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
              {!isCounselorsLoading && !hasAvailableCounselors && (
                <div className="rounded-2xl border border-dashed border-slate-300/70 bg-white/70 p-5 text-center text-xs text-muted-foreground">
                  No counselors found for this filter.
                </div>
              )}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
};
