"""Private IPC bridge around the actual central/Catalog-owned test factories.

This is test orchestration, not a shared contract or runtime API. No existing
database path, remote target, reusable grants or caller-issued credentials can
be loaded. All product mutation, publication and read assertions use HTTP.
"""

from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import signal
import sys
from urllib.parse import urlsplit


PREFIX = "@@WA_PRODUCT_CYCLE@@"
ALLOWED_PORTS = set()
PHASE = "initializing"


def emit(value):
    print(PREFIX + json.dumps(value), flush=True)


def network_boundary(event, args):
    if event == "socket.connect":
        address = args[1]
        if not (isinstance(address, tuple) and address[0] == "127.0.0.1" and address[1] in ALLOWED_PORTS):
            raise PermissionError("WA acceptance permits only its owned loopback services")
    elif event == "socket.bind":
        address = args[1]
        if not (isinstance(address, tuple) and address[0] == "127.0.0.1" and address[1] == 0):
            raise PermissionError("WA acceptance may allocate only owned ephemeral loopback listeners")
    elif event == "socket.getaddrinfo" and args[0] != "127.0.0.1":
        raise PermissionError("WA acceptance does not resolve external names")


sys.addaudithook(network_boundary)
signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))


def checked(status, payload, expected=200):
    if status != expected:
        # Never put a response, credential or product payload in exceptions.
        raise AssertionError(f"Synthetic HTTP status mismatch in {PHASE}: {status} != {expected}")
    return payload


def source_configuration(fixture):
    # Catalog's actual published factory accepts identity maps and a separate
    # per-installation worker credential; a read/OIDC token is never reused.
    headers = fixture.source_headers()
    return {
        "source_bindings": {fixture.source_business_id: {
            "organization_id": fixture.organization_id,
            "activity_id": fixture.scope_a.activity_id,
            "source_installation_id": fixture.source_installation_id,
            "ownership_epoch": 1,
            "price_list_id": "synthetic-catalog-retail", "price_channel": "catalog",
        }},
        "source_credentials": {fixture.source_installation_id: {
            "credential_id": headers["X-Savana-Source-Credential-Id"],
            "secret": headers["Authorization"].removeprefix("SavanaSource "),
        }},
    }


def main():
    global PHASE
    options = json.loads(sys.stdin.readline())
    if set(options) != {"catalog_root", "catalog_python"}:
        raise ValueError("Only the explicit source checkout can select this fixture")
    catalog_root = Path(options["catalog_root"]).resolve()
    catalog_python = Path(options["catalog_python"])
    if not catalog_python.is_absolute() or not catalog_python.is_file():
        raise ValueError("Use the existing published Catalog test interpreter; do not install tools")
    catalog_helpers = catalog_root / "backend/src/tests/acceptance"
    if not (catalog_helpers / "catalog_product_source.py").is_file():
        raise ValueError("Published actual Catalog source factory is unavailable")
    sys.path.insert(0, str(catalog_helpers))
    from tools.product_cycle_acceptance_fixture import isolated_product_cycle_server
    from catalog_product_source import isolated_catalog_product_source, synthetic_product_payload
    from http_harness import request_json

    # Configure explicit synthetic semantics through the central owner's
    # trusted fixture API. These are not actual business mappings or grants.
    def prepare(fixture):
        fixture.provision_source_credential(
            allowed_operations=("upsert", "archive"), unit_codes=("each",),
            currencies=("LYD",), price_list_ids=("synthetic-catalog-retail",), channels=("catalog",))

    with ExitStack() as stack:
        PHASE = "central_startup"
        center = stack.enter_context(isolated_product_cycle_server(prepare=prepare))
        fixture = center.fixture
        center_port = urlsplit(center.base_url).port
        ALLOWED_PORTS.add(center_port)
        source_config = source_configuration(fixture)
        PHASE = "native_source_startup"
        source = stack.enter_context(isolated_catalog_product_source(
            center_origin=center.base_url, organization_id=fixture.organization_id,
            business_uuid=fixture.source_business_id, python=str(catalog_python), **source_config,
        ))
        ALLOWED_PORTS.add(source.port)
        local_headers = source.login()
        read_headers = fixture.headers("wa_savana")
        token = read_headers["Authorization"].removeprefix("Bearer ")
        emit({
            "event": "ready", "source_kind": "native_catalog_http_and_real_outbox",
            "owned_directories": [str(fixture.root), str(source.directory)],
            "center": {"base_url": center.base_url},
            "consumer": {
                "access_token": token, "platform_token": read_headers["X-Savana-Platform-Token"],
                "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat(),
                "scope": fixture.scope_a.model_dump(exclude_none=True),
                "installation_id": fixture.installations["wa_savana"],
                "account_id": fixture.tenants["wa_savana"]["id"], "actor_id": fixture.actor_id,
            },
        })
        offering_uuid = None
        first_payload = None
        actor_revision = 1

        def central_read():
            from urllib.parse import urlencode
            query = {**fixture.query("wa_savana"), "domain": "product.core"}
            diagnostics = source.diagnostics(include_payload=True)
            entity = diagnostics["sources"][0]["central_entity_id"]
            return checked(*request_json(center_port, f"/v1/integration/data/records/product/{entity}?" + urlencode(query),
                                         headers=read_headers))["record"]

        def published():
            source.publish()
            diagnostics = source.diagnostics(include_payload=True)
            if not diagnostics["sources"] or not diagnostics["sources"][0]["central_entity_id"]:
                raise AssertionError("Actual Catalog publisher has not obtained a central identity")
            latest = diagnostics["outbox"][-1]
            if (latest["transport_status"] != "received"
                    or latest["business_status"] not in {"applied", "duplicate"}
                    or latest.get("result", {}).get("external_business_effect") is not False):
                raise AssertionError("Actual source worker did not persist a successful non-external outcome")
            record = central_read()
            return diagnostics, record

        for line in sys.stdin:
            action = json.loads(line).get("command")
            PHASE = action
            if action == "stop":
                emit({"event": "stopping"})
                break
            if action == "stop_center_http":
                stack.close()
                emit({"event": "center_stopped"})
                continue
            if action == "create_and_publish":
                payload = synthetic_product_payload("Synthetic WA source product")
                created = checked(*source.create(local_headers, payload), 201)
                if created["compatibility"]["projection_type"] is not None:
                    raise AssertionError("Catalog source must be a native Offering")
                offering_uuid = created["uuid"]
                fixture.approve_native_product(offering_uuid, initially_visible=True)
                diagnostics, record = published()
                first_payload = diagnostics["outbox"][0]["payload"]
                if ("base_unit" in first_payload["fields"]
                        or first_payload["fields"]["price"]["unit_code"] != "each"
                        or "attributes" in first_payload["fields"]
                        or "settings" in first_payload["fields"]):
                    raise AssertionError("Source publisher inferred a base unit or copied private source fields")
                expected = {"name": "Synthetic WA source product", "is_visible": True}
                if record["data"] != expected:
                    raise AssertionError("Current WA fields do not match the exact source/consumer grant intersection")
                emit({"event": "published", "entity_id": record["entity_id"], "source": record["source"],
                      "version": record["version"], "allowed_data": expected, "external_effects": 0})
            elif action == "update_and_publish":
                checked(*source.update(local_headers, offering_uuid, {"name": "Synthetic WA updated product"}))
                _, record = published()
                expected = {"name": "Synthetic WA updated product", "is_visible": True}
                if record["data"] != expected:
                    raise AssertionError("Updated source fields were not preserved/redacted")
                emit({"event": "published", "entity_id": record["entity_id"], "source": record["source"],
                      "version": record["version"], "allowed_data": expected, "external_effects": 0})
            elif action in {"retry_duplicate_and_reverse", "retry_old_active"}:
                response = checked(*request_json(center_port, "/v1/integration/products/changes", method="POST",
                                                headers=fixture.source_headers(), body=first_payload))
                if response["record_applied"] or response["external_business_effect"]:
                    raise AssertionError("A retry caused another record or external effect")
                emit({"event": "checked", "duplicate_effects": 0, "external_effects": 0})
            elif action == "credential_roles_separate":
                from urllib.parse import urlencode
                before = central_read()
                publish_status, _ = request_json(center_port, "/v1/integration/products/changes", method="POST",
                    headers=read_headers, body=first_payload)
                read_status, _ = request_json(center_port, "/v1/integration/context?" + urlencode(fixture.query("wa_savana")),
                    headers=fixture.source_headers())
                if publish_status != 401 or read_status != 401 or central_read() != before:
                    raise AssertionError("User read and source worker credentials were not separated")
                emit({"event": "checked", "read_token_publish_status": publish_status,
                      "source_token_read_status": read_status, "external_effects": 0})
            elif action == "unseen_reverse_order_and_resume":
                before = central_read()
                checked(*source.update(local_headers, offering_uuid, {"name": "Synthetic queued older source name"}))
                checked(*source.update(local_headers, offering_uuid, {"name": "Synthetic queued newer source name"}))
                queued = source.diagnostics(include_payload=True)["outbox"][-2:]
                frozen = [(row["message_id"], row["payload_utf8"]) for row in queued]
                source.publish_one(queued[-1]["id"])
                waiting = source.diagnostics(include_payload=True)["outbox"][-1]
                if waiting["business_status"] != "waiting_dependency":
                    raise AssertionError("Actual source worker did not defer an unseen later partial revision")
                status, denied = request_json(center_port, "/v1/integration/products/changes", method="POST",
                    headers=fixture.source_headers(), body=queued[-1]["payload"])
                if status != 409 or denied.get("error", {}).get("code") != "product_source_revision_gap":
                    raise AssertionError("Central partial-source gap was not rejected by the published contract")
                unchanged = central_read()
                if unchanged != before:
                    raise AssertionError("Unseen reverse-order delivery overwrote current content")
                final, record = published()
                if frozen != [(row["message_id"], row["payload_utf8"]) for row in final["outbox"][-2:]]:
                    raise AssertionError("Source resumption rewrote immutable native messages")
                expected = {"name": "Synthetic queued newer source name", "is_visible": True}
                if record["data"] != expected or record["version"] <= before["version"]:
                    raise AssertionError("Ordered actual-worker resume lost the newer native product update")
                emit({"event": "checked", "gap_status": status, "worker_waited": True, "resumed": True,
                      "entity_id": record["entity_id"], "source": record["source"], "version": record["version"],
                      "allowed_data": expected, "external_effects": 0})
            elif action == "archive_and_publish":
                checked(*source.archive(local_headers, offering_uuid))
                _, record = published()
                if record["state"] != "archived":
                    raise AssertionError("Native archive was not explicit in the shared record")
                emit({"event": "published", "entity_id": record["entity_id"], "version": record["version"], "state": record["state"]})
            elif action in {"revoke_wa_read_grant", "restore_wa_read_grant"}:
                actor_revision += 1
                registry = fixture.runtime.registry
                if action == "revoke_wa_read_grant":
                    registry.revoke_actor_grant(fixture.actor_id, fixture.installations["wa_savana"], fixture.scope_a)
                else:
                    from product_cycle_fixtures import PRODUCT_FIELDS
                    registry.put_actor_grant(fixture.actor_id, fixture.installations["wa_savana"], fixture.scope_a,
                        {"data.read", "capabilities.view_requirements"}, {"product.core": PRODUCT_FIELDS},
                        datetime.now(timezone.utc) + timedelta(minutes=15), revision=actor_revision)
                emit({"event": "applied", "command": action})
            else:
                raise ValueError("Unknown private acceptance control")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit({"event": "error", "phase": PHASE, "exception": type(error).__name__})
        raise
