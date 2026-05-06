import { useState, useEffect, useRef } from "react";
import {
  LayoutDashboard,
  MessageSquare,
  Calendar,
  Bot,
  Video,
  History,
  Heart,
  Send,
  Sparkles,
  Loader2,
  AlertTriangle,
  Phone,
  ClipboardCheck,
} from "lucide-react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/hooks/useAuth";
import { useAIChat } from "@/hooks/useAIChat";
import { api, getApiErrorMessage } from "@/lib/api";
import { toast } from "sonner";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/student/dashboard" },
  { label: "Chat", icon: MessageSquare, path: "/student/chat" },
  { label: "Appointments", icon: Calendar, path: "/student/appointments" },
  { label: "AI Support", icon: Bot, path: "/student/ai-support" },
  { label: "Video Call", icon: Video, path: "/student/video-call" },
  { label: "Past Sessions", icon: History, path: "/student/history" },
  { label: "Wellness", icon: Heart, path: "/student/wellness" },
  { label: "Assessment", icon: ClipboardCheck, path: "/student/diagnostic-assessment" },
];

const StudentAISupport = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [isTriggeringEmergency, setIsTriggeringEmergency] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split('@')[0] || "Student";

  const { messages, isLoading, error, supportSignal, sendMessage } = useAIChat();

  const quickPrompts = [
    "I'm feeling anxious",
    "Help me relax",
    "Breathing exercises",
    "Study tips",
  ];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    if (error) {
      toast.error(error);
    }
  }, [error]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || isLoading) return;
    
    const currentMessage = message;
    setMessage("");
    await sendMessage(currentMessage);
  };

  const handleQuickPrompt = async (prompt: string) => {
    if (isLoading) return;
    await sendMessage(prompt);
  };

  const handleTriggerEmergency = async () => {
    if (!user?.id || isTriggeringEmergency) {
      return;
    }

    setIsTriggeringEmergency(true);
    try {
      let location: string | undefined;

      if (navigator.geolocation) {
        try {
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
          });
          location = `${position.coords.latitude}, ${position.coords.longitude}`;
        } catch (geoError) {
          if (import.meta.env.DEV) {
            console.info("Could not get location:", geoError);
          }
        }
      }

      const response = await api.createPanicLog({ location });
      const recipientsNotified = Number(
        (response as { recipients_notified?: unknown })?.recipients_notified
      );
      const alertsEnabled = Boolean(
        (response as { alerts_enabled?: unknown })?.alerts_enabled ?? true
      );

      if (!alertsEnabled) {
        toast.warning(
          "Alert logged, but server-side panic alerts are disabled. Please call the hotline now."
        );
      } else if (Number.isFinite(recipientsNotified) && recipientsNotified === 0) {
        toast.warning(
          "Alert logged, but no on-call responders were reachable. Please call the hotline now."
        );
      } else if (Number.isFinite(recipientsNotified) && recipientsNotified > 0) {
        toast.success(
          `Emergency alert sent to ${recipientsNotified} responder${recipientsNotified === 1 ? "" : "s"}.`
        );
      } else {
        toast.success("Emergency alert sent. A counselor or responder will be notified.");
      }
    } catch (triggerError: unknown) {
      if (import.meta.env.DEV) {
        console.error("Emergency alert error:", triggerError);
      }
      toast.error(getApiErrorMessage(triggerError, "Failed to send emergency alert. Please try again."));
    } finally {
      setIsTriggeringEmergency(false);
    }
  };

  const handleCallHotline = () => {
    const hotline = supportSignal?.crisisHotline?.trim() || "";
    if (hotline === "") {
      toast.info("Contact your local emergency services, campus security, or a trusted counselor now.");
      return;
    }

    const dialTarget = hotline.replace(/[^\d+]/g, "");
    if (dialTarget !== "") {
      window.location.href = `tel:${dialTarget}`;
      return;
    }

    toast.info(`Crisis contact: ${hotline}`);
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
          title="AI Support"
          onMenuClick={() => setSidebarOpen(true)}
        />

        <main className="flex justify-center px-4 py-5 sm:px-8 sm:py-7 lg:px-12 lg:py-8">
          <Card className="flex h-[calc(100vh-120px)] w-full max-w-7xl flex-col border-none shadow-2xl shadow-primary/5 rounded-[1.75rem] overflow-hidden bg-background">
            <CardHeader className="border-b border-border/50 bg-secondary/5 px-6 py-5 sm:px-8 sm:py-6">
              <CardTitle className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="h-12 w-12 shrink-0 rounded-2xl bg-gradient-to-br from-primary to-info flex items-center justify-center shadow-lg shadow-primary/20">
                    <Sparkles className="h-6 w-6 text-primary-foreground" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-xl font-bold text-foreground tracking-tight">AI Wellness Assistant</h2>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-success animate-pulse" />
                      <p className="text-sm font-medium text-muted-foreground">Always here for you</p>
                    </div>
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="rounded-full shrink-0" onClick={() => toast.info("Your conversation is private and handled securely.")}>
                  <Heart className="h-5 w-5 text-primary" />
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col p-0">
              <ScrollArea className="flex-1 min-h-0 px-5 py-7 sm:px-8 sm:py-9">
                <div className="mx-auto w-full max-w-6xl space-y-8">
                  {messages.length === 0 && !isLoading && (
                    <div className="rounded-2xl border border-dashed border-border/70 bg-secondary/20 px-6 py-10 text-center text-sm text-muted-foreground leading-relaxed">
                      No conversation yet. Send a message to start live AI support.
                    </div>
                  )}
                  {messages.map((msg) =>
                    msg.sender === "user" ? (
                      <div key={msg.id} className="flex w-full justify-end">
                        <div className="flex w-full max-w-[min(80%,32rem)] flex-col items-end gap-1.5 sm:max-w-[min(76%,38rem)]">
                          <span className="text-[11px] font-medium text-muted-foreground pr-0.5">You</span>
                          <div className="group relative w-full break-words rounded-[1.25rem] bg-primary px-5 py-4 text-primary-foreground shadow-lg shadow-primary/10 transition-all duration-300 sm:px-5 sm:py-4">
                            <p className="text-base leading-7 whitespace-pre-wrap sm:text-[1.05rem]">{msg.content}</p>
                            <p className="mt-2 text-[10px] font-medium uppercase tracking-wider text-primary-foreground/60 opacity-0 transition-opacity group-hover:opacity-100">
                              {msg.time}
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div key={msg.id} className="flex w-full justify-start gap-3 sm:gap-3.5">
                        <div
                          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-info text-primary-foreground shadow-md shadow-primary/15 sm:h-10 sm:w-10"
                          aria-hidden
                        >
                          <Sparkles className="h-4 w-4 sm:h-[1.125rem] sm:w-[1.125rem]" />
                        </div>
                        <div className="min-w-0 flex-1 max-w-[min(92%,48rem)] lg:max-w-[min(90%,56rem)]">
                          <div className="group relative break-words rounded-[1.25rem] border border-border/50 bg-secondary/50 px-5 py-4 text-foreground transition-all duration-300 sm:px-[1.125rem] sm:py-[1.125rem]">
                            <p className="text-base leading-7 whitespace-pre-wrap sm:text-[1.05rem]">{msg.content}</p>
                            <p className="mt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                              {msg.time}
                            </p>
                          </div>
                        </div>
                      </div>
                    )
                  )}
                  {isLoading && (
                    <div className="flex justify-start gap-3 sm:gap-3.5">
                      <div
                        className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-info text-primary-foreground opacity-80 sm:h-10 sm:w-10"
                        aria-hidden
                      >
                        <Sparkles className="h-4 w-4" />
                      </div>
                      <div className="rounded-[1.25rem] border border-border/50 bg-secondary/50 px-5 py-4">
                        <div className="flex gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="h-2 w-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: "150ms" }} />
                          <span className="h-2 w-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={scrollRef} className="h-2 shrink-0" />
                </div>
              </ScrollArea>

              <div className="border-t border-border/50 bg-background px-5 py-6 sm:px-8 sm:py-7">
                <div className="mx-auto w-full max-w-6xl space-y-5">
                  {supportSignal?.requiresImmediateHelp && (
                    <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4 sm:p-5">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-destructive">
                            <AlertTriangle className="h-5 w-5" />
                            <p className="text-sm font-semibold">Immediate help recommended</p>
                          </div>
                          <p className="text-sm text-foreground">
                            Move toward another person or a safer place now. Use the emergency alert if you need a counselor response quickly.
                          </p>
                          {supportSignal.crisisHotline && (
                            <p className="text-xs text-muted-foreground">
                              Crisis contact: {supportSignal.crisisHotline}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {supportSignal.showPanicButton && (
                            <Button
                              type="button"
                              variant="destructive"
                              onClick={() => {
                                void handleTriggerEmergency();
                              }}
                              disabled={isTriggeringEmergency}
                            >
                              {isTriggeringEmergency ? "Alerting..." : "Send emergency alert"}
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="outline"
                            className="gap-2"
                            onClick={handleCallHotline}
                          >
                            <Phone className="h-4 w-4" />
                            Call now
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap justify-center gap-2.5 sm:justify-start sm:gap-3">
                    {quickPrompts.map((prompt) => (
                      <Button
                        key={prompt}
                        variant="outline"
                        size="sm"
                        className="rounded-full border border-border/40 bg-background/80 px-4 py-2 h-auto min-h-9 text-sm shadow-none hover:bg-primary/10 hover:text-primary transition-all duration-300"
                        onClick={() => handleQuickPrompt(prompt)}
                        disabled={isLoading}
                      >
                        {prompt}
                      </Button>
                    ))}
                  </div>
                  <form onSubmit={handleSendMessage} className="relative flex items-center gap-2 pt-1">
                    <Input
                      placeholder="Share what's on your mind..."
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      className="h-[3.25rem] pl-6 pr-16 rounded-full bg-secondary/30 border border-border/30 focus-visible:ring-primary/20 text-base shadow-sm"
                      disabled={isLoading}
                    />
                    <Button 
                      type="submit" 
                      variant="hero" 
                      size="icon"
                      className="absolute right-1.5 h-11 w-11 rounded-full bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all active:scale-95"
                      disabled={!message.trim() || isLoading}
                    >
                      {isLoading ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Send className="h-5 w-5" />
                      )}
                    </Button>
                  </form>
                  <p className="text-center text-xs leading-relaxed text-muted-foreground pt-1 pb-0.5">
                    I'm here to listen. Remember, I'm an AI assistant and not a replacement for professional clinical help.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default StudentAISupport;
