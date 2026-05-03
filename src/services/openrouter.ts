import { api, getApiErrorMessage } from "@/lib/api";
import { resolveApiBaseUrl } from "@/lib/runtimeConfig";

const API_BASE_URL = resolveApiBaseUrl();
const DEFAULT_REQUEST_TIMEOUT_MS = 20000;
const MAX_RETRIES = 2;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface StreamChunk {
  content: string;
  done: boolean;
  conversation_id?: number;
}

export interface Conversation {
  id: number;
  title: string;
  model: string;
  last_message_at: string;
  message_count: number;
  latest_message: string;
}

export interface ConversationDetail {
  id: number;
  title: string;
  model: string;
  created_at: string;
  messages: ChatMessage[];
}

type RequestOptions = {
  timeoutMs?: number;
  retries?: number;
};

export class OpenRouterService {
  private getAuthHeaders(): HeadersInit {
    const token = api.getToken();
    return {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    };
  }

  private async fetchWithTimeout(
    path: string,
    init: RequestInit,
    timeoutMs: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  private async requestJson<T>(
    path: string,
    init: RequestInit,
    options: RequestOptions = {}
  ): Promise<T> {
    const retries = Math.max(0, Math.min(4, options.retries ?? MAX_RETRIES));
    const timeoutMs = Math.max(5000, options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await this.fetchWithTimeout(path, init, timeoutMs * (attempt + 1));

        if (!response.ok) {
          const text = await response.text();
          let parsed: unknown = null;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            parsed = null;
          }

          const message =
            parsed &&
            typeof parsed === "object" &&
            "message" in (parsed as Record<string, unknown>) &&
            typeof (parsed as { message: unknown }).message === "string" &&
            (parsed as { message: string }).message.trim() !== ""
              ? (parsed as { message: string }).message
              : `HTTP error! status: ${response.status}`;
          const error = new Error(message);

          const shouldRetry = (response.status === 429 || response.status >= 500) && attempt < retries;
          if (shouldRetry) {
            await sleep(250 * (attempt + 1));
            continue;
          }

          throw error;
        }

        const data = (await response.json()) as T;
        return data;
      } catch (error) {
        lastError = error;
        const message = String((error as { message?: unknown })?.message || "").toLowerCase();
        const shouldRetry =
          attempt < retries &&
          (
            message.includes("network") ||
            message.includes("failed to fetch") ||
            message.includes("timeout") ||
            message.includes("abort")
          );

        if (shouldRetry) {
          await sleep(300 * (attempt + 1));
          continue;
        }

        throw error;
      }
    }

    throw lastError ?? new Error("Request failed");
  }

  async streamChat(
    messages: ChatMessage[],
    model: string = "nvidia/nemotron-nano-9b-v2:free",
    conversationId?: number,
    onChunk?: (chunk: StreamChunk) => void
  ): Promise<{ content: string; conversationId?: number }> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const response = await this.fetchWithTimeout(
          "/openrouter/stream",
          {
            method: "POST",
            headers: this.getAuthHeaders(),
            body: JSON.stringify({
              messages,
              model,
              conversation_id: conversationId,
            }),
          },
          DEFAULT_REQUEST_TIMEOUT_MS * (attempt + 1)
        );

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let fullContent = "";
        let finalConversationId: number | undefined = undefined;

        if (!reader) {
          return { content: "", conversationId: undefined };
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;

            try {
              const data = JSON.parse(line.slice(6));

              if (data.done) {
                if (typeof data.conversation_id === "number") {
                  finalConversationId = data.conversation_id;
                }
                onChunk?.({ content: "", done: true, conversation_id: finalConversationId });
                return { content: fullContent, conversationId: finalConversationId };
              }

              if (typeof data.content === "string" && data.content !== "") {
                fullContent += data.content;
                onChunk?.({
                  content: data.content,
                  done: false,
                });
              }

              if (typeof data.conversation_id === "number") {
                finalConversationId = data.conversation_id;
              }
            } catch {
              // Ignore malformed stream chunks and keep reading.
            }
          }
        }

        return { content: fullContent, conversationId: finalConversationId };
      } catch (error) {
        lastError = error;
        const shouldRetry = attempt < MAX_RETRIES;
        if (shouldRetry) {
          await sleep(250 * (attempt + 1));
          continue;
        }
      }
    }

    throw new Error(getApiErrorMessage(lastError, "OpenRouter streaming failed."));
  }

  async sendMessage(
    messages: ChatMessage[],
    model: string = "nvidia/nemotron-nano-9b-v2:free",
    conversationId?: number
  ): Promise<{ content: string; conversationId?: number }> {
    const data = await this.requestJson<{ success: boolean; error?: string; content: string; conversation_id: number }>(
      "/openrouter/chat",
      {
        method: "POST",
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          messages,
          model,
          conversation_id: conversationId,
        }),
      }
    );

    if (!data.success) {
      throw new Error(data.error || "Unknown error occurred");
    }

    return {
      content: data.content,
      conversationId: data.conversation_id,
    };
  }

  async simpleChat(
    message: string,
    model: string = "nvidia/nemotron-nano-9b-v2:free"
  ): Promise<{ message: string; response: string; model: string }> {
    const data = await this.requestJson<{ success: boolean; error?: string; message: string; response: string; model: string }>(
      "/openrouter/simple-chat",
      {
        method: "POST",
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          message,
          model,
        }),
      }
    );

    if (!data.success) {
      throw new Error(data.error || "Unknown error occurred");
    }

    return {
      message: data.message,
      response: data.response,
      model: data.model,
    };
  }

  async getModels(): Promise<any[]> {
    const data = await this.requestJson<{ success: boolean; error?: string; models: any[] }>(
      "/openrouter/models",
      {
        method: "GET",
        headers: this.getAuthHeaders(),
      }
    );

    if (!data.success) {
      throw new Error(data.error || "Unknown error occurred");
    }

    return data.models;
  }

  async getConversations(): Promise<Conversation[]> {
    const data = await this.requestJson<{ success: boolean; error?: string; conversations: Conversation[] }>(
      "/openrouter/conversations",
      {
        method: "GET",
        headers: this.getAuthHeaders(),
      }
    );

    if (!data.success) {
      throw new Error(data.error || "Unknown error occurred");
    }

    return data.conversations;
  }

  async getConversationMessages(conversationId: number): Promise<ConversationDetail> {
    const data = await this.requestJson<{ success: boolean; error?: string; conversation: ConversationDetail }>(
      `/openrouter/conversations/${conversationId}`,
      {
        method: "GET",
        headers: this.getAuthHeaders(),
      }
    );

    if (!data.success) {
      throw new Error(data.error || "Unknown error occurred");
    }

    return data.conversation;
  }

  async createConversation(title?: string, model?: string): Promise<Conversation> {
    const data = await this.requestJson<{ success: boolean; error?: string; conversation: Conversation }>(
      "/openrouter/conversations",
      {
        method: "POST",
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          title,
          model,
        }),
      }
    );

    if (!data.success) {
      throw new Error(data.error || "Unknown error occurred");
    }

    return data.conversation;
  }

  async deleteConversation(conversationId: number): Promise<void> {
    const data = await this.requestJson<{ success: boolean; error?: string }>(
      `/openrouter/conversations/${conversationId}`,
      {
        method: "DELETE",
        headers: this.getAuthHeaders(),
      }
    );

    if (!data.success) {
      throw new Error(data.error || "Unknown error occurred");
    }
  }
}

export const createOpenRouterService = (): OpenRouterService => {
  return new OpenRouterService();
};
