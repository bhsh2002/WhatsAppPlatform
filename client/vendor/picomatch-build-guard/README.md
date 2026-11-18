# Internal bounded Picomatch prototype — not release accepted

Name: `@savana-internal/picomatch-build-guard@4.1.2` (private prototype).
This is an owned private Node build/test adapter, not an official patched
Picomatch release. Nothing was published or adopted by a project. The original
MIT license and the registry-verified Picomatch 4.0.5 source are retained.
`provenance.json` pins the original tarball and every vendored file. The vendored
matching implementation is unchanged; the worker adds a compiled-source length
check through its private/public `toRegex` property.

## Property under evaluation

Compilation, parsing, scanning and matching through the exported callable/API
execute in one persistent Worker per resolved module and Node isolate. Native
regex matching stays there. A slow operation raises an explicit error; it never
returns a fabricated false/no-match. The Worker is terminated and the adapter is
poisoned after a deadline: subsequent calls fail instead of spawning replacements.
This contains the observed backtracking stall; it is not a new linear regex
algorithm and does not claim to correct all pre-existing upstream semantics.

CommonJS and ESM root/posix entrypoints reuse the same Worker. The package exports
only root and posix. It never exposes an unprotected native RegExp from an API.
Guarded RegExp objects implement exec/test and ordinary String regex operations
by remote calls; intrinsic exec and source access are not native execution paths.

## Accepted surface

- String/array glob callables, isMatch, scan, makeRe, compileRe, toRegex, test and
  matchBase run with the upstream engine. Boolean matching, contains, captures,
  flags, ordering and lastIndex are preserved for completed supported operations.
- `scan` retains its ordinary metadata including parts/base/isGlob/negated.
- `parse` returns an opaque handle usable by guarded `compileRe`. It is not a
  mutable or inspectable raw compiled-source object.
- Ordinary native RegExp arguments to APIs are cloned into the Worker and their
  lastIndex updates are copied back. lastIndex must be a nonnegative safe integer;
  object/string/fractional coercion is explicitly unsupported. Custom/subclassed/Proxy/frozen RegExp inputs
  are explicitly rejected.
- Plain data options with enumerable own string keys and ordinary arrays are
  supported. Nonenumerable custom input properties are explicitly rejected rather
  than silently dropped. Object subject/replacement/split-limit coercion through
  regex methods is unsupported; primitive coercion remains in the Worker.
  Local JavaScript callbacks,
  accessors, Proxy inputs, symbol-bearing/custom-prototype records and reentrant
  calls are explicitly unsupported. Current inventoried consumers use scalar
  options/ignore arrays, not local callback options.

## Deliberately unsupported; no drop-in claim

Raw `.source`, regex `toString`, JSON/structured/binary cloning, raw compile-output
flags and parse-state inspection/mutation/serialization fail explicitly. Any
native Rolldown/Vite handoff or native cloning must fail; it must not receive a
lookalike regex with a false/empty/match-all replacement source. Generic
RegExp-prototype exec rejects the incompatible object. Guarded regexes carry a
function clone barrier; serialization does not quietly produce a usable regex.

Catalog Vite8 has a conditional native makeRe transport for custom `assetsInclude`.
The current Catalog config does not set it, but the route is real. It remains an
integration limitation until a reviewed bounded bridge/engine exists. An actual
fresh partner build and a canary requiring the unsupported route are mandatory;
an untested optional branch is not claimed compatible.

Raw user-created regex strings, arbitrary host JavaScript, deliberately requiring
private files by absolute filesystem path, and manually recreating a regex outside
this API are outside its boundary. No package can sandbox arbitrary Node caller
code. The public source-export APIs that would ordinarily encourage such a native
handoff are intentionally blocked here. The API is for trusted build code with
untrusted patterns/subjects, not a general JavaScript sandbox or browser runtime.

## Explicit resource bounds

- One Worker; no pool/restart loop. Startup wait 3000ms; each synchronous call
  waits at most 500ms plus scheduling/IPC overhead, then aborts and terminates it.
- Worker V8 old generation 64MiB, young generation 16MiB, stack 4MiB.
- Shared wire buffer 2MiB; pre-serialization byte accounting, final byte check,
  50000 graph-node/depth64 checks; arrays at most65536 with charged capacity.
- Glob patterns at most4096 UTF-16 characters at every nested-array depth;
  each pattern/ignore tree at most1024 leaves, arrays at most1024, no cycles,
  tree traversal at most50000 visits/depth64;
  strings at most65536, compiled regex source at most16384.
- Worker remote entities/main opaque cache at most16384; external native regex
  references at most4096. Local callback count is zero.
- Native RegExp source inputs are limited to4096 and standard writable-lastIndex
  objects. Matcher state after an aborted call is invalid; the adapter stays closed.

Startup fails closed with PICOMATCH_WORKER_HEAP_FLAGS_UNSUPPORTED for ANY nonempty
NODE_OPTIONS, or parent heap-size flags in process.execArgv that can override Worker
limits. An explicitly empty NODE_OPTIONS is the supported build/test profile;
even benign nonempty options are deliberately unsupported. This avoids trying to
reimplement Node's environment-option quoting/tokenization.
The error exposes flag names only, never environment values. Clear these flags in
frontend build/test and Docker builder processes; keep outer CI resource limits.

Worker resourceLimits constrain V8 memory, not every native/external allocation or
the caller's existing objects. CI must retain its hard process/container memory,
PID and outer-job limits. No claim of an independent hard total-RSS bound is made.
Host callback code is rejected, not treated as being contained by the Worker.

## Acceptance remains outstanding

The old Catalog24h exception is not changed or extended and does not authorize new
UI/lock inputs. A renamed package or a clean audit report alone is not acceptance.
Keep npm audit fully active, pin this adapter's source/engine integrity and run its
negative controls/boundary contract. Track the embedded upstream CVE until an
actual reviewed release replaces it.

Before adoption: independent code/security review; full upstream corpus with each
failure classified publicly; actual dependency corpus and dynamic-wrapper tests;
bounded DoS/resource/escape tests; fresh locked Node22/24 dependency installs and
real tests/builds in all three partner projects; Linux validation under existing
CI resource controls. No actual project/lock or CI was changed by this prototype.

The private owned version4.1.2 is chosen for fixture validation against current
optional Picomatch `^3 || ^4` peer ranges. It is not an upstream4.0.8 release and
its number does not establish compatibility or remediation. Final adoption still
requires truthful source/integrity tracking and successful clean peer resolution
without `--force`/`--legacy-peer-deps`, plus all acceptance gates above.
