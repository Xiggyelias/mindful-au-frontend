import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface RequestBody {
  message: string;
  history?: ChatMessage[];
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return new Response(
      JSON.stringify({
        ok: true,
        function: "ai-wellness-chat",
        status: "ready",
        usage: "Send a POST request with a JSON body containing { message, history? }.",
        example: {
          message: "I am feeling anxious about exams",
          history: [],
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // Only allow POST requests for chat requests
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({
        error: "Method not allowed",
        allowed_methods: ["GET", "POST", "OPTIONS"],
      }),
      { 
        status: 405, 
        headers: {
          ...corsHeaders,
          "Allow": "GET, POST, OPTIONS",
          "Content-Type": "application/json",
        },
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
    const systemPrompt = `You are a compassionate and supportive AI wellness assistant for university students. Your role is to:
- Provide emotional support and active listening
- Suggest coping strategies and relaxation techniques
- Offer study tips and stress management advice
- Encourage seeking professional help when appropriate
- Be empathetic, non-judgmental, and supportive

Important guidelines:
- Never provide medical diagnoses or treatment advice
- If someone expresses thoughts of self-harm, gently encourage them to speak with a counselor
- Keep responses concise but warm and helpful
- Use techniques from CBT and mindfulness when appropriate
- Validate feelings before offering suggestions`;

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...(history || []).slice(-10), // Keep last 10 messages for context
      { role: "user", content: message.trim() }
    ];

    // Try Gemini first, then OpenAI, then fallback
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");

    let aiResponse: string | null = null;

    // Try Gemini API
    if (geminiApiKey) {
      try {
        aiResponse = await tryGemini(geminiApiKey, messages);
      } catch (error) {
        console.error("Gemini API error:", error);
      }
    }

    // Try OpenAI API if Gemini failed
    if (!aiResponse && openaiApiKey) {
      try {
        aiResponse = await tryOpenAI(openaiApiKey, messages);
      } catch (error) {
        console.error("OpenAI API error:", error);
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

// Try Gemini API
async function tryGemini(apiKey: string, messages: ChatMessage[]): Promise<string | null> {
  // Convert messages format for Gemini
  const geminiMessages: any[] = [];
  
  // Add system prompt as first user message
  const systemMsg = messages.find(m => m.role === "system");
  if (systemMsg) {
    geminiMessages.push({
      role: "user",
      parts: [{ text: systemMsg.content }]
    });
  }

  // Add conversation history
  for (const msg of messages) {
    if (msg.role === "system") continue;
    geminiMessages.push({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.content }]
    });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 30000); // 30 second timeout

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: geminiMessages
        }),
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
    if (error.name === "AbortError") {
      console.error("Gemini API request timed out");
    }
    return null;
  }
}

// Try OpenAI API
async function tryOpenAI(apiKey: string, messages: ChatMessage[]): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 30000); // 30 second timeout

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: messages,
        max_tokens: 500,
        temperature: 0.7,
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
    if (error.name === "AbortError") {
      console.error("OpenAI API request timed out");
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
