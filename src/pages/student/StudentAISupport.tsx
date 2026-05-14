import { useState, useEffect, useRef, memo, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard, MessageSquare, Calendar, Bot, Video, History, Heart,
  Send, Sparkles, Loader2, AlertTriangle, Phone, ClipboardCheck,
  Wind, Moon, Brain, Zap, MessageCircle, Mic,
  Activity, Waves, Flame, Lock, ChevronDown,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useAIChat } from "@/hooks/useAIChat";
import { api, getApiErrorMessage } from "@/lib/api";
import { useChatScroll } from "@/hooks/useChatScroll";
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

// ==============================================================================
// WELLNESS CAPSULES — Interactive wellness action triggers
// ==============================================================================
const wellnessCapsules = [
  { icon: Wind, label: "Breathe", prompt: "Guide me through a breathing exercise", color: "from-cyan-500/30 to-blue-600/30", glow: "shadow-cyan-500/20" },
  { icon: Moon, label: "Sleep", prompt: "Help me relax before sleep", color: "from-violet-500/30 to-indigo-600/30", glow: "shadow-violet-500/20" },
  { icon: Brain, label: "Focus", prompt: "I'm stressed about studying", color: "from-amber-500/30 to-orange-600/30", glow: "shadow-amber-500/20" },
  { icon: Flame, label: "Calm", prompt: "I'm feeling anxious", color: "from-rose-500/30 to-red-600/30", glow: "shadow-rose-500/20" },
  { icon: Waves, label: "Ground", prompt: "I need some self-care tips", color: "from-emerald-500/30 to-teal-600/30", glow: "shadow-emerald-500/20" },
  { icon: MessageCircle, label: "Talk", prompt: "I just want to talk", color: "from-sky-500/30 to-cyan-600/30", glow: "shadow-sky-500/20" },
];

// ==============================================================================
// AMBIENT CANVAS — Deep wellness atmosphere
// ==============================================================================
const AmbientCanvas = () => (
  <div className="fixed inset-0 pointer-events-none overflow-hidden">
    {/* Deep base layer */}
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-rose-950/40 via-black to-black" />
    {/* Floating orbs */}
    <motion.div
      className="absolute top-1/4 left-1/4 w-[600px] h-[600px] rounded-full"
      style={{ background: "radial-gradient(circle, rgba(225,29,72,0.08) 0%, transparent 70%)" }}
      animate={{ x: [0, 30, 0], y: [0, -20, 0], scale: [1, 1.1, 1] }}
      transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
    />
    <motion.div
      className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] rounded-full"
      style={{ background: "radial-gradient(circle, rgba(139,92,246,0.06) 0%, transparent 70%)" }}
      animate={{ x: [0, -20, 0], y: [0, 30, 0], scale: [1, 1.15, 1] }}
      transition={{ duration: 15, repeat: Infinity, ease: "easeInOut", delay: 3 }}
    />
    <motion.div
      className="absolute top-1/2 left-1/2 w-[400px] h-[400px] rounded-full"
      style={{ background: "radial-gradient(circle, rgba(6,182,212,0.05) 0%, transparent 70%)" }}
      animate={{ x: [0, 15, 0], y: [0, -15, 0], scale: [1, 1.05, 1] }}
      transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 6 }}
    />
    {/* Subtle grid texture */}
    <div className="absolute inset-0 opacity-[0.015]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)", backgroundSize: "60px 60px" }} />
  </div>
);

// ==============================================================================
// FLOATING AI COMPANION — Emotional wellness presence
// ==============================================================================
const AICompanion = ({ isThinking }: { isThinking?: boolean }) => (
  <div className="relative flex flex-col items-center">
    {/* Outer aura rings */}
    <motion.div
      className="absolute w-32 h-32 rounded-full border border-rose-500/10"
      animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.1, 0.3] }}
      transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
    />
    <motion.div
      className="absolute w-24 h-24 rounded-full border border-rose-500/20"
      animate={{ scale: [1, 1.1, 1], opacity: [0.5, 0.2, 0.5] }}
      transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
    />
    {/* Core orb */}
    <motion.div
      className="relative w-16 h-16 rounded-full bg-gradient-to-br from-rose-500 via-red-600 to-rose-700 shadow-2xl flex items-center justify-center"
      animate={isThinking ? {
        boxShadow: ["0 0 30px rgba(225,29,72,0.3)", "0 0 60px rgba(225,29,72,0.5)", "0 0 30px rgba(225,29,72,0.3)"],
        scale: [1, 1.05, 1]
      } : {
        boxShadow: ["0 0 20px rgba(225,29,72,0.2)", "0 0 40px rgba(225,29,72,0.3)", "0 0 20px rgba(225,29,72,0.2)"]
      }}
      transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
    >
      <Sparkles className="h-7 w-7 text-white" />
    </motion.div>
    {/* Status dot */}
    <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 border border-white/10 backdrop-blur-md">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
      </span>
      <span className="text-[10px] text-muted-foreground font-medium">Here</span>
    </div>
  </div>
);

// ==============================================================================
// WELLNESS CARD — User emotional expression card
// ==============================================================================
const UserCard = memo(({ content, time }: { content: string; time: string }) => (
  <motion.div
    initial={{ opacity: 0, y: 16, scale: 0.96 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
    className="flex justify-end w-full"
  >
    <div className="max-w-[90%] sm:max-w-[80%] lg:max-w-[70%]">
      <div className="relative group">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-rose-500/20 to-red-600/20 rounded-2xl blur opacity-0 group-hover:opacity-100 transition duration-500" />
        <div className="relative rounded-2xl bg-gradient-to-br from-zinc-800/80 to-zinc-900/80 border border-white/[0.06] px-6 py-4 shadow-xl">
          <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-rose-500/30 to-transparent" />
          <p className="text-[15px] leading-relaxed text-zinc-100 whitespace-pre-wrap break-words">{content}</p>
        </div>
      </div>
      <p className="mt-2 text-[10px] text-zinc-500 text-right pr-2 tracking-wide uppercase">{time}</p>
    </div>
  </motion.div>
));
UserCard.displayName = "UserCard";

// ==============================================================================
// AI RESPONSE CARD — Elegant floating wellness response
// ==============================================================================
const AICard = memo(({ content, time, isThinking }: { content: string; time: string; isThinking?: boolean }) => (
  <motion.div
    initial={{ opacity: 0, y: 16, scale: 0.96 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
    className="flex gap-4 w-full"
  >
    <div className="flex-shrink-0 pt-1">
      <AICompanion isThinking={isThinking} />
    </div>
    <div className="min-w-0 flex-1 max-w-[88%] sm:max-w-[82%] lg:max-w-[75%]">
      <div className="relative group">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-red-900/20 via-rose-800/10 to-transparent rounded-2xl blur opacity-0 group-hover:opacity-100 transition duration-500" />
        <div className="relative rounded-2xl bg-muted text-foreground border border-border backdrop-blur-sm px-6 py-5 shadow-xl">
          <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-rose-500/20 via-red-400/10 to-transparent" />
          <p className="text-[15px] leading-[1.7] whitespace-pre-wrap break-words">{content}</p>
        </div>
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground pl-2 tracking-wide uppercase">{time}</p>
    </div>
  </motion.div>
));
AICard.displayName = "AICard";

// ==============================================================================
// WELLNESS CAPSULE — Interactive emotional trigger
// ==============================================================================
const WellnessCapsule = ({ capsule, onClick, disabled }: {
  capsule: typeof wellnessCapsules[0];
  onClick: () => void;
  disabled: boolean;
}) => {
  const Icon = capsule.icon;
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      whileHover={{ scale: 1.05, y: -2 }}
      whileTap={{ scale: 0.97 }}
      className={cn(
        "relative group flex items-center gap-2 px-3.5 py-2 rounded-xl",
        "border border-border bg-muted text-foreground backdrop-blur-md",
        "hover:border-border/80 transition-all duration-500",
        capsule.color
      )}
    >
      <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-muted/50 group-hover:bg-muted transition-colors">
        <Icon className="h-3.5 w-3.5 text-foreground" />
      </div>
      <span className="text-sm font-medium text-foreground">{capsule.label}</span>
    </motion.button>
  );
};

// ==============================================================================
// WELLNESS TYPING — Breathing AI presence
// ==============================================================================
const WellnessTyping = () => (
  <motion.div
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    className="flex gap-4"
  >
    <AICompanion isThinking />
    <div className="rounded-2xl border border-border bg-muted backdrop-blur-sm px-6 py-4 shadow-xl">
      <div className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-rose-400/60"
            animate={{ y: [-3, 3, -3], opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
          />
        ))}
        <span className="ml-3 text-xs text-muted-foreground">Thinking...</span>
      </div>
    </div>
  </motion.div>
);

// ==============================================================================
// MOOD CHECK — Quick emotional state selector
// ==============================================================================
const MoodCheck = ({ onSelect }: { onSelect: (mood: string) => void }) => {
  const moods = [
    { label: "Good", color: "from-emerald-500/20 to-green-600/20" },
    { label: "Okay", color: "from-amber-500/20 to-yellow-600/20" },
    { label: "Low", color: "from-orange-500/20 to-red-600/20" },
    { label: "Anxious", color: "from-rose-500/20 to-red-700/20" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border bg-muted/50 backdrop-blur-md p-5"
    >
      <p className="text-sm text-muted-foreground mb-3 flex items-center gap-2">
        <Activity className="h-4 w-4 text-rose-400" />
        How are you feeling right now?
      </p>
      <div className="flex flex-wrap gap-2">
        {moods.map((mood) => (
          <motion.button
            key={mood.label}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => onSelect(`I'm feeling ${mood.label.toLowerCase()}`)}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-xl border border-border",
              "bg-muted hover:border-border/80 transition-all",
              mood.color
            )}
          >
            <span className="text-xs font-medium text-foreground">{mood.label}</span>
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
};

// ==============================================================================
// MAIN COMPONENT
// ==============================================================================
const StudentAISupport = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [isTriggeringEmergency, setIsTriggeringEmergency] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [showMoodCheck, setShowMoodCheck] = useState(true);
  const navigate = useNavigate();
  const { user } = useAuth();
  const userName = user?.profile?.full_name || user?.email?.split('@')[0] || "Student";

  const { messages, isLoading, error, supportSignal, sendMessage, clearMessages } = useAIChat();
  const { scrollRef: scrollContainerRef, handleScroll, scrollToBottom, isNearBottom } = useChatScroll(messages.length, {
    threshold: 150,
    smooth: true
  });

  // Track if user has scrolled up (not near bottom) and there are messages
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const prevMessagesLengthRef = useRef(messages.length);

  // Detect new messages arriving
  useEffect(() => {
    if (messages.length > prevMessagesLengthRef.current) {
      setHasNewMessages(true);
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages.length]);

  // Show scroll button when not near bottom and has new messages
  useEffect(() => {
    setShowScrollToBottom(!isNearBottom && hasNewMessages && messages.length > 0);
  }, [isNearBottom, hasNewMessages, messages.length]);

  const handleScrollToBottom = () => {
    scrollToBottom();
    setHasNewMessages(false);
  };

  const handleResetChat = () => {
    if (messages.length === 0) return;
    if (window.confirm("Are you sure you want to clear your conversation history?")) {
      clearMessages();
      setShowMoodCheck(true);
      toast.success("Conversation cleared");
    }
  };

  const handleBack = () => {
    navigate("/student/dashboard");
  };

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  const handleSendMessage = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!message.trim() || isLoading) return;
    
    const content = message.trim();
    setShowMoodCheck(false);
    setMessage("");
    
    // Scroll to show user's new message
    scrollToBottom();
    
    await sendMessage(content);
  };

  const handleQuickPrompt = async (prompt: string) => {
    if (isLoading) return;
    setShowMoodCheck(false);
    scrollToBottom();
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
      <AmbientCanvas />
      <DashboardSidebar
        items={navItems}
        userType="student"
        userName={userName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-72 pl-0 relative z-10 flex flex-col h-[100dvh] overflow-hidden">
        <DashboardHeader
          title="AI Support"
          onMenuClick={() => setSidebarOpen(true)}
        />

        <main className="flex-1 min-h-0 flex flex-col p-2 sm:p-4 lg:p-6">
          <div className="flex-1 min-h-0 flex flex-col rounded-2xl sm:rounded-[2rem] border border-border bg-background/95 backdrop-blur-xl shadow-2xl overflow-hidden">
            {/* AI Header - Compact & Premium */}
            <div className="flex-shrink-0 border-b border-white/[0.04] bg-gradient-to-r from-rose-500/5 via-transparent to-violet-500/5 px-5 py-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-full hover:bg-muted/50"
                    onClick={handleBack}
                  >
                    <History className="h-5 w-5 text-muted-foreground rotate-180" />
                  </Button>
                  <AICompanion isThinking={isLoading} />
                  <div>
                    <h1 className="text-base font-semibold text-foreground tracking-tight">AI Wellness Assistant</h1>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                      </span>
                      <span className="text-[11px] text-muted-foreground">Always here for you</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/50 border border-border">
                    <Lock className="h-3 w-3 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground">Private</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full h-8 w-8 hover:bg-rose-500/10 text-rose-400"
                    onClick={handleResetChat}
                    title="Reset Conversation"
                  >
                    <Zap className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full h-8 w-8 hover:bg-muted/50"
                    onClick={() => toast.info("Your conversation is private and handled securely.")}
                  >
                    <Heart className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Messages Area */}
            <div 
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="flex-1 min-h-0 overflow-y-auto custom-scrollbar relative"
            >
              {/* Scroll to bottom indicator */}
              <AnimatePresence>
                {showScrollToBottom && (
                  <motion.button
                    initial={{ opacity: 0, y: 20, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 20, scale: 0.9 }}
                    onClick={handleScrollToBottom}
                    className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-rose-500 to-red-600 text-white text-sm font-medium shadow-lg shadow-rose-500/30 hover:shadow-xl hover:shadow-rose-500/40 transition-all"
                  >
                    <ChevronDown className="h-4 w-4" />
                    <span>New messages</span>
                  </motion.button>
                )}
              </AnimatePresence>
              <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
                <AnimatePresence>
                  {messages.length === 0 && !isLoading && (
                    <motion.div
                      key="welcome-screen"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20, transition: { duration: 0.2 } }}
                      className="text-center py-10"
                    >
                      <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-rose-500/20 to-violet-500/20 mb-5">
                        <Sparkles className="h-7 w-7 text-rose-400" />
                      </div>
                      <h2 className="text-lg font-semibold text-foreground mb-2">Welcome to your safe space</h2>
                      <p className="text-muted-foreground text-sm max-w-md mx-auto">
                        I'm here to listen and support you. Share what's on your mind, or choose a topic below to get started.
                      </p>
                    </motion.div>
                  )}

                  {showMoodCheck && messages.length === 0 && !isLoading && (
                    <motion.div
                      key="mood-check"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20, transition: { duration: 0.2 } }}
                    >
                      <MoodCheck onSelect={(mood) => void handleQuickPrompt(mood)} />
                    </motion.div>
                  )}

                  {messages.map((msg, index) => (
                    <div
                      key={msg.id || `msg-${index}-${msg.time}`}
                      className="w-full"
                    >
                      {msg.sender === "user" ? (
                        <UserCard content={msg.content} time={msg.time} />
                      ) : (
                        <AICard content={msg.content} time={msg.time} />
                      )}
                    </div>
                  ))}

                  {isLoading && <WellnessTyping key="typing" />}
                </AnimatePresence>
              </div>
            </div>

            {/* Input Area - Floating Premium Design */}
            <div className="flex-shrink-0 border-t border-border bg-background p-3 sm:p-5">
              <div className="max-w-3xl mx-auto space-y-3">
                {/* Crisis Alert */}
                <AnimatePresence>
                  {supportSignal?.requiresImmediateHelp && (
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.95 }}
                      className="rounded-2xl border border-rose-500/20 bg-gradient-to-br from-rose-500/10 to-red-600/5 p-4"
                    >
                      <div className="flex flex-col sm:flex-row gap-4">
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-rose-500/20 flex items-center justify-center">
                            <AlertTriangle className="h-4 w-4 text-rose-400" />
                          </div>
                          <div>
                            <p className="font-semibold text-rose-400 text-sm">Immediate help recommended</p>
                            <p className="text-sm text-foreground mt-1">
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
                              className="gap-2 bg-gradient-to-br from-rose-600 to-red-700 border-none"
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
                            className="gap-2 border-border hover:bg-muted/50"
                          >
                            <Phone className="h-4 w-4" />
                            Call Now
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Wellness Capsules */}
                <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
                  {wellnessCapsules.map((capsule) => (
                    <WellnessCapsule
                      key={capsule.label}
                      capsule={capsule}
                      onClick={() => void handleQuickPrompt(capsule.prompt)}
                      disabled={isLoading}
                    />
                  ))}
                </div>

                {/* Premium Input */}
                <form onSubmit={handleSendMessage}>
                  <div className={cn(
                    "relative flex items-center rounded-2xl border transition-all duration-300",
                    "bg-muted backdrop-blur-md",
                    isFocused
                      ? "border-rose-500/30 shadow-lg shadow-rose-500/10"
                      : "border-border hover:border-border/80"
                  )}>
                    <input
                      type="text"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      onFocus={() => setIsFocused(true)}
                      onBlur={() => setIsFocused(false)}
                      placeholder="Share what's on your mind..."
                      disabled={isLoading}
                      className="flex-1 bg-transparent px-5 py-3.5 text-[15px] text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
                    />
                    <div className="flex items-center gap-2 pr-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 rounded-xl hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                        onClick={() => toast.info("Voice input coming soon!")}
                      >
                        <Mic className="h-5 w-5" />
                      </Button>
                      <Button
                        type="submit"
                        size="icon"
                        disabled={!message.trim() || isLoading}
                        className={cn(
                          "h-9 w-9 rounded-xl transition-all duration-300",
                          "bg-gradient-to-br from-rose-500 to-red-600",
                          "hover:shadow-lg hover:shadow-rose-500/30",
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
                <p className="text-center text-[10px] text-muted-foreground leading-relaxed">
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
