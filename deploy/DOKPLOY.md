# Dokploy Deployment Notes (AUCMS)

## Stack

Use `docker-compose.yml` as the deployment source.

Services:
- `nginx`: public entrypoint, SPA host, and health probe endpoint (built from `frontend/Dockerfile`)
- `app`: internal Laravel PHP-FPM runtime behind `nginx`
- `queue`: Supervisor-managed queue workers
- `scheduler`: Laravel scheduler process
- `redis`: shared cache/session/queue backend

Publish the `nginx` service in Dokploy. Do not expose `app` directly for this stack, because `app` only listens for FastCGI on port `9000`.
The public `nginx` container serves the built frontend and forwards `/api`, `/health`, `/live`, and `/storage` to Laravel.
Enable HTTPS/automatic certificate issuance on the `nginx` service. If the public domain shows an untrusted root certificate, Traefik/Dokploy is still serving a default or self-signed certificate instead of a valid issued one.

## Required Secrets / Env

Set these in Dokploy environment variables (do not commit real values):
- `APP_KEY`
- `DB_*` credentials
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `OPENROUTER_API_KEY`, `GEMINI_API_KEY` (if used)
- mail credentials (`MAIL_*`) if email delivery is enabled

## Health Checks

- Readiness: `/health`
- Liveness: `/live`

`/health` checks database, cache, queue backend, and disk free space threshold.

## Horizontal Scaling

Recommended:
- Scale `app` replicas horizontally.
- Scale `queue` replicas independently based on queue depth.
- Keep `scheduler` as a single replica.

Stateless requirements already configured:
- sessions in Redis (`SESSION_DRIVER=redis`)
- cache in Redis (`CACHE_STORE=redis`)
- queue in Redis (`QUEUE_CONNECTION=redis`)

For multi-node clusters, move file uploads from local disk to shared/object storage.
