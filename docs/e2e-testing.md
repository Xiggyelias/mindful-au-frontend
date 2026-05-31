# CMS E2E Testing

The Playwright suite covers the critical production contracts for CMS:

- role routing and protected dashboards
- counselor/student two-way chat
- peer counselor session isolation
- admin peer assignment and return flow
- delete-for-everyone response contract
- panic escalation notifications for professional staff, excluding peer counselors

## Local Run

Start from a migrated backend with the seeded test users:

```powershell
cd ..\mindful-au-backend
php artisan db:seed --class=TestUserSeeder
```

Student password login is disabled in normal production-like configs. For E2E, set this in the backend `.env`:

```dotenv
AUTH_REQUIRE_GOOGLE_FOR_STUDENTS=false
AUTH_REQUIRE_GOOGLE_FOR_STUDENT_STAFF=false
```

Then run from the frontend:

```powershell
cd ..\mindful-au-frontend
npm run test:e2e
```

Reports, screenshots, traces, and videos are written to:

```text
../mindful-au-backend/storage/testing/reports
```

## Browser Matrix

Chromium is the default stable gate. To include Firefox, WebKit, and mobile browser profiles:

```powershell
$env:CMS_E2E_FULL_MATRIX = "1"
npm run test:e2e
```
