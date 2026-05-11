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

## Machine Learning System

The `MentalHealthMlService` is a **lightweight, rule-based ML system** that provides real-time mental health insights without requiring heavy ML infrastructure. It runs entirely on the backend using feature engineering and weighted scoring.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    MentalHealthMlService                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐    ┌──────────────────┐                   │
│  │ Feature Snapshot │───►│  Risk Scoring    │                   │
│  │   (Student)      │    │   Algorithm      │                   │
│  └──────────────────┘    └────────┬─────────┘                   │
│                                   │                              │
│  ┌──────────────────┐             ▼                              │
│  │ Text Analysis    │    ┌──────────────────┐                   │
│  │ (Distress/Crisis)│───►│  Insight Builder │                   │
│  └──────────────────┘    └────────┬─────────┘                   │
│                                   │                              │
│                                   ▼                              │
│                         ┌──────────────────┐                    │
│                         │ ML Signals Output│                    │
│                         └──────────────────┘                    │
└─────────────────────────────────────────────────────────────────┘
```

### How It Works

#### 1. Feature Collection

The system builds a **feature snapshot** for each student by aggregating data from multiple sources:

```php
private function buildStudentFeatureSnapshots(array $studentIds): array
{
    // Collect from:
    // - Diagnostic assessments (180 days)
    // - AI session diagnostics (90 days)
    // - Appointments (60 days)
    // - Counseling sessions (60 days)
    // - Mood logs (14 days)
    // - Chat messages (30 days)
}
```

**Feature Snapshot Fields:**

| Feature | Window | Description |
|---------|--------|-------------|
| `latest_diagnostic_score` | 180d | Most recent self-assessment score |
| `latest_ai_score` | 90d | Most recent AI-analyzed risk score |
| `appointments_60d` | 60d | Total appointments scheduled |
| `cancelled_appointments_60d` | 60d | Cancelled appointments |
| `cancel_rate_60d` | 60d | Cancellation rate (0.0-1.0) |
| `upcoming_appointments` | Future | Scheduled future appointments |
| `sessions_60d` | 60d | Counseling sessions attended |
| `completed_sessions_60d` | 60d | Successfully completed sessions |
| `mood_logs_14d` | 14d | Mood check-ins submitted |
| `low_mood_logs_14d` | 14d | Logs with low/stressed mood |
| `ai_chat_messages_30d` | 30d | Messages sent to AI chat |
| `distress_messages_30d` | 30d | Messages containing distress words |
| `crisis_messages_30d` | 30d | Messages containing crisis words |
| `topic_counts` | 30d | Frequency of each conversation topic |

#### 2. Text Analysis (Keyword Detection)

The system uses **keyword matching** to detect distress and crisis signals:

```php
private const DISTRESS_TERMS = [
    'stress', 'anxious', 'anxiety', 'panic', 'overwhelmed',
    'hopeless', 'alone', 'lonely', 'drained', 'tired', 'exhausted',
    'burnout', 'can\'t cope', 'no point', 'give up', 'suffocating',
    'lost', 'unbearable', 'drowning', 'empty', 'help me', 'crisis',
    'distressed', 'miserable', 'heartbroken', 'scared', 'fearful',
    'shaking', 'crying', 'tears', 'heavy', 'worthless', 'failure',
    'useless', 'hating myself'
];

private const CRISIS_TERMS = [
    'suicide', 'kill myself', 'end my life', 'self harm', 'hurt myself',
    'jump off', 'wish i were dead', 'better off without me', 'take my life',
    'dont want to live', 'sleeping pills', 'overdose', 'goodbye everyone',
    'no more pain', 'done with life', 'cutting', 'bleeding', 'hanging'
];
```

**Topic Detection:**

```php
private const CHAT_TOPICS = [
    'anxiety'  => ['anxiety', 'anxious', 'panic', 'overwhelmed', 'stress', ...],
    'study'    => ['exam', 'assignment', 'deadline', 'study', 'focus', ...],
    'sleep'    => ['sleep', 'insomnia', 'tired', 'exhausted', 'rest', ...],
    'sadness'  => ['sad', 'depressed', 'hopeless', 'alone', 'lonely', ...],
    'relationships' => ['relationship', 'breakup', 'friend', 'partner', ...],
    'financial' => ['fees', 'tuition', 'money', 'rent', 'debt', ...],
];
```

#### 3. Risk Score Calculation

The **forecast risk score** is calculated using a weighted algorithm:

```php
private function buildForecastRiskScore(array $snapshot): int
{
    // Base score from diagnostics (weighted average)
    if ($diagnosticScore !== null) $weightedSum += $diagnosticScore * 0.40;
    if ($aiScore !== null) $weightedSum += $aiScore * 0.34;
    
    // Add contextual modifiers
    $base += min(18, $distressRatio * 100 * 0.18);      // Distress signals
    $base += min(12, $cancelRate * 100 * 0.12);          // Cancellation rate
    $base += min(12, $lowMoodLogs * 2.5);                // Low mood logs
    
    // Trend adjustment
    if ($trendDelta >= 12) $base += min(12, $trendDelta * 0.45);  // Worsening
    if ($trendDelta <= -12) $base -= min(10, abs($trendDelta) * 0.30);  // Improving
    
    // Crisis override - any crisis message forces high risk
    if ($crisisMessages > 0) $base = max($base, 90);
    
    // Protective factors reduce risk
    $base -= min(10, $upcomingAppointments * 4);         // Scheduled support
    $base -= min(8, $completedSessions * 1.5);           // Engagement
    
    return clamp($base, 0, 100);
}
```

**Risk Level Mapping:**

| Score Range | Level | Description |
|-------------|-------|-------------|
| 0-39 | `low` | Routine monitoring |
| 40-69 | `medium` | Elevated attention |
| 70-84 | `high` | Priority follow-up needed |
| 85-100 | `critical` | Immediate intervention required |

#### 4. Trend Detection

```php
private function buildTrendLabel(array $snapshot): string
{
    if ($crisisMessages > 0 || $delta >= 12) return 'rising';    // Worsening
    if ($delta <= -12) return 'improving';                        // Getting better
    if ($cancelRate >= 0.4 && $upcomingAppointments === 0) return 'fragile';
    return 'steady';                                              // Stable
}
```

#### 5. Focus Area Determination

```php
private function buildFocusArea(array $snapshot, int $riskScore): string
{
    if ($crisisMessages > 0 || $riskScore >= 85) {
        return 'Immediate safety review';
    }
    
    return match ($dominantTopic) {
        'anxiety' => 'Stress regulation and grounding',
        'study' => 'Academic pressure stabilization',
        'sleep' => 'Sleep recovery support',
        'sadness' => 'Mood recovery and connection',
        'relationships' => 'Relationship coping support',
        'financial' => 'Practical support planning',
        default => 'Routine wellbeing support',
    };
}
```

#### 6. Recommended Actions

```php
private function buildRecommendedActions(array $snapshot, int $riskScore, string $focusArea): array
{
    if ($riskScore >= 85) {
        $actions[] = 'Escalate to a counselor or crisis contact immediately';
    } elseif ($riskScore >= 70) {
        $actions[] = 'Book or confirm a counselor follow-up within 48 hours';
    } elseif ($riskScore >= 45) {
        $actions[] = 'Keep a structured check-in this week';
    }
    
    if ($cancelRate >= 0.35) {
        $actions[] = 'Reduce cancellations by choosing one stable session slot';
    }
    
    if ($upcomingAppointments === 0) {
        $actions[] = 'No follow-up scheduled. Add one support session.';
    }
    
    // Focus-specific action
    $actions[] = match ($focusArea) {
        'Stress regulation and grounding' => 'Use one short grounding cycle today',
        'Academic pressure stabilization' => 'Break workload into one short focus block',
        'Sleep recovery support' => 'Protect tonight with a wind-down routine',
        'Mood recovery and connection' => 'Reach out to one trusted person today',
        ...
    };
    
    return $actions;
}
```

### ML Signals Output

```typescript
interface MlSignals {
  modelVersion?: string;           // 'mindful-lightweight-ml-v1'
  conversationTopic?: string;       // Detected topic from current message
  focusArea?: string;              // Primary concern area
  riskForecast?: {                 // Risk prediction
    score?: number;                // 0-100
    level?: string;                // low, medium, high, critical
    confidence?: number;           // 35-95 (based on signal count)
  };
  trend?: {                       // Conversation trend
    label?: string;                // improving, rising, steady, fragile
    delta?: number;                // Change from previous diagnostic
  };
  dominantTopics?: string[];       // Top 2 topics discussed
  recommendedActions?: string[];   // Up to 4 suggested interventions
  lowBandwidthMode?: boolean;      // Always true for efficiency
}
```

### Confidence Estimation

Confidence is based on the number of available data signals:

```php
private function estimateConfidence(array $snapshot): int
{
    $signals = 0;
    if ($diagnosticScore !== null) $signals++;
    if ($aiScore !== null) $signals++;
    if ($appointments > 0) $signals++;
    if ($sessions > 0) $signals++;
    if ($chatMessages > 0) $signals++;
    if ($moodLogs > 0) $signals++;
    
    return clamp(35 + ($signals * 10), 35, 95);
}
```

| Signals | Confidence | Interpretation |
|---------|------------|----------------|
| 0 | 35% | Limited data, use with caution |
| 3 | 65% | Moderate confidence |
| 6+ | 95% | High confidence |

### Protective Factors

The system identifies positive factors that reduce risk:

```php
private function buildProtectiveFactors(array $snapshot, string $trendLabel): array
{
    $factors = [];
    if ($upcomingAppointments > 0) {
        $factors[] = 'Has upcoming support scheduled.';
    }
    if ($completedSessions >= 2) {
        $factors[] = 'Consistent engagement with counseling.';
    }
    if ($trendLabel === 'improving') {
        $factors[] = 'Wellness trend is moving positively.';
    }
    if ($moodLogs >= 5) {
        $factors[] = 'Active self-monitoring of mood.';
    }
    return $factors;
}
```

### Counselor Ranking (ML-Powered)

When a student needs to book an appointment, the ML system ranks counselors:

```php
public function rankCounselorsForStudent(User $student, array $options = []): array
{
    // Calculate scores for each counselor:
    $availabilityScore = $isOnline ? 100 : max(35, 85 - $minutesOffline);
    $workloadScore = max(30, 100 - ($activeSessions * 22) - ($upcomingAppointments * 6));
    $reliabilityScore = round(($completedAppointments / $scheduledAppointments) * 100);
    $experienceScore = $studentRiskScore >= 70 
        ? min(100, 45 + ($highRiskExperience * 12))
        : min(100, 55 + ($completedAppointments * 3));
    $continuityScore = $priorSessions > 0 ? min(100, 70 + ($priorSessions * 10)) : 20;
    
    // Weighted final score
    $finalScore = ($availability * 0.18) + ($workload * 0.18) + ($reliability * 0.25)
                + ($experience * 0.18) + ($continuity * 0.16) + ($mode * 0.05);
}
```

**Ranking Weights:**

| Factor | Weight | Rationale |
|--------|--------|-----------|
| Reliability | 25% | Most important - will they show up? |
| Availability | 18% | Can they respond quickly? |
| Workload | 18% | Do they have capacity? |
| Experience | 18% | Can they handle this case? |
| Continuity | 16% | Have they worked with this student? |
| Mode | 5% | Online/offline preference |

### Admin ML Dashboard

The system provides an ML overview for administrators:

```php
public function buildAdminMlOverview(): array
{
    return [
        'model_version' => 'mindful-lightweight-ml-v1',
        'students_needing_follow_up' => 12,    // Risk >= 70
        'rising_risk_students' => 5,           // Trend = rising
        'chat_support_utilization_30d' => 45,  // Students using AI chat
        'proactive_follow_up_coverage' => 75.5, // % with appointments
        'risk_forecast_distribution' => [
            'low' => 150,
            'medium' => 35,
            'high' => 10,
            'critical' => 2,
        ],
        'validation' => [
            'diagnostic_agreement_rate' => 87.5,  // AI vs diagnostic alignment
            'fairness_gap' => 3.2,                 // Anonymous vs named avg
            'fairness_status' => 'stable',         // <= 10 gap
        ],
        'ethics' => [
            'privacy' => 'Aggregated features only. No PII in ML.',
            'human_review_required' => true,
            'low_bandwidth_mode' => true,
        ],
    ];
}
```

### Privacy & Ethics

The ML system is designed with privacy-first principles:

1. **No PII in ML** - Names, emails, and identifiers are excluded from ML processing
2. **Aggregated Features Only** - Only behavioral aggregates are used for scoring
3. **Explainable Scores** - Every score has explicit thresholds and match reasons
4. **Human Review Required** - ML assists but never replaces human judgment
5. **Fairness Monitoring** - Tracks gap between anonymous and named students
6. **Low Bandwidth Mode** - Optimized for resource-constrained environments

### Model Version

Current version: `mindful-lightweight-ml-v1`

This is a **rule-based, deterministic system** - not a neural network. This ensures:
- **Predictability** - Same inputs always produce same outputs
- **Auditability** - Every decision can be traced to specific rules
- **No Training Data Required** - Works immediately without ML training
- **Low Latency** - Sub-150ms response time budget
- **No GPU Required** - Runs on standard PHP infrastructure

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

---

## End-to-End Encrypted Chat (E2E)

The system implements **true end-to-end encryption** for counseling sessions, ensuring that messages can only be read by the intended participants - not even the server can decrypt them.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    E2E Encryption Flow                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Student Device                    Counselor Device              │
│  ┌──────────────┐                  ┌──────────────┐             │
│  │ Device Key   │                  │ Device Key   │             │
│  │ Pair (RSA)   │                  │ Pair (RSA)   │             │
│  └──────┬───────┘                  └──────┬───────┘             │
│         │                                 │                      │
│         │ 1. Exchange Public Keys         │                      │
│         │◄───────────────────────────────►│                      │
│         │                                 │                      │
│         │ 2. Generate Session Key (AES)   │                      │
│         │    Encrypt with Peer's RSA Pub  │                      │
│         │────────────────────────────────►│                      │
│         │                                 │                      │
│         │ 3. All messages encrypted       │                      │
│         │    with shared AES-256-GCM      │                      │
│         │◄───────────────────────────────►│                      │
│         │                                 │                      │
│  └──────┴───────┘                  └──────┴───────┘             │
│                                                                  │
│                        Server                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Stores only encrypted ciphertext + E2E envelopes        │   │
│  │  Cannot decrypt messages (no private keys)               │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Cryptographic Algorithms

| Component | Algorithm | Key Size | Purpose |
|-----------|-----------|----------|---------|
| Device Keys | RSA-OAEP | 2048-bit | Encrypt/decrypt session key |
| Session Key | AES-GCM | 256-bit | Encrypt/decrypt messages |
| Key Exchange | Hybrid RSA-AES | - | Secure session key transfer |
| IV (Nonce) | Random | 96-bit | Unique per message |

### Key Hierarchy

```
┌─────────────────────────────────────────┐
│         Device Key Pair (RSA)           │
│   Stored in localStorage, per device    │
│   - Generated once, reused              │
│   - Never sent to server                │
└─────────────────┬───────────────────────┘
                  │
                  │ Wraps
                  ▼
┌─────────────────────────────────────────┐
│         Session Key (AES-256)            │
│   - One per chat session                 │
│   - Generated by initiator               │
│   - Exchanged via RSA-encrypted envelope │
│   - Stored encrypted in localStorage     │
└─────────────────┬───────────────────────┘
                  │
                  │ Encrypts
                  ▼
┌─────────────────────────────────────────┐
│           Messages                       │
│   - Each message: IV + ciphertext        │
│   - AES-GCM provides authenticity        │
│   - Cannot be decrypted by server        │
└─────────────────────────────────────────┘
```

### Handshake Protocol

The E2E handshake establishes a shared session key between participants:

```
Step 1: Public Key Exchange
┌─────────────┐                    ┌─────────────┐
│  Student    │                    │  Counselor  │
│             │──[pub envelope]────►│             │
│             │    {publicKey}      │             │
│             │◄─[pub envelope]────│             │
│             │    {publicKey}      │             │
└─────────────┘                    └─────────────┘

Step 2: Session Key Transfer (Initiator only)
┌─────────────┐                    ┌─────────────┐
│  Initiator  │                    │  Receiver   │
│ (lower ID)  │──[key envelope]────►│             │
│             │ {encryptedKey}      │             │
│             │ (RSA-OAEP wrapped)  │             │
└─────────────┘                    └─────────────┘

Step 3: Secure Communication
┌─────────────┐                    ┌─────────────┐
│  Both       │◄──[AES-GCM msg]───►│  Both       │
│  parties    │    encrypted        │  parties    │
└─────────────┘                    └─────────────┘
```

**Initiator Selection**: The participant with the **lower user ID** initiates the session key exchange. This prevents both parties from generating conflicting keys.

### Envelope Types

```typescript
// Public Key Envelope
interface E2EPublicEnvelope {
  __e2e: 'v1';
  kind: 'pub';
  from: number;           // Sender user ID
  to: number;             // Recipient user ID
  sessionId: string;      // Chat session ID
  publicKey: string;      // RSA public key (base64 SPKI)
  createdAt: number;      // Timestamp
}

// Session Key Envelope
interface E2ESessionKeyEnvelope {
  __e2e: 'v1';
  kind: 'key';
  from: number;
  to: number;
  sessionId: string;
  encryptedSessionKey: string;  // AES key encrypted with peer's RSA
  createdAt: number;
}
```

### Encryption Process

```typescript
// 1. Generate random IV
const iv = crypto.getRandomValues(new Uint8Array(12));

// 2. Encrypt message with AES-GCM
const encrypted = await crypto.subtle.encrypt(
  { name: 'AES-GCM', iv },
  sessionKey,
  new TextEncoder().encode(message)
);

// 3. Combine IV + ciphertext
const combined = new Uint8Array(iv.length + encrypted.byteLength);
combined.set(iv, 0);
combined.set(new Uint8Array(encrypted), iv.length);

// 4. Base64 encode for transmission
const ciphertext = uint8ToBase64(combined);
```

### Decryption Process

```typescript
// 1. Base64 decode
const combined = base64ToUint8(ciphertext);

// 2. Extract IV and ciphertext
const iv = combined.slice(0, 12);
const ciphertext = combined.slice(12);

// 3. Decrypt with AES-GCM
const decrypted = await crypto.subtle.decrypt(
  { name: 'AES-GCM', iv },
  sessionKey,
  ciphertext
);

// 4. Decode to string
const plaintext = new TextDecoder().decode(decrypted);
```

### Message Visual States

The UI displays different states for encrypted messages:

| State | Description | UI Indicator |
|-------|-------------|--------------|
| `plain` | Unencrypted message | No indicator |
| `decrypted` | Successfully decrypted | 🔓 Lock icon |
| `awaiting_key` | Waiting for session key | ⏳ Loading spinner |
| `needs_resync` | Key mismatch, needs re-handshake | ⚠️ Warning icon |
| `payload_invalid` | Corrupted ciphertext | ❌ Error icon |

### Key Storage

```typescript
// Device Keys (persistent across sessions)
localStorage.setItem('e2e_device_public_key_v1', publicKeyBase64);
localStorage.setItem('e2e_device_private_key_v1', privateKeyBase64);

// Peer Public Keys (per session)
localStorage.setItem(`chat_peer_pub_${sessionId}_${peerId}`, peerPublicKey);

// Session Keys (per participant pair)
localStorage.setItem(`chat_key_v2_${sessionId}_${userA}_${userB}`, sessionKey);
```

### Security Properties

1. **Forward Secrecy**: Each session uses a unique key; compromising one session doesn't affect others
2. **Authentication**: AES-GCM provides integrity and authenticity guarantees
3. **Confidentiality**: Server stores only ciphertext; cannot read messages
4. **Key Isolation**: Device keys never leave the client device
5. **Participant Verification**: Envelopes include sender/recipient IDs to prevent injection

### Crisis Detection Exception

For safety, **crisis terms are detected BEFORE encryption**:

```typescript
// Crisis detection runs on plaintext before encryption
const crisisTerms = detectCrisisTermsInText(message);
if (crisisTerms.length > 0) {
  // Alert system triggered while still preserving E2E for content
  // The presence of crisis terms is logged, not the message content
}
```

This ensures safety while maintaining message privacy.

### Performance Optimizations

1. **Decrypt Cache**: LRU cache (250 entries) avoids re-decrypting same ciphertext
2. **Web Worker**: Large messages (>3200 chars) decrypted off main thread
3. **Key Fingerprinting**: Cache key fingerprint avoids redundant key exports
4. **Batch Decryption**: Messages decrypted in batches of 8 for UI responsiveness

### Anonymous Sessions

The E2E system supports anonymous counseling sessions:

```typescript
// Anonymous sessions mask student_id in API responses
// Backend provides chat_peer_student_id for E2E handshake
const studentId = Number(session?.chat_peer_student_id ?? session?.student_id);

// Counselor sees anonymous identifier, not real student ID
// E2E encryption still works with anonymous identifiers
```

### Error Recovery

```typescript
// If decryption fails, message shows placeholder
if (!decryptionResult.ok) {
  message.e2eVisual = 'payload_invalid';
  message.decryptedContent = '[Unable to decrypt message]';
}

// Re-handshake triggered if keys don't match
if (!encryptionKeyRef.current) {
  await sendPublicKeyEnvelope(peerId);
  // Session key exchange will follow
}
```

### Implementation Files

| File | Purpose |
|------|---------|
| `src/lib/encryption.ts` | Core crypto operations (AES, RSA) |
| `src/hooks/useEncryptedChat.ts` | E2E chat state management |
| `src/types/e2eChat.ts` | Visual state types |
| `src/lib/chatSessionKeys.ts` | Session key persistence |
| `src/workers/chatDecrypt.worker.ts` | Off-main-thread decryption |
