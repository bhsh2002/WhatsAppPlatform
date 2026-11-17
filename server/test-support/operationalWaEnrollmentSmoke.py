"""Actual native WA enrollment and owner-reviewed consumer registration.

This intentionally ends before a Catalog-backed read-sharing approval. It proves
that enrollment/installation approval cannot manufacture a reader grant. All
central setup uses the official isolated center's real owner BFF HTTP session.
"""

import json
import sys

from operational_wa_fixture import isolated_wa_operational
from operationalWaIdentitySmoke import _callback, _center_factory, _check, _effects, _initial, _oidc, _status


def _expect(response, expected=200):
    _check(response.status_code == expected)
    return response.json()


def run_enrollment_smoke():
    with _center_factory()() as center:
        client_id = "synthetic-wa-native-enrollment-smoke"
        with isolated_wa_operational({**_initial(center), **_oidc(center, client_id)}) as wa:
            center.register_oidc_client("wa_savana", wa.callback_uri, client_id=client_id)
            wa.login("owner")
            wa.login("employee")
            status, _, headers = wa.request("GET", _callback(center, wa), as_user="owner")
            _check(status == 303 and headers["Location"].endswith("shared_read_setup=connected"))
            before = center.aggregate_effects()
            status, _, _ = wa.request("POST", "/api/portal/integrations/shared-read-setup/enrollment",
                                      as_user="employee", body={})
            _check(status == 403)
            status, enrolled, _ = wa.request("POST", "/api/portal/integrations/shared-read-setup/enrollment",
                                             as_user="owner", body={})
            _check(status == 200 and enrolled["state"] == "completed" and not enrolled["grants_created"])
            enrollment = enrolled["enrollment"]
            _check(enrollment["platform"] == "wa_savana"
                   and enrollment["external_tenant_id"] == "wa_savana:tenant:1"
                   and enrollment["organization_id"] == center.organization_id)
            _check(not _status(wa)["read_ready"])
            _check(wa.request("GET", "/api/portal/integrations/shared-products", as_user="owner")[0] == 403)
            scope = center.scope_a
            _expect(center.owner.integration("POST", "/scopes", json={"scope": scope,
                "label": "Synthetic native WA consumer scope"}), 201)
            _expect(center.owner.integration("PUT", "/scope-authorizations/" + center.owner.account_id,
                json={"scope": scope, "actions": ["read.request", "read.approve", "reviews.read"],
                      "expires_at": None, "expected_version": 0}))
            request = _expect(center.owner.integration("POST", "/requests", json={
                "kind": "consumer_registration", "scope": scope,
                "proposal": {"enrollment_id": enrollment["enrollment_id"],
                             "enrollment_version": enrollment["version"],
                             "installation_label": "Synthetic owner-reviewed native WA consumer"}}), 201)
            _check(request["state"] == "pending" and request["effective_resource"] is None)
            status, _, _ = wa.request("POST", "/api/portal/integrations/shared-read-setup/reader",
                as_user="owner", body={"consumer_installation_id": "unapproved-synthetic-selector",
                                       "activity_id": scope["activity_id"]})
            _check(status == 403)
            approved = _expect(center.owner.integration("POST", "/requests/" + request["request_id"] + "/approve",
                                                        json={"expected_version": request["version"]}))
            _check(approved["state"] == "approved" and approved["effective_version"] == request["version"])
            installation = approved["effective_resource"]
            _check(installation["enrollment_id"] == enrollment["enrollment_id"])
            status, denial, _ = wa.request("POST", "/api/portal/integrations/shared-read-setup/reader",
                as_user="owner", body={"consumer_installation_id": installation["installation_id"],
                                       "activity_id": scope["activity_id"]})
            _check(status == 403 and denial["error"]["code"] == "integration_grant_required")
            _check(not _status(wa)["read_ready"])
            _check(wa.request("GET", "/api/portal/integrations/shared-products", as_user="owner")[0] == 403)
            # Public discovery is checked through the actual existing platform
            # HTTP route, never by reading/seeding a central registry table.
            discovered = _expect(center.identity.client.get("/v1/platform-bindings",
                params={"external_tenant_id": "wa_savana:tenant:1"},
                headers=center.platform_headers("wa_savana")))
            _check(len(discovered) == 1 and discovered[0]["binding_method"] == "operational_owner_review")
            overview = _expect(center.owner.integration("GET", "/overview"))
            actual = [row for row in overview["installations"]
                      if row["installation_id"] == installation["installation_id"]]
            _check(len(actual) == 1 and actual[0]["tenant_id"] == discovered[0]["id"]
                   and actual[0]["enrollment_id"] == enrollment["enrollment_id"])
            again_status, again, _ = wa.request("POST", "/api/portal/integrations/shared-read-setup/enrollment",
                                                as_user="owner", body={})
            _check(again_status == 200 and again["enrollment"] == enrollment and again["attempts"] == 1)
            _check(center.aggregate_effects() == before)
            effects = _effects(wa)
    return {"kind": "owned_WA_native_enrollment_owner_consumer_approval_pending_reader_denial",
            "actual_native_enrollment_HTTP": True, "native_service_generated_encrypted_RSA_key": True,
            "actual_owner_BFF_scope_actions_request_and_consumer_approval": True,
            "native_employee_cannot_borrow_owner_identity": True,
            "enrollment_repeat_preserves_key_identity_without_second_dispatch": True,
            "existing_platform_binding_GET_returns_operational_owner_review": True,
            "central_native_installation_enrollment_account_link_verified_by_actual_HTTP": True,
            "reader_denied_before_approval": True,
            "reader_denied_after_consumer_approval_until_read_sharing": True,
            "pending_reader_error": "integration_grant_required", "effects": effects,
            "owned_lifecycle_cleanup_passed": True, "registry_or_grant_seeding": False,
            "Catalog_source_created": False, "positive_read_sharing_acceptance": False,
            "four_app_simultaneous_acceptance": False, "production_activation": False}


if __name__ == "__main__":
    if len(sys.argv) != 1:
        raise SystemExit("This owned acceptance entry accepts no target or configuration arguments")
    print(json.dumps(run_enrollment_smoke(), indent=2))
