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

interface AIAvailability {
  status: "checking" | "live" | "fallback" | "offline";
  label: string;
  detail: string | null;
  providerName: string | null;
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
  const [availability, setAvailability] = useState<AIAvailability>({
    status: "checking",
    label: "Checking AI",
    detail: "Checking backend AI availability.",
    providerName: null,
  });

  const refreshAvailability = useCallback(async () => {
    try {
      const data = await api.getReadiness();
      const aiDetails =
        data?.details && typeof data.details === "object"
          ? (data.details as Record<string, unknown>).ai
          : null;

      if (!aiDetails || typeof aiDetails !== "object") {
        throw new Error("Backend readiness payload did not include AI details.");
      }

      const mode = String((aiDetails as Record<string, unknown>).mode || "").trim();
      const validation = String((aiDetails as Record<string, unknown>).validation || "").trim();
      const configuredProviders = Array.isArray((aiDetails as Record<string, unknown>).configured_providers)
        ? ((aiDetails as Record<string, unknown>).configured_providers as unknown[])
            .map((entry) => String(entry || "").trim())
            .filter(Boolean)
        : [];
      const activeProvider = String((aiDetails as Record<string, unknown>).active_provider || "").trim();
      const providerName = activeProvider || configuredProviders[0] || null;
      const externalProviderReady = Boolean((aiDetails as Record<string, unknown>).external_provider_ready);
      const warning =
        typeof (aiDetails as Record<string, unknown>).warning === "string"
          ? String((aiDetails as Record<string, unknown>).warning || "").trim()
          : "";

      if (mode === "external") {
        setAvailability({
          status: "live",
          label: validation === "verified" || externalProviderReady ? "Live AI connected" : "AI configured",
          detail:
            warning ||
            (providerName ? `Using ${providerName}.` : "Using an external AI provider."),
          providerName,
        });
        return;
      }

      setAvailability({
        status: "fallback",
        label: "Local fallback mode",
        detail:
          warning ||
          (configuredProviders.length > 0
            ? "External AI is configured, but local fallback is currently handling requests."
            : "The backend is reachable, but no external AI provider is configured."),
        providerName: configuredProviders.length > 0 ? providerName : null,
      });
    } catch (err) {
      setAvailability({
        status: "offline",
        label: "AI backend offline",
        detail: getApiErrorMessage(err, "The backend AI service is not reachable from this site."),
        providerName: null,
      });
    }
  }, []);

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
          })
        );
        return;
      }

      setMessages(normalizedMessages);
      setSupportSignal(null);
      localStorage.setItem(
        AI_HISTORY_CACHE_KEY,
        JSON.stringify({
          saved_at: Date.now(),
          conversation_id: Number.isFinite(loadedConversationId) && loadedConversationId > 0 ? loadedConversationId : null,
          messages: normalizedMessages,
        })
      );
    } catch (err) {
      console.error("Failed to load AI chat history:", err);
      const fallbackRaw = localStorage.getItem(AI_HISTORY_CACHE_KEY);
      if (fallbackRaw) {
        try {
          const parsed = JSON.parse(fallbackRaw) as {
            messages?: Message[];
            conversation_id?: number | null;
          };
          if (Array.isArray(parsed?.messages)) {
            setMessages(parsed.messages);
            const cachedConversationId = Number(parsed?.conversation_id);
            if (Number.isFinite(cachedConversationId) && cachedConversationId > 0) {
              setConversationId(cachedConversationId);
            }
            setError(getApiErrorMessage(err, "Failed to load previous AI conversation."));
            return;
          }
        } catch {
          // ignore malformed cache
        }
      }

      setMessages([]);
      setSupportSignal(null);
      setError(getApiErrorMessage(err, "Failed to load previous AI conversation."));
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    void refreshAvailability();
  }, [refreshAvailability]);

  useEffect(() => {
    const retryLoad = () => {
      void loadHistory();
      void refreshAvailability();
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

        const providerMode = typeof data?.provider_mode === "string" ? data.provider_mode.trim() : "";
        const providerName =
          typeof data?.provider_name === "string" && data.provider_name.trim() !== ""
            ? data.provider_name.trim()
            : null;
        const externalConfigured = Boolean(data?.external_ai_configured);
        const externalLive = Boolean(data?.external_ai_live);
        const configuredProviders = Array.isArray(data?.configured_providers)
          ? (data.configured_providers as unknown[])
              .map((entry) => String(entry || "").trim())
              .filter(Boolean)
          : [];
        const resolvedProviderName = providerName || configuredProviders[0] || null;

        if (providerMode === "external" || externalLive) {
          setAvailability({
            status: "live",
            label: "Live AI connected",
            detail: resolvedProviderName ? `Responding with ${resolvedProviderName}.` : "Responding with external AI.",
            providerName: resolvedProviderName,
          });
        } else {
          const fallbackDetail =
            providerMode === "safety_guardrail"
              ? "Safety guardrails handled this message locally to prioritize immediate crisis guidance."
              : externalConfigured
              ? resolvedProviderName
                ? `${resolvedProviderName} is configured, but this reply used local fallback guidance.`
                : "External AI is configured, but this reply used local fallback guidance."
              : "The backend is reachable, but live external AI is not configured.";

          setAvailability({
            status: "fallback",
            label: "Local fallback mode",
            detail: fallbackDetail,
            providerName: externalConfigured ? resolvedProviderName : null,
          });
        }

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
        console.error("AI chat error:", err);
        setAvailability({
          status: "offline",
          label: "AI backend offline",
          detail: getApiErrorMessage(err, "The backend AI service is not reachable from this site."),
          providerName: null,
        });
        setError(getApiErrorMessage(err, "Failed to get response. Please try again."));
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
    availability,
    sendMessage,
    reloadHistory: loadHistory,
    refreshAvailability,
  };
};
