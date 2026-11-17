"""Actual Catalog source to native WA approved reader, without a four-app claim.

Catalog is consumed only through its official temporary entry and native HTTP.
Source service keys are generated/delivered/decrypted/acknowledged only inside
Catalog. Initial central source-action administration uses real owner BFF HTTP;
WA consumer/read-sharing requests and approvals use native WA owner HTTP.
"""

from datetime import datetime, timedelta, timezone
import json
import sys
from urllib.parse import urlparse

import httpx

from operationalCatalogPeer import official_catalog_peer
from operational_wa_fixture import isolated_wa_operational
from operationalWaIdentitySmoke import _callback, _center_factory, _check, _contract_hashes, _effects, _initial, _oidc
from operationalWaOwnerSmoke import OWNER, _http, _operation


BUSINESS = "00000000-0000-4000-8000-00000000c101"
NAME = "Synthetic actual Catalog goods for native WA"


def _response(response, status=200):
    if response.status_code != status:
        raise AssertionError("Actual native source/read HTTP status did not match")
    return response.json()


def _goods():
    # Exact explicit native values from Catalog's published synthetic payload;
    # no central product wire/event/identity is constructed by this harness.
    return {"name": NAME, "description": "Synthetic public source description", "kind": "physical_good", "status": "active",
        "attributes": {"private_fixture_attribute": "must-never-be-published"},
        "options": [{"code": "purchase", "process": "purchase", "status": "active", "is_primary": True,
            "pricing": {"model": "fixed", "amount": "12.345", "currency": "LYD", "unit": "each"},
            "supply": {"strategy": "finite_stock", "resource_key": "synthetic-source-stock", "available_quantity": "10.000"},
            "fulfillment": [{"method": "pickup", "enabled": True, "config": {}}]}]}


def run_source_read_smoke():
    trace = []
    with _center_factory()() as center:
        source_policy = {"unit_codes": ["each"], "currencies": ["LYD"],
                         "price_list_ids": ["synthetic-catalog-retail"], "channels": ["catalog"]}
        source_config = {"SAVANA_OPERATIONAL_ENABLED": True, "SAVANA_OPERATIONAL_PORTAL_URL": center.portal_url,
            "SAVANA_OPERATIONAL_BINDINGS": {BUSINESS: center.scope_a},
            "SAVANA_CONNECT_PLATFORM_TOKEN": center.platform_token("catalog"),
            "SAVANA_OPERATIONAL_SOURCE_POLICY": {BUSINESS: source_policy}}
        start = {"center_origin": center.base_url, "portal_origin": center.portal_url,
                 "business_uuid": BUSINESS, "organization_id": center.organization_id,
                 "enable_source": True, "test_config": source_config}
        client_id = "synthetic-wa-actual-source-read"
        config = {**_initial(center), **_oidc(center, client_id),
                  "ownerPortalEnabled": True, "ownerPortalOrigin": center.base_url}
        contracts_before = _contract_hashes(config)
        # This is genuine current owner HTTP administration, not a registry or
        # grant bootstrap. Catalog's native source facade does not expose scope
        # administration; its source requests/review still use native HTTP.
        _response(center.owner.integration("POST", "/scopes", json={"scope": center.scope_a,
            "label": "Synthetic actual source to native WA scope"}), 201)
        _response(center.owner.integration("PUT", "/scope-authorizations/" + center.owner.account_id, json={
            "scope": center.scope_a, "actions": ["source.request", "source.approve", "origin.request", "origin.approve",
                "read.request", "read.approve", "fields.approve", "source.manage", "read.manage", "reviews.read", "operations.inspect"],
            "expires_at": None, "expected_version": 0}))
        expiry = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        with official_catalog_peer(start) as catalog, isolated_wa_operational(config) as wa:
            _check(wa.contract_sha256 == contracts_before)
            contracts_consumed = wa.contract_sha256
            with httpx.Client(base_url=catalog.base_url, follow_redirects=False, trust_env=False, timeout=20) as native:
                local = _response(native.post("/v1/auth/login", json={"username": "catalog-operational-owner",
                    "password": "synthetic-operational-local-password-123"}))
                native.headers["Authorization"] = "Bearer " + local["access_token"]
                prefix = f"/v1/integrations/entities/business_entity/{BUSINESS}/publisher-operations"
                _response(native.post(prefix + "/authorization", json=dict(center.test_login_credentials("owner"))))
                # Catalog _empty means zero bytes, unlike WA's strict JSON {}.
                _response(native.post(prefix + "/enrollment"))
                proposed = _response(native.post(prefix + "/requests", json={"proposal": {
                    "installation_label": "Actual native Catalog source", "fields": ["name", "description", "price", "is_visible"],
                    "allowed_operations": ["upsert", "hide", "unhide", "archive"], "expires_at": expiry,
                    "allow_restore": False, **source_policy}}), 201)
                approved = _response(native.post(prefix + "/requests/" + proposed["id"] + "/approve",
                                                  json={"expected_version": proposed["version"]}))
                _check(approved["status"] == "approved" and approved["effective_version"] == proposed["version"])
                source_status = _response(native.get(prefix))
                _check(source_status["credential"]["state"] == "active" and source_status["grant"]["state"] == "active")
                source_installation = source_status["scope"]["source_installation_id"]
                goods = _response(native.post(f"/v1/business-entities/{BUSINESS}/offerings", json=_goods()), 201)
                native_product_id = goods["uuid"]
                origin = _response(native.post(prefix + "/native-origins", json={"local_product_id": native_product_id}), 201)
                _check(origin["state"] == "pending")
                origin_approved = _response(native.post(prefix + "/requests/" + origin["id"] + "/approve",
                                                         json={"expected_version": origin["version"]}))
                _check(origin_approved["state"] == "approved")
                catalog.command("publish", limit=100)
                _response(native.post(prefix + "/native-products/" + native_product_id + "/visibility", json={"visible": True}), 202)
                catalog.command("publish", limit=100)
                center.register_oidc_client("wa_savana", wa.callback_uri, client_id=client_id)
                wa.login("owner")
                wa.login("employee")
                status, _, headers = _http(wa, trace, "GET", _callback(center, wa), as_user="owner")
                _check(status == 303 and headers["Location"].endswith("shared_read_setup=connected"))
                status, owner, _ = _http(wa, trace, "POST", OWNER + "/login", as_user="owner",
                                        body=dict(center.test_login_credentials("owner")))
                _check(status == 200)
                status, enrollment, _ = _http(wa, trace, "POST", "/api/portal/integrations/shared-read-setup/enrollment",
                                              as_user="owner", body={})
                _check(status == 200 and enrollment["state"] == "completed")
                scope = {"activity_id": center.scope_a["activity_id"]}
                consumer = _operation(wa, trace, "request.create", {"kind": "consumer_registration", "scope": scope,
                    "proposal": {"enrollment_id": enrollment["enrollment"]["enrollment_id"],
                                 "enrollment_version": enrollment["enrollment"]["version"],
                                 "installation_label": "Actual native WA reader"}})["request"]
                consumer = _operation(wa, trace, "request.approve", {"expected_version": consumer["version"]},
                                       requestId=consumer["request_id"])["request"]
                consumer_installation = consumer["effective_resource"]["installation_id"]
                fields = ["name", "description", "is_visible"]
                share = _operation(wa, trace, "request.create", {"kind": "read_sharing", "scope": scope,
                    "proposal": {"source_installation_id": source_installation,
                        "consumer_installation_id": consumer_installation, "fields": fields,
                        "reader_account_ids": [owner["session"]["actor_id"]], "expires_at": expiry}})["request"]
                share = _operation(wa, trace, "request.approve", {"expected_version": share["version"]},
                                    requestId=share["request_id"])["request"]
                status, bound, _ = _http(wa, trace, "POST", "/api/portal/integrations/shared-read-setup/reader",
                    as_user="owner", body={"consumer_installation_id": consumer_installation, **scope})
                _check(status == 200 and bound["read_ready"])
                status, found, _ = _http(wa, trace, "GET", "/api/portal/integrations/shared-products?limit=10", as_user="owner")
                _check(status == 200 and len(found["records"]) == 1)
                record = found["records"][0]
                _check(record["source"]["local_entity_id"] == native_product_id
                       and record["source"]["installation_id"] == source_installation
                       and record["scope"]["activity_id"] == scope["activity_id"]
                       and record["data"]["name"] == NAME and record["data"]["is_visible"] is True
                       and set(record["data"]) == set(fields))
                _check(not found["execution_ready"] and not found["pricing_use_allowed"])
                status, exact, _ = _http(wa, trace, "GET", "/api/portal/integrations/shared-products/" + record["entity_id"], as_user="owner")
                _check(status == 200 and exact["record"]["entity_id"] == record["entity_id"]
                       and exact["record"]["version"] == record["version"] and exact["record"]["data"] == record["data"])
                # Same organization/current staff login is not a listed reader.
                status, authorization, _ = wa.request("POST", "/api/portal/integrations/shared-read-setup/authorization",
                                                       as_user="employee", body={})
                _check(status == 200)
                callback = urlparse(center.approve_oidc_authorization(authorization["authorization_url"], session=center.staff))
                _check(wa.request("GET", callback.path + "?" + callback.query, as_user="employee")[0] == 303)
                status, denied, _ = _http(wa, trace, "POST", "/api/portal/integrations/shared-read-setup/reader",
                    as_user="employee", body={"consumer_installation_id": consumer_installation, **scope})
                _check(status == 403 and denied["error"]["code"] == "integration_grant_required")
                grant = share["effective_resource"]
                _operation(wa, trace, "read_grant.revoke", {"expected_revision": grant["revision"],
                    "reason": "Synthetic independent reader revocation"}, requestId=grant["read_grant_id"])
                _check(_http(wa, trace, "GET", "/api/portal/integrations/shared-products", as_user="owner")[0] == 403)
                _check(_response(native.get(prefix))["grant"]["state"] == "active")
                effects = _effects(wa)
                central_effects = center.aggregate_effects()
                _check(central_effects.get("stock_entries", 0) == 0 and central_effects.get("operations", 0) == 0)
        contracts_after = _contract_hashes(config)
        _check(contracts_before == contracts_consumed == contracts_after)
    return {"kind": "actual_Catalog_source_to_native_WA_approved_read",
        "actual_official_Catalog_and_WA_alive_with_same_owned_center": True,
        "source_scope_action_administration_via_actual_center_owner_BFF": True,
        "native_Catalog_RSA_enrollment_source_request_review_sealed_delivery_ACK": True,
        "native_Catalog_goods_create_signed_origin_review_publication_and_explicit_unhide": True,
        "native_WA_consumer_and_read_sharing_create_approve": True,
        "native_WA_OIDC_account_binding_and_product_read": True,
        "same_actual_Catalog_identity_and_version_in_search_and_record": True,
        "read_fields_exactly_name_description_is_visible": True,
        "publisher_price_not_shared_and_pricing_use_disabled": True,
        "actual_current_staff_OIDC_without_reader_grant_denied": True,
        "native_read_grant_revocation_refuses_next_read_without_publisher_revocation": True,
        "WA_effects": effects, "central_data_counts": central_effects,
        "native_WA_HTTP_trace": trace,
        "contract_hashes": {"before": contracts_before, "consumed": contracts_consumed, "after": contracts_after, "all_match": True},
        "owned_lifecycle_cleanup_passed": True, "source_key_or_grant_seeded": False,
        "source_secret_entered_harness": False, "other_project_edits": False,
        "Sawemly_included": False, "four_app_simultaneous_acceptance": False, "production_activation": False}


if __name__ == "__main__":
    if len(sys.argv) != 1:
        raise SystemExit("This owned acceptance entry accepts no target or configuration arguments")
    print(json.dumps(run_source_read_smoke(), indent=2))
