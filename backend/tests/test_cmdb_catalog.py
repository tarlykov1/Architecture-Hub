"""Configurable CI classes and opt-in relation rules preserve legacy graph behavior."""
from uuid import uuid4

from fastapi.testclient import TestClient
from app.main import app

ADMIN = {"Authorization": "Bearer ci-admin-token-123456789012345678901234"}
VIEWER = {"Authorization": "Bearer ci-viewer-token-123456789012345678901234"}
ARCHITECT = {"Authorization": "Bearer ci-architect-token-123456789012345678901234"}


def create(client, path, data):
    res = client.post(path, json=data, headers=ADMIN)
    assert res.status_code == 201, res.text
    return res.json()


def class_payload(rev=0, **overrides):
    return {
        "expected_revision": rev, "label": "Message bridge",
        "layer": "platform", "enabled": True,
        "required": ["technical_owner", "lifecycle", "deployment_region"],
        "fields": [{"key": "deployment_region", "label": "Region", "type": "choice",
                    "options": ["zone-a", "zone-b"]}],
        "reason": "Architecture class model reviewed",
        **overrides,
    }


def cmdb_record(revision=0, custom_values=None):
    return {
        "expected_revision": revision, "lifecycle": "active",
        "owner": "Service owner", "technical_owner": "Platform owner",
        "criticality": "high", "source_system": "architecture_hub",
        "source_record_id": "", "notes": "Test",
        "custom_values": custom_values,
        "reason": "Validated CMDB metadata",
    }


def test_editable_ci_class_required_fields_and_role_protection():
    with TestClient(app) as client:
        suffix = str(uuid4()).replace("-", "")[:12]
        kind = "bridge_" + suffix
        system = create(client, "/api/objects", {"name": "Class host " + suffix})
        vm = create(client, "/api/infra", {
            "system_id": system["id"], "kind": kind, "name": "Custom bridge " + suffix
        })
        class_url = "/api/cmdb/classes/" + kind
        assert client.put(class_url, json=class_payload(), headers=VIEWER).status_code == 403
        assert client.put(class_url, json=class_payload(), headers=ARCHITECT).status_code == 403
        saved = client.put(class_url, json=class_payload(), headers=ADMIN)
        assert saved.status_code == 200, saved.text
        assert saved.json()["revision"] == 1
        assert saved.json()["is_custom"] is True
        classes = client.get("/api/cmdb/classes", headers=VIEWER).json()["classes"]
        assert next(c for c in classes if c["id"] == kind)["fields"][0]["key"] == "deployment_region"

        # Explicit class field validation instead of silently accepting arbitrary JSON.
        bad_schema = client.put(class_url, headers=ADMIN, json=class_payload(
            rev=1, fields=[{"key": "owner", "label": "Reserved", "type": "text"}]))
        assert bad_schema.status_code == 422
        duplicate_revision = client.put(class_url, json=class_payload(), headers=ADMIN)
        assert duplicate_revision.status_code == 409

        key = "component:" + vm["id"]
        empty_record = client.put("/api/cmdb/records/" + key, headers=ADMIN,
                                  json=cmdb_record(custom_values={}))
        assert empty_record.status_code == 200, empty_record.text
        assert empty_record.json()["custom_values"] == {}

        # Required class-specific attribute prevents falsely verifying incomplete CI.
        incomplete = client.post("/api/cmdb/records/" + key + "/verify", headers=ADMIN,
            json={"expected_revision": 1, "evidence": "Compared to authoritative inventory"})
        assert incomplete.status_code == 422
        q = client.get("/api/cmdb/quality", headers=VIEWER).json()
        row = next(v for v in q["items"] if v["ci_id"] == key)
        assert "deployment_region" in row["missing"]

        bad_choice = client.put("/api/cmdb/records/" + key, headers=ADMIN,
            json=cmdb_record(revision=1, custom_values={"deployment_region": "wrong"}))
        assert bad_choice.status_code == 422
        updated = client.put("/api/cmdb/records/" + key, headers=ADMIN,
            json=cmdb_record(revision=1, custom_values={"deployment_region": "zone-a"}))
        assert updated.status_code == 200, updated.text
        verified = client.post("/api/cmdb/records/" + key + "/verify", headers=ADMIN,
            json={"expected_revision": 2, "evidence": "Confirmed with platform owner"})
        assert verified.status_code == 200, verified.text
        assert verified.json()["custom_values"]["deployment_region"] == "zone-a"
        row = next(v for v in client.get("/api/cmdb/quality", headers=VIEWER).json()["items"]
                   if v["ci_id"] == key)
        assert row["verified"] is True and row["missing"] == []

        events = client.get("/api/cmdb/schema/history", headers=VIEWER)
        assert events.status_code == 200
        assert any(x["resource_id"] == kind and "Architecture class model" in x["reason"]
                   for x in events.json())


def test_direct_flows_and_board_review_honor_opt_in_enforced_rules():
    with TestClient(app) as client:
        suffix = str(uuid4()).replace("-", "")[:12]
        kind = "adapter_" + suffix
        system = create(client, "/api/objects", {"name": "Rule host " + suffix})
        src = create(client, "/api/infra", {"system_id": system["id"], "name": "Rule source",
                                            "kind": kind})
        dst_ok = create(client, "/api/infra", {"system_id": system["id"], "name": "Database",
                                               "kind": "database"})
        dst_bad = create(client, "/api/infra", {"system_id": system["id"], "name": "VM",
                                                "kind": "vm"})
        p = class_payload(required=["technical_owner", "lifecycle"], fields=[])
        assert client.put("/api/cmdb/classes/" + kind, json=p, headers=ADMIN).status_code == 200
        rule_payload = {
            "relation_kind": "supplies_data_to",
            "source_class": kind, "target_class": "database",
            "mode": "advisory", "enabled": True,
            "description": "Adapters transfer information to database",
            "reason": "Pilot explicit data dependencies",
        }
        created = client.post("/api/cmdb/relationship-rules", headers=ADMIN, json=rule_payload)
        assert created.status_code == 201, created.text
        rule_id = created.json()["id"]
        assert client.post("/api/cmdb/relationship-rules", headers=ADMIN,
                           json=rule_payload).status_code == 409
        assert client.put("/api/cmdb/relationship-rules/" + rule_id, headers=VIEWER,
                          json={**rule_payload, "expected_revision": 1}).status_code == 403

        check_path = "/api/cmdb/relationships/check"
        args = {"source_id": "component:" + src["id"], "target_id": "component:" + dst_bad["id"],
                "relation_kind": "supplies_data_to"}
        advisory = client.get(check_path, params=args, headers=VIEWER)
        assert advisory.status_code == 200
        assert advisory.json()["allowed"] is True
        assert advisory.json()["enforced"] is False

        old_flow = create(client, "/api/flows", {
            "source_id": src["id"], "target_id": dst_bad["id"], "name": "Legacy relation"
        })
        updated = client.put("/api/cmdb/relationship-rules/" + rule_id, headers=ADMIN,
                             json={**rule_payload, "mode": "enforced",
                                   "expected_revision": 1, "reason": "Enable reviewed strict scope"})
        assert updated.status_code == 200, updated.text
        assert updated.json()["revision"] == 2
        assert client.put("/api/cmdb/relationship-rules/" + rule_id, headers=ADMIN,
                          json={**rule_payload, "expected_revision": 1}).status_code == 409

        strict = client.get(check_path, params=args, headers=VIEWER)
        assert strict.status_code == 200 and strict.json()["allowed"] is False
        deny = client.post("/api/flows", headers=ADMIN, json={
            "source_id": src["id"], "target_id": dst_bad["id"], "name": "Forbidden"
        })
        assert deny.status_code == 422
        # Strict mode governs new/edited connections, never deletes legacy records.
        flows = client.get("/api/flows", headers=ADMIN).json()
        assert old_flow["id"] in {row["id"] for row in flows}

        board = {"reason": "Reviewed flow creation", "changes": [{
            "action": "create_flow", "id": str(uuid4()), "source_id": src["id"],
            "target_id": dst_bad["id"], "name": "Board bypass attempt",
        }]}
        assert client.post("/api/board/preview", headers=ADMIN, json=board).status_code == 422
        assert client.post("/api/board/commit", headers=ADMIN, json=board).status_code == 422

        allowed = create(client, "/api/flows", {
            "source_id": src["id"], "target_id": dst_ok["id"], "name": "Allowed"
        })
        assert allowed["id"]
        assert client.get(check_path, headers=VIEWER, params={**args,
                          "target_id": "component:" + dst_ok["id"]}).json()["allowed"]
        rules = client.get("/api/cmdb/relationship-rules", headers=VIEWER).json()
        assert any(r["id"] == rule_id and r["mode"] == "enforced" for r in rules)


def test_class_schema_rejects_bad_reference_and_duplicate_field_definitions():
    with TestClient(app) as client:
        suffix = str(uuid4()).replace("-", "")[:12]
        kind = "rules_" + suffix
        invalid = client.put("/api/cmdb/classes/" + kind, headers=ADMIN,
            json=class_payload(fields=[
                {"key": "region", "label": "Region", "type": "choice", "options": []}
            ], required=["region"]))
        assert invalid.status_code == 422
        duplicate = client.put("/api/cmdb/classes/" + kind, headers=ADMIN,
            json=class_payload(fields=[
                {"key": "region", "label": "First", "type": "text"},
                {"key": "region", "label": "Second", "type": "text"},
            ], required=["region"]))
        assert duplicate.status_code == 422
        unknown = client.post("/api/cmdb/relationship-rules", headers=ADMIN,
            json={"relation_kind": "supplies_data_to", "source_class": kind,
                  "target_class": "database", "mode": "enforced",
                  "reason": "Unknown class must be rejected"})
        assert unknown.status_code == 422
