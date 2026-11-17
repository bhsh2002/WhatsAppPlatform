# Controlled CI and release images

CI and the release workflow now build from the same reviewed runtime selection
and `ops/release/server.Dockerfile` / `client.Dockerfile` used by the isolated
Linux validation. They export committed Git objects into a new directory under
`RUNNER_TEMP`; neither build receives the live repository's server/client tree.
The exporter requires the exact clean checkout revision, rejects dirty/staged,
mode/deletion and untracked changes, and leaves Git index bytes untouched.
Ignored environment/data/dependency/build files never enter the export.

`ops/release/runtime-source.sha256` pins the reviewed public runtime marker:
`7bc9f88c66fc39e4577b2687f4aa8f493483856e271aeb1fbced42d0de13c8d8`.
The marker covers only sorted controlled runtime paths, modes and SHA256 bytes;
it excludes HEAD, workflows, deployment tools, recipes and review metadata.
The current selection is441 runtime files, including the Logs page and public
PWA assets. Official contract snapshots remain independent review evidence;
no sibling checkout or official-contract file is needed by the CI exporter.

The source identity is distinct from the real Git release identity. For release,
`workflow_run.head_sha` must equal the actual checkout HEAD. Both built images
carry that full Git revision as `org.opencontainers.image.revision` and the public
marker as `savana.candidate.source-sha256`. The client receives the same marker
through `VITE_WA_CLIENT_RELEASE`. Release evidence prints the literal public
runtime setting `WA_BROWSER_RELEASE=<marker>` for root to install privately;
the workflow does not change runtime configuration or activate features.

The helper binds each build to the original exported manifest hash and public
marker. Before each component and final evidence it rechecks every exported
file/recipe mode and hash, the original manifest hash and revision. It verifies
both image labels after each build. CI loads local images; actual publication
retains max provenance, SBOM and immutable digest checks. A successful release
summary includes actual revision, immutable image references, runtime marker,
component context hashes and recipe hashes. All existing coverage, dependency
audits, client lint/tests/build/PWA checks, pinned history secret scan, private
GHCR repository checks before and after publishing, and anonymous access denial
checks remain mandatory. Publication still requires successful push CI on main.

Focused tests exercise clean export, index preservation, metadata-only commit
stability, dirty source refusal, reviewed-marker drift, context/recipe mutation,
concurrent manifest replacement, explicit build arguments and both revision and
source-label rejection. CI also runs the existing focused browser fetch-hook
checks on Node20. Local implementation validation does not rerun product suites
when runtime files are unchanged.

To intentionally change runtime source in a future release, review the complete
selected file changes, recompute the runtime-only identity with the same
selector/canonical hash algorithm, validate the revised Linux build and update
the pin in that reviewed commit. Do not replace the pin with a Git SHA or disable
the mismatch check. Recipe-only updates preserve the public runtime marker but
require their own build/provenance review. The Git commit/export proof must bind
the exact runtime inputs and both recipes to the reviewed validation evidence.

The immutable `5c4b4166...2fde` source archive remains the historical validated
runtime reference. It does not contain these later workflow/helper changes.
The new isolated Git candidate records those changes separately. Preparation
may create the reviewed local commit/bundle in a managed isolated checkout; no
push or GitHub Actions execution is performed by this task. The original
coordinating root alone pushes/merges, publishes images, changes private
configuration and performs maintenance/resume deployment.
