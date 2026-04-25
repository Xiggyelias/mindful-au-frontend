import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Loader2, LogOut, Monitor, ShieldCheck, Trash2 } from "lucide-react";
import { AuthDeviceSession, api, getApiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";

const formatSessionTime = (value?: string | null) => {
  if (!value) {
    return "Unknown";
  }

  try {
    return formatDistanceToNow(new Date(value), { addSuffix: true });
  } catch {
    return "Unknown";
  }
};

export const SessionManagerDialog = () => {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<AuthDeviceSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [busySessionId, setBusySessionId] = useState<number | null>(null);
  const [isLoggingOutOthers, setIsLoggingOutOthers] = useState(false);

  const loadSessions = async () => {
    try {
      setIsLoading(true);
      const next = await api.getAuthSessions();
      setSessions(next);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to load active sessions."));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      void loadSessions();
    }
  }, [open]);

  const handleRevoke = async (sessionId: number) => {
    try {
      setBusySessionId(sessionId);
      const next = await api.revokeAuthSession(sessionId);
      setSessions(next);
      toast.success("Session revoked.");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to revoke the selected session."));
    } finally {
      setBusySessionId(null);
    }
  };

  const handleLogoutOthers = async () => {
    try {
      setIsLoggingOutOthers(true);
      const next = await api.logoutOtherAuthSessions();
      setSessions(next);
      toast.success("Other devices were logged out.");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to log out other devices."));
    } finally {
      setIsLoggingOutOthers(false);
    }
  };

  const otherSessionCount = sessions.filter((session) => !session.is_current).length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Manage device sessions">
          <ShieldCheck className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Active Sessions</DialogTitle>
          <DialogDescription>
            Review signed-in devices, revoke old sessions, or log out every other device.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {sessions.length} active session{sessions.length === 1 ? "" : "s"} detected.
          </p>
          <Button
            variant="outline"
            onClick={() => void handleLogoutOthers()}
            disabled={isLoading || isLoggingOutOthers || otherSessionCount === 0}
          >
            {isLoggingOutOthers ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <LogOut className="mr-2 h-4 w-4" />
            )}
            Log Out Other Devices
          </Button>
        </div>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-3">
            {isLoading ? (
              <div className="rounded-2xl border border-dashed border-border/70 bg-secondary/20 px-4 py-8 text-center text-sm text-muted-foreground">
                <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
                Loading sessions...
              </div>
            ) : sessions.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/70 bg-secondary/20 px-4 py-8 text-center text-sm text-muted-foreground">
                No active sessions found.
              </div>
            ) : (
              sessions.map((session) => (
                <div
                  key={session.id}
                  className="rounded-2xl border border-border/60 bg-background p-4 shadow-sm"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-2">
                          <div className="rounded-xl bg-primary/10 p-2 text-primary">
                            <Monitor className="h-4 w-4" />
                          </div>
                          <p className="font-medium text-foreground">{session.device_name || "Browser session"}</p>
                        </div>
                        {session.is_current ? <Badge>Current</Badge> : null}
                        {session.two_factor_verified ? <Badge variant="outline">2FA verified</Badge> : null}
                      </div>
                      <div className="grid gap-1 text-sm text-muted-foreground">
                        <p>Last activity: {formatSessionTime(session.last_activity_at || session.last_used_at)}</p>
                        <p>Signed in: {formatSessionTime(session.created_at)}</p>
                        <p>IP address: {session.ip_address || "Unavailable"}</p>
                        {session.expires_at ? <p>Expires: {formatSessionTime(session.expires_at)}</p> : null}
                      </div>
                    </div>

                    {!session.is_current ? (
                      <Button
                        variant="ghost"
                        className="justify-start text-destructive hover:text-destructive"
                        onClick={() => void handleRevoke(session.id)}
                        disabled={busySessionId === session.id}
                      >
                        {busySessionId === session.id ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="mr-2 h-4 w-4" />
                        )}
                        Revoke
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};
