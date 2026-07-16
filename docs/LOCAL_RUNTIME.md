# Local Runtime

This is the runtime-first path for using the platform locally. Its acceptance
criteria are deliberately limited to starting the UI, API, and database;
loading the public and login screens; and reaching authentication through the
same-origin `/api` proxy. Audit refactors and non-blocking quality improvements
are tracked separately and are not prerequisites for this profile.

## Start

```bash
cd server
npm run setup:local
cd ..
docker network inspect proxy >/dev/null 2>&1 || docker network create proxy
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build -d
```

Open <http://localhost:3133>.

`setup:local` creates missing local JWT/encryption/bootstrap secrets without
printing their values. It also replaces an unsafe placeholder JWT. It refuses
to replace an invalid encryption key when encrypted database values exist.

For an existing database, sign in with its existing user credentials. For a
fresh database, the generated `BOOTSTRAP_ADMIN_PASSWORD` is stored only in the
ignored `server/.env`; sign in as `admin`, change the password, then remove the
bootstrap value.

## Verify

```bash
curl -fsS http://localhost:3031/health
curl -fsS http://localhost:3133/api/health
```

A ready response reports `status: ok`, `database: ok`, and zero pending
migrations. The second request proves that Nginx can reach Express through the
same origin used by the browser.

Check container state with:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml ps
```

## Stop and restart

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml down
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
```

These commands preserve `server/db` and `server/uploads` on the host.

## Local profile boundaries

The local override sets:

- `NODE_ENV=development`, so the session cookie works over local HTTP.
- `CORS_ORIGINS` to `localhost:3133` and `127.0.0.1:3133`, so login and other
  browser mutations pass the origin guard.
- `DISABLE_BACKGROUND_JOBS=true`, so missing Meta credentials do not start
  external synchronization work or the Facebook Content Studio scheduler.

The UI, API, database, migrations, and local authentication remain available.
WhatsApp/Facebook messaging, onboarding, webhook verification, template sync,
and other Meta-backed actions require valid Meta sandbox or production
credentials and are not simulated by this profile.

Facebook Content Studio can be opened locally to inspect its library,
campaigns, calendar, and settings. Automatic publication remains paused by the
local profile. The writing assistant remains disabled until `OPENAI_API_KEY` is
configured; no key is required for the rest of the studio.

## Verified state — 2026-07-15

- Server and client images built successfully.
- `whatsapp-platform-server` is healthy on port 3031.
- `whatsapp-platform-client` serves the SPA on port 3133.
- Direct and proxied health checks return HTTP 200.
- SQLite reports 40 applied migrations and zero pending migrations.
- The landing and login screens render in a real browser.
- A login submission reaches the authentication handler and returns the
  expected invalid-credentials response for a deliberately invalid test user.

## Deferred because they do not block local operation

- Raising coverage beyond the current gate.
- Additional monolith decomposition and UI deduplication.
- Full manual screen-reader and visual-regression passes.
- Tracing and Alertmanager delivery.
- Live Meta end-to-end testing.
- Container CVE report while the scanner database is unavailable.

These items remain valuable backlog. Production deployment still requires
HTTPS, real Meta secrets, backup/restore validation, an image vulnerability
scan, and environment-specific monitoring.
