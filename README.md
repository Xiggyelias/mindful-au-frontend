# Mindful AU Counseling System

Mindful AU is a counseling platform with role-based access for students, staff, and admins.

## Portals

- `Student Portal`: chat, appointments, wellness check-ins, AI support, video sessions.
- `Staff Portal`: counselor and peer counselor workflows, case assignment, escalations, session notes.
- `Admin Portal`: account approval, analytics, settings, and platform oversight.

## Key Features

- Institutional Google OAuth with domain restrictions.
- Email/password login for approved non-student roles.
- Peer counselor assignment with notification flow.
- Anonymous support mode for protected student identity in chat.
- End-to-end encrypted messaging with delivery/seen receipts.
- Server-backed chat message deletion (sender/admin authorized, synced across devices).
- Appointment-based video call access windows.
- Daily student mood check-in enforcement (once per day).
- API resilience: retry on transient failures, base URL failover, and stale-if-error cache fallback.

## Tech Stack

- Frontend: React, TypeScript, Vite, Tailwind, shadcn/ui.
- Backend: Laravel (Sanctum auth, REST API).
- Database: SQLite (default local), MySQL/MariaDB, or PostgreSQL.

## Quick Start

### 1) Backend

```sh
cd backend
composer install
cp .env.example .env
php artisan key:generate
php artisan migrate
php artisan serve
```

If you use the default local SQLite settings from `backend/.env.example`, create `backend/database/database.sqlite` before running migrations.

Backend runs at `http://127.0.0.1:8000`.

### 2) Frontend

```sh
cd frontend
cp .env.example .env
npm install
npm run dev
```

Frontend runs at `http://127.0.0.1:5173`.

## Environment (backend/.env)

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

Frontend (`frontend/.env` from `frontend/.env.example`):

```env
VITE_API_URL=https://your-api-domain.com/api
VITE_API_TIMEOUT_MS=45000
```

Backend (`backend/.env` from `backend/.env.production.example`):

```env
APP_URL=https://your-api-domain.com
FRONTEND_URL=https://your-frontend-domain.com
CORS_ALLOWED_ORIGINS=https://your-frontend-domain.com
CORS_SUPPORTS_CREDENTIALS=false
```

Notes:
- If frontend and backend are on the same domain, `VITE_API_URL` can be omitted and the app falls back to `https://your-domain/api`.
- Restart backend after env changes: `php artisan config:clear && php artisan cache:clear`.
- Do not place provider secrets (for example OpenRouter private keys) in `VITE_*` frontend env vars.
- Health probes:
  - liveness: `GET /api/health`
  - readiness (db + cache): `GET /api/ready`

## Production Runbook

Backend startup (PHP-FPM/Nginx stack recommended, not `php artisan serve`):

```sh
cd backend
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

- `backend/Dockerfile`
- `frontend/docker-compose.yml`
- `frontend/deploy/nginx/default.conf`
- `backend/.env.production.example`

Quick start:

```sh
cp backend/.env.production.example backend/.env
php backend/artisan key:generate
docker compose -f frontend/docker-compose.yml up -d --build
docker compose -f frontend/docker-compose.yml exec app php artisan migrate --force
```

Health endpoints (for Dokploy checks):

- readiness: `GET /health`
- liveness: `GET /live`

Pre-deploy env validation:

```sh
node backend/scripts/validate-production-env.mjs
```

Frontend deploy:

```sh
cd frontend
npm ci
npm run build
```

## Chat Message Deletion

- Endpoint: `DELETE /api/sessions/{sessionId}/messages/{messageId}`
- Authorization:
  - `admin`: can delete any message in the session
  - session participants: can delete only messages they sent
- Behavior:
  - deletes from backend storage (not device-local hide)
  - deletion is reflected on subsequent sync/poll and realtime hints

## Quality Checks

From workspace root:

```sh
npm --prefix frontend run check:prod
```

Equivalent manual checks:

```sh
cd frontend
npm run lint
npx tsc --noEmit
npm run build
composer --working-dir=../backend test
```

## Database Schema

- Canonical SQL snapshot: `backend/database/schema.sql`
- Schema includes peer assignment, escalations, login logs, student mood logs, message seen receipts, and performance indexes.
- Keep schema in sync with migrations when adding/changing tables.

## Project Structure

- `src/pages/student/`: student pages
- `src/pages/counselor/`: counselor and peer counselor pages
- `src/pages/admin/`: admin pages
- `src/hooks/`: frontend hooks
- `src/lib/api.ts`: API client
- `backend/app/Http/Controllers/`: backend controllers
- `backend/routes/api.php`: API routes
