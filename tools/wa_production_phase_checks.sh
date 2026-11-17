#!/usr/bin/env bash
# Pure deployment phase checks. Sourcing this file changes no Docker state.

wa_verify_target_frontend() {
  local image="$1" expected="$2"
  [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || return 1
  docker run --rm --network none --read-only --cap-drop ALL \
    --security-opt no-new-privileges:true --entrypoint sh "$image" -c \
    'grep -R -F -q -- "$1" /usr/share/nginx/html/assets' wa-candidate-release-check "$expected"
}

wa_verify_crypto_key_continuity() {
  local image="$1" runtime_env="$2"
  # The producer must have Docker logging disabled: stdout contains the key only
  # inside this private pipe. Never enable shell tracing around this operation.
  docker run --rm --log-driver none --network none --read-only --cap-drop ALL \
    --security-opt no-new-privileges:true --env-file "$runtime_env" "$image" node -e '
      const key = process.env.CRYPTO_KEY || "";
      if (!/^[0-9a-fA-F]{64}$/.test(key)) process.exit(1);
      process.stdout.write(key);
    ' | docker exec -i wa-savana-server node -e '
      const { timingSafeEqual } = require("node:crypto");
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", chunk => { input += chunk; if (input.length > 64) process.exit(1); });
      process.stdin.on("end", () => {
        const current = process.env.CRYPTO_KEY || "";
        if (!/^[0-9a-fA-F]{64}$/.test(current) || !/^[0-9a-fA-F]{64}$/.test(input)
          || !timingSafeEqual(Buffer.from(input, "hex"), Buffer.from(current, "hex"))) process.exit(1);
        process.stdout.write("Encryption key continuity verified.\n");
      });
    '
}

wa_verify_runtime_phase() {
  local phase="$1"
  local expected_release="${2:-}"
  case "$phase" in
    maintenance) ;;
    resume)
      [[ "$expected_release" =~ ^[0-9a-f]{64}$ ]] || {
        printf '%s\n' 'Resume requires the reviewed public candidate release marker.' >&2
        return 1
      }
      ;;
    *) printf '%s\n' 'Unknown deployment phase.' >&2; return 1 ;;
  esac

  docker exec wa-savana-server node --input-type=module -e '
    import assert from "node:assert/strict";
    const [phase, expected] = process.argv.slice(1);
    const base = "http://127.0.0.1:3031";
    const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200, "Health must be ready");
    const health = await response.json();
    assert.equal(health.maintenance?.enforced, true, "Hard maintenance barrier must be installed");
    if (phase === "maintenance") {
      assert.equal(health.maintenance.active, true, "Maintenance must be active");
      assert.equal(health.maintenance.requested, true, "Maintenance must be explicitly requested");
      for (const [method, path] of [["GET", "/auth/session"], ["POST", "/v1/messages/send"], ["POST", "/webhook"]]) {
        const result = await fetch(`${base}${path}`, { method, signal: AbortSignal.timeout(10000),
          headers: { "Content-Type": "application/json" }, ...(method === "POST" ? { body: "{}" } : {}) });
        assert.equal(result.status, 503, "Native request gate must refuse, not acknowledge");
        const body = await result.json();
        assert.equal(body.accepted, false);
        assert.equal(body.error?.code, "WA_EGRESS_MAINTENANCE");
      }
    } else {
      assert.equal(health.maintenance.active, false, "Resume requires inactive maintenance");
      assert.equal(health.maintenance.requested, false);
      assert.equal(health.maintenance.resume_check?.required, true, "Idle preflight must be required");
      assert.equal(health.maintenance.resume_check?.passed, true, "Actual idle preflight must pass");
      assert.equal(process.env.WA_BROWSER_RELEASE, expected, "Running server public marker differs from reviewed candidate");
    }
  ' "$phase" "$expected_release" || return 1

  if [[ "$phase" == resume ]]; then
    docker exec wa-savana-frontend sh -c \
      'grep -R -F -q -- "$1" /usr/share/nginx/html/assets' \
      wa-candidate-release-check "$expected_release" || {
      printf '%s\n' 'Running frontend does not contain the reviewed public release marker.' >&2
      return 1
    }
  fi
}

wa_verify_metrics_for_phase() {
  local phase="$1"
  if [[ "$phase" == maintenance ]]; then
    printf '%s\n' 'Maintenance health/request gates passed; metrics remain intentionally unavailable.'
    return 0
  fi
  docker exec wa-savana-server node --input-type=module -e '
    const response = await fetch("http://127.0.0.1:3031/metrics", {
      headers: { Authorization: `Bearer ${process.env.METRICS_TOKEN}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok || !(await response.text()).includes("whatsapp_process_uptime_seconds")) process.exit(1);
  '
}
