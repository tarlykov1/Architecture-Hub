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


def test_drawing_network_and_enclosing_vm_creates_interface_atomically():
    with TestClient(app) as client:
        system_id, vm_id = create_system_and_vm(client)
        network_id, nic_id = str(uuid4()), str(uuid4())
        batch = {"reason": "New rectangle includes VM", "changes": [
            {"action": "create_network", "id": network_id,
             "name": "Drawn " + network_id[:8], "kind": "zone"},
            {"action": "create_interface", "id": nic_id, "item_id": vm_id,
             "interface_name": "eth0", "network_id": network_id, "network_field": "zone_id"},
        ]}
        preview = client.post("/api/board/preview", headers=ADMIN, json=batch)
        assert preview.status_code == 200, preview.text
        assert preview.json()["count"] == 2
        assert nic_id not in {item["id"] for item in client.get("/api/network-interfaces", headers=ADMIN).json()}
        commit = client.post("/api/board/commit", headers=ADMIN, json=batch)
        assert commit.status_code == 200, commit.text
        created = {item["id"]: item for item in client.get("/api/network-interfaces", headers=ADMIN).json()}
        assert created[nic_id]["zone_id"] == network_id
        assert created[nic_id]["item_id"] == vm_id
        assert created[nic_id]["ip_address"] == ""


def test_reviewed_vm_passport_update_is_audited_and_rejects_stale_values():
    with TestClient(app) as client:
        system_id, vm_id = create_system_and_vm(client)
        before = next(x for x in client.get("/api/infra", headers=ADMIN).json() if x["id"] == vm_id)
        batch = {"reason": "Review VM passport", "changes": [{
            "action": "update_vm", "id": vm_id, "system_id": system_id,
            "name": "Reviewed VM", "description": "New description",
            "previous_name": before["name"], "previous_description": before["description"],
            "details_patch": {"purpose": "Application server", "environment": "test"},
            "previous_details": {"purpose": before["details"].get("purpose"), "environment": before["details"].get("environment")},
        }]}
        audit_before = len(client.get("/api/board/audit", headers=ADMIN).json())
        preview = client.post("/api/board/preview", headers=ADMIN, json=batch)
        assert preview.status_code == 200, preview.text
        assert preview.json()["changes"][0]["before"]["name"] == before["name"]
        unchanged = next(x for x in client.get("/api/infra", headers=ADMIN).json() if x["id"] == vm_id)
        assert unchanged["name"] == before["name"]
        assert len(client.get("/api/board/audit", headers=ADMIN).json()) == audit_before
        commit = client.post("/api/board/commit", headers=ADMIN, json=batch)
        assert commit.status_code == 200, commit.text
        updated = next(x for x in client.get("/api/infra", headers=ADMIN).json() if x["id"] == vm_id)
        assert updated["name"] == "Reviewed VM"
        assert updated["description"] == "New description"
        assert updated["details"]["purpose"] == "Application server"
        assert updated["details"]["environment"] == "test"
        assert any(x["id"] == commit.json()["audit_id"] for x in client.get("/api/board/audit", headers=ADMIN).json())
        assert client.post("/api/board/commit", headers=ADMIN, json=batch).status_code == 409
        assert client.post("/api/board/preview", headers=VIEWER, json=batch).status_code == 403


def test_board_layout_save_roundtrip_and_validation():
    with TestClient(app) as client:
        system_id, vm_id = create_system_and_vm(client)
        before = client.get("/api/board/layout/" + system_id, headers=ADMIN)
        assert before.status_code == 200, before.text
        assert before.json()["positions"] == {}

        payload = {"positions": {vm_id: {"x": 450.5, "y": -120}}}
        updated = client.put("/api/board/layout/" + system_id, headers=ADMIN, json=payload)
        assert updated.status_code == 200, updated.text
        after = client.get("/api/board/layout/" + system_id, headers=ADMIN)
        assert after.status_code == 200
        assert after.json()["positions"] == payload["positions"]
        # Layout is presentation only: the inventory remains unchanged.
        listed = client.get("/api/infra", headers=ADMIN).json()
        assert any(item["id"] == vm_id for item in listed)

        bad = client.put("/api/board/layout/" + system_id, headers=ADMIN,
                         json={"positions": {str(uuid4()): {"x": 5, "y": 15}}})
        assert bad.status_code == 422
        assert client.get("/api/board/layout/" + system_id, headers=ADMIN).json()["positions"] == payload["positions"]

        invalid = client.put("/api/board/layout/" + system_id, headers=ADMIN,
                             json={"positions": {vm_id: {"x": "NaN", "y": 0}}})
        assert invalid.status_code == 422
        viewer = client.put("/api/board/layout/" + system_id, headers=VIEWER, json=payload)
        assert viewer.status_code == 403


def test_board_layout_can_store_connected_external_components():
    with TestClient(app) as client:
        system_id, vm_id = create_system_and_vm(client)
        _, other_vm = create_system_and_vm(client)
        locations = {vm_id: {"x": 10, "y": 20}, other_vm: {"x": 280, "y": 20}}
        response = client.put("/api/board/layout/" + system_id, headers=ADMIN,
                              json={"positions": locations})
        assert response.status_code == 200, response.text
        assert response.json()["positions"] == locations


def test_board_layout_roundtrip_includes_network_rectangles_and_rejects_unknown_networks():
    with TestClient(app) as client:
        system_id, vm_id = create_system_and_vm(client)
        network = client.post("/api/networks", headers=ADMIN, json={
            "name": "Saved diagram zone " + str(uuid4()), "kind": "zone"})
        assert network.status_code == 201, network.text
        net_id = network.json()["id"]
        data = {"positions": {vm_id: {"x": 240, "y": 130}},
                "network_rectangles": {net_id: {
                    "x": 50, "y": 80, "width": 480, "height": 300}}}
        result = client.put("/api/board/layout/" + system_id, headers=ADMIN, json=data)
        assert result.status_code == 200, result.text
        read = client.get("/api/board/layout/" + system_id, headers=ADMIN)
        assert read.status_code == 200
        assert read.json()["network_rectangles"] == data["network_rectangles"]
        assert read.json()["positions"] == data["positions"]
        unknown = client.put("/api/board/layout/" + system_id, headers=ADMIN, json={
            "positions": {}, "network_rectangles": {
                str(uuid4()): {"x": 0, "y": 0, "width": 400, "height": 320}}})
        assert unknown.status_code == 422
        assert client.get("/api/board/layout/" + system_id,
                          headers=ADMIN).json()["network_rectangles"] == data["network_rectangles"]
        assert client.put("/api/board/layout/" + system_id,
                          headers=VIEWER, json=data).status_code == 403



def test_existing_flow_can_be_reconnected_and_reversed_only_after_review():
    with TestClient(app) as client:
        system, source = create_system_and_vm(client)
        another = client.post("/api/infra", headers=ADMIN, json={
            "system_id": system, "kind": "vm", "name": "New destination " + str(uuid4())}).json()["id"]
        final = client.post("/api/infra", headers=ADMIN, json={
            "system_id": system, "kind": "vm", "name": "Third VM " + str(uuid4())}).json()["id"]
        original = client.post("/api/flows", headers=ADMIN, json={
            "source_id": source, "target_id": another, "name": "Reviewed connection",
            "protocol": "TCP", "port": "443", "security": "TLS",
            "data_description": "Test contract", "schedule": "daily",
            "verification": "verified"})
        assert original.status_code == 201, original.text
        flow = original.json()
        previous = {k: flow[k] for k in (
            "source_id", "target_id", "name", "protocol", "port", "security",
            "data_description", "schedule", "verification")}
        batch = {"reason": "Move flow endpoint to another VM", "changes": [{
            "action": "update_flow", "id": flow["id"], "previous_flow": previous,
            **{**previous, "target_id": final},
        }]}
        preview = client.post("/api/board/preview", headers=ADMIN, json=batch)
        assert preview.status_code == 200, preview.text
        assert preview.json()["changes"][0]["before"]["target_id"] == another
        unchanged = next(x for x in client.get("/api/flows", headers=ADMIN).json() if x["id"] == flow["id"])
        assert unchanged["target_id"] == another
        committed = client.post("/api/board/commit", headers=ADMIN, json=batch)
        assert committed.status_code == 200, committed.text
        now = next(x for x in client.get("/api/flows", headers=ADMIN).json() if x["id"] == flow["id"])
        assert now["target_id"] == final
        assert now["verification"] == "draft"
        assert now["source_id"] == source
        assert len([x for x in client.get("/api/flows", headers=ADMIN).json() if x["id"] == flow["id"]]) == 1
        assert any(entry["changes"][0]["action"] == "update_flow"
                   for entry in client.get("/api/board/audit", headers=ADMIN).json()
                   if entry["reason"] == batch["reason"])
        assert client.post("/api/board/commit", headers=ADMIN, json=batch).status_code == 409
        bad = {"reason": "Cannot connect VM to itself", "changes": [{
            **batch["changes"][0], "source_id": final, "target_id": final,
            "previous_flow": {**previous, "target_id": final, "verification": "draft"},
        }]}
        assert client.post("/api/board/preview", headers=ADMIN, json=bad).status_code == 422
        assert client.post("/api/board/commit", headers=VIEWER, json=batch).status_code == 403


def test_flow_handles_stored_only_as_valid_presentation_coordinates():
    with TestClient(app) as client:
        system, source = create_system_and_vm(client)
        target = client.post("/api/infra", headers=ADMIN, json={
            "system_id": system, "kind": "vm", "name": "Port target " + str(uuid4())}).json()["id"]
        flow = client.post("/api/flows", headers=ADMIN, json={
            "source_id": source, "target_id": target, "name": "Layout-only flow",
            "protocol": "TCP", "port": "443"}).json()
        data = {"positions": {}, "network_rectangles": {},
                "flow_handles": {flow["id"]: {
                    "source_handle": "right-b", "target_handle": "left-a"}}}
        saved = client.put("/api/board/layout/" + system, headers=ADMIN, json=data)
        assert saved.status_code == 200, saved.text
        after = client.get("/api/board/layout/" + system, headers=ADMIN)
        assert after.json()["flow_handles"] == data["flow_handles"]
        stored = next(x for x in client.get("/api/flows", headers=ADMIN).json() if x["id"] == flow["id"])
        assert stored["source_id"] == source and stored["target_id"] == target
        invalid = {"positions": {}, "flow_handles": {flow["id"]: {
            "source_handle": "outside", "target_handle": "left-b"}}}
        assert client.put("/api/board/layout/" + system, headers=ADMIN, json=invalid).status_code == 422
        unknown = {"positions": {}, "flow_handles": {str(uuid4()): {
            "source_handle": "top-a", "target_handle": "right-b"}}}
        assert client.put("/api/board/layout/" + system, headers=ADMIN, json=unknown).status_code == 422
        assert client.put("/api/board/layout/" + system, headers=VIEWER, json=data).status_code == 403
