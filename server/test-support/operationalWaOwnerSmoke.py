"""Native WA owner login/create/revise/approve using actual portal cookie HTTP.

The center wrapper is used only for identity bootstrap and existing OIDC consent.
Every operational scope/action/request/edit/approval originates at actual WA
owner HTTP routes. No portal signing secret or registry seed enters WA.
"""

import json
import re
import sys
from uuid import uuid4

from operational_wa_fixture import isolated_wa_operational
from operationalWaIdentitySmoke import _callback, _center_factory, _check, _contract_hashes, _effects, _initial, _oidc


OWNER = "/api/portal/integrations/shared-read-setup/owner"


def _http(wa, trace, method, path, **options):
    result = wa.request(method, path, **options)
    public_path = path.split("?", 1)[0]
    if public_path.startswith(OWNER + "/intents/by-key/"):
        public_path = OWNER + "/intents/by-key/{idempotency_key}"
    elif public_path.startswith(OWNER + "/intents/"):
        public_path = OWNER + "/intents/{intent_id}"
    elif public_path.startswith("/api/portal/integrations/shared-products/"):
        public_path = "/api/portal/integrations/shared-products/{entity_id}"
    trace.append({"method": method, "path": public_path,
                  "native_role": options.get("as_user"), "status": result[0]})
    return result


def _operation(wa, trace, operation, body, **selectors):
    status, payload, headers = _http(wa, trace, "POST", OWNER + "/operations", as_user="owner", body={
        "operation": operation, "idempotencyKey": "synthetic-native-owner-" + str(uuid4()),
        "body": body, **selectors,
    })
    trace[-1]["operation"] = operation
    _check(status == 200 and headers.get("Cache-Control") == "no-store")
    _check(payload["intent"]["state"] == "completed" and payload["intent"]["result"] is not None)
    _check(payload["read_only"] and not payload["execution_ready"] and not payload["pricing_use_allowed"])
    return payload["intent"]["result"]


def run_native_owner_smoke():
    trace = []
    with _center_factory()() as center:
        client_id = "synthetic-wa-native-owner-smoke"
        config = {**_initial(center), **_oidc(center, client_id),
                  "ownerPortalEnabled": True, "ownerPortalOrigin": center.base_url}
        contracts_before = _contract_hashes(config)
        with isolated_wa_operational(config) as wa:
            contracts_consumed = wa.contract_sha256
            _check(contracts_consumed == contracts_before)
            center.register_oidc_client("wa_savana", wa.callback_uri, client_id=client_id)
            wa.login("owner")
            wa.login("employee")
            status, _, headers = _http(wa, trace, "GET", _callback(center, wa), as_user="owner")
            _check(status == 303 and headers["Location"].endswith("shared_read_setup=connected"))
            before = center.aggregate_effects()
            # Credentials are a transient private fixture mapping, never part of
            # startup configuration, an artifact, stdout or a returned cookie.
            status, _, _ = _http(wa, trace, "POST", OWNER + "/login", as_user="employee",
                                      body=dict(center.test_login_credentials("owner")))
            _check(status == 403)
            status, login, _ = _http(wa, trace, "POST", OWNER + "/login", as_user="owner",
                                          body=dict(center.test_login_credentials("owner")))
            _check(status == 200 and login["session"]["state"] == "connected")
            _check(isinstance(login.get("native_reference"), str)
                   and re.fullmatch(r"[a-f0-9]{64}", login["native_reference"]))
            actor = login["session"]["actor_id"]
            _check(actor and login["session"]["organization_id"] == center.organization_id)
            status, owner_status, _ = _http(wa, trace, "GET", OWNER, as_user="owner")
            _check(status == 200 and owner_status["session"]["state"] == "connected"
                   and owner_status["native_reference"] == login["native_reference"])
            status, enrolled, _ = _http(wa, trace, "POST", "/api/portal/integrations/shared-read-setup/enrollment",
                                             as_user="owner", body={})
            _check(status == 200 and enrolled["state"] == "completed" and not enrolled["grants_created"])
            enrollment = enrolled["enrollment"]
            native_scope = {"activity_id": center.scope_a["activity_id"]}
            _operation(wa, trace, "scope.create", {"scope": native_scope, "label": "Synthetic native owner scope"})
            _operation(wa, trace, "scope.authorize", {"scope": native_scope,
                "actions": ["read.request", "read.approve", "reviews.read"],
                "expires_at": None, "expected_version": 0}, targetAccountId=actor)
            proposal = {"enrollment_id": enrollment["enrollment_id"], "enrollment_version": enrollment["version"],
                        "installation_label": "Synthetic native owner proposal v1"}
            pending = _operation(wa, trace, "request.create", {"kind": "consumer_registration",
                                                        "scope": native_scope, "proposal": proposal})["request"]
            _check(pending["state"] == "pending" and pending["version"] == 1
                   and pending["effective_resource"] is None)
            revised = _operation(wa, trace, "request.edit", {"expected_version": pending["version"],
                "proposal": {**proposal, "installation_label": "Synthetic native owner reviewed v2"}},
                requestId=pending["request_id"])["request"]
            _check(revised["state"] == "pending" and revised["version"] == 2
                   and revised["effective_resource"] is None)
            approved = _operation(wa, trace, "request.approve", {"expected_version": revised["version"]},
                                  requestId=pending["request_id"])["request"]
            _check(approved["state"] == "approved" and approved["version"] == 2
                   and approved["effective_version"] == 2
                   and approved["effective_resource"]["enrollment_id"] == enrollment["enrollment_id"])
            status, denial, _ = _http(wa, trace, "POST", "/api/portal/integrations/shared-read-setup/reader",
                as_user="owner", body={"consumer_installation_id": approved["effective_resource"]["installation_id"],
                                       "activity_id": native_scope["activity_id"]})
            _check(status == 403 and denial["error"]["code"] == "integration_grant_required")
            _check(_http(wa, trace, "GET", "/api/portal/integrations/shared-products", as_user="owner")[0] == 403)
            status, disconnected, _ = _http(wa, trace, "POST", OWNER + "/disconnect", as_user="owner", body={})
            _check(status == 200 and disconnected["session"]["state"] != "connected"
                   and disconnected["native_reference"] == login["native_reference"])
            _check(center.aggregate_effects() == before)
            effects = _effects(wa)
            diagnostic = wa.diagnostics()
            business_tables = ["messages", "savana_service_requests", "savana_integration_outbox",
                "billing_usage_events", "billing_ledger", "billing_payments", "savana_product_projection",
                "facebook_content_campaigns", "facebook_content_publications"]
            _check(set(diagnostic["effect_tables_before"]) == set(business_tables)
                   and diagnostic["effect_tables_before"] == diagnostic["effect_tables_current"])
            _check(all(not names for names in diagnostic["owned_entry_structure"]["matching_business_model_tables"].values()))
            business_counters = {"tables_before": diagnostic["effect_tables_before"],
                "tables_current": diagnostic["effect_tables_current"], "all_unchanged": True,
                "billing_payments_measured": True, "owned_entry_structure": diagnostic["owned_entry_structure"]}
        contracts_after = _contract_hashes(config)
        _check(contracts_before == contracts_consumed == contracts_after)
    return {"kind": "actual_native_WA_owner_cookie_create_revise_approve",
            "actual_native_portal_password_login": True,
            "portal_cookie_kept_separate_from_OIDC": True,
            "native_employee_cannot_borrow_owner_identity": True,
            "scope_create_and_explicit_actions_from_native_HTTP": True,
            "consumer_request_v1_create_v2_edit_v2_approve_from_native_HTTP": True,
            "central_owner_operational_wrapper_used_for_proof": False,
            "native_service_enrollment_used": True,
            "reader_denied_without_read_sharing_after_owner_approval": True,
            "local_portal_disconnect_confirmed": True, "effects": effects, "native_HTTP_trace": trace,
            "opaque_native_reference_consistent_for_current_native_user": True,
            "business_effect_counters": business_counters,
            "contract_hashes": {"before": contracts_before, "consumed": contracts_consumed,
                                "after": contracts_after, "all_match": True},
            "owned_lifecycle_cleanup_passed": True, "portal_HMAC_secret_copied": False,
            "registry_or_grant_seeding": False, "Catalog_source_created": False,
            "positive_read_sharing_acceptance": False,
            "four_app_simultaneous_acceptance": False, "production_activation": False}


if __name__ == "__main__":
    if len(sys.argv) != 1:
        raise SystemExit("This owned acceptance entry accepts no target or configuration arguments")
    print(json.dumps(run_native_owner_smoke(), indent=2))
