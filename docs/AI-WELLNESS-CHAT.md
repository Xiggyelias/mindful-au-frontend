# AI Wellness Chat System Documentation

## Overview

The AI Wellness Chat is a mental health support system designed for university students. It provides 24/7 emotional support, coping strategies, and crisis intervention through an AI-powered chat interface.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React)                          │
├─────────────────────────────────────────────────────────────────┤
│  StudentAISupport.tsx  ──►  useAIChat.ts  ──►  useChatScroll.ts  │
│         │                        │                    │           │
│         │                   State Management    Smart Scrolling  │
│         │                        │                    │           │
│         └────────────────────────┼────────────────────┘           │
│                                  ▼                                │
│                            api.ts (HTTP Client)                   │
└──────────────────────────────────┬────────────────────────────────┘
                                   │
                                   │ POST /ai/wellness-chat
                                   │ GET  /ai/wellness-chat/history
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                     BACKEND (Laravel)                            │
├─────────────────────────────────────────────────────────────────┤
│  AIWellnessChatController.php                                    │
│         │                                                        │
│         ├──► MentalHealthMlService (ML Insights)                │
│         │                                                        │
│         ├──► AI Provider Cascade:                               │
│         │    1. Kwaipilot (GPT-4o-mini)                          │
│         │    2. OpenRouter (GPT-4o)                              │
│         │    3. Gemini (1.5/2.5 Flash)                           │
│         │    4. OpenAI Direct (GPT-4o-mini)                      │
│         │    5. Local Fallback (Deterministic)                   │
│         │                                                        │
│         └──► Database (chat_conversations, chat_messages)        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Frontend Components

### `StudentAISupport.tsx`

Main UI component providing the chat interface.

**Features:**
- Message list with user/AI message cards
- Input field with send button
- Wellness capsules (quick prompts for breathing, sleep, focus, etc.)
- Mood check selector
- Crisis alert with emergency button
- Smart scroll behavior (WhatsApp-style)

**Key State:**
```typescript
const [message, setMessage] = useState("");           // Input field
const [showMoodCheck, setShowMoodCheck] = useState(true);  // Mood selector
const [showScrollToBottom, setShowScrollToBottom] = useState(false);
```

### `useAIChat.ts`

Custom hook managing chat state and API communication.

**Exports:**
| Property | Type | Description |
|----------|------|-------------|
| `messages` | `Message[]` | Chat history |
| `isLoading` | `boolean` | AI is generating response |
| `error` | `string \| null` | Error message if any |
| `supportSignal` | `SupportSignal \| null` | Crisis detection signals |
| `mlSignals` | `MlSignals \| null` | ML insights (topic, risk, etc.) |
| `sendMessage` | `(content: string) => Promise<void>` | Send message to AI |
| `clearMessages` | `() => void` | Reset conversation |
| `reloadHistory` | `() => Promise<void>` | Reload from server |

**Message Flow:**
1. User sends message → Optimistic UI update (immediate)
2. API call to backend → AI processes
3. Response received → Update message ID, add AI response
4. Support signals updated → Crisis UI if needed

### `useChatScroll.ts`

Smart scroll behavior hook.

**Behavior:**
- **User sends message** → Scroll to bottom
- **User near bottom, new message arrives** → Auto-scroll
- **User scrolled up reading** → Stay in place, show "New messages" button
- **Initial load** → Scroll to bottom

---

## Backend Controller

### `AIWellnessChatController.php`

Handles all AI chat logic with multi-provider fallback and crisis detection.

### Endpoint: `POST /ai/wellness-chat`

**Request:**
```json
{
  "message": "I'm feeling anxious about my exams",
  "history": [],  // Optional: previous messages for context
  "conversation_id": 123  // Optional: continue existing conversation
}
```

**Response:**
```json
{
  "response": "That sounds heavy... [AI response]",
  "conversation_id": 123,
  "user_message_id": 456,
  "assistant_message_id": 457,
  "risk_level": "normal",
  "requires_immediate_help": false,
  "show_panic_button": false,
  "crisis_hotline": null,
  "provider_mode": "external",
  "provider_name": "gemini",
  "latency_ms": 850,
  "ml_signals": {
    "model_version": "v1.2.0",
    "conversation_topic": "anxiety",
    "focus_area": "academic",
    "risk_forecast": { "score": 0.2, "level": "low" },
    "dominant_topics": ["exam", "stress"],
    "recommended_actions": ["breathing exercise", "study break"]
  }
}
```

---

## AI Provider Cascade

The system tries providers in order, falling back if one fails:

```
┌────────────────┐     ┌────────────────┐     ┌────────────────┐
│   Kwaipilot    │ ──► │  OpenRouter    │ ──► │     Gemini     │
│  (GPT-4o-mini) │     │   (GPT-4o)     │     │ (1.5/2.5 Flash)│
└───────┬────────┘     └───────┬────────┘     └───────┬────────┘
        │                      │                      │
        │ Success              │ Success              │ Success
        ▼                      ▼                      ▼
   [Return Response]     [Return Response]     [Return Response]
        │                      │                      │
        │ Fail                 │ Fail                 │ Fail
        ▼                      ▼                      ▼
┌────────────────┐     ┌────────────────┐     ┌────────────────┐
│    OpenAI      │ ──► │ Local Fallback │ ──► │  Deterministic │
│  (GPT-4o-mini) │     │   (Offline)    │     │   Responses    │
└────────────────┘     └────────────────┘     └────────────────┘
```

**Provider Priority:**
1. **Kwaipilot** - Primary external provider
2. **OpenRouter** - Secondary OpenAI proxy
3. **Gemini** - Google's model with multi-model fallback
4. **OpenAI Direct** - Direct OpenAI API
5. **Local Fallback** - Deterministic responses (always available)

---

## Crisis Detection System

### Keywords Triggering Crisis Mode

**Immediate Crisis (triggers safety guardrail):**
- Suicide, kill myself, end my life
- Self harm, hurt myself
- "I want to die", "I don't want to live"
- Specific self-harm methods (overdose, hanging, etc.)
- "Not safe", "do not feel safe"

**Crisis Response:**
```php
private function buildCrisisResponse(string $message): string
{
    return 'Your safety comes first. Please contact emergency services 
            or a trusted counselor right now...';
}
```

**UI Response:**
- `requires_immediate_help: true`
- `show_panic_button: true`
- Crisis hotline displayed
- Emergency alert button activated

---

## Topic Detection

The system detects conversation topics to provide relevant responses:

| Topic | Keywords |
|-------|----------|
| `crisis` | suicide, kill myself, self harm, unsafe |
| `anxiety` | anxiety, anxious, panic, overwhelmed, stress |
| `study` | exam, deadline, assignment, study, focus |
| `sleep` | sleep, insomnia, tired, exhausted |
| `sadness` | sad, depressed, down, lonely, hopeless |
| `relationships` | breakup, boyfriend, girlfriend, friend |
| `family` | family, mother, father, parents |
| `financial` | money, fees, tuition, broke, debt |
| `safety` | abuse, assault, harassed, threatened |
| `physical_health` | sick, fever, headache, nausea |

---

## System Prompt

The AI is configured with this system prompt:

```
You are a compassionate and supportive AI wellness assistant for university students.

Your role is to:
- Provide emotional support and active listening
- Suggest coping strategies and relaxation techniques
- Offer study tips and stress management advice
- Encourage seeking professional help when appropriate
- Be empathetic, non-judgmental, and supportive
- Respond naturally to greetings and follow-up questions
- Track context across turns

Important guidelines:
- Never provide medical diagnoses or treatment advice
- If someone expresses thoughts of self-harm, give immediate safety guidance
- Keep responses concise but warm
- Use techniques from CBT and mindfulness when appropriate
- Validate feelings before offering suggestions
```

---

## Database Schema

### `chat_conversations`
| Column | Type | Description |
|--------|------|-------------|
| `id` | bigint | Primary key |
| `user_id` | bigint | Student ID |
| `title` | string | First message preview |
| `model` | string | `wellness-assistant-v1` |
| `is_active` | boolean | Conversation status |
| `last_message_at` | timestamp | Last activity |

### `chat_messages`
| Column | Type | Description |
|--------|------|-------------|
| `id` | bigint | Primary key |
| `conversation_id` | bigint | Foreign key |
| `role` | string | `user` or `assistant` |
| `content` | text | Message content |
| `created_at` | timestamp | Sent time |

### `message_metadata`
| Column | Type | Description |
|--------|------|-------------|
| `message_id` | bigint | Foreign key |
| `key` | string | Metadata key |
| `value` | text | Metadata value |
| `type` | string | `string`, `json`, `boolean` |

---

## ML Signals

The `MentalHealthMlService` provides insights:

```typescript
interface MlSignals {
  modelVersion?: string;           // ML model version
  conversationTopic?: string;       // Detected topic
  focusArea?: string;              // Primary concern area
  riskForecast?: {                 // Risk prediction
    score?: number;                // 0.0 - 1.0
    level?: string;                // low, medium, high
    confidence?: number;
  };
  trend?: {                       // Conversation trend
    label?: string;                // improving, declining, stable
    delta?: number;                // Change magnitude
  };
  dominantTopics?: string[];       // Top 3 topics discussed
  recommendedActions?: string[];   // Suggested interventions
  lowBandwidthMode?: boolean;      // Optimized for slow connections
}
```

---

## Local Fallback Responses

When all external providers fail, the system uses deterministic responses:

```php
// Anxiety
"That sounds heavy. Start with your body first: breathe in for 4 
 and out for 6 for one minute..."

// Study
"Academic pressure can feel intense. Start with the smallest 
 concrete task first..."

// Sleep
"Sleep strain can increase stress quickly. Focus on tonight..."

// Crisis
"Your safety comes first. Please contact emergency services..."
```

---

## Configuration

### Environment Variables

```env
# Kwaipilot
KWAIPILOT_API_KEY=your_key
KWAIPILOT_BASE_URL=https://api.kwaipilot.com/v1

# OpenRouter
OPENROUTER_API_KEY=your_key
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1

# Gemini
GEMINI_API_KEY=your_key
GEMINI_MODEL=gemini-1.5-flash

# OpenAI Direct
OPENAI_API_KEY=your_key
```

---

## Performance Optimizations

1. **Context Window**: Only last 10 messages sent to AI
2. **Timeout**: 8 second provider timeout, 5 second connect
3. **Latency Logging**: Warns if response > 3 seconds
4. **Local Caching**: History cached in localStorage
5. **Optimistic UI**: User messages appear immediately

---

## Security

- **Input Sanitization**: All user input sanitized before processing
- **Content Filtering**: Disallowed content blocked
- **Rate Limiting**: Via Laravel throttle middleware
- **Authentication**: All endpoints require valid session
- **Privacy**: No sensitive data sent to external providers

---

## Error Handling

```typescript
// Frontend
try {
  await sendMessage(content);
} catch (error) {
  setError("Failed to get response. Please try again.");
}

// Backend - Provider Cascade
foreach ($providers as $provider) {
  $response = $this->{$provider['method']}($messages);
  if ($response) return $response;
}
// Fallback to deterministic response
return $this->buildLocalWellnessFallbackResponse($message);
```

---

## Monitoring

Key metrics logged:
- Response latency (warn if > 3s)
- Provider used
- Crisis signals detected
- Provider failures
- Slow response budget exceeded

---

## Future Enhancements

1. **WebSocket Real-time**: Live message streaming
2. **Voice Input**: Speech-to-text support
3. **Multi-language**: Support for local languages
4. **Session Analysis**: Post-conversation insights for counselors
5. **Proactive Check-ins**: AI-initiated wellness checks
