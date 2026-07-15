# WhatsApp Platform Operations Notes

## Quick local start

The local profile runs the UI, API, and SQLite database without requiring live
Meta application credentials. It uses development cookies so login works over
`http://localhost`, and it disables Meta-dependent background jobs. Existing
Meta-backed screens remain unavailable until their credentials are configured.

```bash
cd server
npm run setup:local
cd ..
docker network inspect proxy >/dev/null 2>&1 || docker network create proxy
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build -d
```

Open `http://localhost:3133`. Verify the stack with:

```bash
curl -fsS http://localhost:3031/health
curl -fsS http://localhost:3133/api/health
```

Stop it without deleting the host database or uploads:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml down
```

The local override is intentionally not a production profile. Production must
use HTTPS, valid Meta webhook secrets, and the base `docker-compose.yml` only.
The complete local run contract and the explicitly deferred non-blocking work
are documented in [docs/LOCAL_RUNTIME.md](docs/LOCAL_RUNTIME.md).

## Required server environment

The server fails fast when required secrets are missing or unsafe. Before running
`server/server.js`, configure `server/.env` from `server/.env.example` and make
sure these values are set:

- `JWT_SECRET`: a non-placeholder secret with at least 32 characters.
- `CRYPTO_KEY`: exactly 64 hex characters, generated from 32 random bytes.

Generate safe local values with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Use one generated value for `JWT_SECRET` and another for `CRYPTO_KEY`.

For a fresh local database, the server package can add missing local secrets
without printing their values:

```bash
cd server
npm run setup:local
```

The command refuses to generate a replacement `CRYPTO_KEY` when encrypted data
already exists, because replacing that key would make the data unreadable.

On a database with no users, first startup also requires
`BOOTSTRAP_ADMIN_PASSWORD` (at least 16 characters). `npm run setup:local`
generates it into the ignored, local `.env` when needed. The server creates one
administrator before listening, never prints the password, and ignores the
bootstrap value once any user exists. Rotate the password after first login and
remove the bootstrap value from the runtime environment.

## Browser session contract

Browser traffic must use the same-origin `/api` proxy. Login establishes an
`HttpOnly`, `SameSite=Lax` session cookie scoped to `/api`; it is marked
`Secure` in production. The web client no longer persists JWTs in
`localStorage`. Bearer JWT responses remain available for non-browser API
clients, and existing browser JWTs are rotated once into the cookie session.

State-changing browser requests are checked against the request origin. Keep
`CORS_ORIGINS` limited to trusted development or application origins, and
terminate production traffic over HTTPS.

## Upload contract

Uploaded images, media, documents, and CSV imports are classified from their
bytes before a route can use them. Client-supplied MIME headers and filename
extensions are not authoritative. Rejected temporary files are deleted, and
public bot image assets receive random names with extensions derived from the
verified content. The application does not perform antivirus scanning; add an
external scanner if the deployment threat model requires one.

The contacts CSV schema, limits, tenant isolation, and import/update behavior are
documented in [docs/CONTACTS_CSV.md](docs/CONTACTS_CSV.md).

## Operational metrics

Authenticated administrators can inspect JSON at `/api/settings/metrics` and
`/api/settings/alerts`. Prometheus text metrics are available at `/api/metrics`
only when a dedicated `METRICS_TOKEN` of at least 32 characters is configured;
otherwise that endpoint returns 404. Scrape and alert examples are documented
under [ops/prometheus](ops/prometheus/README.md).

## Database tracking

SQLite database files are local runtime state and should not be committed.
Schema changes belong in SQL migrations under `server/db/migrations`.

Development and pull-request conventions, including the full local verification
gate and secret-handling rules, are documented in [CONTRIBUTING.md](CONTRIBUTING.md).
