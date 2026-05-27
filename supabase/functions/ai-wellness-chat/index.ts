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
    const systemPrompt = `You are a warm, compassionate, and deeply human mental health support companion for university students. Your goal is to provide a safe, empathetic, and natural conversational space—not to act like a clinical tool or search engine.

To sound and feel genuinely human and avoid sounding like a robotic AI:
1. Use a warm, casual, conversational tone: Write as if you are a supportive peer or a caring counselor talking to a friend over coffee. Use natural contractions (e.g., "it's", "I'm", "you're", "don't"). Avoid stiff, clinical, or overly formal phrases.
2. Empathize and validate first: When a student shares something difficult, sit with them in that feeling first. Validate their emotions warmly and naturally (e.g., "That sounds really exhausting," or "It makes complete sense that you'd feel overwhelmed by that").
3. Ditch the "AI-isms" & lists: NEVER say "As an AI wellness assistant..." or start every response with generic empathy templates. Do not immediately jump into "fixing" their problem or providing long numbered/bulleted lists of advice unless they explicitly ask for strategies. Talk WITH them, not AT them.
4. Keep it brief and natural: Keep your responses conversational, paced, and clear, like messages in a chat app. Avoid massive blocks of text or rigid step-by-step guides.
5. Introduce gentle reflection: Ask gentle, open-ended questions one at a time to help them explore their feelings, rather than overwhelming them with options.
6. Respond naturally to greetings, short replies, and follow-up questions: Track context across turns and answer the actual message the student just sent. If the student is simply chatting, keep the conversation natural instead of forcing advice.

Important guidelines:
- Never provide medical diagnoses or treatment advice.
- If someone expresses thoughts of self-harm, stop normal coaching and give immediate safety guidance to connect with emergency services, a counselor, or a trusted person.
- Use techniques from CBT and mindfulness subtly and conversationally when appropriate, without explicitly naming them as clinical exercises.`;

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
    return "I hear that you're feeling anxious, and that's completely valid. Anxiety can feel overwhelming, but there are some techniques that might help:\n\n• Try the 4-7-8 breathing technique: breathe in for 4 seconds, hold for 7, exhale for 8\n• Ground yourself by naming 5 things you can see, 4 you can touch, 3 you can hear, 2 you can smell, and 1 you can taste\n• Remember that this feeling will pass\n\nWould you like to talk more about what's triggering your anxiety?";
  }
  
  if (lowerMessage.includes("stress") || lowerMessage.includes("overwhelmed")) {
    return "Feeling stressed and overwhelmed is a common experience, especially for students. Here are some strategies that might help:\n\n• Break large tasks into smaller, manageable steps\n• Take short breaks every 25-30 minutes (Pomodoro technique)\n• Make sure you're getting enough sleep and staying hydrated\n• Try some light physical activity or stretching\n\nWhat specifically is causing you the most stress right now?";
  }
  
  if (lowerMessage.includes("relax") || lowerMessage.includes("calm")) {
    return "I'd be happy to help you relax. Here's a simple breathing exercise:\n\n1. Find a comfortable position\n2. Close your eyes if that feels comfortable\n3. Breathe in slowly through your nose for 4 counts\n4. Hold your breath for 4 counts\n5. Exhale slowly through your mouth for 4 counts\n6. Repeat 4-5 times\n\nYou might also try progressive muscle relaxation: starting from your toes, tense each muscle group for 5 seconds, then relax. Would you like me to guide you through more relaxation techniques?";
  }
  
  if (lowerMessage.includes("study") || lowerMessage.includes("focus") || lowerMessage.includes("concentrate")) {
    return "I understand studying can be challenging. Here are some evidence-based study tips:\n\n• Use active recall: test yourself instead of just re-reading\n• Space out your study sessions rather than cramming\n• Find a consistent study environment with minimal distractions\n• Take regular breaks to maintain focus\n• Get adequate sleep - it's crucial for memory consolidation\n\nWhat subject or aspect of studying are you struggling with most?";
  }
  
  if (lowerMessage.includes("sad") || lowerMessage.includes("depressed") || lowerMessage.includes("down")) {
    return "I'm sorry to hear you're feeling down. Your feelings are valid, and it takes courage to reach out. Some things that might help:\n\n• Talk to someone you trust about how you're feeling\n• Try to maintain a routine, even if it's simple\n• Spend some time outdoors if possible\n• Be gentle with yourself - it's okay to not be okay\n\nIf these feelings persist, I'd encourage you to speak with a counselor who can provide more personalized support. Would you like to tell me more about what you're experiencing?";
  }
  
  if (lowerMessage.includes("breathing") || lowerMessage.includes("breathe")) {
    return "Let's do a breathing exercise together:\n\n**Box Breathing Technique:**\n\n1. Breathe IN slowly for 4 seconds\n2. HOLD your breath for 4 seconds\n3. Breathe OUT slowly for 4 seconds\n4. HOLD for 4 seconds\n5. Repeat 4-5 times\n\nThis technique activates your parasympathetic nervous system, helping your body relax. Try it now, and let me know how you feel afterward.";
  }
  
  return "Thank you for reaching out. I'm here to listen and support you. Your wellbeing matters, and it's important to take care of your mental health.\n\nCould you tell me more about how you're feeling or what's on your mind? I'm here to help in any way I can.";
}
