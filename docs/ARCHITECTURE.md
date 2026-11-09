# Mindful AU — System Architecture & Component Diagrams

This document outlines the end-to-end architecture of **Mindful AU**, a secure mental health counseling and teletherapy platform comprising a React/TypeScript single-page application, a Laravel 11 API backend, Supabase Realtime signaling, peer-to-peer WebRTC media streaming, and an ML wellness scoring & crisis-detection pipeline.

**Legend (diagrams 1a and 1b):** solid arrow = synchronous REST / direct call · dashed arrow = async, signaling or push · thick double arrow = peer-to-peer media.

---

## 1a. System Architecture (Clients → API → Data)

Portal routing nodes (Student App / Counselor App) stand in for all REST calls made by each portal. Real-time signaling and push delivery are in diagram 1b.

```mermaid
flowchart LR
    subgraph Clients["Frontend Client Layer (React 18 + Vite + Tailwind)"]
        subgraph StudentUI["Student Portal"]
            SP_App["Student App / Routing"]
            SP_Chat["Chat & E2E Crypto"]
            SP_Video["StudentVideoCall.tsx"]
            SP_Appt["StudentAppointments.tsx"]
            SP_Panic["Emergency / Panic Request"]
        end

        subgraph CounselorUI["Counselor & Staff Portal"]
            CP_App["Counselor App / Routing"]
            CP_Chat["Supervised Chat & Roster"]
            CP_Video["CounselorVideo.tsx"]
            CP_Schedule["Slot Management"]
            CP_Alerts["Crisis & Triage Alerts"]
        end

        subgraph ClientCommon["Shared Client Infrastructure"]
            SW["Service Worker (sw.js / WebPush)"]
            Hook_Calls["useIncomingCalls (Tab Leader Election)"]
        end
    end

    subgraph Backend["Backend API Layer (Laravel 11 / PHP 8.2)"]
        subgraph Gateways["API Routing & Middleware"]
            AuthMid["Sanctum Auth & 2FA Middleware"]
            CorsMid["CORS & Role Gatekeeper"]
        end

        subgraph CoreControllers["Core Controllers"]
            ApptCtrl["AppointmentController"]
            VideoCtrl["VideoCallController"]
            CallInCtrl["Counselor / Student IncomingCallController"]
            SessCtrl["SessionController"]
            MsgCtrl["MessageController"]
            ProfCtrl["ProfileController"]
            EmergCtrl["EmergencyRequestController"]
        end

        subgraph SupportServices["Domain Coordinators & Services"]
            CallCoord["CallCoordinator (Concurrency & Distributed Locks)"]
            CallFormat["AppointmentCallFormat & Window Manager"]
            WebPushSvc["WebPushService (VAPID RFC 8292)"]
            ML_Svc["MentalHealthMlService (Crisis & Wellness Analysis)"]
        end
    end

    subgraph DataStorage["Data & Persistence Tier"]
        DB[("Primary Database: MySQL (prod) / SQLite (dev)")]
        CacheStorage["Analytics & Distributed Cache (File / Redis)"]
        FileStore["Encrypted Storage (Voice Notes & Attachments)"]
    end

    subgraph ExternalServices["External Cloud & Push Services"]
        GoogleOAuth["Google OAuth 2.0 (SSO)"]
        WebPushGateway["Browser Push Service (FCM / Mozilla Autopush)"]
    end

    %% Clients -> API
    SP_App --> AuthMid
    CP_App --> AuthMid
    Hook_Calls --> AuthMid
    SW --> AuthMid
    SP_App -. "OAuth Login" .-> GoogleOAuth

    %% Middleware chain
    AuthMid --> CorsMid
    CorsMid --> ApptCtrl
    CorsMid --> VideoCtrl
    CorsMid --> CallInCtrl
    CorsMid --> SessCtrl
    CorsMid --> MsgCtrl
    CorsMid --> ProfCtrl
    CorsMid --> EmergCtrl

    %% Controllers -> services
    ApptCtrl --> CallFormat
    VideoCtrl --> CallCoord
    VideoCtrl --> CallFormat
    VideoCtrl --> WebPushSvc
    CallInCtrl --> CallCoord
    MsgCtrl --> ML_Svc
    EmergCtrl --> WebPushSvc

    %% Persistence
    ApptCtrl & VideoCtrl & CallInCtrl & SessCtrl & MsgCtrl & ProfCtrl & EmergCtrl --> DB
    CallCoord & ML_Svc --> CacheStorage
    MsgCtrl --> FileStore

    %% Push out to external gateway
    WebPushSvc --> WebPushGateway
```

---

## 1b. Real-Time Call, Signaling & Push Flow

```mermaid
flowchart LR
    subgraph Clients["Client Browsers (Student & Counselor)"]
        VideoPages["StudentVideoCall.tsx / CounselorVideo.tsx"]
        Hook_RTC["useWebRTC (Engine State Machine)"]
        Hook_Calls["useIncomingCalls (Tab Leader Election)"]
        SW["Service Worker (sw.js / WebPush)"]
    end

    subgraph Backend["Backend API Layer (Laravel 11)"]
        VideoCtrl["VideoCallController"]
        EmergCtrl["EmergencyRequestController"]
        CallCoord["CallCoordinator (Concurrency & Distributed Locks)"]
        WebPushSvc["WebPushService (VAPID RFC 8292)"]
    end

    subgraph RealtimeMedia["Real-Time Signaling & Media Infrastructure"]
        SupaRT["Supabase Realtime (WSS)"]
        WebRTC_P2P[["P2P WebRTC Media Stream (SRTP/DTLS)"]]
        STUN_TURN["STUN / TURN Relay Servers (coturn)"]
    end

    WebPushGateway["Browser Push Service (FCM / Mozilla Autopush)"]

    %% Call setup (backend)
    VideoCtrl --> CallCoord
    VideoCtrl --> WebPushSvc
    EmergCtrl --> WebPushSvc
    CallCoord -. "Call signal wake (REST)" .-> SupaRT

    %% Wake-ups to clients
    SupaRT -. "Wake event" .-> Hook_Calls
    WebPushSvc -- "VAPID push" --> WebPushGateway
    WebPushGateway -- "Deliver push" --> SW
    SW -. "Subscribe" .-> WebPushGateway

    %% WebRTC signaling and media
    VideoPages --> Hook_RTC
    Hook_RTC -. "Offer / Answer / ICE" .-> SupaRT
    Hook_RTC <==> WebRTC_P2P
    WebRTC_P2P -. "Fallback relay" .-> STUN_TURN
```

---

## 2. Voice & Video Call Orchestration (WebRTC + Realtime Ringing)

This sequence diagram depicts call initiation, lock acquisition, concurrent ring resolution, peer wake-up, and WebRTC media establishment.

```mermaid
sequenceDiagram
    autonumber
    actor Student as Student (Caller)
    participant Back as Backend (VideoCallController + CallCoordinator)
    participant Supa as Supabase Realtime
    actor Counselor as Counselor (Callee)

    Note over Student,Counselor: Both users are in an active appointment window
    Student->>Back: POST /api/video-calls/authorize (appointment_id, call_type)
    Back->>Back: Acquire atomic lock on [student_id, counselor_id]
    Back->>Back: Sweep expired calls & check active conflicts (anti-glare)
    Back->>Back: Resolve format (enforces audio-only for anonymous)
    Back->>Back: Create CounselingCall (status: PENDING, caller_role: student)
    Back-->>Student: 200 OK (session_id, call_state: "CALLING", call_type)

    Back-)Supa: Broadcast RINGING signal (channel: user-wake-{counselor_id})
    Back-)Counselor: Send VAPID Web Push (if offline/background tab)
    Supa-)Counselor: Receive wake event {appointment_id, call_type, caller_role}

    Note over Counselor: CounselorIncomingCallBanner mounts & plays ringtone
    Counselor->>Back: PATCH /api/counselor/incoming-calls/{id} (status: "accepted")
    Back->>Back: Transition call status to ACCEPTED
    Back-)Supa: Broadcast ACCEPTED signal
    Counselor->>Counselor: Navigate to /counselor/video?autostart=1

    Counselor->>Back: POST /api/video-calls/authorize (autostart)
    Back-->>Counselor: 200 OK (reused active accepted call)

    Note over Student,Counselor: WebRTC Signaling via Supabase Channel (video-call-{appointment_id})
    Counselor-)Supa: Broadcast "call-accepted" (targetId: Student)
    Supa-)Student: Deliver "call-accepted"
    Student->>Student: initializeLocalMedia() & createPeerConnection()
    Student->>Student: createOffer(SDP)
    Student-)Supa: Broadcast "offer" (SDP)
    Supa-)Counselor: Deliver "offer"
    Counselor->>Counselor: setRemoteDescription(Offer) & createAnswer(SDP)
    Counselor-)Supa: Broadcast "answer" (SDP)
    Supa-)Student: Deliver "answer"
    Student->>Student: setRemoteDescription(Answer)

    Student-)Supa: Exchange ICE Candidates
    Counselor-)Supa: Exchange ICE Candidates

    Note over Student,Counselor: Media stream connects (direct P2P, DTLS-SRTP)
    Student-->>Counselor: Audio / video stream
    Counselor-->>Student: Audio / video stream

    Note over Student,Counselor: Call Hangup or Termination
    Student->>Back: POST /api/video-calls/end (appointment_id)
    Back->>Back: Mark CounselingSession completed (if window closed)
    Back-->>Student: 200 OK (session_still_open boolean)
    Student-)Supa: Broadcast "call-ended"
```

---

## 3. Privacy, Anonymity & Data Boundary Isolation

Mindful AU enforces strict anonymity boundaries between students and counselors. This diagram demonstrates how data projections isolate student PII at the API and database levels.

```mermaid
flowchart TD
    subgraph StudentPrivacyDomain["Student Privacy Domain"]
        Profile["Student Profile (anonymous_mode flag)"]
        BookingAction["Booking Action (is_anonymous toggle)"]
        ChatToggle["Session Anonymity Toggle"]
    end

    subgraph EnforcementEngine["Backend Anonymity & Format Engine"]
        CallFormatEngine["AppointmentCallFormat"]
        AnonProjection["applyAnonymousAppointmentProjection()"]
        MessageMasker["shouldMaskStudentIdentityForRecipient()"]
        SessionMasker["applyAnonymousProjection()"]
    end

    subgraph PublicApiBoundary["Restricted API Output Boundary"]
        subgraph MaskedPayload["Sanitized View for Counselor / Peers"]
            MaskedStudentId["student_id: 0"]
            MaskedName["name: 'Anonymous User'"]
            MaskedAvatar["avatar_url: null"]
            MaskedEmail["email: null"]
            ForcedAudio["call_type: 'audio' / notes: 'Online audio'"]
        end
    end

    subgraph SafetyBypass["Emergency / Safety Exceptions"]
        SafetyReveal["Clinical Safety Reveal (Self-Harm / Crisis)"]
        EmergencyBooking["Emergency Crisis Queue (is_emergency: true)"]
    end

    Profile --> CallFormatEngine
    BookingAction --> CallFormatEngine

    CallFormatEngine -->|"is_anonymous = true"| ForcedAudio
    BookingAction --> AnonProjection
    ChatToggle --> MessageMasker
    ChatToggle --> SessionMasker

    AnonProjection --> MaskedStudentId
    AnonProjection --> MaskedName
    AnonProjection --> MaskedAvatar
    AnonProjection --> MaskedEmail

    SessionMasker --> MaskedName
    MessageMasker -->|"Per-message sent_as_anonymous snapshot preserved"| MaskedName

    SafetyReveal -.->|"De-anonymize with Audit Trail"| AnonProjection
    EmergencyBooking -.->|"Force Identified Mode"| AnonProjection
```

---

## 4. ML Wellness Scoring & Crisis Detection Pipeline

```mermaid
flowchart LR
    subgraph InputStreams["Real-Time Content & Assessment Inputs"]
        ChatMessage["Plaintext Chat Message"]
        VoiceTrans["Voice Note Audio Transcript"]
        CheckinQuiz["PHQ-9 / GAD-7 Daily Check-In"]
    end

    subgraph ProcessingPipeline["ML & Analytics Pipeline"]
        Heuristics["Heuristic Regex Tokenizer (Urgent Crisis Terms)"]
        ML_Model["MentalHealthMlService (Feature Extraction & Scikit-learn Classifier)"]
        ScoreAggregator["Wellness Score Aggregator (0 - 100 Scale)"]
    end

    subgraph TriageActions["Escalation & Intervention Engine"]
        DirectSend["Normal Message Dispatch"]
        LowRisk["Routine Dashboard Wellness Trend Update (Low Risk)"]
        ModerateSupport["Targeted Recommendations & Coping Habits (Steady Support)"]
        HighRiskAlert["Triage Alert Triggered (NotificationCreated Event)"]
        EmergencyQueue["Automatic Emergency Case Elevation"]
        WebPushStaff["High-Priority VAPID Web Push to Duty Counselors"]
    end

    ChatMessage --> Heuristics
    ChatMessage --> ML_Model
    VoiceTrans --> Heuristics
    VoiceTrans --> ML_Model
    CheckinQuiz --> ScoreAggregator

    Heuristics -->|"Critical Keyword Detected"| HighRiskAlert
    ML_Model -->|"Risk Classification"| ScoreAggregator

    ScoreAggregator -->|"Score >= 60 (Good / Excellent)"| LowRisk
    ScoreAggregator -->|"Score 40 - 59 (Fair / Moderate)"| ModerateSupport
    ScoreAggregator -->|"Score < 40 (Needs Attention / Critical)"| HighRiskAlert

    ChatMessage --> DirectSend

    HighRiskAlert --> EmergencyQueue
    HighRiskAlert --> WebPushStaff
```
