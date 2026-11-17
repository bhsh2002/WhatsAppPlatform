"""Actual lost owner-BFF acknowledgement cannot be forced through a new login.

The real center commits an actual native-originated scope create, then the WA
fixture loses that real HTTP response. Every later attempt uses native HTTP;
no center operational wrapper, registry seed or reconciliation override exists.
"""

import json
import re
import sys
from urllib.parse import quote
from uuid import uuid4

from operational_wa_fixture import isolated_wa_operational
from operationalWaIdentitySmoke import _callback, _center_factory, _check, _contract_hashes, _effects, _initial, _oidc
from operationalWaOwnerSmoke import OWNER, _http


def run_owner_unknown_smoke():
    trace = []
    with _center_factory()() as center:
        client_id = "synthetic-wa-native-owner-unknown-smoke"
        config = {**_initial(center), **_oidc(center, client_id),
                  "ownerPortalEnabled": True, "ownerPortalOrigin": center.base_url}
        contracts_before = _contract_hashes(config)
        with isolated_wa_operational(config) as wa:
            contracts_consumed = wa.contract_sha256
            _check(contracts_consumed == contracts_before)
            center.register_oidc_client("wa_savana", wa.callback_uri, client_id=client_id)

            def connect_native_owner():
                wa.login("owner")
                status, _, headers = _http(wa, trace, "GET", _callback(center, wa), as_user="owner")
                _check(status == 303 and headers["Location"].endswith("shared_read_setup=connected"))
                status, body, _ = _http(wa, trace, "POST", OWNER + "/login", as_user="owner",
                                       body=dict(center.test_login_credentials("owner")))
                _check(status == 200 and body["session"]["state"] == "connected")
                _check(isinstance(body.get("native_reference"), str)
                       and re.fullmatch(r"[a-f0-9]{64}", body["native_reference"]))
                return body["session"]["organization_id"], body["native_reference"]

            organization, native_reference = connect_native_owner()
            before = center.aggregate_effects()
            activity = center.scope_a["activity_id"]
            payload = {"operation": "scope.create", "idempotencyKey": "synthetic-uncertain-" + str(uuid4()),
                       "body": {"scope": {"activity_id": activity}, "label": "Synthetic actual uncertain owner scope"}}
            wa.network(drop_next_ack={"method": "POST",
                "path": f"/api/member/organizations/{organization}/integration/scopes"})
            status, failure, _ = _http(wa, trace, "POST", OWNER + "/operations", as_user="owner", body=payload)
            _check(status == 503 and failure["error"]["code"] == "owner_portal_outcome_unknown")
            status, current, _ = _http(wa, trace, "GET", OWNER, as_user="owner")
            _check(status == 200 and current["intents"]["unknown_count"] == 1
                   and current["intents"]["mutations_blocked"])
            # Identical intent retry observes status only; no automatic re-send.
            status, old, _ = _http(wa, trace, "POST", OWNER + "/operations", as_user="owner", body=payload)
            _check(status == 200 and old["intent"]["state"] == "unknown" and old["intent"]["result"] is None)
            status, looked, _ = _http(wa, trace, "GET", OWNER + "/intents/" + old["intent"]["id"], as_user="owner")
            _check(status == 200 and looked["intent"]["state"] == "unknown" and looked["intent"]["result"] is None)
            # This allocates actual new native and portal sessions, not a JWT or
            # cookie seed. The immutable tenant/central-actor/org hold survives.
            _check(connect_native_owner() == (organization, native_reference))
            status, current, _ = _http(wa, trace, "GET", OWNER, as_user="owner")
            _check(status == 200 and current["intents"]["unknown_count"] == 1
                   and current["intents"]["mutations_blocked"]
                   and current["native_reference"] == native_reference)
            mutations_before_lookup = wa.diagnostics()["effects"]["owner_portal_mutation_requests"]
            status, recovered, _ = _http(wa, trace, "GET",
                OWNER + "/intents/by-key/" + quote(payload["idempotencyKey"], safe=""), as_user="owner")
            _check(status == 200 and recovered["intent"]["state"] == "unknown"
                   and recovered["intent"]["result"] is None
                   and recovered["intent"]["id"] == old["intent"]["id"]
                   and recovered["intent"]["request_sha256"] == old["intent"]["request_sha256"])
            _check(wa.diagnostics()["effects"]["owner_portal_mutation_requests"] == mutations_before_lookup == 1)
            status, refusal, _ = _http(wa, trace, "POST", OWNER + "/operations", as_user="owner",
                                      body={**payload, "idempotencyKey": "synthetic-fresh-key-" + str(uuid4())})
            _check(status == 409 and refusal["error"]["code"] == "owner_portal_unresolved_intent")
            status, overview, _ = _http(wa, trace, "GET", OWNER + "/overview", as_user="owner")
            _check(status == 200 and len([row for row in overview["options"]["scopes"]
                if row["scope"]["activity_id"] == activity]) == 1)
            _check(center.aggregate_effects() == before)
            effects = _effects(wa)
            _check(effects["lost_acknowledgements"] == 1 and effects["owner_portal_mutation_requests"] == 1)
            state_counts = wa.diagnostics()["owner_portal_state_counts"]
            _check(state_counts["savana_owner_portal_intents"] == {"unknown": 1})
        contracts_after = _contract_hashes(config)
        _check(contracts_before == contracts_consumed == contracts_after)
    return {"kind": "actual_native_owner_lost_BFF_acknowledgement_hold",
            "actual_center_scope_commit_before_lost_response": True,
            "same_intent_retry_only_observes_unknown_without_result": True,
            "actual_new_native_JWT_OIDC_and_portal_login_cannot_clear_hold": True,
            "opaque_native_reference_stable_across_actual_new_JWT": True,
            "read_only_by_key_lookup_after_new_JWT_returns_same_unknown_metadata_result_null": True,
            "by_key_lookup_dispatches_no_owner_mutation": True,
            "fresh_key_blocked_before_second_owner_mutation": True,
            "actual_owner_BFF_mutation_dispatch_count": 1,
            "actual_native_fresh_current_overview_reads_committed_scope": True,
            "owner_portal_state_counts": state_counts, "effects": effects,
            "native_HTTP_trace": trace, "owned_lifecycle_cleanup_passed": True,
            "contract_hashes": {"before": contracts_before, "consumed": contracts_consumed,
                                "after": contracts_after, "all_match": True},
            "portal_HMAC_secret_copied": False, "registry_or_grant_seeding": False,
            "reconciliation_or_force_override": False, "four_app_acceptance": False,
            "production_activation": False}


if __name__ == "__main__":
    if len(sys.argv) != 1:
        raise SystemExit("This owned acceptance entry accepts no target or configuration arguments")
    print(json.dumps(run_owner_unknown_smoke(), indent=2))
