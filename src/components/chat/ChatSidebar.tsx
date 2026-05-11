import React, { useMemo, useRef } from "react";
import { Session } from "@/hooks/useChatSession";
import { 
  Search, 
  MessageSquare, 
  Users, 
  Shield, 
  Loader2, 
  ChevronLeft, 
  ChevronRight,
  MoreVertical,
  Plus
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
  onSelectSession: (id: string) => void;
  onStartSession: (id: number, isAnon: boolean) => void;
  /**
   * Optional callback fired when a Recent Support row is clicked while its
   * latest session is anonymous. Should ALWAYS open a brand-new anonymous
   * chat session with the same counselor (do not resume the old one).
   */
  onStartFreshAnonymousSession?: (counselorId: number) => void;
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
  onStartFreshAnonymousSession,
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
}) => {
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleRowMouseEnter = (sessionId: string) => {
    console.log('[preload] hover start - sessionId:', sessionId);
    const userId = activeSession?.student_id?.toString() || activeSession?.counselor_id?.toString();
    if (!userId) return;

    hoverTimerRef.current = setTimeout(async () => {
      console.log('[preload] timer fired - checking cache for:', sessionId);
      const existing = await loadPreloadedSessionMessages(sessionId, {
        expectedOwnerUserId: userId,
      });
      if (!existing || existing.length === 0) {
        const rawMessages = await api.getMessages(sessionId, {
          limit: 40,
          mark_read: false,
          timeout_ms: 5000,
        }).catch((err) => {
          console.log('[preload] fetch failed for:', sessionId, err);
          return null;
        });
        if (rawMessages?.length) {
          console.log('[preload] saved to cache:', sessionId, 'messages:', rawMessages.length);
          await savePreloadedSessionMessages(sessionId, rawMessages, {
            ownerUserId: userId,
          });
        }
      } else {
        console.log('[preload] cache hit - skipping fetch for:', sessionId, 'messages:', existing.length);
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

  // Deduplicate "Recent Support" so each counselor (regardless of whether
  // they engaged as a professional counselor or peer counselor, or whether
  // some sessions were anonymous) appears exactly once. The displayed row
  // reflects that counselor's MOST RECENT session, and the "(Session N)"
  // label reflects the total number of sessions the user has had with them.
  const recentSupportRows = useMemo(() => {
    if (!sessions || sessions.length === 0) return [];

    type GroupRow = {
      counselorId: number;
      counselorName: string;
      sessions: Session[];
      latest: Session;
    };

    const groups = new Map<string, GroupRow>();

    for (const session of sessions) {
      const counselorId = Number(session.counselor_id || session.peer_counselor_id || 0);
      const counselorName =
        session.counselor?.profile?.full_name ||
        session.peer_counselor?.profile?.full_name ||
        "Counselor";
      const groupKey = counselorId !== 0 ? `id:${counselorId}` : `name:${counselorName}`;

      const existing = groups.get(groupKey);
      if (!existing) {
        groups.set(groupKey, {
          counselorId,
          counselorName,
          sessions: [session],
          latest: session,
        });
        continue;
      }

      existing.sessions.push(session);
      const currentLatestTime = new Date(existing.latest.created_at).getTime();
      const candidateTime = new Date(session.created_at).getTime();
      if (Number.isFinite(candidateTime) && candidateTime > currentLatestTime) {
        existing.latest = session;
      }
    }

    const rows = Array.from(groups.values()).map((group) => ({
      counselorId: group.counselorId,
      session: group.latest,
      totalSessions: group.sessions.length,
    }));

    // Most recently active counselors first.
    rows.sort(
      (a, b) =>
        new Date(b.session.created_at).getTime() -
        new Date(a.session.created_at).getTime()
    );

    return rows;
  }, [sessions]);

  return (
    <div className="flex h-full w-full flex-col border-r border-border/50 bg-background">
      <div className="space-y-5 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-display font-bold tracking-tight">Conversations</h2>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="More options">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </div>

        <div className="relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
          <Input 
            placeholder="Search counselors..." 
            className="h-11 rounded-2xl border-border/60 bg-secondary/20 pl-10 focus-visible:ring-2 focus-visible:ring-primary/10"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>

        <div
          className={cn(
            "flex items-center justify-between rounded-2xl border p-3 transition-colors",
            anonymousStartMode
              ? "border-red-600 bg-black text-white shadow-[inset_0_0_0_1px_rgba(220,38,38,0.35)]"
              : "border-primary/10 bg-primary/5"
          )}
        >
          <div className="flex items-center gap-2">
            <Shield className={cn("h-4 w-4 shrink-0", anonymousStartMode ? "text-red-500" : "text-primary")} />
            <Label
              htmlFor="anon-mode"
              className={cn(
                "cursor-pointer text-xs font-bold uppercase tracking-wider",
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
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-3 pb-6 space-y-8">
          <div className="space-y-2">
            <div className="px-3 flex items-center justify-between">
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60">Recent Support</h3>
              {sessionTotalPages > 1 && (
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onPrevSessionPage} disabled={sessionPage === 1} aria-label="Previous sessions page"><ChevronLeft className="h-3 w-3" /></Button>
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onNextSessionPage} disabled={sessionPage === sessionTotalPages} aria-label="Next sessions page"><ChevronRight className="h-3 w-3" /></Button>
                </div>
              )}
            </div>
            
            <div className="space-y-1">
              {recentSupportRows.map(({ session, totalSessions, counselorId }) => {
                const name =
                  session.counselor?.profile?.full_name ||
                  session.peer_counselor?.profile?.full_name ||
                  "Counselor";
                const isActive = activeSession?.id === session.id;
                const isPeer = session.assigned_role === "peer_counselor";
                const isAnon = isAnonymousSessionFlag(session.is_anonymous);

                const handleRowClick = () => {
                  // Anonymous rows must always open a brand-new chat session so
                  // an old anonymous thread is never silently resumed (which
                  // would re-link the student's previous anonymous identity to
                  // the counselor for a longer window than expected).
                  if (isAnon && counselorId > 0 && onStartFreshAnonymousSession) {
                    onStartFreshAnonymousSession(counselorId);
                    return;
                  }
                  if (isAnon && counselorId > 0) {
                    // Fallback: if the parent didn't supply a fresh-start
                    // callback, still avoid resuming the existing anonymous
                    // thread by going through the regular start flow with
                    // anonymity flagged on.
                    onStartSession(counselorId, true);
                    return;
                  }
                  onSelectSession(String(session.id));
                };

                return (
                  <button
                    key={`recent-${counselorId || session.id}`}
                    onClick={handleRowClick}
                    onMouseEnter={() => handleRowMouseEnter(String(session.id))}
                    onMouseLeave={handleRowMouseLeave}
                    className={`w-full flex items-center gap-3 p-3 rounded-2xl transition-colors group ${
                      isActive
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "hover:bg-secondary/50 text-foreground"
                    }`}
                  >
                    <div className={`h-11 w-11 rounded-full flex items-center justify-center shrink-0 font-bold text-sm shadow-sm ${
                      isActive ? "bg-white/20" : getUserColor(name) + " text-white"
                    }`}>
                      {getInitials(name)}
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <p className="font-bold truncate text-sm">
                        {name}
                        <span className="text-[10px] font-normal text-muted-foreground/70 ml-1">
                          (Session {totalSessions})
                        </span>
                      </p>
                      <p className="text-[10px] uppercase font-black tracking-widest opacity-60 flex items-center gap-1">
                        {isPeer && <Users className="h-2.5 w-2.5" />}
                        {isPeer ? "Peer Support" : "Professional"}
                        {isAnon ? " \u2022 Anon" : ""}
                      </p>
                    </div>
                  </button>
                );
              })}
              {sessions.length === 0 && (
                <div className="p-8 text-center space-y-2">
                  <MessageSquare className="h-8 w-8 text-muted-foreground/20 mx-auto" />
                  <p className="text-xs font-medium text-muted-foreground">No sessions yet</p>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="px-3 flex items-center justify-between">
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60">Available Now</h3>
              {counselorTotalPages > 1 && (
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onPrevCounselorPage} disabled={counselorPage === 1} aria-label="Previous counselors page"><ChevronLeft className="h-3 w-3" /></Button>
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onNextCounselorPage} disabled={counselorPage === counselorTotalPages} aria-label="Next counselors page"><ChevronRight className="h-3 w-3" /></Button>
                </div>
              )}
            </div>

            <div className="space-y-2">
              {isCounselorsLoading ? (
                <div className="flex flex-col items-center py-8 gap-3">
                  <Loader2 className="h-6 w-6 animate-spin text-primary/40" />
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Finding counselors...</p>
                </div>
              ) : (
                counselors.map((counselor) => {
                  const name = counselor.profile?.full_name || "Counselor";
                  return (
                    <div key={counselor.id} className="rounded-2xl border border-border/50 bg-secondary/20 p-3 transition-colors group hover:border-primary/20">
                      <div className="flex items-center gap-3">
                        <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 font-bold text-xs text-white ${getUserColor(name)}`}>
                          {getInitials(name)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold truncate text-sm">{name}</p>
                          <div className="flex items-center gap-1.5">
                            <span className={`h-1.5 w-1.5 rounded-full ${counselor.is_online ? "bg-success animate-pulse" : "bg-muted"}`} />
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{counselor.is_online ? "Online" : "Offline"}</span>
                          </div>
                        </div>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-8 w-8 rounded-full bg-primary/5 text-primary hover:bg-primary hover:text-white transition-all"
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
              {!isCounselorsLoading && counselors.length === 0 && (
                <p className="text-center text-xs text-muted-foreground py-8">No counselors found</p>
              )}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
};
