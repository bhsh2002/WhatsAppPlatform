# Owned Picomatch guard: portable integration verifier

This verifier is a required CI gate for the reviewed internal adapter. It is not
an official Picomatch patch, a general JavaScript sandbox, or adoption approval.
The final p10 owned package is version **4.1.2**. Use its reviewed archive and
evidence, never historical p9 pins or results as substitutes.

## Configure and review

Source owners adapt `config.json` to their own consumer graph and review the
change. Resolve `repoRoot` relative to the config file; resolve every other
configured path relative to that repository root, not the current working
directory. Keep machine-specific absolute paths out of committed config. Start
from the reviewed `config.example.json` and package fragment, then review the
source-owner adaptation.

Pin the owned package identity/version, archive SHA-256 and SRI, and the approved
file-manifest path/hash. Verify every file listed by that manifest and reject
missing, additional or changed package files. Pin `fileCount` in config to the
reviewed manifest and verify the agreement; do not substitute a hardcoded 19/20
count or accept an unreviewed manifest size.

The reviewed inventory covers the selected dependency manifests/locks, relevant
consumer package entrypoints/helpers, build/test configuration, and the configured
proof entrypoint. It is **not a snapshot of the whole UI repository**. Include the
paths that establish matcher options, native regex handoffs and package resolution.
New consumers, private/deep imports, callbacks or relevant configuration changes
require a fresh source-owner review, not an automatic baseline refresh.

Scripts under repository-root `tools` need not import the frontend alias relative
to their own location. For each inventoried JavaScript file outside `packageRoot`,
record its actual source-reviewed `createRequire` context in
`inventory.resolutionAnchors`, for example:

```json
{ "tools/picomatch/bounded-proof.cjs": "frontend/package.json" }
```

This matches the proof source: it explicitly creates a require from the passed
package-root manifest. The anchor is part of the approved inventory, and its base
file is hashed too. An anchor is a checked description, not an import remapping.
A root script with a real bare `require("picomatch")` must use its own file as
anchor and will fail if no root dependency exists; do not invent a root dependency
or symlink. Every consumer inside `packageRoot`, including dependency files, is
always checked relative to its own file and cannot be overridden by an anchor.

For initial review only:

```sh
node verify.cjs --config ./config.json --capture-inventory ./inventory.candidate.json
```

A captured candidate is untrusted until manually reviewed and approved. Capture
must not overwrite the trusted inventory, auto-accept new inputs, or turn CI green
by learning the current checkout. Commit the reviewed config/inventory through the
normal source-owner change process.

## Local inspection is not the mandatory gate

The currently authorized local diagnostic mode is:

```sh
node verify.cjs --config ./config.json --mode inspect
```

Inspection is static only: it does not run the bounded/DoS proof and always reports
`mandatoryGatePassed: false`. It is forbidden when `CI=true` and cannot stand in
for the normal CI gate. This documentation does not authorize repeating DoS probes.

## Mandatory CI verification

After the project's approved locked installation, run the normal verifier in CI:

```sh
node verify.cjs --config ./config.json
```

The normal mode checks the reviewed pins/inventory and requires the configured
bounded proof entrypoint under its explicit outer deadline. Missing proof, an
unknown/changed inventory item, timeout or incomplete cleanup is a failure, never
a skipped pass. Every normal proof must read the **actual finite Linux cgroup memory
limit** (`memory.max`) and require it to be at most
`limits.maxCIMemoryLimitBytes` (for example, 1 GiB). Missing, unreadable, invalid or
unbounded cgroup evidence fails closed for every normal proof, whether `CI` is
set or not; a config value or asserted limit alone is not enforcement evidence.
Only diagnostic inspect mode may report unavailable cgroup evidence without
executing the proof.

The current approved upper policy ceiling is **4 GiB**, with a 64 MiB minimum.
The prior 2 GiB ceiling was a review-policy choice, not an engine-derived or
measured safe RSS bound. Root explicitly approved the existing Catalog runner
4 GiB and BuildKit builder 3 GiB profiles in
`root-build-verifier-resource-profile-decision.json`; no runtime profile or
privilege was increased for this verifier change.

`limits.maxCIMemoryLimitBytes` is the reviewed maximum for the cgroup running
this gate. The example now shows 4294967296 bytes (4 GiB) for that approved
profile; a 3 GiB-only profile can pin 3221225472. Other source owners must pin
their own approved finite maximum rather than blindly inheriting the example.
Every normal proof still reads the actual cgroup and requires it to be finite
and at or below the configured ceiling. Missing, unreadable, invalid, unbounded
or above-policy evidence remains a hard failure regardless of `CI`. Do not
replace measured evidence with a config/environment assertion, auto-raise it to
host RAM, or infer an RSS safety guarantee from this policy cap.

Worker 64/16 MiB and 500 ms limits, CPU/PID/job controls, readonly/offline proof
controls, and the original audit requirements are unchanged. The accepted R2
256 MiB Linux normal proof remains differential evidence of the unchanged path;
it is not relabeled as a 4 GiB real-job test. Each project still owes its actual
full CI normal proof under its approved resource profile.

Require the actual CI runtime/platform and its current native npm to prove:

```sh
npm ls --all --include=dev --include=optional --strict-peer-deps
```

Keep the selected platform's optional native bindings. Do not hide dependency or
peer failures with `--force`, `--legacy-peer-deps`, omitted dev/optional packages,
a different global tree, or a fixture's npm result. Record the runtime/npm version
and exact resolved identities.

Require the single approved Node-resolvable `picomatch` alias to resolve to the
owned package with the pinned archive SRI and file hashes. Reject extra unguarded
upstream copies, unknown alternate identities, and private/deep imports that bypass
the public root/posix boundary. The declared upstream engine remains embedded inside
the bounded Worker; disclose it separately rather than calling it a second guarded
release or concealing its original name/version.

## Docker build-context requirement

All three current frontend Dockerfiles copy `package*.json` and run `npm ci`
**before** their later `COPY . .`. A local `file:` archive must therefore be inside
the frontend build context and copied before that install layer: use
`frontend/vendor/...p10.tgz` (WA: `client/vendor/...p10.tgz`) and the reviewed
package dependency such as `file:vendor/...p10.tgz`. Keep the approved manifest in
that same `vendor` area, allow those files through `.dockerignore`, and add the
appropriate `COPY vendor/...` before `npm ci`. The later source copy cannot make a
missing archive available to an earlier install layer. Verifier/helper/proof
scripts belong under repository-root `tools`; do not resolve a frontend-local
`file:` dependency to a root-only archive outside its Docker build context.
These source-owner Docker/package changes are required integration work, not
changes performed by this README.

## Resource and boundary proof

The configured proof must establish both supported behavior and fail-closed limits:

- Normal supported work completes within the configured budget; a stalled operation
  raises an explicit budget error instead of a fabricated no-match result.
- `NODE_OPTIONS` must be empty: p10 rejects **any nonempty value**. Heap-size
  flags in `process.execArgv`, including relevant quoted/escaped forms, are denied
  by the separately hashed pure startup-policy helper. Verify that helper's pin.
  Do not strip flags, retry with weaker settings, or bypass startup denial to
  obtain a passing result.
- Deadline failure terminates the owned Worker, confirms its exit within the outer
  deadline, and leaves the adapter closed without a replacement/retry loop. Verify
  owned worker/process cleanup; absence of a response alone is not exit evidence.
- Callback, inspectable parse-state and native regex export/clone/handoff limits
  remain explicit. A required unsupported route is an integration blocker, not a
  successful build or an equivalent API result.

Retain CI's outer memory, PID and job-time limits. Worker V8 limits are not an
independent hard total-RSS guarantee. Arbitrary trusted Node caller code and manual
private-file loading remain outside this adapter's containment boundary.

## Evidence and adoption limits

Track the applicable GHSA/CVE against the embedded original engine and its exact
provenance. The owned package's version is not an upstream fixed version. A renamed
package or zero `npm audit` findings does not close that advisory or establish
security acceptance; keep audit and the explicit tracking/ownership record active.

Synthetic Catalog/WA/Saw fixtures are limited integration evidence. Each source
owner must still wire this verifier into the **actual repository CI**, review the
resolved configuration, and pass its fresh locked tests/builds and required boundary
canaries on the intended platform before adoption. A synthetic pass cannot replace
those gates. Preserve immutable evidence of the pins, inventory review, tree/peer
checks, bounded proof and worker exit; CI must never silently refresh acceptance.
