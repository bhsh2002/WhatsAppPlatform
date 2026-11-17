# WA production candidate and root handoff

This prepares a Linux build/release candidate. Root coordination alone executes
SSH, image publishing, commit/push/merge, production configuration changes and
deployment. Preparation opens no business database or runtime environment file.
The previous `1ea6377f4286b8a9505ffc1cdbca9a171efd061aaa360a97d0e87385a42c2350`
selective review archive stays immutable; it is not this production candidate.

## Identity and exact build inputs

`tools/package_wa_production_candidate.py` reconstructs unchanged runtime inputs
from clean Git objects and applies only an explicit reviewed dirty-file overlay.
It includes complete server/client runtime source, public assets, public npm
lockfiles, approved digest-pinned build recipes, deployment tools and five
byte-identical official contract evidence snapshots. Its per-file manifest
records hashes, modes and baseline/overlay provenance. Test harnesses, `.env`
files, credentials, databases, uploads, workspace `node_modules`, generated
`dist`, Git history and unrelated projects are excluded. This is one controlled
build-source artifact, not another workspace/data backup.

The deterministic source archive and full `source_sha256` identify modified
content. The Git baseline remains a baseline and is never relabeled as the
modified release. Candidate validation images use an explicit uncommitted
source label. Production promotion additionally requires root's actual reviewed
Git commit, successful release checks, immutable image digests and matching OCI
revision labels. An old clean HEAD or truncated content hash is not that commit.

The public compatibility marker is `source_sha256`: build the frontend with
`VITE_WA_CLIENT_RELEASE` and set runtime `WA_BROWSER_RELEASE` to that same value.
It carries no authority or secret. The client adds it only to its own API
requests; it cannot replace native authentication, session rotation, cache
refresh, current central approval or the maintenance egress barrier. It is
calculated before build only from controlled runtime source paths, modes and
bytes. Git/overlay state, HEAD, release metadata, documentation, recipes,
contract-review metadata and build artifacts are separately hashed in the
archive and do not change that public marker. A later real commit of identical
runtime inputs therefore preserves it, without circular bundled-output input.

## Dependencies and Linux provenance

The required target is `linux/amd64`, matching the production Linux x86_64 host.
Local Docker29.1.3 runs on ARM64, so an image label alone is insufficient: the
probe must measure Linux `process.arch === "x64"`, Node20, native SQLite loading
and frontend `uname -m === x86_64`. No Docker Desktop installation/start/settings
changes or existing container/volume changes are part of preparation.

Server/client npm lockfiles v3 are included and dependency sections must match
their package manifests. All recorded tarballs use the public npm registry and
lock integrity. The server recipe compiles native SQLite from its locked source
against the approved base image's Node headers, rather than relying on a mutable
native prebuild download. The client installs its locked build dependencies;
only generated static output enters the final nginx image. Host dependencies
and previously generated frontend output are never reused. These commands use
[`npm ci` frozen-lock semantics](https://docs.npmjs.com/cli/v10/commands/npm-ci/).

The existing reviewed Node20/Alpine/nginx base digests are retained. Node20 is
now listed as EOL by the [official Node release schedule](https://nodejs.org/en/about/previous-releases).
This candidate does not silently change runtime major versions. The release
owner must resolve runtime support and current image/dependency vulnerability
gates before a production verdict. Deterministic source packaging is verified;
bit-identical rebuilt OCI images are not asserted. Image IDs, native binary
hashes, dependency locks and build logs provide the measured build provenance.

Root's consolidated source checks passed289 server cases in32 files and138
client cases plus lint/build. The packaging/phase suites are separate; exact final results are recorded in
the candidate handoff and are not added to the product totals.
The approved base-image probe measured Linux x64, Node v20.20.2 on the local ARM
engine. Complete candidate-image/runtime results are reported separately in
`linux-validation.json`; the base probe alone is not a full image verdict.

## Candidate preparation commands

Run only after root declares the maintenance/browser compatibility source and
the reviewed overlay stable. JSON inputs contain exact task paths and official
contract paths/versions/SHA256, never runtime values.

```bash
python3 -B tools/package_wa_production_candidate.py \
  --repository "$WA_REPOSITORY" \
  --overlay "$WA_REVIEWED_OVERLAY_JSON" \
  --contracts "$WA_FIVE_CONTRACT_REFS_JSON" \
  --output-directory "$WA_OWNED_PRODUCTION_CANDIDATE_DIR"

python3 -B tools/validate_wa_linux_candidate.py \
  --archive "$WA_CANDIDATE_ARCHIVE" \
  --sha256 "$WA_CANDIDATE_ARCHIVE_SHA256" \
  --docker-endpoint "$WA_APPROVED_LOCAL_DOCKER_ENDPOINT" \
  --output-directory "$WA_OWNED_LINUX_VALIDATION_DIR"
```

The validator uses a private empty Docker authentication configuration and only
task-owned tags/one fresh container. It builds both images for amd64, then tests
real `npm start` using generated synthetic credentials and fresh tmpfs
SQLite/uploads with `--network none`. A separate process checks actual `/health`
maintenance enforcement and refusal of native auth/API/webhook requests without
ingestion or queue changes. Initial `DISABLE_BACKGROUND_JOBS=false` proves the
maintenance barrier independently. It restarts the application against the
same owned tmpfs database: idle resume passes with the required guard, while a
synthetic unknown intent blocks startup and is preserved. No real send occurs.
It also verifies current/missing browser release markers and nginx/PWA assets.
All owned containers/tmpfs are removed even on failure. Image export is optional
and capacity-checked; no existing Docker cache is pruned to make room.

Build/public release arguments are not secrets. Docker's
[build reference](https://docs.docker.com/reference/cli/docker/buildx/build/)
describes the platform/label/build-argument controls used here. Images are local
candidates only: preparation does not push, log into GHCR or publish a release.

## Root production transition

The archive contains deployment scripts for review, not permission to execute.
Root must first bind the candidate to the actual approved commit/images and
check exact source/recipe/browser marker agreement. The current CI/release
workflows use the committed controlled-context exporter and reviewed recipes
as documented in `docs/WA_CONTROLLED_CI_RELEASE.md`. Images from older/default
workflow versions do not establish this marker. Never deploy validation images
labeled as uncommitted source.

After root creates/verifies the real release commit and confirms identical
controlled runtime inputs, the following root-only build/push sequence is an
explicit manual alternative to the controlled CI path. Both tags are then resolved
to immutable registry digests; Compose never deploys the tags themselves.

```bash
WA_SERVER_RELEASE_TAG="ghcr.io/bhsh2002/savana-wa-server:candidate-${WA_CANDIDATE_SOURCE_SHA256}-${WA_RELEASE_SHA}"
WA_CLIENT_RELEASE_TAG="ghcr.io/bhsh2002/savana-wa-client:candidate-${WA_CANDIDATE_SOURCE_SHA256}-${WA_RELEASE_SHA}"

docker build --platform linux/amd64 \
  --file "$WA_EXTRACTED_CANDIDATE/release/server.Dockerfile" \
  --label "org.opencontainers.image.revision=$WA_RELEASE_SHA" \
  --label "savana.candidate.source-sha256=$WA_CANDIDATE_SOURCE_SHA256" \
  --tag "$WA_SERVER_RELEASE_TAG" "$WA_EXTRACTED_CANDIDATE/source/server"

docker build --platform linux/amd64 \
  --file "$WA_EXTRACTED_CANDIDATE/release/client.Dockerfile" \
  --build-arg "VITE_WA_CLIENT_RELEASE=$WA_CANDIDATE_SOURCE_SHA256" \
  --label "org.opencontainers.image.revision=$WA_RELEASE_SHA" \
  --label "savana.candidate.source-sha256=$WA_CANDIDATE_SOURCE_SHA256" \
  --tag "$WA_CLIENT_RELEASE_TAG" "$WA_EXTRACTED_CANDIDATE/source/client"

# Root only, after current scanning/private-package checks and scoped registry auth:
docker push "$WA_SERVER_RELEASE_TAG"
docker push "$WA_CLIENT_RELEASE_TAG"
docker image inspect --format '{{json .RepoDigests}}' "$WA_SERVER_RELEASE_TAG"
docker image inspect --format '{{json .RepoDigests}}' "$WA_CLIENT_RELEASE_TAG"
```

Record only the exact expected `ghcr.io/bhsh2002/savana-wa-server@sha256:...`
and client counterpart, their real release revision and candidate marker.
Private registry auth stays with root; no credential is a build argument.

Record secret **names/references only** in handoff. Actual values stay in the
existing private runtime secret store and are not copied into source/build
arguments, labels, logs, reports or this candidate. `configuration-names.json`
contains only names extracted from committed templates. Preserve current
`CRYPTO_KEY` decryption access for all retained credential/vault/enrollment/cookie
state; this release does not supply a keyring or destructive key rotation.
Before replacing an existing running server, the runner compares the candidate
and current `CRYPTO_KEY` privately in memory. The producer uses `--log-driver none`
and a private stdin pipe; no value, fingerprint or length is recorded. Failure
aborts before cutover, leaving the current server untouched. With no prior
container, recovery additionally requires a private root-authored JSON evidence
file selected by `WA_RECOVERY_KEY_CONTINUITY_EVIDENCE`, containing only
`release_sha`, `restored_database_verified:true`,
`retained_encryption_key_matches_backup:true`, `root_record_reference`, and
`verified_backup_sha256`. This is an explicit operator provenance attestation,
not cryptographic verification by this script; root must actually verify the
matching restored database/backup and retained key before writing it. No key
or key hash belongs in that evidence.

1. Establish a bounded hard maintenance window before replacing old code.
   Existing old processes do not acquire the new in-process guard merely from
   editing an environment file. Root must quiesce old native sending/automation
   and coordinate provider webhook retries without false acknowledgements.
2. Confirm the approved quarantine policy: synchronized missing/malformed/stale
   prices hide on upgrade until the authoritative source is corrected. Do not
   ask that existing decision again. Any real impact scan/backup/migration is a
   separate root-authorized operating action.
3. Inspect the actual `_migrations` names and checksums; a count of55 alone does
   not establish a054 baseline. Root subsequently verified the actual current
   head is054_meta_page_ownership.sql with SHA256
   `4b17c6e3a9c8669b4981b31b7895ed8ceb28f3b1218ef508ab270d0f1efea9be`;
   this is root's safe metadata, not a business DB read by this agent.
   Recheck at transition time. Verify every applied file exists and matches the
   candidate. The manifest pins055–060 individually. Never edit applied SQL,
   drop tracking rows, force a version or use raw ALTER replay.
4. Create and verify the coherent operating recovery point under a write fence.
   Use the existing verified backup and isolated preflight tools. They migrate
   only the separately restored owned copy, validate tracking/quick/FK checks,
   and leave the operating DB untouched until root performs the transition.
5. Start the approved image with `SAVANA_EGRESS_MAINTENANCE=true`; keep shared
   reads, setup and owner-portal features false. The bootstrap installs the
   network barrier before application imports; every route except GET/HEAD
   `/health` returns503. No webhook receipt/ingestion is fabricated.
6. Read the actual post-migration aggregate inflight inventory. Reconcile
   processing/broadcast/reserved/unknown work without replay, reset or deleting
   history. A paused scheduler alone is not clearance to resume.
7. Deploy the matching frontend, install the public marker, rotate/invalidate
   native signed sessions by privately replacing `JWT_SECRET` with a controlled
   restart and force client refresh. This invalidates native cookie, bearer and
   media JWTs while keeping `CRYPTO_KEY` unchanged. It does not revoke central
   grants/API keys, reset stored auth versions/revoked rows, or revoke every
   stored Web Push subscription.
   Old browser mutations/re-login fail409; native Origin-less API/webhook
   authentication remains unchanged. The header is not a universal egress gate.
8. Root performs the explicit resume phase only after the actual DB is complete
   and idle, with `SAVANA_EGRESS_MAINTENANCE=false` and
   `SAVANA_EGRESS_REQUIRE_IDLE=true`. With the bootstrap barrier already
   installed, startup verifies schema completeness and zero unresolved rows
   before the actual application/provider modules load. Pure integration config
   imports already run under that barrier. If that
   fails, stop and reconcile; never set the required guard false to force it.

Root-only deployment phase commands use private existing configuration files;
the public expected marker comes from the reviewed candidate manifest:

```bash
WA_DEPLOY_PHASE=maintenance \
WA_COMPOSE_ENV_FILE="$WA_PRIVATE_COMPOSE_ENV_FILE" \
  ./tools/deploy_production.sh

WA_DEPLOY_PHASE=resume \
WA_EXPECTED_BROWSER_RELEASE="$WA_CANDIDATE_SOURCE_SHA256" \
WA_COMPOSE_ENV_FILE="$WA_PRIVATE_COMPOSE_ENV_FILE" \
  ./tools/deploy_production.sh
```

Maintenance requires actual ready health with `active=true`, `requested=true`,
`enforced=true`, and native request-gate503. It checks static PWA assets but
intentionally skips authenticated metrics because the hard barrier also blocks
that route. Resume requires `active=false`, required/passed idle preflight,
matching running-server/compiled-client public markers, static assets and
authenticated metrics. The target frontend marker is checked offline before
Compose changes any running service. Both phases must be explicit; an omitted
phase or legacy `normal` fails before Docker changes. After cutover begins, any
up, health, runtime, PWA or metrics failure triggers one EXIT cleanup path that
stops only `wa-savana-server`. No automatic rollback/reset occurs. Root must
contain a failed stop and restart explicitly in maintenance after review.

Read-only impact and isolated migration/preflight commands, when separately
authorized by root, remain:

```bash
node server/scripts/check-savana-migration-impact.js --database "$WA_APPROVED_DATABASE_PATH"
node server/scripts/verify-backup.js "$WA_VERIFIED_BACKUP_ARCHIVE"
./tools/preflight_migrations.sh "$WA_VERIFIED_BACKUP_ARCHIVE" "$WA_IMMUTABLE_SERVER_IMAGE" "$WA_APPROVED_DATA_DIR"
```

The post-migration inventory command below opens the explicit existing database
read-only, without importing the application singleton or starting providers:

```bash
docker exec wa-savana-server node --input-type=module -e '
  import Database from "better-sqlite3";
  import { getEgressInflightInventory } from "./services/egressInflightInventory.js";
  const db = new Database("/app/data/platform.db", { readonly: true, fileMustExist: true });
  try { console.log(JSON.stringify(getEgressInflightInventory(db))); }
  finally { db.close(); }
'
```

Actual startup is `npm start` (`node start.js`), which validates production
settings and synchronously migrates before the listener. Starting it against
an operating DB is itself a migration action. No command above is run against
production by the packaging/validation agent.

## Health, release boundary and forward recovery

Root verifies loopback HTTPS/proxy health, zero pending exact migrations,
quick/FK checks, secure current sessions, maintenance/public compatibility state,
PWA content types/cache policy and aggregate histories. Features remain disabled
until their separate explicit activation scope and current central approvals.
Formal four-application acceptance is taken only from the center's final
counter/guard verdict, never inferred from exploratory or three-app tests.

On failure keep hard maintenance, preserve queues/audits/unknown history and
prefer a schema/key-compatible forward fix. An older image lacking055–060 cannot
be made compatible by deleting migration records. Never restore an old snapshot
over newer correct operations or discard required decryption material. Any
historical restore needs a separately reviewed write fence proving no valid
later operations are lost, or an approved reconciliation procedure. No backup,
restore, full-project copy, worker activation or runtime configuration is
performed by candidate preparation.
