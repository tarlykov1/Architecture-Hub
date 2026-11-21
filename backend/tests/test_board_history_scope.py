"""AH-QA-09: an IS journal must never display another system's operations."""
from uuid import uuid4

from fastapi.testclient import TestClient
from app.main import app

ADMIN = {"Authorization": "Bearer ci-admin-token-123456789012345678901234"}


def create(client, route, body):
    response = client.post(route, json=body, headers=ADMIN)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def commit(client, changes):
    response = client.post("/api/board/commit", headers=ADMIN, json={
        "reason": "QA-WORK-scoped-history", "changes": changes,
    })
    assert response.status_code == 200, response.text
    return response.json()["audit_id"]


def audit_entry(client, audit_id, system_id=None, limit=30):
    query = f"/api/board/audit?limit={limit}"
    if system_id:
        query += f"&system_id={system_id}"
    response = client.get(query, headers=ADMIN)
    assert response.status_code == 200, response.text
    return next((item for item in response.json() if item["id"] == audit_id), None)


def test_audit_history_is_scoped_per_system_and_cross_system_flow_is_shared():
    with TestClient(app) as client:
        first = create(client, "/api/objects", {"name": "QA-WORK-A-" + str(uuid4()), "kind": "system"})
        second = create(client, "/api/objects", {"name": "QA-WORK-B-" + str(uuid4()), "kind": "system"})
        source = create(client, "/api/infra", {"system_id": first, "name": "QA-WORK-source", "kind": "vm"})
        target = create(client, "/api/infra", {"system_id": second, "name": "QA-WORK-target", "kind": "vm"})

        vm_a, vm_b = str(uuid4()), str(uuid4())
        mixed_id = commit(client, [
            {"action": "create_vm", "id": vm_a, "system_id": first, "kind": "vm", "name": "QA-WORK-new A"},
            {"action": "create_vm", "id": vm_b, "system_id": second, "kind": "vm", "name": "QA-WORK-new B"},
        ])
        assert len(audit_entry(client, mixed_id)["changes"]) == 2
        assert [change["id"] for change in audit_entry(client, mixed_id, first)["changes"]] == [vm_a]
        assert [change["id"] for change in audit_entry(client, mixed_id, second)["changes"]] == [vm_b]

        cross_id = str(uuid4())
        flow_audit = commit(client, [
            {"action": "create_flow", "id": cross_id, "source_id": source,
             "target_id": target, "name": "QA-WORK-cross-system", "protocol": "", "port": ""},
        ])
        for system_id in (first, second):
            result = audit_entry(client, flow_audit, system_id)
            assert result is not None
            assert [change["id"] for change in result["changes"]] == [cross_id]

        # Last written audit belongs exclusively to B. It must not consume
        # A's limit=1 slot; the previous cross-system flow remains visible.
        only_b = commit(client, [
            {"action": "create_vm", "id": str(uuid4()), "system_id": second,
             "kind": "vm", "name": "QA-WORK-only B"},
        ])
        assert audit_entry(client, only_b, first) is None
        assert audit_entry(client, flow_audit, first, limit=1) is not None

        # A network is global, but when linked to A in the same batch its
        # creation belongs to A's journal only.
        network_id = str(uuid4())
        linked_id = commit(client, [
            {"action": "create_network", "id": network_id, "name": "QA-WORK-VLAN-" + str(uuid4()), "kind": "vlan"},
            {"action": "create_interface", "id": str(uuid4()), "item_id": source,
             "interface_name": "qa-" + str(uuid4())[:8], "network_id": network_id, "network_field": "vlan_id"},
        ])
        assert len(audit_entry(client, linked_id, first)["changes"]) == 2
        assert audit_entry(client, linked_id, second) is None


def test_layout_changes_follow_owning_is_instead_of_global_network():
    with TestClient(app) as client:
        first = create(client, "/api/objects", {"name": "QA-WORK-Layout-A-" + str(uuid4()), "kind": "system"})
        second = create(client, "/api/objects", {"name": "QA-WORK-Layout-B-" + str(uuid4()), "kind": "system"})
        vm = create(client, "/api/infra", {"system_id": first, "name": "QA-WORK-LAYOUT-VM", "kind": "vm"})
        layout = client.put("/api/board/layout/" + first, headers=ADMIN, json={
            "positions": {vm: {"x": 140, "y": 220}},
            "notes": [{"id": str(uuid4()), "x": 30, "y": 30, "text": "QA-WORK note"}],
        })
        assert layout.status_code == 200, layout.text
        history = client.get("/api/board/audit", headers=ADMIN, params={"system_id": first}).json()
        records = [entry for entry in history if entry["reason"].startswith("Сохранено оформление схемы")]
        assert records
        assert all(change.get("system_ids") == [first] for change in records[0]["changes"])
        other_history = client.get("/api/board/audit", headers=ADMIN, params={"system_id": second}).json()
        assert all(entry["id"] != records[0]["id"] for entry in other_history)
