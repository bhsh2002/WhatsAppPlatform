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

Every update first creates and verifies an online SQLite backup, restores that
archive into an isolated copy, and runs every migration with the new immutable
server image. The live containers are replaced only after the migrated copy
passes migration status, `quick_check`, and foreign-key validation.

Use the dedicated Caddy topology and immutable GHCR images described in
[docs/PRODUCTION_CADDY_RUNBOOK.md](docs/PRODUCTION_CADDY_RUNBOOK.md). It publishes
only the frontend on host loopback, joins the server to the private Control
Plane network, validates all production environment values before touching the
database, and does not connect to Nginx Proxy Manager.

Production pulls the private `ghcr.io/bhsh2002/savana-wa-server` and
`ghcr.io/bhsh2002/savana-wa-client` packages by immutable `sha256` digest. Release tags
identify the verified commit but are never used directly by Compose.

These package names were bootstrapped privately and are linked only to
`bhsh2002/WhatsAppPlatform`, with package permissions managed independently
from the public repository. Routine releases authenticate with the
repository-scoped `GITHUB_TOKEN` and `packages: write`; no personal access
token is stored in Actions. The repository must retain `Write` under each
package's **Manage Actions access** without inheriting repository permissions.
The release verifies the exact repository link, private visibility, and denial
of anonymous image access.

When the production source is a Git checkout, the deployment command requires
its exact `HEAD` to equal `WA_RELEASE_SHA` and rejects tracked or untracked
local changes before Docker is changed. A source release without `.git` emits a
warning and relies on the mandatory immutable-image OCI revision checks. Prefer
a clean Git checkout when preparing future releases so both gates are applied.

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
- Browser push requires one stable VAPID key pair. Keep
  `WEB_PUSH_VAPID_PRIVATE_KEY` only in the mode-`0600` production runtime file;
  it is not an Actions secret and must never be committed, pasted into chat, or
  printed in deployment logs. The public key is not secret, but both halves
  must remain paired and unchanged across routine releases. The example runtime
  file keeps `WEB_PUSH_ENABLED=false` so copying it with empty key fields cannot
  break an unrelated deployment; enable the feature only after installing the
  complete key pair and subject below.
- Stop production with the same Compose file and Compose environment used to
  start it. Never add `-v` and never delete the shared data directory.

## Web Push production keys

Generate the VAPID pair once from a trusted checkout after `npm ci` has
installed the reviewed server dependencies. Redirect the result into a private
file so the private key never appears in terminal output or shell history:

```bash
umask 077
vapid_output=/srv/wa-savana/shared/web-push-vapid.generated
install -m 0600 /dev/null "$vapid_output"
(
  cd server
  node --input-type=module <<'NODE'
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
process.stdout.write(`WEB_PUSH_VAPID_PUBLIC_KEY=${keys.publicKey}\n`);
process.stdout.write(`WEB_PUSH_VAPID_PRIVATE_KEY=${keys.privateKey}\n`);
NODE
) > "$vapid_output"
chmod 0600 "$vapid_output"
```

Using a local editor, transfer the two generated assignments into the file
referenced by `WA_RUNTIME_ENV_FILE`, then add:

```dotenv
WEB_PUSH_ENABLED=true
WEB_PUSH_VAPID_SUBJECT=mailto:an-address-monitored-by-savana@example.invalid
WEB_PUSH_TIMEOUT_MS=10000
```

Replace the subject with a monitored Savana contact address. Keep the runtime
file mode `0600`, run the production environment validator through the normal
deployment command, and delete the temporary `web-push-vapid.generated` file
after the first verified push. Do not generate a new pair for each deployment:
rotating it invalidates existing browser subscriptions and requires users to
subscribe again. If rotation is necessary, schedule it as a user-visible
maintenance change rather than silently replacing either key.

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
test -s dist/manifest.webmanifest && test -s dist/sw.js
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
when the checked-out code has unapplied migrations. Production deployment also
requires `/manifest.webmanifest` and `/sw.js` to return their correct non-HTML
content types with revalidating cache policies; this prevents the SPA fallback
from masquerading as an installable PWA asset.

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

`tools/deploy_production.sh` normally permits only two host states: a fresh
installation with neither `platform.db` nor `wa-savana-server`, or an update
with both a regular (non-symlink) database and the current server container
running. It fails closed when only one exists so a deleted or unsafe database
cannot silently be replaced by an empty one.

After an intentional rollback or disaster recovery, verify the backup as
shown above, remove the stopped `wa-savana-server` container, restore
`platform.db` as a regular file, and invoke the target release once with:

```bash
WA_DEPLOY_RECOVERY_MODE=verified-database-restore \
  WA_COMPOSE_ENV_FILE=/srv/wa-savana/shared/production-compose.env \
  ./tools/deploy_production.sh
```

This one-shot mode accepts only the exact recovery state (verified database
present and server container absent). It intentionally skips the online backup
that requires the old running container. Never persist the recovery variable in
the Compose or runtime environment files.
