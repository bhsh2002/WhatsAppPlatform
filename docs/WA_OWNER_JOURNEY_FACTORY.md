# WA ordinary-owner journey factory

This source-owned runner implements the November 18 owner-factory manifest, start and diagnostic schemas. It does not certify a journey or reuse previous acceptance runs. A missing actual application factory fails startup; no mock application or readiness default substitutes for it.

Generate a new public manifest using an existing private Python interpreter and approved Node 22.23.5:

```sh
python3 -B tools/wa_owner_journey_factory.py manifest \
  --source-revision REVIEWED_FULL_40_HEX_REVISION \
  --python /absolute/existing/private/python \
  --node /absolute/approved/node-v22.23.5/bin/node \
  --output /absolute/new/wa-owner-factory.json
```

The manifest records actual controlled runtime paths, modes and bytes, including working changes. Its Git revision remains the reviewed baseline until final source freeze. Separate hashes cover the controller, Node runtime, real application factory, source selector and exact readonly official schema snapshots under `server/test-support/owner-journey-contracts`. No sibling project is needed at factory runtime.

The generator also publishes an immutable public initializer beside the manifest. That initializer contains only fixed approved interpreter/source paths and public hashes, verifies the controller bytes and supplies its pinned Node/source configuration. The manifest entry point has exactly `args: ["--stdio"]`. There are no secret values, caller-selected modules, shell commands or executable stdio requests. Changing any pinned source requires a new manifest and initializer.

Every private JSONL request has exactly `{id,command,params}` and every response has `{id,ok,data}`. The commands are `start`, `diagnostics`, `checkpoint`, `fault`, `restart`, and `stop`. Duplicate JSON keys, nonfinite values, oversize input, unsupported fields and commands are rejected.

`start.params` uses the actual published keys: `run_id`, `state_root`, `port_base`, `urls`, `credentials`, `peers`, `source_revision`, `source_sha256`, and `identity`. The strict schema requires actual per-run URLs, four private service credentials (`platform_token`, `callback_token`, `subscriptions_platform_token`, `subscription_signing`), source-published peer metadata and the real Core-registered identity. The identity contains `client_id`, `redirect_uri`, `issuer`, `discovery_url`, `subscriptions_url`, `portal_url`, `ingress_service`, `ingress_url`, `api_base_url`, `authorization_endpoint`, `token_endpoint`, `userinfo_endpoint`, and `jwks_uri`. Native issuer/discovery/workspace and OIDC endpoints use the public Portal offset 2; internal Connect offset 0 is rejected as the native issuer/API base. Earlier prose keys `owned_state_root`, `ephemeral_service_credentials` and `oidc` are rejected.

The declared loopback offsets are Connect 0, subscriptions 1, portal 2, Catalog 3, Saw 4, WA API 5, WA frontend 6, message provider 7, payment provider 8 and controller 9. Their origins must be exact `http://127.0.0.1:PORT` values. The schema also supplies `catalog_domain_proxy` as `https://127.0.0.1:base+10`; WA accepts that metadata but grants it no outbound socket or TLS access. All other public hosts, undeclared ports, TLS, datagrams and redirects are denied. Occupied WA API/frontend listeners are refused without touching them.

Actual WA peer metadata:

| Purpose | Service | Path |
| --- | --- | --- |
| OIDC PKCE redirect | `wa_frontend` | `/api/portal/integrations/shared-read-setup/callback` |
| Signed Connect server callback | `wa_savana` | `/api/integrations/connect/events` |
| Signed native command adapter | `wa_savana` | `/api/savana/command-adapter/v1` |
| Owner action UI | `wa_frontend` | `/portal/integrations` |

The frontend OIDC redirect keeps browser owner-intent requests on the actual frontend origin. The native cookie is `wa_session` with path `/api`. The factory adapter uses an empty signature prefix because it mounts the complete public `/api` path. Production assembly fixes that prefix to `/api` after Nginx removes it; neither mapping is supplied by browser or forwarded headers. The browser binding return uses `/portal/integrations?savana_binding=...&state=...`; it is separate from the signed Connect callback.

Before any application import, the dedicated Node process clears inherited environment values, generates its own ephemeral native JWT/encryption keys and owner password, and installs the owned SQLite path. It never imports `server.js`, dotenv or an existing database. Actual migrations, encryption, native auth router and cookie handling are used. Bootstrap creates only one ordinary native tenant user and tenant, without grants, bindings, enrollments, source authority, consent, products or ready flags. Exact original request bytes are retained before JSON parsing for actual webhook/command HMAC verification.

Actual Vite/React runs on the frontend offset with environment-file loading disabled. Its `/api` proxy preserves the complete path. The root-owned fixed module `server/test-support/ownerJourneyApplication.js` must export:

```js
createOwnerJourneyApplication({
  app, database, stateRoot, runId, urls, serviceCredentials,
  nativeOwner, observe, oidc, peers,
}) // -> { diagnostics(), checkpoint(params), fault(params), close() }
```

`serviceCredentials` maps only from validated `credentials`; `oidc` maps only from validated Core `identity`; `peers` contains published route metadata. The factory mounts real native/workspace/Connect routers at full `/api` paths. It validates real provider configuration and derives current rights from source-owned state and actual authoritative calls. An initial native identity is not a grant.

Application `diagnostics()` and `checkpoint()` return `{facts,observations?,capability_proofs?}`. Facts use canonical published counter names and actual nonnegative integer measurements. Missing/unmeasured values stay absent; they never become zero. The runtime adds only its measured process-restart count. Observations have `{service,method,path_template,status,observed_at}` and never contain bodies, headers, cookies, query values or actual opaque IDs. Trusted source `observe` accepts `{method,path_template,status,service?}` and attaches its own timestamp. Static auth route declarations are automatically observed; no fallback to `originalUrl` is collected. Python validates resulting diagnostic envelopes against the exact published schema.

Official observations contain only responses served by `wa_savana` or `wa_frontend`. Actual outbound peer/provider HTTP audits remain in the private `owner_journey_outbound_observations` table; they do not impersonate independent Core/provider server traces. Repeated real source responses remain distinct.

The public fault control is exactly `{fault:"commit_then_drop_ack_once"}`. It returns `{fault:"commit_then_drop_ack_once",armed:true,boundary:"owned_provider_http"}` only after the actual response hook is installed and its one-shot state is persisted. A retained, dispatching collaborative SMS/WhatsApp/Messenger effect must match the actual request before a valid endpoint-specific acceptance ACK can consume that arm. The applied counter changes atomically with consumption, not with arming. Concurrent or late ACKs cannot consume the arm twice or consume a later generation. Restart retains armed/consumed state without dispatching. Reconciliation still requires the actual signed callback or original SMS history, with no blind resend. Unrelated sends, setup calls and content/media without a retained transport correlation do not consume this fault.

Startup's `browser_context` privately supplies `ordinary_owner: {username,password}`. The application may additionally supply a bounded technical provider object as `native_provider`; it cannot contain contacts, recipients, grants, consent or approval/binding authority. The native key handoff stays only in the internal child pipe and Python memory, is removed before the external response, and is reused for actual process restart. Diagnostic/checkpoint responses reject private fields. Neither credentials nor key material belongs in public evidence.

Before application imports, the runtime derives this run's Meta app secret and webhook verify token from its private callback credential, sets the fixed owned Meta app ID, and points the SMS callback at the declared native loopback API. These values configure only the owned fixture. Actual webhook handlers therefore import the matching ephemeral verification configuration. Persisted application observations and automatic native-auth observations are composed once; repeated real requests are retained.

The initial smoke uses the actual application factory, migrated owned SQLite, ordinary native authentication, Vite, and the disconnected workspace route. It also checks the same native session after an actual Node process restart and removes the allocated state. It does not run Core, register a provider, seed business authority, validate the newly locked build adapter, or certify a multi-application journey. Current working-source hashes and each immutable smoke manifest/receipt are published in the owned handoff.

The manifest declares actual owner navigation for applicable journeys. Native capability proofs join reviewed workspace requests, immutable native command/effect receipts, actual source facts, current configured adapters and completed signed result HTTP responses. Empty ledgers produce no positive proof. Factory-only helpers and their bytes are included in the separate factory identity.

Catalog actions use the current Core-provided, operator-validated source owner form URL. WA then reads current scoped command/results through its own identity. Native WA contacts/media remain distinct sources. Shared media presentation shows authorized metadata counts without creating image URLs. Consumer observations retain private hashes and measured context; missing semantic evidence is not a measured zero or an accepted journey.

The linked Catalog inventory/deficit/order journeys use that same real workspace navigation and scoped result retrieval. Exact authorized `inventory.read` and order result reads can be measured. A result GET alone does not prove a deficit, a reconciliation request, or the absence of an inventory ledger. Those criteria require an explicit source projection or independently correlated source evidence; WA creates no native stock/order implementation for these declarations.

`checkpoint` is read-only and accepts an optional scenario name. `fault` accepts only owned message/payment provider targets with `commit_then_drop_ack` or `restore` and an optional correlation reference; the actual source-owned provider supports it or fails explicitly. There is no success flag, business-row mutation, public send or payment control.

`restart` stops the actual API/Vite Node process and starts a fresh one using the same owned SQLite state and keys. It cannot clear unknowns, reclaim effects or replay sends. `stop` and EOF terminate only the owned process and remove only the allocated directory after checking filesystem identity. Arbitrary symlink traversal is refused; known macOS `/tmp` and `/var` aliases are canonicalized. No global cleanup, dependency installation, deployment or production access occurs.

Focused checks:

```sh
python3 -B -m unittest tools.tests.test_wa_owner_journey_factory
/absolute/approved/node-v22.23.5/bin/node --test server/test/ownerJourneyRuntime.test.js
```

These verify protocol/schema boundaries, source identity, exact request bytes, private handoff separation, owned process cleanup and actual local HTTP network confinement. The fresh shared browser journey and real application/provider integration still require separate evidence.
