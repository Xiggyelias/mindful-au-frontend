import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface RequestBody {
  message: string;
  history?: ChatMessage[];
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Only allow POST requests
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { 
        status: 405, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }

  try {
    const body: RequestBody = await req.json();
    const { message, history = [] } = body;

    // Validate input
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Message is required and must be a non-empty string" }),
        { 
          status: 400, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        }
      );
    }

    // Build conversation context
    const systemPrompt = `You are a warm mental health support companion for university students. Listen first—do not fix, diagnose, or lecture.

RULES:
- Be warm, simple, and non-judgmental.
- Never sound robotic, formal, or overly therapist-like.
- Avoid long explanations unless the student asks for more.
- Understand first, then offer gentle guidance.
- Use short sentences and natural language. Use contractions (I'm, you're, it's).
- Acknowledge their emotions before giving any advice.
- Never overwhelm with multiple suggestions at once—one gentle thought or question at a time.
- No bullet lists or numbered steps unless they explicitly ask for strategies.
- Never say "As an AI..." or dump generic advice templates.
- Respond to what they actually said, not a script.

STYLE:
- Sound like a caring friend texting back: "That sounds really heavy. I get why you feel that way."
- NOT like: "I am sorry to hear that you are experiencing distress."

END GOAL:
Make them feel heard, safe, and not judged.

CRITICAL:
- Never provide medical diagnoses or treatment advice.
- If they mention suicide or self-harm, give immediate safety guidance to contact emergency services, a counselor, or a trusted person.
- Use mindfulness and CBT insights naturally in conversation, never as clinical exercises.`;

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...(history || []).slice(-10), // Keep last 10 messages for context
      { role: "user", content: message.trim() }
    ];

    // Try OpenRouter Llama first, then Gemini, then fallback
    const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

    let aiResponse: string | null = null;

    // Try OpenRouter API
    if (openRouterApiKey) {
      try {
        aiResponse = await tryOpenRouter(openRouterApiKey, messages);
      } catch (error) {
        console.error("OpenRouter API error:", error);
      }
    }

    // Try Gemini API
    if (!aiResponse && geminiApiKey) {
      try {
        aiResponse = await tryGemini(geminiApiKey, messages);
      } catch (error) {
        console.error("Gemini API error:", error);
      }
    }

    // Use fallback if all APIs failed
    if (!aiResponse) {
      aiResponse = getWellnessResponse(message);
    }

    return new Response(
      JSON.stringify({ response: aiResponse }),
      { 
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  } catch (error) {
    console.error("Error in ai-wellness-chat:", error);
    return new Response(
      JSON.stringify({ 
        response: "I understand you're reaching out, and I'm here to help. Sometimes our systems need a moment. In the meantime, remember that it's okay to take things one step at a time. Would you like to share what's been on your mind?" 
      }),
      { 
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});

// Try OpenRouter API
async function tryOpenRouter(apiKey: string, messages: ChatMessage[]): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 30000);

  const baseUrl = Deno.env.get("OPENROUTER_BASE_URL") || "https://openrouter.ai/api/v1";
  const model = Deno.env.get("OPENROUTER_CHAT_MODEL") || "meta-llama/llama-3.3-70b-instruct:free";

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": Deno.env.get("OPENROUTER_SITE_URL") || "https://mindful-au.local",
        "X-Title": Deno.env.get("OPENROUTER_SITE_NAME") || "Mindful AU",
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 500,
        temperature: 0.85,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;

    return content || null;
  } catch (error) {
    clearTimeout(timeoutId);
    if (isAbortError(error)) {
      console.error("OpenRouter API request timed out");
    }
    return null;
  }
}

// Try Gemini API
async function tryGemini(apiKey: string, messages: ChatMessage[]): Promise<string | null> {
  const model = Deno.env.get("GEMINI_MODEL") || "gemini-1.5-flash";

  // Convert messages format for Gemini
  const geminiMessages: any[] = [];
  const systemMsg = messages.find(m => m.role === "system");

  // Add conversation history
  for (const msg of messages) {
    if (msg.role === "system") continue;
    geminiMessages.push({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.content }]
    });
  }

  const payload: any = {
    contents: geminiMessages,
    generationConfig: {
      temperature: 0.85,
    }
  };

  if (systemMsg) {
    payload.systemInstruction = {
      parts: [{ text: systemMsg.content }]
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 30000); // 30 second timeout

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    
    return text || null;
  } catch (error) {
    clearTimeout(timeoutId);
    if (isAbortError(error)) {
      console.error("Gemini API request timed out");
    }
    return null;
  }
}

// Fallback wellness responses based on common keywords
function getWellnessResponse(message: string): string {
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes("anxious") || lowerMessage.includes("anxiety")) {
    return "That sounds really heavy, and it makes sense you'd feel on edge. What's been weighing on you most?";
  }
  
  if (lowerMessage.includes("stress") || lowerMessage.includes("overwhelmed")) {
    return "Being overwhelmed is a lot to carry. What's taking up the most space in your head right now?";
  }
  
  if (lowerMessage.includes("relax") || lowerMessage.includes("calm")) {
    return "Yeah, let's slow things down a bit. Try breathing in slowly for four counts, then out for six—just a few times. How does that feel?";
  }
  
  if (lowerMessage.includes("study") || lowerMessage.includes("focus") || lowerMessage.includes("concentrate")) {
    return "Study pressure can pile up fast. What's the one thing on your plate that feels hardest right now?";
  }
  
  if (lowerMessage.includes("sad") || lowerMessage.includes("depressed") || lowerMessage.includes("down")) {
    return "That sounds really heavy. I get why you'd feel low right now. What's been sitting with you most?";
  }
  
  if (lowerMessage.includes("breathing") || lowerMessage.includes("breathe")) {
    return "Okay—breathe in slowly for four counts, hold for four, then out for four. A few rounds is enough. How are you feeling after that?";
  }
  
  return "I'm here. What's on your mind right now?";
}
