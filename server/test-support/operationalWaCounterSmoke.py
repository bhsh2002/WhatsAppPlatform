"""Counter sensitivity only, in one official owned temporary WA lifecycle.

Synthetic payment/message rows and schema sentinels are injected only into this
fixture's newly allocated private SQLite database. No owner/source journey,
provider sending, real business database or central grant is exercised.
"""

import json
from pathlib import Path
import sqlite3
import sys

from operational_wa_fixture import isolated_wa_operational
from operationalWaIdentitySmoke import _center_factory, _check, _contract_hashes, _initial, _oidc


HANDOFF = Path("/Users/savana/Dev/.organization/2026-11-17/integration-plan/project-handoffs/WA-Savana/operational-handoff")


def _value(snapshot, path):
    for name in path:
        snapshot = snapshot[name]
    return snapshot


def _mapped(snapshot, metadata):
    result = {"categories": {}, "network": {}, "schema_absence": {}}
    for category, path in metadata["counter_paths"].items():
        value = _value(snapshot, path)
        _check(type(value) is int and value >= 0)
        result["categories"][category] = value
    for category, path in metadata["network_counter_paths"].items():
        value = _value(snapshot, path)
        _check(type(value) is int and value >= 0)
        result["network"][category] = value
    for category, declaration in metadata["inapplicable_categories"].items():
        value = _value(snapshot, declaration["schema_evidence_path"])
        _check(type(value) is bool)
        result["schema_absence"][category] = value
    return result


def run_counter_smoke():
    metadata = json.loads((HANDOFF / "business-effect-counters.json").read_text())
    _check(metadata["project"] == "WA-Savana" and metadata["diagnostics_command"] == "diagnostics")
    with _center_factory()() as center:
        config = {**_initial(center), **_oidc(center, "synthetic-wa-counter-only-client")}
        contracts_before = _contract_hashes(config)
        with isolated_wa_operational(config) as wa:
            contracts_consumed = wa.contract_sha256
            _check(contracts_consumed == contracts_before)
            first_diagnostic = wa.diagnostics()
            baseline = _mapped(first_diagnostic, metadata)
            _check(all(value == 0 for value in baseline["categories"].values()))
            _check(all(value == 0 for value in baseline["network"].values()))
            _check(all(value is True for value in baseline["schema_absence"].values()))
            # The path is allocated by this currently running official fixture,
            # never supplied as a caller-selected existing database or output.
            with sqlite3.connect(wa._owned_directory / "synthetic-wa.db") as owned:
                payment_id = owned.execute("INSERT INTO billing_payments(tenant_id,amount_lyd,method,reference) VALUES(1,1,'synthetic_counter_test','synthetic_counter_only')").lastrowid
                message_id = owned.execute("INSERT INTO messages(tenant_id,direction,message_type,content,status) VALUES(1,'outgoing','text','synthetic unsent counter row','pending')").lastrowid
                owned.commit()
                pending = _mapped(wa.diagnostics(), metadata)
                _check(pending["categories"] == {"payments": 1, "send": 1})
                _check(pending["network"]["send_attempts"] == 0 and pending["network"]["send_successes"] == 0)
                owned.execute("UPDATE messages SET status='sent' WHERE id=?", (message_id,))
                owned.commit()
                sent = _mapped(wa.diagnostics(), metadata)
                _check(sent["categories"] == pending["categories"] and sent["network"]["send_successes"] == 1)
                # No provider call occurs: the real owned native HTTP guard
                # rejects the attempt before any channel handler is mounted.
                _check(wa.request("POST", "/api/messages", body={})[0] == 403)
                guarded = _mapped(wa.diagnostics(), metadata)
                _check(guarded["network"]["send_attempts"] == 1 and guarded["network"]["external_network_attempts"] == 0)
                for name in ("orders", "order_items", "stock_movements", "measurement_events"):
                    owned.execute(f"CREATE TABLE {name}(id INTEGER PRIMARY KEY)")
                owned.commit()
                schema_changed = _mapped(wa.diagnostics(), metadata)
                _check(all(value is False for value in schema_changed["schema_absence"].values()))
                for name in ("orders", "order_items", "stock_movements", "measurement_events"):
                    owned.execute(f"DROP TABLE {name}")
                owned.execute("DELETE FROM messages WHERE id=?", (message_id,))
                owned.execute("DELETE FROM billing_payments WHERE id=?", (payment_id,))
                owned.commit()
            final_diagnostic = wa.diagnostics()
            restored = _mapped(final_diagnostic, metadata)
            _check(restored["categories"] == baseline["categories"])
            _check(all(value is True for value in restored["schema_absence"].values()))
            _check(restored["network"]["send_attempts"] == 1 and restored["network"]["send_successes"] == 0)
            _check(final_diagnostic["owned_entry_structure"]["schema_table_names_sha256"]
                   == first_diagnostic["owned_entry_structure"]["schema_table_names_sha256"])
            _check(final_diagnostic["native_effect_tables_unchanged"] and final_diagnostic["legacy_rows_unchanged"])
            _check(final_diagnostic["effects"]["actual_external_effects"] == 0)
        contracts_after = _contract_hashes(config)
        _check(contracts_before == contracts_consumed == contracts_after)
    return {"kind": "owned_WA_business_counter_sensitivity_only", "same_owned_lifecycle": True,
        "exact_frozen_metadata_paths_resolve_to_nonnegative_integers_and_real_booleans": True,
        "baseline": baseline, "after_synthetic_payment_and_pending_message": pending,
        "after_in_place_synthetic_sent_status": sent, "after_blocked_native_send_attempt": guarded,
        "after_synthetic_business_schema_sentinels": schema_changed, "after_removing_owned_injections": restored,
        "actual_payment_and_outgoing_row_injection_detected": True,
        "actual_in_place_message_success_status_change_detected": True,
        "actual_blocked_native_send_attempt_counted": True,
        "schema_absence_flags_falsifiable_and_restored": True,
        "owned_schema_digest_restored": True, "owned_lifecycle_cleanup_passed": True,
        "real_provider_send_or_real_business_database_used": False,
        "owner_or_source_journey_repeated": False, "source_or_grant_seeded": False,
        "contract_hashes": {"before": contracts_before, "consumed": contracts_consumed, "after": contracts_after, "all_match": True},
        "zero_business_effect_acceptance_claimed_from_injection_test": False,
        "four_app_acceptance": False, "production_activation": False}


if __name__ == "__main__":
    if len(sys.argv) != 1:
        raise SystemExit("This owned counter check accepts no target or database arguments")
    print(json.dumps(run_counter_smoke(), indent=2))
