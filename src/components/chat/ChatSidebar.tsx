import React, { useMemo } from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface ChatSidebarProps {
  sessions: Session[];
  activeSession: Session | null;
  counselors: any[];
  isCounselorsLoading: boolean;
  searchQuery: string;
  onSearchChange: (val: string) => void;
  onSelectSession: (id: string) => void;
  onStartSession: (id: number, isAnon: boolean) => void;
  anonymousStartMode: boolean;
  onToggleAnonymous: (val: boolean) => void;
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
  anonymousStartMode,
  onToggleAnonymous,
  counselorPage,
  counselorTotalPages,
  onNextCounselorPage,
  onPrevCounselorPage,
  sessionPage,
  sessionTotalPages,
  onNextSessionPage,
  onPrevSessionPage,
}) => {
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

  return (
    <div className="w-full lg:w-80 border-r border-border/50 flex flex-col h-full bg-background/50 backdrop-blur-xl">
      <div className="p-4 lg:p-6 space-y-6">
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
            className="pl-10 bg-secondary/30 border-none rounded-2xl h-11 focus-visible:ring-4 focus-visible:ring-primary/5 transition-all"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>

        <div className="flex items-center justify-between p-3 rounded-2xl bg-primary/5 border border-primary/10">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <Label htmlFor="anon-mode" className="text-xs font-bold uppercase tracking-wider cursor-pointer">Stay Anonymous</Label>
          </div>
          <Switch 
            id="anon-mode" 
            checked={anonymousStartMode} 
            onCheckedChange={onToggleAnonymous}
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
              {useMemo(() => {
                if (!sessions || sessions.length === 0) return [];

                // 1. Group sessions by counselor to identify multiple sessions
                const sessionsByCounselor: Record<string, Session[]> = {};
                sessions.forEach(s => {
                  const counselorId = s.counselor_id || s.peer_counselor_id || 0;
                  const counselorName = s.counselor?.profile?.full_name || s.peer_counselor?.profile?.full_name || "Counselor";
                  const groupKey = counselorId !== 0 ? String(counselorId) : counselorName;
                  
                  if (!sessionsByCounselor[groupKey]) sessionsByCounselor[groupKey] = [];
                  sessionsByCounselor[groupKey].push(s);
                });

                const finalSessionsList: (Session & { sessionLabel?: string })[] = [];

                Object.values(sessionsByCounselor).forEach(group => {
                  // Sort group by created_at ASC to identify duplicates and assign numbers
                  const sortedGroup = [...group].sort((a, b) => 
                    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
                  );

                  // Keep only the latest for each "logical conversation" (same role and anon status)
                  const seenLogicalKeys = new Set<string>();
                  const keptInGroup: Session[] = [];
                  
                  // Process from newest to oldest for deduplication
                  [...sortedGroup].reverse().forEach(s => {
                    const logicalKey = `${s.assigned_role}-${s.is_anonymous ? 'anon' : 'clear'}`;
                    if (!seenLogicalKeys.has(logicalKey)) {
                      seenLogicalKeys.add(logicalKey);
                      keptInGroup.push(s);
                    }
                  });

                  // If multiple sessions remain for this counselor, assign them labels
                  if (keptInGroup.length > 1) {
                    // Sort by original creation time again for stable numbering
                    const labeled = keptInGroup.sort((a, b) => 
                      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
                    );
                    labeled.forEach((s, idx) => {
                      finalSessionsList.push({ ...s, sessionLabel: `(Session ${idx + 1})` });
                    });
                  } else if (keptInGroup.length === 1) {
                    finalSessionsList.push(keptInGroup[0]);
                  }
                });

                // 2. Final sort by timestamp DESC (most recent first)
                return finalSessionsList.sort((a, b) => 
                  new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                );
              }, [sessions]).map((session) => {
                const name = session.counselor?.profile?.full_name || session.peer_counselor?.profile?.full_name || "Counselor";
                const isActive = activeSession?.id === session.id;
                const isPeer = session.assigned_role === "peer_counselor";

                return (
                  <button
                    key={session.id}
                    onClick={() => onSelectSession(String(session.id))}
                    className={`w-full flex items-center gap-3 p-3 rounded-[1.5rem] transition-all duration-300 group ${
                      isActive 
                        ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20 scale-[1.02]" 
                        : "hover:bg-secondary/50 text-foreground"
                    }`}
                  >
                    <div className={`h-11 w-11 rounded-2xl flex items-center justify-center shrink-0 font-bold text-sm shadow-inner ${
                      isActive ? "bg-white/20" : getUserColor(name) + " text-white"
                    }`}>
                      {getInitials(name)}
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <p className="font-bold truncate text-sm">
                        {name} {session.sessionLabel && <span className="text-[10px] font-normal text-muted-foreground/70 ml-1">{session.sessionLabel}</span>}
                      </p>
                      <p className={`text-[10px] uppercase font-black tracking-widest opacity-60 flex items-center gap-1`}>
                        {isPeer && <Users className="h-2.5 w-2.5" />}
                        {isPeer ? "Peer Support" : "Professional"}
                        {session.is_anonymous ? " • Anon" : ""}
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
                    <div key={counselor.id} className="p-3 rounded-[1.5rem] bg-secondary/20 border border-border/50 group hover:border-primary/20 transition-all duration-300">
                      <div className="flex items-center gap-3">
                        <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 font-bold text-xs text-white ${getUserColor(name)}`}>
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
