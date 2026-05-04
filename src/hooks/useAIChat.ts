import { useCallback, useEffect, useState } from "react";
import { API_RECOVERED_EVENT, api, getApiErrorMessage } from "@/lib/api";

interface Message {
  id: string | number;
  sender: "user" | "ai";
  content: string;
  time: string;
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

const AI_HISTORY_CACHE_KEY = "ai_chat_history_v1";

const formatTime = (value?: string | number | Date) => {
  if (!value) {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

export const useAIChat = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supportSignal, setSupportSignal] = useState<SupportSignal | null>(null);
  const [mlSignals, setMlSignals] = useState<MlSignals | null>(null);

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

      const optimisticId = `user-${Date.now()}`;
      const optimisticMessage: Message = {
        id: optimisticId,
        sender: "user",
        content: trimmed,
        time: formatTime(),
      };

      setMessages((prev) => [...prev, optimisticMessage]);
      setIsLoading(true);
      setError(null);

      try {
        const data = await api.aiWellnessChat(trimmed, [], conversationId);

        const nextConversationId = Number(data?.conversation_id);
        if (Number.isFinite(nextConversationId) && nextConversationId > 0) {
          setConversationId(nextConversationId);
        }

        setSupportSignal({
          riskLevel: typeof data?.risk_level === "string" ? data.risk_level : "normal",
          requiresImmediateHelp: Boolean(data?.requires_immediate_help),
          showPanicButton: Boolean(data?.show_panic_button),
          crisisHotline:
            typeof data?.crisis_hotline === "string" && data.crisis_hotline.trim() !== ""
              ? data.crisis_hotline.trim()
              : null,
        });

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
        const aiMessage: Message = {
          id:
            Number.isFinite(assistantMessageId) && assistantMessageId > 0
              ? assistantMessageId
              : `ai-${Date.now()}`,
          sender: "ai",
          content: aiContent,
          time: formatTime(),
        };

        setMessages((prev) => [...prev, aiMessage]);
      } catch (err: any) {
        if (import.meta.env.DEV) {
          console.error("AI chat error:", err);
        }
        setError("Failed to get response. Please try again.");
      } finally {
        setIsLoading(false);
      }
    },
    [conversationId]
  );

  return {
    messages,
    isLoading,
    error,
    supportSignal,
    mlSignals,
    sendMessage,
    reloadHistory: loadHistory,
  };
};
