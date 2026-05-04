# Mindful AU Counseling System

Mindful AU is a counseling platform with role-based access for students, staff, and admins.

Full cross-repo manual: `../CMS_MANUAL.md`  
If this repository sits next to `mindful-au-backend` under a shared parent, see also `../README.md` for a workspace overview.

## Portals

- `Student Portal`: dashboard, chat, appointments, wellness check-ins, AI support, video sessions, diagnostic assessment, history.
- `Staff Portal`: **counselors** use `/counselor/*` (including `/counselor/2fa` when two-factor is required). **Peer counselors** use `/peer/*` (including `/peer/2fa`) and the peer messaging experience (e.g. `/peer/chats`). Case assignment, escalations, and session notes follow role permissions.
- `Admin Portal`: account approval, analytics, settings, and platform oversight.

## Key Features

- Institutional Google OAuth with domain restrictions.
- Email/password login for approved non-student roles.
- Peer counselor assignment with notification flow.
- Anonymous support mode for protected student identity in chat, appointments, and calls.
- End-to-end encrypted messaging with delivery/seen receipts.
- Real-time chat attachments with image previews, document downloads, and playable voice notes.
- Server-backed chat message deletion (sender/admin authorized, synced across devices).
- Secure real-time call flow with stable signaling, call-request/accept/reject, reconnect handling, and quality telemetry.
- Appointment-based video call access windows.
- Daily wellness tip cards with per-user daily caching, favorites, and notification integration.
- Optional real-time voice anonymization filters during calls (neutral mask, pitch shift, tone modulation, robotic).
- Speaking-activity indicators and low-bandwidth call handling.
- Screen-capture deterrence on sensitive routes (watermark, blur-on-inactive, copy/context restrictions, warning overlay).
- Daily student mood check-in enforcement (once per day).
- **Student dashboard** (`/student/dashboard`): aggregates open chat sessions, truly upcoming appointments (status + future `scheduled_at`), wellness score, and **AI assistant usage (30 days)** from the wellness summary ML snapshot when available; tolerates partial API failures (`Promise.allSettled`); optional **soft refresh** when returning to the tab (throttled, e.g. 45s); daily mood buttons; panic support strip with **`988`** hotline shortcut and emergency log action (server notifies **professional staff**, not peers).
- API resilience: retry on transient failures, base URL failover, and stale-if-error cache fallback.

## Tech Stack

- Frontend: React, TypeScript, Vite, Tailwind, shadcn/ui.
- Backend: Laravel (Sanctum auth, REST API).
- Database: SQLite (default local), MySQL/MariaDB, or PostgreSQL.

## Quick Start

### 1) Backend

Run the API from the sibling backend repository:

```sh
cd ../mindful-au-backend
composer install
cp .env.example .env
php artisan key:generate
php artisan migrate
php artisan serve
```

If you use the default local SQLite settings from `../mindful-au-backend/.env.example`, create `../mindful-au-backend/database/database.sqlite` before running migrations.

Backend runs at `http://127.0.0.1:8000`.

### 2) Frontend

Run the web app from this repository:

```sh
cp .env.example .env
npm install
npm run dev
```

Frontend runs at `http://127.0.0.1:5173`.

## Environment (../mindful-au-backend/.env)

Set at minimum:

```env
APP_URL=http://127.0.0.1:8000
FRONTEND_URL=http://127.0.0.1:5173

GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URL=http://127.0.0.1:8000/api/auth/google/callback
INSTITUTION_EMAIL_DOMAINS=africau.edu

AUTH_REQUIRE_GOOGLE_FOR_STUDENTS=true
AUTH_AUTO_PROVISION_STUDENTS=true
```

## Deployment Checklist

When hosting frontend and backend, set these values explicitly to avoid `Network Error` and failed data loads:

Frontend (`.env` from `.env.example`):

```env
VITE_API_URL=https://your-api-domain.com/api
VITE_API_TIMEOUT_MS=45000
```

Backend (`../mindful-au-backend/.env` from `../mindful-au-backend/.env.example`):

```env
APP_URL=https://your-api-domain.com
FRONTEND_URL=https://your-frontend-domain.com
CORS_ALLOWED_ORIGINS=https://your-frontend-domain.com
CORS_SUPPORTS_CREDENTIALS=false
```

Notes:
- If frontend and backend are on the same domain, `VITE_API_URL` can be omitted and the app falls back to `https://your-domain/api`.
- For reliable student-to-counselor audio/video across mobile, carrier NAT, school, or office networks, configure TURN as well as STUN:

```env
VITE_WEBRTC_ICE_SERVERS=[{"urls":["stun:stun.l.google.com:19302"]},{"urls":["turn:turn.example.com:3478?transport=udp","turn:turn.example.com:3478?transport=tcp"],"username":"turn-user","credential":"turn-password"}]
VITE_WEBRTC_TURN_URLS=turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp
VITE_WEBRTC_TURN_USERNAME=turn-user
VITE_WEBRTC_TURN_CREDENTIAL=turn-password
```

- Restart backend after env changes: `php artisan config:clear && php artisan cache:clear`.
- Do not place provider secrets (for example OpenRouter private keys) in `VITE_*` frontend env vars.
- Health probes:
  - liveness: `GET /api/health`
  - readiness (db + cache): `GET /api/ready`

## Production Runbook

Backend startup (PHP-FPM/Nginx stack recommended, not `php artisan serve`):

```sh
cd ../mindful-au-backend
php artisan migrate --force
php artisan config:cache
php artisan route:cache
php artisan view:cache
php artisan event:cache
php artisan queue:work --queue=default --tries=3
php artisan schedule:work
```

### Docker / Dokploy

Production-ready container files are included:

- `Dockerfile`
- `deploy/nginx/default.conf`
- `../mindful-au-backend/Dockerfile`
- `../mindful-au-backend/docker-compose.yml`
- `../mindful-au-backend/.env.example`

Quick start:

```sh
cd ../mindful-au-backend
cp .env.example .env
php artisan key:generate
docker compose up -d --build
docker compose exec app php artisan migrate --force
```

Health endpoints (for Dokploy checks):

- readiness: `GET /health`
- liveness: `GET /live`

Pre-deploy env validation:

```sh
node ../mindful-au-backend/scripts/validate-production-env.mjs
```

Frontend deploy:

```sh
npm ci
npm run build
```

## Real-Time Chat Attachments

- Upload transport: `FormData` to `POST /api/chat/upload-file`
- Message sync: attachment metadata is returned in normal chat message payloads
- Rendering:
  - images: inline preview thumbnails
  - documents: file card with download action
  - audio: embedded player for voice notes
- Default limit: `5 MB`
- Supported types:
  - images: `jpg`, `jpeg`, `png`, `gif`
  - documents: `pdf`, `docx`, `txt`
  - audio: `mp3`, `wav`, `webm`, `ogg`, `m4a`, `aac`

## Daily Wellness Tips

- Dashboard cards load from `GET /api/wellness/tip`
- The current tip is cached locally per authenticated user for the served date
- Users can save or unsave tips without losing the current card state
- The same daily tip can surface in the notifications view because the backend creates one notification on first daily delivery
- UI is optimized for low bandwidth: one small JSON request, local reuse for the rest of the day, and lightweight card rendering

## Video And Audio Calls

- Signaling uses Supabase broadcast channels.
- Media transport uses browser WebRTC with configurable ICE servers.
- Student and counselor call pages share a common `useWebRTC` hook for offer/answer flow, track handling, and reconnect recovery.
- Current implementation includes:
  - preflight media access before accepting an incoming call
  - stable signaling subscriptions per active session
  - remote audio/video track refresh on mute, unmute, and end events
  - low-bandwidth media constraints and live quality telemetry

If calls work on the same network but fail across different laptops or off-campus networks, TURN configuration is the first thing to verify.

## Chat Message Deletion

- Endpoint: `DELETE /api/sessions/{sessionId}/messages/{messageId}`
- Authorization:
  - `admin`: can delete any message in the session
  - session participants: can delete only messages they sent
- Behavior:
  - deletes from backend storage (not device-local hide)
  - deletion is reflected on subsequent sync/poll and realtime hints

## Privacy and Anonymity Controls

- Anonymous aliases use the `User_XXXX` format.
- Student identity is hidden by default in anonymous sessions.
- Controlled identity reveal is restricted and audited:
  - `POST /api/sessions/{id}/reveal-identity` (authorized counselor/admin + required reason)
- Anonymous sessions have TTL-based expiry for misuse prevention (`ANONYMOUS_SESSION_TTL_HOURS` on backend).
- Privacy deterrence for capture risk is active on sensitive web routes:
  - right-click/copy/cut/drag blocking
  - shortcut-triggered warning shield
  - auto-obscure when tab/app loses focus
  - timestamped watermark overlay

## ML Readiness and Monitoring

- ML integration is lightweight and explainable (local-first scoring + optional external providers).
- AI chat includes provider fallback logic and deterministic local wellness fallback.
- Admin ML operational health endpoint:
  - `GET /api/ml/health`
  - includes fallback rate, provider distribution, inference volume, average/p95 latency, and risk monitoring indicators.
- Admin analytics includes `ml_intelligence` payload for validation, fairness status, and readiness signals.

Additional ML docs:

- `../mindful-au-backend/docs/ml-integration.md`
- `../mindful-au-backend/docs/screen-capture-privacy-protection.md`

## Quality Checks

From this repository:

```sh
npm run check:prod
```

Equivalent manual checks:

```sh
npm run lint
npx tsc --noEmit
npm run build
composer --working-dir=../mindful-au-backend test
```

## Database Schema

- Canonical SQL snapshot: `../mindful-au-backend/database/schema.sql`
- Schema includes peer assignment, escalations, login logs, student mood logs, message seen receipts, and performance indexes.
- Keep schema in sync with migrations when adding/changing tables.

## Project Structure

- `src/pages/student/`: student pages (including `StudentDashboard.tsx`)
- `src/pages/counselor/`: counselor UI; peer-specific flows live under peer routes/components as configured in `src/App.tsx`
- `src/pages/admin/`: admin pages
- `src/hooks/`: frontend hooks
- `src/lib/api.ts`: API client
- `../mindful-au-backend/app/Http/Controllers/`: backend controllers
- `../mindful-au-backend/routes/api.php`: API routes
