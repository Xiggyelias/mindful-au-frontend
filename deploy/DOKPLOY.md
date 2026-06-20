# Dokploy Deployment (mindful-au-frontend)

This guide covers deploying the **Vite + React** frontend to [Dokploy](https://dokploy.com/).

## Quick Start

1. In Dokploy, create a new **Application**.
2. Connect your Git repository (this repo).
3. Set **Build Type** to `Dockerfile`.
4. Ensure the Dockerfile path is `Dockerfile` (project root).
5. Add environment variables (see below).
6. Deploy.

## Build Arguments / Environment Variables

Set these in Dokploy **Build Arguments** or **Environment Variables** (do not commit real values):

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_API_URL` | Backend API base URL | `https://mindfulapi.africau.co.zw/api` |
| `VITE_API_TIMEOUT_MS` | API request timeout (ms) | `45000` |
| `VITE_SUPABASE_URL` | Supabase project URL | `https://xxx.supabase.co` |
| `VITE_SUPABASE_PROJECT_ID` | Supabase project ID | `xxx` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase anon/public key | `eyJ...` |

> **Note:** `VITE_*` variables are baked into the build at compile time. Rebuild after changing them.

## Health Check

- **Path:** `/health`
- Returns `200 OK` for liveness/readiness probes.

## Port

The container listens on **port 80**. Dokploy/Traefik will route traffic to it.

## Domain & HTTPS

1. In Dokploy, add a **Domain** to your application.
2. Enable **Generate SSL** for automatic Let's Encrypt certificates.

## Troubleshooting

- **502 Bad Gateway:** Ensure the app is listening on port 80 and `/health` returns 200.
- **Blank page / 404 on refresh:** The SPA nginx config (`deploy/nginx/spa.conf`) should serve `index.html` for all routes. Verify it's copied into the image.
- **API/CORS errors:** Ensure `VITE_API_URL` points to your backend and CORS is configured on the API to allow your frontend domain.
