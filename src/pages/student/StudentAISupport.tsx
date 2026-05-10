import { useState, useEffect, useRef, useMemo } from "react";
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
  Wind,
  Moon,
  Brain,
  Coffee,
  Shield,
  Lock,
  Zap,
  MessageCircle,
  Mic,
  Smile,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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

// Premium quick action chips with icons
const quickActions = [
  { icon: Brain, label: "Anxiety Support", prompt: "I'm feeling anxious", gradient: "from-violet-500/20 to-purple-500/20" },
  { icon: Wind, label: "Breathing", prompt: "Guide me through a breathing exercise", gradient: "from-cyan-500/20 to-blue-500/20" },
  { icon: Moon, label: "Sleep Help", prompt: "Help me relax before sleep", gradient: "from-indigo-500/20 to-violet-500/20" },
  { icon: Coffee, label: "Study Stress", prompt: "I'm stressed about studying", gradient: "from-amber-500/20 to-orange-500/20" },
  { icon: Heart, label: "Self-Care", prompt: "I need some self-care tips", gradient: "from-rose-500/20 to-pink-500/20" },
  { icon: MessageCircle, label: "Talk Freely", prompt: "I just want to talk", gradient: "from-emerald-500/20 to-teal-500/20" },
];

// Animated background gradient component
const AnimatedBackground = () => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none">
    <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-to-br from-primary/5 via-transparent to-transparent rounded-full blur-3xl animate-pulse" style={{ animationDuration: '8s' }} />
    <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-to-tl from-rose-500/5 via-transparent to-transparent rounded-full blur-3xl animate-pulse" style={{ animationDuration: '10s', animationDelay: '2s' }} />
  </div>
);

// AI Avatar with animated glow
const AIAvatar = ({ isThinking }: { isThinking?: boolean }) => (
  <div className="relative">
    <div className={cn(
      "absolute inset-0 rounded-2xl bg-gradient-to-br from-primary to-rose-500 blur-xl transition-opacity duration-500",
      isThinking ? "opacity-40 animate-pulse" : "opacity-20"
    )} />
    <motion.div
      className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary via-primary to-rose-500 shadow-lg"
      animate={isThinking ? { scale: [1, 1.05, 1] } : {}}
      transition={{ duration: 1.5, repeat: isThinking ? Infinity : 0 }}
    >
      <Sparkles className="h-6 w-6 text-white" />
    </motion.div>
  </div>
);

// Typing indicator with smooth animation
const TypingIndicator = () => (
  <div className="flex items-center gap-1.5 px-2 py-3">
    {[0, 1, 2].map((i) => (
      <motion.div
        key={i}
        className="h-2 w-2 rounded-full bg-primary/60"
        animate={{ y: [-2, 2, -2], opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15 }}
      />
    ))}
  </div>
);

// Message bubble components
const UserMessage = ({ content, time }: { content: string; time: string }) => (
  <motion.div
    initial={{ opacity: 0, y: 10, scale: 0.95 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    transition={{ duration: 0.3, ease: "easeOut" }}
    className="flex justify-end"
  >
    <div className="max-w-[85%] sm:max-w-[75%]">
      <div className="relative overflow-hidden rounded-[1.5rem] bg-gradient-to-br from-primary to-primary/90 px-5 py-3.5 shadow-lg shadow-primary/20">
        <div className="absolute inset-0 bg-gradient-to-t from-white/10 to-transparent pointer-events-none" />
        <p className="relative text-[15px] leading-relaxed text-white whitespace-pre-wrap">{content}</p>
      </div>
      <p className="mt-1.5 text-[10px] text-muted-foreground/70 text-right pr-1">{time}</p>
    </div>
  </motion.div>
);

const AIMessage = ({ content, time, isThinking }: { content: string; time: string; isThinking?: boolean }) => (
  <motion.div
    initial={{ opacity: 0, y: 10, scale: 0.98 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    transition={{ duration: 0.3, ease: "easeOut" }}
    className="flex gap-3"
  >
    <AIAvatar isThinking={isThinking} />
    <div className="max-w-[85%] sm:max-w-[75%] min-w-0">
      <div className="relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-gradient-to-br from-white/[0.08] to-white/[0.03] backdrop-blur-sm px-5 py-3.5 shadow-lg shadow-black/10">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-rose-500/5 pointer-events-none" />
        <p className="relative text-[15px] leading-relaxed text-foreground whitespace-pre-wrap">{content}</p>
      </div>
      <p className="mt-1.5 text-[10px] text-muted-foreground/70 pl-1">{time}</p>
    </div>
  </motion.div>
);

// Quick action chip component
const QuickActionChip = ({ action, onClick, disabled }: { action: typeof quickActions[0]; onClick: () => void; disabled: boolean }) => {
  const Icon = action.icon;
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      whileHover={{ scale: 1.02, y: -2 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        "group relative flex items-center gap-2.5 px-4 py-2.5 rounded-full",
        "border border-white/10 bg-gradient-to-br backdrop-blur-sm",
        "hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10",
        "transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed",
        action.gradient
      )}
    >
      <Icon className="h-4 w-4 text-foreground/80 group-hover:text-primary transition-colors" />
      <span className="text-sm font-medium text-foreground/90 group-hover:text-foreground transition-colors">{action.label}</span>
    </motion.button>
  );
};

const StudentAISupport = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [isTriggeringEmergency, setIsTriggeringEmergency] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split('@')[0] || "Student";

  const { messages, isLoading, error, supportSignal, sendMessage } = useAIChat();

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
    <div className="min-h-screen bg-background relative overflow-hidden">
      <AnimatedBackground />
      <DashboardSidebar
        items={navItems}
        userType="student"
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-72 relative z-10">
        <DashboardHeader
          title="AI Support"
          onMenuClick={() => setSidebarOpen(true)}
        />

        <main className="flex flex-col h-[calc(100vh-64px)] p-4 sm:p-6 lg:p-8">
          <div className="flex flex-1 min-h-0 rounded-[2rem] border border-white/10 bg-gradient-to-br from-black/40 to-black/20 backdrop-blur-xl shadow-2xl overflow-hidden">
            {/* AI Header - Compact & Premium */}
            <div className="flex-shrink-0 border-b border-white/5 bg-gradient-to-r from-primary/5 via-transparent to-rose-500/5 px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <AIAvatar isThinking={isLoading} />
                  <div>
                    <h1 className="text-lg font-semibold text-foreground tracking-tight">AI Wellness Assistant</h1>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                      </span>
                      <span className="text-xs text-muted-foreground">Always here for you</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
                    <Lock className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Private</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full h-9 w-9 hover:bg-white/10"
                    onClick={() => toast.info("Your conversation is private and handled securely.")}
                  >
                    <Heart className="h-4 w-4 text-primary" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 min-h-0 overflow-y-auto" ref={messagesContainerRef}>
              <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
                <AnimatePresence mode="popLayout">
                  {messages.length === 0 && !isLoading && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-center py-12"
                    >
                      <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-rose-500/20 mb-6">
                        <Sparkles className="h-8 w-8 text-primary" />
                      </div>
                      <h2 className="text-xl font-semibold text-foreground mb-2">Welcome to your safe space</h2>
                      <p className="text-muted-foreground max-w-md mx-auto">
                        I'm here to listen and support you. Share what's on your mind, or choose a topic below to get started.
                      </p>
                    </motion.div>
                  )}
                  
                  {messages.map((msg) =>
                    msg.sender === "user" ? (
                      <UserMessage key={msg.id} content={msg.content} time={msg.time} />
                    ) : (
                      <AIMessage key={msg.id} content={msg.content} time={msg.time} />
                    )
                  )}
                  
                  {isLoading && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex gap-3"
                    >
                      <AIAvatar isThinking />
                      <div className="rounded-[1.5rem] border border-white/10 bg-gradient-to-br from-white/[0.08] to-white/[0.03] backdrop-blur-sm px-5 py-4">
                        <TypingIndicator />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <div ref={scrollRef} />
              </div>
            </div>

            {/* Input Area - Floating Premium Design */}
            <div className="flex-shrink-0 border-t border-white/5 bg-gradient-to-t from-black/60 to-transparent p-4 sm:p-6">
              <div className="max-w-4xl mx-auto space-y-4">
                {/* Crisis Alert */}
                <AnimatePresence>
                  {supportSignal?.requiresImmediateHelp && (
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.95 }}
                      className="rounded-2xl border border-destructive/30 bg-gradient-to-br from-destructive/10 to-destructive/5 p-4"
                    >
                      <div className="flex flex-col sm:flex-row gap-4">
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-destructive/20 flex items-center justify-center">
                            <AlertTriangle className="h-5 w-5 text-destructive" />
                          </div>
                          <div>
                            <p className="font-semibold text-destructive text-sm">Immediate help recommended</p>
                            <p className="text-sm text-foreground/80 mt-1">
                              Move toward another person or a safer place now. Use the emergency alert if you need a counselor response quickly.
                            </p>
                            {supportSignal.crisisHotline && (
                              <p className="text-xs text-muted-foreground mt-2">Crisis contact: {supportSignal.crisisHotline}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 sm:flex-col">
                          {supportSignal.showPanicButton && (
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={() => void handleTriggerEmergency()}
                              disabled={isTriggeringEmergency}
                              className="gap-2"
                            >
                              {isTriggeringEmergency ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                              {isTriggeringEmergency ? "Alerting..." : "Emergency Alert"}
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleCallHotline}
                            className="gap-2"
                          >
                            <Phone className="h-4 w-4" />
                            Call Now
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Quick Action Chips */}
                <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
                  {quickActions.map((action) => (
                    <QuickActionChip
                      key={action.label}
                      action={action}
                      onClick={() => void handleQuickPrompt(action.prompt)}
                      disabled={isLoading}
                    />
                  ))}
                </div>

                {/* Premium Input */}
                <form onSubmit={handleSendMessage}>
                  <div className={cn(
                    "relative flex items-center rounded-2xl border transition-all duration-300",
                    "bg-gradient-to-br from-white/[0.08] to-white/[0.03] backdrop-blur-sm",
                    isFocused 
                      ? "border-primary/40 shadow-lg shadow-primary/10" 
                      : "border-white/10 hover:border-white/20"
                  )}>
                    <input
                      type="text"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      onFocus={() => setIsFocused(true)}
                      onBlur={() => setIsFocused(false)}
                      placeholder="Share what's on your mind..."
                      disabled={isLoading}
                      className="flex-1 bg-transparent px-5 py-4 text-[15px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none disabled:opacity-50"
                    />
                    <div className="flex items-center gap-2 pr-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 rounded-xl hover:bg-white/10 text-muted-foreground hover:text-foreground"
                        onClick={() => toast.info("Voice input coming soon!")}
                      >
                        <Mic className="h-5 w-5" />
                      </Button>
                      <Button
                        type="submit"
                        size="icon"
                        disabled={!message.trim() || isLoading}
                        className={cn(
                          "h-10 w-10 rounded-xl transition-all duration-300",
                          "bg-gradient-to-br from-primary to-primary/90",
                          "hover:shadow-lg hover:shadow-primary/30",
                          "disabled:opacity-50 disabled:cursor-not-allowed"
                        )}
                      >
                        {isLoading ? (
                          <Loader2 className="h-5 w-5 animate-spin text-white" />
                        ) : (
                          <Send className="h-5 w-5 text-white" />
                        )}
                      </Button>
                    </div>
                  </div>
                </form>

                {/* Footer */}
                <p className="text-center text-[11px] text-muted-foreground/60 leading-relaxed">
                  I'm here to listen and support you. Remember, I'm an AI assistant and not a replacement for professional clinical help.
                </p>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default StudentAISupport;
