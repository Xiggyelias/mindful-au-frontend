# Dokploy Deployment Notes (AUCMS)

## Stack

Use `docker-compose.yml` as the deployment source.

Services:
- `nginx`: public entrypoint and health probe endpoint
- `app`: Laravel PHP-FPM API runtime
- `queue`: Supervisor-managed queue workers
- `scheduler`: Laravel scheduler process
- `redis`: shared cache/session/queue backend

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
