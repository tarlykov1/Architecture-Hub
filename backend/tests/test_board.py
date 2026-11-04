"""Contract tests for board review, atomic commits, audit and permission checks."""
from uuid import uuid4

from fastapi.testclient import TestClient
from app.main import app

ADMIN = {"Authorization": "Bearer ci-admin-token-123456789012345678901234"}
VIEWER = {"Authorization": "Bearer ci-viewer-token-123456789012345678901234"}


def create_system_and_vm(client):
    key = str(uuid4())[:8]
    system = client.post("/api/objects", headers=ADMIN, json={"name": "Board test " + key, "kind": "system"})
    assert system.status_code == 201, system.text
    system_id = system.json()["id"]
    vm = client.post("/api/infra", headers=ADMIN, json={"system_id": system_id, "kind": "vm", "name": "VM " + key})
    assert vm.status_code == 201, vm.text
    return system_id, vm.json()["id"]


def test_preview_does_not_write_and_commit_audits():
    with TestClient(app) as client:
        system_id, vm_id = create_system_and_vm(client)
        zone_id, new_vm_id, flow_id = str(uuid4()), str(uuid4()), str(uuid4())
        name = "Board zone " + zone_id[:8]
        batch = {"reason": "Approved network migration", "changes": [
            {"action": "create_network", "id": zone_id, "name": name, "kind": "zone"},
            {"action": "create_vm", "id": new_vm_id, "system_id": system_id, "name": "New VM", "kind": "vm"},
            {"action": "create_flow", "id": flow_id, "source_id": vm_id, "target_id": new_vm_id,
             "name": "Data exchange", "protocol": "TCP", "port": "443", "security": "tls"},
        ]}
        before = client.get("/api/board/audit", headers=ADMIN).json()
        preview = client.post("/api/board/preview", headers=ADMIN, json=batch)
        assert preview.status_code == 200, preview.text
        assert preview.json()["count"] == 3
        assert all(item["before"] is None for item in preview.json()["changes"])
        assert new_vm_id not in {item["id"] for item in client.get("/api/infra", headers=ADMIN).json()}
        assert zone_id not in {item["id"] for item in client.get("/api/networks", headers=ADMIN).json()}
        assert len(client.get("/api/board/audit", headers=ADMIN).json()) == len(before)

        saved = client.post("/api/board/commit", headers=ADMIN, json=batch)
        assert saved.status_code == 200, saved.text
        assert saved.json()["count"] == 3
        assert new_vm_id in {item["id"] for item in client.get("/api/infra", headers=ADMIN).json()}
        assert flow_id in {item["id"] for item in client.get("/api/flows", headers=ADMIN).json()}
        history = client.get("/api/board/audit", headers=ADMIN).json()
        assert any(entry["id"] == saved.json()["audit_id"] and entry["reason"] == batch["reason"]
                   and len(entry["changes"]) == 3 and entry["actor"].startswith("admin:") for entry in history)


def test_failed_batch_rolls_back_even_after_staged_changes():
    with TestClient(app) as client:
        system_id, vm_id = create_system_and_vm(client)
        new_vm = str(uuid4())
        batch = {"reason": "Rollback test", "changes": [
            {"action": "create_vm", "id": new_vm, "system_id": system_id, "kind": "vm", "name": "Should roll back"},
            {"action": "create_flow", "id": str(uuid4()), "source_id": vm_id,
             "target_id": str(uuid4()), "name": "Invalid target", "port": "443"},
        ]}
        result = client.post("/api/board/commit", headers=ADMIN, json=batch)
        assert result.status_code == 422, result.text
        assert new_vm not in {item["id"] for item in client.get("/api/infra", headers=ADMIN).json()}


def test_network_move_changes_exact_interface_and_rejects_stale_preview():
    with TestClient(app) as client:
        _, vm_id = create_system_and_vm(client)
        old_zone = client.post("/api/networks", headers=ADMIN, json={"name": "Old " + str(uuid4()), "kind": "zone"}).json()["id"]
        new_zone = client.post("/api/networks", headers=ADMIN, json={"name": "New " + str(uuid4()), "kind": "zone"}).json()["id"]
        nic = client.post("/api/network-interfaces", headers=ADMIN,
                          json={"item_id": vm_id, "name": "eth0", "zone_id": old_zone}).json()
        nic2 = client.post("/api/network-interfaces", headers=ADMIN,
                           json={"item_id": vm_id, "name": "eth1", "zone_id": old_zone}).json()
        batch = {"reason": "Move eth0 only", "changes": [{
            "action": "move_interface", "interface_id": nic["id"],
            "previous_network_id": old_zone, "network_id": new_zone, "network_field": "zone_id"
        }]}
        preview = client.post("/api/board/preview", headers=ADMIN, json=batch)
        assert preview.status_code == 200, preview.text
        assert preview.json()["changes"][0]["before"] == old_zone
        assert preview.json()["changes"][0]["after"] == new_zone
        before = {n["id"]: n for n in client.get("/api/network-interfaces", headers=ADMIN).json()}
        assert before[nic["id"]]["zone_id"] == old_zone
        applied = client.post("/api/board/commit", headers=ADMIN, json=batch)
        assert applied.status_code == 200, applied.text
        after = {n["id"]: n for n in client.get("/api/network-interfaces", headers=ADMIN).json()}
        assert after[nic["id"]]["zone_id"] == new_zone
        assert after[nic2["id"]]["zone_id"] == old_zone
        assert client.post("/api/board/commit", headers=ADMIN, json=batch).status_code == 409


def test_board_rejects_viewer_changes_and_allows_viewer_audit_read():
    with TestClient(app) as client:
        changes = {"reason": "No permission", "changes": [
            {"action": "create_network", "id": str(uuid4()), "name": "Unauthorized", "kind": "zone"}]}
        assert client.post("/api/board/preview", headers=VIEWER, json=changes).status_code == 403
        assert client.post("/api/board/commit", headers=VIEWER, json=changes).status_code == 403
        assert client.get("/api/board/audit", headers=VIEWER).status_code == 200
