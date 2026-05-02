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
import { api } from "@/lib/api";
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
    } catch (triggerError: any) {
      console.error("Emergency alert error:", triggerError);
      toast.error(triggerError?.response?.data?.message || "Failed to send emergency alert. Please try again.");
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

        <main className="p-4 lg:p-6 max-w-6xl mx-auto h-[calc(100vh-80px)]">
          <Card className="h-full border-none shadow-2xl rounded-[2.5rem] overflow-hidden bg-background/40 backdrop-blur-md flex flex-col glass">
            <CardHeader className="border-b border-border/20 bg-card/30 backdrop-blur-xl py-6 px-8">
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-5">
                  <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-primary via-primary/80 to-info flex items-center justify-center shadow-2xl shadow-primary/30 animate-pulse-glow">
                    <Sparkles className="h-7 w-7 text-primary-foreground" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-display font-bold text-gradient leading-tight">AI Wellness Assistant</h2>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="h-2.5 w-2.5 rounded-full bg-success shadow-[0_0_10px_rgba(34,197,94,0.5)]" />
                      <p className="text-sm font-medium text-muted-foreground/80">Always here to listen & support you</p>
                    </div>
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="rounded-2xl hover:bg-primary/10 transition-colors" onClick={() => toast.info("Your conversation is private and encrypted.")}>
                  <Heart className="h-6 w-6 text-primary animate-pulse" />
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col p-0 min-h-0 bg-transparent">
              <ScrollArea className="flex-1 px-8 py-8 scrollbar-hide">
                <div className="space-y-8 max-w-4xl mx-auto pb-10">
                  {messages.length === 0 && !isLoading && (
                    <div className="flex flex-col items-center justify-center py-20 space-y-4 animate-fade-in">
                      <div className="p-4 rounded-3xl bg-primary/5">
                        <Bot className="h-12 w-12 text-primary/40" />
                      </div>
                      <div className="space-y-1 text-center">
                        <p className="text-lg font-semibold text-foreground/80">How can I help you today?</p>
                        <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                          Start a conversation or choose a topic below to explore wellness support.
                        </p>
                      </div>
                    </div>
                  )}
                  {messages.map((msg, idx) => (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"} animate-slide-up`}
                      style={{ animationDelay: `${idx * 0.05}s` }}
                    >
                      <div
                        className={`group relative max-w-[85%] sm:max-w-[75%] p-5 rounded-[2rem] transition-all duration-300 ${
                          msg.sender === "user"
                            ? "bg-primary text-primary-foreground rounded-br-none shadow-xl shadow-primary/20"
                            : "bg-secondary/40 backdrop-blur-sm text-foreground rounded-bl-none border border-border/10 shadow-sm"
                        }`}
                      >
                        <p className="text-[15px] sm:text-base leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                        <div className={`flex items-center gap-2 mt-3 opacity-0 group-hover:opacity-100 transition-opacity ${msg.sender === "user" ? "justify-end" : "justify-start"}`}>
                          <p className={`text-[10px] font-bold uppercase tracking-widest ${msg.sender === "user" ? "text-primary-foreground/50" : "text-muted-foreground/50"}`}>
                            {msg.time}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                  {isLoading && (
                    <div className="flex justify-start animate-fade-in">
                      <div className="bg-secondary/40 backdrop-blur-sm p-5 rounded-[2rem] rounded-bl-none border border-border/10">
                        <div className="flex gap-1.5">
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
              
              <div className="p-8 bg-card/20 backdrop-blur-2xl border-t border-border/10">
                <div className="max-w-4xl mx-auto space-y-6">
                  {supportSignal?.requiresImmediateHelp && (
                    <div className="rounded-3xl border border-destructive/20 bg-destructive/5 p-6 animate-pulse-glow">
                      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-destructive">
                            <AlertTriangle className="h-6 w-6" />
                            <p className="text-base font-bold uppercase tracking-tight">Immediate help recommended</p>
                          </div>
                          <p className="text-sm text-foreground/90 font-medium">
                            Please find a safe place or a trusted person. You can also alert our response team now.
                          </p>
                          {supportSignal.crisisHotline && (
                            <p className="text-xs font-semibold text-muted-foreground/70">
                              Direct Crisis Contact: {supportSignal.crisisHotline}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-3">
                          {supportSignal.showPanicButton && (
                            <Button
                              type="button"
                              variant="destructive"
                              className="rounded-2xl h-12 px-6 shadow-xl shadow-destructive/20 active:scale-95 transition-transform"
                              onClick={() => {
                                void handleTriggerEmergency();
                              }}
                              disabled={isTriggeringEmergency}
                            >
                              {isTriggeringEmergency ? "Sending Alert..." : "Send Emergency Alert"}
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="outline"
                            className="rounded-2xl h-12 px-6 gap-2 border-destructive/30 hover:bg-destructive/10 hover:text-destructive active:scale-95 transition-all"
                            onClick={handleCallHotline}
                          >
                            <Phone className="h-4 w-4" />
                            Call Support
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  <div className="flex flex-wrap gap-2.5">
                    {quickPrompts.map((prompt) => (
                      <Button
                        key={prompt}
                        variant="outline"
                        size="sm"
                        className="rounded-full bg-secondary/30 border-border/10 hover:bg-primary/20 hover:text-primary hover:border-primary/30 transition-all duration-300 px-5 h-9"
                        onClick={() => handleQuickPrompt(prompt)}
                        disabled={isLoading}
                      >
                        {prompt}
                      </Button>
                    ))}
                  </div>
                  
                  <form onSubmit={handleSendMessage} className="relative flex items-center gap-4">
                    <div className="relative flex-1 group">
                      <Input
                        placeholder="Type a message or share how you're feeling..."
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        className="h-16 pl-8 pr-20 rounded-[1.5rem] bg-secondary/40 border-border/10 focus-visible:ring-primary/20 text-base placeholder:text-muted-foreground/50 transition-all focus:bg-secondary/60"
                        disabled={isLoading}
                      />
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                        <Button 
                          type="submit" 
                          variant="hero" 
                          size="icon"
                          className="h-11 w-11 rounded-2xl bg-primary hover:bg-primary/90 shadow-xl shadow-primary/30 transition-all active:scale-90"
                          disabled={!message.trim() || isLoading}
                        >
                          {isLoading ? (
                            <Loader2 className="h-5 w-5 animate-spin" />
                          ) : (
                            <Send className="h-5 w-5" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </form>
                  <p className="text-[11px] font-medium text-center text-muted-foreground/60 max-w-lg mx-auto">
                    Mindful AU: Anonymous, secure AI support. Not a replacement for professional clinical help.
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
