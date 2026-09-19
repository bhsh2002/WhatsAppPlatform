# Deployment Guide

## Prerequisites
- Docker
- Docker Compose

## Local run without Meta credentials

For local UI/API/database work, generate only the local runtime secrets and use
the local Compose override:

```bash
cd server
npm run setup:local
cd ..
docker network inspect proxy >/dev/null 2>&1 || docker network create proxy
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build -d
curl -fsS http://localhost:3031/health
curl -fsS http://localhost:3133/api/health
```

Open `http://localhost:3133`. This profile sets `NODE_ENV=development`, allowing
the browser session cookie over local HTTP, and disables Meta-dependent
background jobs. It does not simulate Meta: messaging, onboarding, webhooks,
sync, and other Meta-backed actions require real sandbox credentials.

Stop the local stack with:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml down
```

See [docs/LOCAL_RUNTIME.md](docs/LOCAL_RUNTIME.md) for the verified runtime
state, troubleshooting boundaries, and work intentionally deferred from the
local-operability goal.

## Production deployment

Use the dedicated Caddy topology and immutable GHCR images described in
[docs/PRODUCTION_CADDY_RUNBOOK.md](docs/PRODUCTION_CADDY_RUNBOOK.md). It publishes
only the frontend on host loopback, joins the server to the private Control
Plane network, validates all production environment values before touching the
database, and does not connect to Nginx Proxy Manager.

Production pulls the private `ghcr.io/bhsh2002/savana-wa-server` and
`ghcr.io/bhsh2002/savana-wa-client` packages by immutable `sha256` digest. Release tags
identify the verified commit but are never used directly by Compose.

The first publication of these package names is a one-time bootstrap. Before
merging the bootstrap release, create the repository secret
`GHCR_BOOTSTRAP_PAT` from a short-lived GitHub personal access token (classic)
with only `write:packages`; do not grant `repo` or `delete:packages`. The
release authenticates as `bhsh2002`, deliberately omits the OCI source label,
and fails unless GitHub reports both packages as private and unlinked and an
anonymous manifest request is denied. After the successful bootstrap, grant
this repository `Write` under each package's **Manage Actions access**, revoke
the token, delete the secret, and replace the bootstrap authentication with a
normal `GITHUB_TOKEN` release before the next commit reaches `main`.

`docker-compose.server.yml` and `tools/deploy_server.sh` remain the isolated
company/test topology. They must not be used on the production host.

## Notes
- The database is persisted on the host at `./server/db/platform.db` and is
  mounted as `/app/data/platform.db`. The source directory `/app/db` remains
  part of the immutable image and must never be shadowed by a data volume.
- Environment variables are loaded from `./server/.env`.
- Docker runs the server with `NODE_ENV=production`; `META_APP_SECRET` and
  `WEBHOOK_VERIFY_TOKEN` are therefore mandatory.
- A fresh database with no users also requires `BOOTSTRAP_ADMIN_PASSWORD` of at
  least 16 characters. Supply it through the deployment secret store; it is
  never logged. Rotate it after first login and remove it from runtime secrets.
- Both containers use a read-only root filesystem, drop Linux capabilities,
  and enable `no-new-privileges`. Only database/uploads bind mounts and declared
  runtime tmpfs paths remain writable; the `.env` bind mount is read-only.
- Serve the browser and `/api` proxy from the same HTTPS origin. Browser
  sessions use a `Secure`, `HttpOnly` cookie scoped to `/api`; direct HTTP in
  production will not carry that cookie.
- If a separate trusted development origin is required, list it explicitly in
  `CORS_ORIGINS`. Cross-origin state-changing browser requests outside that
  allowlist are rejected.
- Set `PUBLIC_APP_URL` to the canonical HTTPS origin used for Meta data-deletion status links.
- Production requires a separate random `METRICS_TOKEN` of at least 32
  characters. Scrape the loopback `/api/metrics` path with an Authorization
  bearer header; Caddy blocks that route publicly.
- Stop production with the same Compose file and Compose environment used to
  start it. Never add `-v` and never delete the shared data directory.

## Supported topology

The current release supports **one server process**. SQLite, the in-process
SSE event bus, schedulers, and broadcast workers are not safe for horizontal
replication. Do not increase the server replica count or mount the SQLite file
through a network filesystem. Move the database, event bus, and jobs to shared
services before enabling multiple server instances.

The server enables SQLite WAL mode, foreign-key enforcement, `synchronous=NORMAL`,
and a five-second busy timeout. `SQLITE_BUSY_TIMEOUT_MS` may be set between
1,000 and 30,000 milliseconds when storage latency requires it.

## Pre-deployment verification

Run from the repository root:

```bash
cd server && npm test && npm audit --audit-level=low
cd ../client && npm run lint && npm run build && npm audit --audit-level=low
cd .. && docker compose config --quiet
docker build --tag whatsapp-platform-server:verify server
docker build --tag whatsapp-platform-client:verify client
docker scout cves --only-severity critical,high --exit-code local://whatsapp-platform-server:verify
docker scout cves --only-severity critical,high --exit-code local://whatsapp-platform-client:verify
```

Base images are pinned by multi-architecture digest. Dependabot proposes Docker
digest updates, and CI builds both images on every push and pull request. The
release is blocked when the organization-approved image scanner reports a High
or Critical vulnerability. Docker Scout requires an authenticated Docker ID;
an equivalent scanner is acceptable when it uses a current vulnerability DB
and returns a non-zero exit status for those severities.

The `/health` readiness endpoint returns HTTP 503 when SQLite is unavailable or
when the checked-out code has unapplied migrations.

## Backup, migration, and rollback

1. Stop writes for schema-changing maintenance; ordinary scheduled backups may
   use SQLite's online snapshot while the single server is running.
2. From `server`, run `npm run backup`. The command validates `quick_check` and
   foreign keys, compresses the snapshot, restores it into a temporary
   directory, validates it again, and prints its SHA-256 digest.
3. Start the new release. Migrations run synchronously before the HTTP listener.
4. Verify `/api/health`, the anonymous `/api/auth/session` response, login,
   signed webhook delivery, the authenticated landing page, and a tenant portal
   page.

SQL migrations are forward-only. To roll back a release that applied a schema
migration, stop the server, restore the verified pre-deployment database backup,
then deploy the earlier code. Rolling back code alone is not a database rollback.

Before restoring any archive, run:

```bash
cd server
npm run verify:backup -- db/backups/platform_TIMESTAMP.db.gz
```

Restore into a separate file first, keep the current database as a rollback
copy, and only replace `db/platform.db` while the server is stopped. Backup
retention defaults to 10 local archives and may be set with `BACKUP_RETENTION`;
configure encrypted off-host copies and scheduling in the deployment platform.
