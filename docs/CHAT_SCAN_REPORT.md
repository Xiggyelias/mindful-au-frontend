# Chat Section Technical Scan Report

This report provides a comprehensive technical overview of the chat section in the Mindful AU Counseling System, covering architecture, security, and feature implementation.

## 1. Architecture & Real-time Synchronization

The chat system implements a robust, low-latency communication layer using a hybrid approach:

- **Supabase Realtime Broadcast**: Used for immediate UI updates such as:
  - Typing indicators (`typing` event)
  - Message delivery notifications (`message-updated` event)
  - Message deletion synchronization (`message-deleted` event)
  - Session key requests (`request-session-key` event)
- **Intelligent Polling fallback**: Implemented in `useEncryptedChat.ts`.
  - **Active Polling**: 2.8 seconds when the user is actively engaged or a peer is typing.
  - **Idle Polling**: 6.5 seconds when the session is inactive.
- **Warm Hydration & Preloading**:
  - `chatPreloadCache.ts` uses `sessionStorage` to cache the last 40 messages per session.
  - `useChatPreloader.ts` optimistically fetches messages for adjacent conversations.
  - This ensures that when a user clicks a conversation, the history appears instantly while fresh data fetches in the background.
- **List Virtualization**: Both `MessageList.tsx` and `CounselorMessageThread.tsx` utilize `react-virtuoso` to handle large message histories without performance degradation.

## 2. End-to-End Encryption (E2EE)

Security is at the core of the messaging experience, utilizing the Web Crypto API:

- **Encryption Standards**:
  - **AES-GCM-256**: Used for encrypting actual message payloads.
  - **RSA-OAEP (2048-bit)**: Used for the secure "wrap" and exchange of AES session keys.
- **Key Storage**:
  - **IndexedDB**: Device RSA key pairs (`e2ee-keystore`) and AES session keys (`cms_e2e_session_keys_v1`) are stored in IndexedDB to support `CryptoKey` objects and avoid `localStorage` limitations.
- **Handshake Protocol**:
  - Initiators (typically the lower user ID) generate the AES session key.
  - `kind:pub` envelopes exchange RSA public keys.
  - `kind:key` envelopes transmit the RSA-wrapped AES session key.
  - **History Catch-up**: The system can scan up to 50 pages of history to find a missing session key envelope for users joining an existing thread.
- **Worker-based Decryption**:
  - `chatDecrypt.worker.ts` offloads heavy decryption tasks for large payloads to a background thread, preventing UI jank.

## 3. Core Features & UX

- **Anonymity Controls**:
  - Support for fully anonymous sessions where students use aliases.
  - `sent_as_anonymous` flag on each message ensures historical consistency even if session anonymity is toggled mid-conversation.
- **Rich Media Support**:
  - **Attachments**: Images (with inline previews), PDF/DOCX documents, and Text files.
  - **Voice Memos**: Integrated recording and playback with `VoiceMemoPlayer.tsx`.
  - **Signed URLs**: Attachment security is handled via short-lived signed URLs refreshed on failure.
- **Safety & Compliance**:
  - **Crisis Term Detection**: Scans outbound messages for crisis keywords (`crisisTerms.ts`) and reports signals to the server even if the body is encrypted.
  - **Panic Escalation**: Immediate escalation path for students in distress.
  - **Identity Reveal**: Audited process for counselors to reveal a student's identity in emergency scenarios.
- **In-App Notifications**:
  - `ChatIncomingNotificationHost.tsx` provides persistent global polling for new messages.
  - Supports background notifications and decrypted message previews in banners.

## 4. Key Files & Hooks

- `src/hooks/useEncryptedChat.ts`: The primary engine for E2E logic and message synchronization.
- `src/hooks/useChatSession.ts`: Manages the list of active/past sessions and session lifecycle.
- `src/lib/encryption.ts`: Low-level Web Crypto wrappers.
- `src/components/chat/MessageList.tsx`: Virtualized UI for the student-facing message thread.
- `src/components/chat/CounselorMessageThread.tsx`: Virtualized UI for the staff-facing message thread.
- `src/workers/chatDecrypt.worker.ts`: Background decryption worker.

---
*Scan completed by Jules.*
