# Deployment Scripts

## Overview

The `platform.db` file contains all your data (tenants, users, messages, etc.) and should **NEVER be uploaded/replaced in production**. Doing so will:
1. Reset all data to the uploaded file's state
2. Lose any new data since that backup
3. Potentially cause migration conflicts

## Deployment Workflow

### Initial Setup
```bash
# 1. Generate missing local JWT, encryption, and first-admin bootstrap secrets
npm run setup:local

# 2. Start the server (migrations run automatically)
npm run dev
```

If the users table is empty, inspect the ignored local `.env` for the generated
`BOOTSTRAP_ADMIN_PASSWORD`, sign in as `admin`, rotate that password, then remove
the bootstrap value. Production should inject a chosen value from its secret
store. The server never prints it to logs.

### Regular Updates
```bash
# 1. Pull latest code
git pull

# 2. Install new dependencies
npm ci --omit=dev

# 3. Restart server (migrations run automatically)
# migrations are tracked in _migrations table, only new ones run
```

### Backup before Updates
```bash
# Create and restore-verify a timestamped backup
npm run backup

# Backups are stored in db/backups/
# Only the last 10 backups are kept automatically
```

With the production Compose profile, run the same verified workflow inside the
server image. `BACKUP_DIR` is already set to the writable `/app/data/backups`
volume, so no one-off environment override is required:

```bash
docker compose run --rm --no-deps server npm run backup
```

The host archive is created under `server/db/backups/`. The container runs as
UID/GID `1000:1000`; production must grant that identity read/write/traverse
access to `server/db` and `server/uploads`, and read access to `server/.env`.
Confirm the printed digest from the host before continuing an update:

```bash
sha256sum server/db/backups/platform_TIMESTAMP.db.gz
```

The command uses SQLite's online backup API, runs `quick_check` and
`foreign_key_check`, compresses the snapshot, restores it to a private temporary
directory, checks it again, and prints a SHA-256 digest. Override locations and
retention with `DATABASE_PATH`, `BACKUP_DIR`, and `BACKUP_RETENTION`.

## Scripts

| Script | Purpose |
|--------|---------|
| `deploy.sh` | Production deployment (migrations only) |
| `backup.sh` | Compatibility wrapper for the verified Node backup workflow |
| `backup-database.js` | Create, validate, compress, restore-check, and retain backups |
| `verify-backup.js` | Restore an archive to a temporary directory and validate it |
| `ensure-local-secrets.js` | Add missing secrets for a fresh local database without printing values |
| `migrate-sensitive-credentials.js` | Dry-run report for plaintext credentials |
| `check-savana-migration-impact.js` | Read-only aggregate impact of WA review/pricing migrations on an explicitly selected file |

### WA review and shared-price migration preflight

After approval to inspect a specific database, use the project's Node20 runtime:

```bash
/Users/savana/Dev/.tools/whatsapp/node-v20.20.2-darwin-arm64/bin/node \
  scripts/check-savana-migration-impact.js --database /absolute/path/to/approved.db
```

This command requires an existing absolute path, opens SQLite read-only with
`query_only`, and performs SELECTs in one read transaction. It does not load
`.env`, use `DATABASE_PATH`, bootstrap the app, run migrations, send requests,
or include product names, prices, entity IDs, or raw payloads in its output.
Do not run it against customer data without separate authorization. No such
inspection was performed during development; tests use synthetic databases.

The counts describe the current file, including rows matching the exact 056
and forward-057 predicates. Already quarantined rows can still match a
predicate; `potentially_newly_hidden` distinguishes them from active copies.
The scan is advisory and does not authorize deployment. Missing migration
tracking/checksums or an unsupported schema requires review before proceeding.

055 adds local review evidence and does not authorize execution. 056 hides
incomplete legacy pricing; 057 also quarantines invalid decimal/currency
formats and stale derived prices. Source projections, events, images, IDs and
inactive source memberships are preserved. The owner has explicitly approved
hiding affected synchronized copies on the eventual upgrade until their
authoritative source is corrected. This does not authorize deployment or a
business-data inspection; those still need their separate release approval.
Keeping a stale or inferred price active is not a supported recovery option.

Use the tracked migration runner for retries. Raw replay of 055 is unsupported;
its ALTERs are intentionally tracked once. SQL and the tracking row roll back
together on failure. Never edit checksums/history or restore an old database
over newer valid business operations; apply a reviewed forward correction.
There is no automatic down migration or automatic reactivation.

The current client sends `X-Savana-Review-Mode: review-only-v1` when opening a
contextual request. Older clients are rejected before review acceptance.
`complete` and generic `publish-status` reject unverified execution assertions;
acceptance, queued transport, published transport and actual sending remain
separate. Deployment must refresh old UI sessions: a request already open in
an old client could still call an uncorrelated native send endpoint, which the
server cannot identify as a contextual request. Returning to old code would
reintroduce that behavior and is not an approved compatibility rollback.

Legacy local/SKU/barcode identities still require an explicit installation
mapping. Neither this scan, a valid price, nor central draft schema validation
enables cross-platform execution, financial reservations or external sending.

### Shared product read-through adapter

`SAVANA_SHARED_PRODUCT_READS_ENABLED` is independently disabled by default.
The WA portal exposes local read-only routes for shared product search,
individual records, and change observations. They use only the published
central read/context/capability/eligibility HTTP contract. No product source
publisher, stock/payment command, message, campaign or native bot write is
called. No product cache, persistent inbox or resume cursor is created, so
re-reading a change cannot apply an effect or adopt a legacy product identity.

The server owns each explicit organization/activity/installation binding and
delegated central OIDC token. The runtime SQLite store encrypts this state and
binds it to the current local user, tenant, JWT session and authentication
version. Migrations 058–060 begin without a central grant. OIDC/PKCE identity,
actual service enrollment and approved native-account mapping are separate
steps; changing a feature flag supplies none of them. Browser-supplied tokens,
platform credentials or grant claims cannot enroll a read session. The explicit
installation/activity/branch/warehouse choice is checked against the real native
platform binding and a fresh central read context. Deployment configuration is
not filled from a fixture, and user read tokens are never publisher credentials.

Every read checks the live local session and its expiry before and after the
central calls. The center checks current OIDC membership, account, field,
source, activity and resource grants. Its context and advisory eligibility are
not reusable authority. Responses have `no-store`; a 404, outage or revoked
grant hides an unverified view rather than manufacturing a tombstone. Only
explicit archived/tombstone observations carry those states. The view keeps
current records separate from older change observations, with their central
identity, source namespace/installation, versions and freshness intact.

The adapter accepts HTTPS, the canonical private `savana-connect:8010` HTTP
service, or an explicitly enabled owned-loopback acceptance fixture. Redirects
are rejected. Browser actor/organization/account/readiness claims and platform
credentials are never accepted as authority. Unknown public response metadata fails closed; the
central-authorized `data` fragment is shown without adding currency or units.
The view cannot use any price for execution, including a valid source price.

The real local product-cycle acceptance is opt-in and requires the published
central and Catalog test factories, their existing project Python runtimes,
matching contract fingerprints and declared isolated readiness:

```bash
NODE_ENV=test WA_RUN_PRODUCT_CYCLE_ACCEPTANCE=1 \
  /Users/savana/Dev/.tools/whatsapp/node-v20.20.2-darwin-arm64/bin/node \
  --test --test-concurrency=1 test/centralProductCycle.acceptance.test.js
```

Run this as a dedicated test process. It owns fresh central/Catalog/WA temporary
state, creates a native Offering through actual Catalog HTTP, invokes the real
source worker with its separate limited source credential, and reads through
real central OIDC plus WA local JWT authentication. It does not accept a
production service URL/database/credential and cannot substitute a mock source
or transport for this acceptance. Its tested native lifecycle is archival;
explicit tombstones are covered separately by the read-contract/UI tests.
Only owned loopback traffic is permitted, native effect tables must remain
unchanged, and nonzero cleanup exit codes fail the acceptance. No production
activation or acceptance for another application's consumer is inferred.

### Native owner setup and retained intent history

`SAVANA_SHARED_READ_SETUP_ENABLED=false` keeps native OIDC/setup off.
`SAVANA_SHARED_READ_OWNER_PORTAL_ENABLED=false` independently keeps the optional
native owner cookie bridge off; `SAVANA_SHARED_READ_OWNER_PORTAL_ORIGIN` stays
empty until an explicit trusted ControlCenter origin is approved. Shared reads
retain their own default-off flag. The native bridge calls the real
ControlCenter `/api/session` password/MFA login and cookie BFF; WA never receives
a portal HMAC key. Credentials are transient, the actual cookie is encrypted
under a dedicated purpose, and its lifetime is capped by the central cookie,
verified OIDC and native JWT. GET session alone is insufficient: each native
owner read/action verifies current BFF `ui-context` membership, the same actual
central actor and current exact-scope actions. Publisher/source operations are
not exposed by this native facade.

The current owner overview returns explicit server-computed action booleans and
filtered native enrollment/installation/source-field/member choices. The UI
cannot infer actions from an owner role or invent an activity candidate. A
scope authorization that contains source/origin actions must be managed in
ControlCenter; replacing it with the native read-only list is rejected. A read
sharing proposal is the complete reviewed fields/readers policy, with current
and effective versions displayed separately.

Migration 060 preserves immutable encrypted owner intents and audit history.
An unknown/inflight intent blocks new owner mutations for the same native tenant,
central actor and organization across native JWTs, local users and portal login.
Never change a key or replay POST to force an unknown result. Read-only native
`/shared-read-setup/owner/intents/:id` and `/intents/by-key/:key` return metadata
only, with `result:null`; 404 does not establish that no effect occurred. Enabled
status/overview exposes opaque `native_reference`, stable across JWTs, for UI
hold partitions together with actual central actor/organization. By-key metadata
lookup requires fresh OIDC+portal membership and the same native tenant, actual
central actor and organization, across native JWTs/users; ID lookup stays bound
to its original native principal. Neither returns cached body/scope/response.
Refresh actual BFF overview and reconcile through a separately reviewed process. Local
disconnect clears/fences only the retained native cookie and keeps history; it
claims no global central logout or grant/source-key revocation. The complete
055–060 deployment/recovery order is in `docs/WA_OPERATIONAL_DEPLOYMENT_REVIEW.txt`.
The separate owner-process regression runs the actual service with real
SQLite/AES in fresh OS children and explicit mock portal HTTP; it proves cold
cookie/intent durability and no reclaim, not real-center HTTP acceptance.

The final review snapshot has 167 selected server tests and 131 client tests
passing (19 owner cases/four process cases and 29 focused client cases are
included, not extra totals), plus six separate packager tests. Lint/build and
synthetic EN/AR mobile/keyboard checks passed; axe reported zero violations,
22 passes and two incomplete checks. Actual screen-reader speech is untested.
Actual Catalog-center-WA source/read/revocation passed. Center exploratory
all-four parity/19 lifecycle cases are reported separately; formal four-app
acceptance remains false pending peer counters and the final guard rerun.
The existing final owner smoke measured nine actual table counts, including
billing_payments, unchanged at zero before/after; unsupported orders/stock/
business-measurement models remain N/A, not inferred zeroes. That refresh adds
no lifecycle scenario. Final timestamp-only Arabic display QA passed targeted
lint/build/visual review and all 17 UI source hashes were reverified.
Neither test success nor the selective source reference authorizes deployment.

### Sensitive credential migration

Run the report first:

```bash
npm run migrate:credentials
```

After creating and verifying a database backup, apply the migration explicitly:

```bash
node scripts/migrate-sensitive-credentials.js --apply --backup-confirmed
```

The command encrypts legacy Meta tokens and webhook secrets, converts plaintext
API keys to indexed SHA-256 digests, and clears the plaintext columns. Existing
bcrypt API-key hashes cannot be converted without the original key and must be
rotated through the tenant portal.

## Migration System

Migrations are stored in `db/migrations/` and run automatically on server startup. The `_migrations` table tracks which ones have been applied:

- Migration files numbered sequentially: `001_*.sql`, `002_*.sql`, etc.
- Each runs once, then is recorded in `_migrations`
- Skipped if already applied

## Recovery

The current operational review plan is
`docs/WA_OPERATIONAL_DEPLOYMENT_REVIEW.txt`. A restore is not an automatic
rollback: never replace a current database with an older snapshot over newer
valid operations. The restore steps below apply only after a separately
approved write fence and proof that no later valid operation will be lost, or
after an explicitly reviewed reconciliation plan. Prefer a compatible forward
correction, preserving migration checksums, audits, sessions, outbox messages
and unknown results. Never downgrade a nonempty state/history by deleting it.

Verify an archive before any recovery:

```bash
npm run verify:backup -- db/backups/platform_TIMESTAMP.db.gz
```

Then restore without overwriting the live database in place:

```bash
# 1. STOP the server and confirm no process has platform.db open.
# 2. Restore to a separate path.
gunzip -c db/backups/platform_TIMESTAMP.db.gz > db/platform.restore.db

# 3. Keep platform.db as a rollback copy, atomically rename the verified
#    restore into place, preserve ownership/mode, and start the server.
# 4. Verify /health and critical tenant data before accepting writes.
```

The built-in retention covers local archives only. Production must schedule the
command and copy archives to encrypted off-host storage with an independently
managed retention policy.

## What NOT to Do

❌ Don't upload `platform.db` to production
❌ Don't copy `platform.db` between environments
❌ Don't commit `platform.db` to git (it's in `.gitignore`)
❌ Don't run migrations manually (they run on startup)
