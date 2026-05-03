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
          console.log("Could not get location:", geoError);
        }
      }

      await api.createPanicLog({ location });
      toast.success("Emergency alert sent. A counselor or responder will be notified.");
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

        <main className="p-4 lg:p-6">
          <Card className="h-[calc(100vh-140px)] border-none shadow-2xl shadow-primary/5 rounded-[2rem] overflow-hidden bg-background">
            <CardHeader className="border-b border-border/50 bg-secondary/5 py-6">
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary to-info flex items-center justify-center shadow-lg shadow-primary/20">
                    <Sparkles className="h-6 w-6 text-primary-foreground" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-foreground">AI Wellness Assistant</h2>
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
                      <p className="text-sm font-medium text-muted-foreground">Always here for you</p>
                    </div>
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="rounded-full" onClick={() => toast.info("Your conversation is private and encrypted.")}>
                  <Heart className="h-5 w-5 text-primary" />
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col h-[calc(100%-90px)] p-0">
              <ScrollArea className="flex-1 px-8 py-8">
                <div className="space-y-6 max-w-6xl mx-auto">
                  {messages.length === 0 && !isLoading && (
                    <div className="p-5 rounded-2xl border border-dashed border-border/70 bg-secondary/20 text-center text-sm text-muted-foreground">
                      No conversation yet. Send a message to start live AI support.
                    </div>
                  )}
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`group relative max-w-[90%] sm:max-w-[85%] p-5 rounded-[1.5rem] transition-all duration-300 ${
                          msg.sender === "user"
                            ? "bg-primary text-primary-foreground rounded-br-none shadow-lg shadow-primary/10"
                            : "bg-secondary/50 text-foreground rounded-bl-none border border-border/50"
                        }`}
                      >
                        <p className="text-lg leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                        <div className={`flex items-center gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity ${msg.sender === "user" ? "justify-end" : "justify-start"}`}>
                          <p className={`text-[10px] font-medium uppercase tracking-wider ${msg.sender === "user" ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                            {msg.time}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                  {isLoading && (
                    <div className="flex justify-start">
                      <div className="bg-secondary/50 p-4 rounded-[1.5rem] rounded-bl-none border border-border/50">
                        <div className="flex gap-1">
                          <span className="h-2 w-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="h-2 w-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="h-2 w-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={scrollRef} />
                </div>
              </ScrollArea>
              
              <div className="p-8 bg-background border-t border-border/50">
                <div className="max-w-6xl mx-auto space-y-6">
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
                  <div className="flex flex-wrap gap-2">
                    {quickPrompts.map((prompt) => (
                      <Button
                        key={prompt}
                        variant="outline"
                        size="sm"
                        className="rounded-full bg-secondary/30 border-none hover:bg-primary/10 hover:text-primary transition-all duration-300"
                        onClick={() => handleQuickPrompt(prompt)}
                        disabled={isLoading}
                      >
                        {prompt}
                      </Button>
                    ))}
                  </div>
                  <form onSubmit={handleSendMessage} className="relative flex items-center gap-2">
                    <Input
                      placeholder="Share what's on your mind..."
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      className="h-14 pl-6 pr-16 rounded-2xl bg-secondary/30 border-none focus-visible:ring-primary/20 text-base"
                      disabled={isLoading}
                    />
                    <Button 
                      type="submit" 
                      variant="hero" 
                      size="icon"
                      className="absolute right-2 h-10 w-10 rounded-xl bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all active:scale-95"
                      disabled={!message.trim() || isLoading}
                    >
                      {isLoading ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Send className="h-5 w-5" />
                      )}
                    </Button>
                  </form>
                  <p className="text-[10px] text-center text-muted-foreground">
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
