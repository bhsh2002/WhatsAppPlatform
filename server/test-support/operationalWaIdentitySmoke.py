"""Separate WA/official-center identity acceptance, never a four-app grant test.

Run with the center's existing Python environment. Targets, identities and
databases are owned by the official temporary entries; no arguments or existing
state are accepted. Only aggregate facts leave this process.
"""

from pathlib import Path
import hashlib
import json
import signal
import sys
from urllib.parse import urlparse

from operational_wa_fixture import isolated_wa_operational


CENTER_ROOT = Path("/Users/savana/Dev/Savana/savana-control-plane")


def _center_factory():
    if str(CENTER_ROOT) not in sys.path:
        sys.path.insert(0, str(CENTER_ROOT))
    from tools.operational_acceptance_fixture import isolated_operational_center
    return isolated_operational_center


def _initial(center):
    contracts = CENTER_ROOT / "contracts/openapi"
    return {
        "centerOrigin": center.base_url,
        "platformToken": center.platform_token("wa_savana"),
        "contractPaths": [str(contracts / "integration-read-v1.openapi.json"),
                          str(contracts / "integration-operational-v1.openapi.json"),
                          str(contracts / "connect-v2.openapi.json"),
                          str(contracts / "control-center-v2.openapi.json")],
        "oidcIssuer": center.base_url,
    }


def _oidc(center, client_id):
    return {
        "oidcClientId": client_id,
        "oidcAuthorizationEndpoint": center.portal_url + "/oauth/authorize",
        "oidcTokenEndpoint": center.base_url + "/v1/oidc/token",
        "oidcJwksUri": center.base_url + "/.well-known/jwks.json",
        "oidcUserInfoEndpoint": center.base_url + "/v1/oidc/userinfo",
    }


def _check(condition):
    if not condition:
        raise AssertionError("Owned WA identity acceptance check failed")


def _contract_hashes(config):
    return {name: hashlib.sha256(Path(name).read_bytes()).hexdigest() for name in config["contractPaths"]}


def _status(wa, actor="owner"):
    status, body, _ = wa.request("GET", "/api/portal/integrations/shared-read-setup", as_user=actor)
    _check(status == 200)
    return body


def _callback(center, wa):
    status, body, _ = wa.request("POST", "/api/portal/integrations/shared-read-setup/authorization",
                                 as_user="owner", body={})
    _check(status == 200)
    redirect = urlparse(center.approve_oidc_authorization(body["authorization_url"]))
    _check(f"{redirect.scheme}://{redirect.netloc}" == wa.base_url)
    return redirect.path + "?" + redirect.query


def _effects(wa):
    diagnostic = wa.diagnostics()
    _check(diagnostic["native_effect_tables_unchanged"] and diagnostic["legacy_rows_unchanged"])
    _check(all(diagnostic["effects"][name] == 0 for name in (
        "external_network_attempts", "channel_requests", "forbidden_business_requests", "actual_external_effects")))
    return diagnostic["effects"]


def run_identity_smoke():
    checks = 0
    with _center_factory()() as center:
        client_id = "synthetic-wa-operational-identity-smoke"
        with isolated_wa_operational({**_initial(center), **_oidc(center, client_id)}) as wa:
            center.register_oidc_client("wa_savana", wa.callback_uri, client_id=client_id)
            _check(wa.request("GET", "/api/portal/integrations/shared-read-setup")[0] == 401)
            checks += 1
            for actor in ("owner", "employee", "foreign"):
                _check(wa.login(actor)["authenticated"])
                checks += 1
            status = _status(wa)
            _check(status["session"]["state"] == "disconnected" and not status["read_ready"])
            checks += 1
            _check(wa.request("POST", "/api/portal/integrations/shared-read-setup/authorization",
                              as_user="owner", body={}, headers={"X-Savana-Owner-Intent": "invalid"})[0] == 403)
            checks += 1
            response, _, headers = wa.request("GET", _callback(center, wa), as_user="owner")
            _check(response == 303 and headers["Location"].endswith("shared_read_setup=connected"))
            checks += 1
            status = _status(wa)
            _check(status["session"]["state"] == "connected" and not status["read_ready"]
                   and any(item["code"] == "operational_owner_actions_in_control_center" for item in status["blockers"]))
            checks += 1
            _check(wa.request("GET", "/api/portal/integrations/shared-products", as_user="owner")[0] == 403)
            checks += 1
            _check(_status(wa, "employee")["session"]["state"] == "disconnected")
            checks += 1
            _check(wa.pause_http()["database_preserved"] and wa.resume_http()["origin_unchanged"])
            _check(_status(wa)["session"]["state"] == "connected")
            checks += 1
            _check(wa.request("POST", "/api/portal/integrations/shared-read-setup/disconnect",
                              as_user="owner", body={})[0] == 200)
            _check(wa.request("GET", "/api/portal/integrations/shared-products", as_user="owner")[0] == 403)
            checks += 1
            effects = _effects(wa)
            checks += 1
    return {"kind": "owned_WA_plus_official_center_identity_OIDC_smoke", "checks_passed": checks,
            "actual_native_password_logins": 3, "actual_center_owner_OIDC_callback": True,
            "read_remains_denied_without_approved_binding": True, "listener_pause_resume_only": True,
            "effects": effects, "cleanup_passed": True, "operational_grants_seeded": False,
            "four_app_acceptance": False}


def run_failure_smoke():
    scenarios = []
    with _center_factory()() as center:
        initial = {**_initial(center), "deferOidcConfiguration": True}
        with isolated_wa_operational(initial) as wa:
            _check(wa.needs_oidc_configuration)
        scenarios.append("private_stop_during_pending_configuration_cleanup")
        with isolated_wa_operational(initial) as wa:
            wa._process.send_signal(signal.SIGTERM)
            stopped = wa.receive()
            _check(stopped["event"] == "stopped" and stopped["cleanup"]["owned_state_removed"])
            wa.cleanup = stopped["cleanup"]
            wa._process.wait(timeout=10)
            _check(wa._process.returncode == 0)
        scenarios.append("SIGTERM_during_pending_configuration_cleanup")
        with isolated_wa_operational(initial) as wa:
            client_id = "synthetic-wa-operational-failure-smoke"
            center.register_oidc_client("wa_savana", wa.callback_uri, client_id=client_id)
            wa.configure_oidc(_oidc(center, client_id))
            _check(wa.login()["authenticated"])
            callback = _callback(center, wa)
            wa.network(disconnected=True)
            status, _, headers = wa.request("GET", callback, as_user="owner")
            _check(status == 303 and headers["Location"].endswith("shared_read_setup=unknown"))
            _check(_status(wa)["session"]["state"] == "unknown")
            _check(wa.request("GET", "/api/portal/integrations/shared-products", as_user="owner")[0] == 403)
            wa.network(disconnected=False)
            scenarios.append("actual_callback_partition_is_unknown_and_read_denied")
            callback = _callback(center, wa)
            wa.network(drop_next_ack={"method": "POST", "path": "/v1/oidc/token"})
            status, _, headers = wa.request("GET", callback, as_user="owner")
            _check(status == 303 and headers["Location"].endswith("shared_read_setup=unknown"))
            _check(_status(wa)["session"]["state"] == "unknown")
            _check(wa.request("GET", callback, as_user="owner")[2]["Location"].endswith("shared_read_setup=unverified"))
            _check(wa.request("GET", "/api/portal/integrations/shared-products", as_user="owner")[0] == 403)
            effects = _effects(wa)
            _check(effects["central_http_requests"] == 1 and effects["lost_acknowledgements"] == 1)
            scenarios.append("real_center_token_HTTP_lost_ack_no_replay_and_read_denied")
    return {"kind": "owned_WA_private_lifecycle_and_OIDC_failure_smoke", "scenarios_passed": scenarios,
            "count": len(scenarios), "effects": effects, "cleanup_passed": True,
            "operational_grants_seeded": False, "four_app_acceptance": False}


if __name__ == "__main__":
    if len(sys.argv) != 1:
        raise SystemExit("This owned acceptance entry accepts no target or configuration arguments")
    print(json.dumps({"identity": run_identity_smoke(), "failure": run_failure_smoke()}, indent=2))
