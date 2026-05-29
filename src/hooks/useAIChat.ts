import { useCallback, useEffect, useRef, useState } from "react";
import { API_RECOVERED_EVENT, api, getApiErrorMessage } from "@/lib/api";
import { formatInDisplayZone } from "@/lib/displayTimezone";

interface Message {
  id: string | number;
  sender: "user" | "ai";
  content: string;
  time: string;
  /** Provider mode returned by backend (e.g. 'external', 'local_fallback'). */
  providerMode?: string;
}

interface SupportSignal {
  riskLevel: string;
  requiresImmediateHelp: boolean;
  showPanicButton: boolean;
  crisisHotline: string | null;
}

interface MlSignals {
  modelVersion?: string;
  conversationTopic?: string | null;
  focusArea?: string | null;
  riskForecast?: {
    score?: number;
    level?: string;
    confidence?: number;
  } | null;
  trend?: {
    label?: string;
    delta?: number;
  } | null;
  dominantTopics?: string[];
  recommendedActions?: string[];
  lowBandwidthMode?: boolean;
}

/** Max turns (user + AI pairs) to include in the context window sent to the model.
 *  Keeps the payload size bounded while still giving meaningful continuity. */
const MAX_HISTORY_TURNS = 20;

/** Profile context forwarded to the backend so it can personalise the system
 *  prompt (address the student by name, adjust tone for anonymous users, etc.). */
export interface AIUserContext {
  /** Display name or null when anonymous. */
  name?: string | null;
  /** Whether the student is in anonymous mode. */
  anonymous?: boolean;
  /** Broad role label, e.g. "student". */
  role?: string;
}

const AI_HISTORY_CACHE_KEY = "ai_chat_history_v1";

const formatTime = (value?: string | number | Date) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return formatInDisplayZone(new Date(), "h:mm a");
  }
  return formatInDisplayZone(date, "h:mm a");
};

export const useAIChat = (userContext?: AIUserContext | null) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supportSignal, setSupportSignal] = useState<SupportSignal | null>(null);
  const [mlSignals, setMlSignals] = useState<MlSignals | null>(null);

  // Keep a ref to the latest messages so sendMessage always sees the current
  // thread without needing to add `messages` to its dependency array (which
  // would recreate the callback on every message and cause double-sends).
  const messagesRef = useRef<Message[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Tracks which conversation we last auto-alerted on so we send at most one
  // background panic log per AI conversation, not one per high-risk reply.
  const autoAlertedConvIdRef = useRef<number | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      setError(null);

      const data = await api.getAIWellnessHistory();
      const loadedConversationId = Number(data?.conversation?.id);
      const loadedMessages = Array.isArray(data?.messages) ? data.messages : [];

      if (Number.isFinite(loadedConversationId) && loadedConversationId > 0) {
        setConversationId(loadedConversationId);
      } else {
        setConversationId(null);
      }

      if (loadedMessages.length === 0) {
        setMessages([]);
        setSupportSignal(null);
        setMlSignals(null);
        return;
      }

      const normalizedMessages: Message[] = loadedMessages
        .filter((m: any) => m?.role === "user" || m?.role === "assistant")
        .map((m: any) => ({
          id: m.id,
          sender: m.role === "user" ? "user" : "ai",
          content: String(m.content || ""),
          time: formatTime(m.created_at),
        }));

      if (normalizedMessages.length === 0) {
        setMessages([]);
        localStorage.setItem(
          AI_HISTORY_CACHE_KEY,
          JSON.stringify({
            saved_at: Date.now(),
            conversation_id: Number.isFinite(loadedConversationId) && loadedConversationId > 0 ? loadedConversationId : null,
            messages: [],
            ml_signals: null,
          })
        );
        return;
      }

      setMessages(normalizedMessages);
      setSupportSignal(null);
      setMlSignals(null);
      localStorage.setItem(
        AI_HISTORY_CACHE_KEY,
        JSON.stringify({
          saved_at: Date.now(),
          conversation_id: Number.isFinite(loadedConversationId) && loadedConversationId > 0 ? loadedConversationId : null,
          messages: normalizedMessages,
          ml_signals: null,
        })
      );
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error("Failed to load AI chat history:", err);
      }
      const fallbackRaw = localStorage.getItem(AI_HISTORY_CACHE_KEY);
      if (fallbackRaw) {
        try {
          const parsed = JSON.parse(fallbackRaw) as {
            messages?: Message[];
            conversation_id?: number | null;
            ml_signals?: MlSignals | null;
          };
          if (Array.isArray(parsed?.messages)) {
            setMessages(parsed.messages);
            const cachedConversationId = Number(parsed?.conversation_id);
            if (Number.isFinite(cachedConversationId) && cachedConversationId > 0) {
              setConversationId(cachedConversationId);
            }
            setMlSignals(parsed?.ml_signals ?? null);
            setError(null);
            return;
          }
        } catch {
          // ignore malformed cache
        }
      }

      setMessages([]);
      setSupportSignal(null);
      setMlSignals(null);
      setError(getApiErrorMessage(err, "Failed to load previous AI conversation."));
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    const retryLoad = () => {
      void loadHistory();
    };

    window.addEventListener("online", retryLoad);
    window.addEventListener(API_RECOVERED_EVENT, retryLoad as EventListener);

    return () => {
      window.removeEventListener("online", retryLoad);
      window.removeEventListener(API_RECOVERED_EVENT, retryLoad as EventListener);
    };
  }, [loadHistory]);

  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;

      // Snapshot the conversation before appending the new user message so
      // the history we send reflects what the model already responded to.
      const priorMessages = messagesRef.current;
      const history = priorMessages
        .slice(-MAX_HISTORY_TURNS)
        .map((m) => ({
          role: m.sender === "user" ? "user" : "assistant",
          content: m.content,
        }));

      const optimisticId = `local-${Date.now()}-user`;
      const optimisticMessage: Message = {
        id: optimisticId,
        sender: "user",
        content: trimmed,
        time: formatTime(),
      };

      setMessages((prev) => [...prev, optimisticMessage]);
      setIsLoading(true);
      setIsThinking(true);
      setError(null);

      try {
        const data = await api.aiWellnessChat(trimmed, history, conversationId, userContext ?? null);

        const nextConversationId = Number(data?.conversation_id);
        if (Number.isFinite(nextConversationId) && nextConversationId > 0) {
          setConversationId(nextConversationId);
        }

        const riskLevel = typeof data?.risk_level === "string" ? data.risk_level : "normal";
        const requiresImmediateHelp = Boolean(data?.requires_immediate_help);

        setSupportSignal({
          riskLevel,
          requiresImmediateHelp,
          showPanicButton: Boolean(data?.show_panic_button),
          crisisHotline:
            typeof data?.crisis_hotline === "string" && data.crisis_hotline.trim() !== ""
              ? data.crisis_hotline.trim()
              : null,
        });

        // When the AI flags high or critical risk, automatically send a background
        // panic log so counselors/admins are notified without waiting for the student
        // to tap the "Emergency Alert" button. Guard with a ref so we fire at most
        // once per conversation (not once per message).
        const isHighRisk =
          requiresImmediateHelp ||
          riskLevel === "high" ||
          riskLevel === "critical";

        if (isHighRisk) {
          const effectiveConvId =
            Number.isFinite(nextConversationId) && nextConversationId > 0
              ? nextConversationId
              : conversationId;
          if (effectiveConvId !== autoAlertedConvIdRef.current) {
            autoAlertedConvIdRef.current = effectiveConvId;
            api.createPanicLog({}).catch(() => {});
          }
        }

        setMlSignals({
          modelVersion: typeof data?.ml_signals?.model_version === "string" ? data.ml_signals.model_version : undefined,
          conversationTopic: typeof data?.ml_signals?.conversation_topic === "string" ? data.ml_signals.conversation_topic : null,
          focusArea: typeof data?.ml_signals?.focus_area === "string" ? data.ml_signals.focus_area : null,
          riskForecast: data?.ml_signals?.risk_forecast ?? null,
          trend: data?.ml_signals?.trend ?? null,
          dominantTopics: Array.isArray(data?.ml_signals?.dominant_topics) ? data.ml_signals.dominant_topics : [],
          recommendedActions: Array.isArray(data?.ml_signals?.recommended_actions) ? data.ml_signals.recommended_actions : [],
          lowBandwidthMode: Boolean(data?.ml_signals?.low_bandwidth_mode),
        });

        const persistedUserMessageId = Number(data?.user_message_id);
        if (Number.isFinite(persistedUserMessageId) && persistedUserMessageId > 0) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === optimisticId
                ? { ...msg, id: persistedUserMessageId }
                : msg
            )
          );
        }

        const aiContent = typeof data?.response === "string" ? data.response.trim() : "";
        if (!aiContent) {
          throw new Error("Empty AI response");
        }
        const assistantMessageId = Number(data?.assistant_message_id);
        const providerMode = typeof data?.provider_mode === "string" ? data.provider_mode : undefined;
        const aiMessage: Message = {
          id:
            Number.isFinite(assistantMessageId) && assistantMessageId > 0
              ? assistantMessageId
              : `ai-${Date.now()}`,
          sender: "ai",
          content: aiContent,
          time: formatTime(),
          providerMode,
        };

        setMessages((prev) => [...prev, aiMessage]);
      } catch (err: any) {
        if (import.meta.env.DEV) {
          console.error("AI chat error:", err);
        }
        setError("Failed to get response. Please try again.");
      } finally {
        setIsLoading(false);
        setIsThinking(false);
      }
    },
    [conversationId, userContext]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setSupportSignal(null);
    setMlSignals(null);
    autoAlertedConvIdRef.current = null;
    localStorage.removeItem(AI_HISTORY_CACHE_KEY);
  }, []);

  return {
    messages,
    isLoading,
    isThinking,
    error,
    supportSignal,
    mlSignals,
    sendMessage,
    clearMessages,
    reloadHistory: loadHistory,
  };
};
