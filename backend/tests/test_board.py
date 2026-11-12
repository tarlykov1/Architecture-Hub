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


def test_board_network_rectangles_can_move_and_are_persisted_with_history():
    with TestClient(app) as client:
        system_id, vm_id = create_system_and_vm(client)
        vlan = client.post("/api/networks", headers=ADMIN,
                           json={"name": "Move VLAN " + str(uuid4()), "kind": "vlan"})
        vrf = client.post("/api/networks", headers=ADMIN,
                          json={"name": "Move VRF " + str(uuid4()), "kind": "vrf"})
        assert vlan.status_code == 201, vlan.text
        assert vrf.status_code == 201, vrf.text
        vlan_id, vrf_id = vlan.json()["id"], vrf.json()["id"]
        positions = {
            vm_id: {"x": 120, "y": 140},
            "network:" + vlan_id: {"x": 50, "y": 70, "width": 540, "height": 340},
            "network:" + vrf_id: {"x": 700, "y": 70, "width": 540, "height": 340},
        }
        before_audit = client.get("/api/board/audit", headers=ADMIN).json()
        saved = client.put("/api/board/layout/" + system_id, headers=ADMIN,
                           json={"positions": positions})
        assert saved.status_code == 200, saved.text
        assert client.get("/api/board/layout/" + system_id, headers=ADMIN).json()["positions"] == positions
        history = client.get("/api/board/audit", headers=ADMIN).json()
        assert len(history) == len(before_audit) + 1
        event = history[0]
        assert event["actor"].startswith("admin:")
        assert {change["id"] for change in event["changes"]} == set(positions)
        assert all(change["action"] == "update_layout" for change in event["changes"])

        positions["network:" + vrf_id] = {"x": 850, "y": 260, "width": 600, "height": 380}
        moved = client.put("/api/board/layout/" + system_id, headers=ADMIN,
                           json={"positions": positions})
        assert moved.status_code == 200, moved.text
        change = client.get("/api/board/audit", headers=ADMIN).json()[0]["changes"]
        assert len(change) == 1
        assert change[0]["id"] == "network:" + vrf_id
        assert change[0]["before"]["x"] == 700
        assert change[0]["after"]["x"] == 850

        # Re-saving unchanged coordinates must not create a phantom history event.
        before = len(client.get("/api/board/audit", headers=ADMIN).json())
        assert client.put("/api/board/layout/" + system_id, headers=ADMIN,
                          json={"positions": positions}).status_code == 200
        assert len(client.get("/api/board/audit", headers=ADMIN).json()) == before


def test_board_rejects_invalid_network_geometry_without_overwriting_layout():
    with TestClient(app) as client:
        system_id, _ = create_system_and_vm(client)
        network_id = client.post("/api/networks", headers=ADMIN,
                                 json={"name": "Geometry check " + str(uuid4()), "kind": "vrf"}).json()["id"]
        url = "/api/board/layout/" + system_id
        baseline = client.get(url, headers=ADMIN).json()["positions"]
        for broken in [
            {"network:" + str(uuid4()): {"x": 20, "y": 30, "width": 400, "height": 200}},
            {"network:" + network_id: {"x": 20, "y": 30}},
            {"network:" + network_id: {"x": 20, "y": 30, "width": 20, "height": 40}},
            {"network:not-a-uuid": {"x": 20, "y": 30, "width": 400, "height": 200}},
        ]:
            response = client.put(url, headers=ADMIN, json={"positions": broken})
            assert response.status_code == 422, response.text
            assert client.get(url, headers=ADMIN).json()["positions"] == baseline


def test_empty_vrf_vlan_and_vm_survive_reviewed_commit():
    """Visual nesting must not require a NIC; new CI and empty networks persist independently."""
    with TestClient(app) as client:
        system_id, _ = create_system_and_vm(client)
        vm_id, vlan_id, vrf_id = str(uuid4()), str(uuid4()), str(uuid4())
        batch = {
            "reason": "Add unconnected VM and independent VRF/VLAN",
            "changes": [
                {"action": "create_vm", "id": vm_id, "system_id": system_id,
                 "name": "Standalone VM " + vm_id[:8], "kind": "vm"},
                {"action": "create_network", "id": vlan_id,
                 "name": "Standalone VLAN " + vlan_id[:8], "kind": "vlan"},
                {"action": "create_network", "id": vrf_id,
                 "name": "Standalone VRF " + vrf_id[:8], "kind": "vrf"},
            ]
        }

        preview = client.post("/api/board/preview", headers=ADMIN, json=batch)
        assert preview.status_code == 200, preview.text
        assert preview.json()["count"] == 3
        assert vm_id not in {r["id"] for r in client.get("/api/infra", headers=ADMIN).json()}
        assert vrf_id not in {r["id"] for r in client.get("/api/networks", headers=ADMIN).json()}

        committed = client.post("/api/board/commit", headers=ADMIN, json=batch)
        assert committed.status_code == 200, committed.text
        assert committed.json()["count"] == 3
        infra = {r["id"]: r for r in client.get("/api/infra", headers=ADMIN).json()}
        networks = {r["id"]: r for r in client.get("/api/networks", headers=ADMIN).json()}
        assert infra[vm_id]["system_id"] == system_id
        assert networks[vlan_id]["kind"] == "vlan"
        assert networks[vrf_id]["kind"] == "vrf"
        assert not any(n["item_id"] == vm_id for n in client.get("/api/network-interfaces", headers=ADMIN).json())

        positions = {
            vm_id: {"x": 330, "y": 170},
            "network:" + vrf_id: {"x": 60, "y": 50, "width": 1000, "height": 600},
            "network:" + vlan_id: {"x": 130, "y": 110, "width": 550, "height": 350},
        }
        stored = client.put("/api/board/layout/" + system_id, headers=ADMIN,
                            json={"positions": positions})
        assert stored.status_code == 200, stored.text
        assert client.get("/api/board/layout/" + system_id, headers=ADMIN).json()["positions"] == positions
        audits = client.get("/api/board/audit", headers=ADMIN).json()
        assert any(row["id"] == committed.json()["audit_id"] and len(row["changes"]) == 3 for row in audits)


def test_explicit_network_hierarchy_validates_and_round_trips():
    with TestClient(app) as client:
        system_id, vm_id = create_system_and_vm(client)
        vrf_ids=[]
        for kind in ("vrf", "vrf", "vlan"):
            response=client.post("/api/networks", headers=ADMIN,
                                 json={"name": "Hierarchy " + kind + " " + str(uuid4()), "kind": kind})
            assert response.status_code == 201, response.text
            vrf_ids.append(response.json()["id"])
        vrf_one, vrf_two, vlan=vrf_ids
        data={
            "network:"+vrf_one:{"x":0,"y":0,"width":1100,"height":700},
            "network:"+vrf_two:{"x":1150,"y":0,"width":1100,"height":700},
            "network:"+vlan:{"x":100,"y":100,"width":600,"height":350,"parent_id":"network:"+vrf_one},
            vm_id:{"x":180,"y":150,"parent_id":"network:"+vlan},
        }
        result=client.put("/api/board/layout/"+system_id,headers=ADMIN,json={"positions":data})
        assert result.status_code == 200,result.text
        restored=client.get("/api/board/layout/"+system_id,headers=ADMIN).json()["positions"]
        assert restored["network:"+vlan]["parent_id"] == "network:"+vrf_one
        assert restored[vm_id]["parent_id"] == "network:"+vlan
        assert not [n for n in client.get("/api/network-interfaces",headers=ADMIN).json() if n["item_id"] == vm_id]

        transfer={**data,"network:"+vlan:{**data["network:"+vlan],"parent_id":"network:"+vrf_two}}
        result=client.put("/api/board/layout/"+system_id,headers=ADMIN,json={"positions":transfer})
        assert result.status_code == 200,result.text
        assert result.json()["positions"]["network:"+vlan]["parent_id"] == "network:"+vrf_two
        detached={**transfer,"network:"+vlan:{k:v for k,v in transfer["network:"+vlan].items() if k!="parent_id"}}
        result=client.put("/api/board/layout/"+system_id,headers=ADMIN,json={"positions":detached})
        assert result.status_code == 200,result.text
        assert "parent_id" not in result.json()["positions"]["network:"+vlan]

        nested_vrf={**data,"network:"+vrf_two:{**data["network:"+vrf_two],"parent_id":"network:"+vrf_one}}
        assert client.put("/api/board/layout/"+system_id,headers=ADMIN,json={"positions":nested_vrf}).status_code == 422
        cycle={**data,"network:"+vrf_one:{**data["network:"+vrf_one],"parent_id":"network:"+vlan}}
        assert client.put("/api/board/layout/"+system_id,headers=ADMIN,json={"positions":cycle}).status_code == 422
        bad_parent={**data,vm_id:{**data[vm_id],"parent_id":"network:"+str(uuid4())}}
        assert client.put("/api/board/layout/"+system_id,headers=ADMIN,json={"positions":bad_parent}).status_code == 422
        assert client.get("/api/board/layout/"+system_id,headers=ADMIN).json()["positions"] == result.json()["positions"]


def test_existing_flow_edit_requires_review_and_writes_audited_parameters():
    """Edits never mutate storage on preview, and include original values in audit."""
    with TestClient(app) as client:
        _, source = create_system_and_vm(client)
        _, target = create_system_and_vm(client)
        flow_id = str(uuid4())
        created = client.post("/api/flows", headers=ADMIN, json={
            "source_id": source, "target_id": target, "name": "HR export",
            "protocol": "TCP", "port": "443", "security": "unknown",
            "data_description": "employee id", "schedule": "daily", "verification": "draft"
        })
        assert created.status_code == 201, created.text
        flow_id = created.json()["id"]
        before = {key: created.json()[key] for key in (
            "name", "protocol", "port", "security", "data_description", "schedule", "verification")}
        item = {
            "action": "update_flow", "id": flow_id,
            "source_id": source, "target_id": target,
            **{**before, "name": "HR employee export", "protocol": "HTTPS",
               "port": "8443", "security": "TLS",
               "data_description": "employee id and work location",
               "schedule": "hourly", "verification": "verified"},
            "previous_flow": before
        }
        batch = {"reason": "Validated integration protocol", "changes": [item]}
        preview = client.post("/api/board/preview", headers=ADMIN, json=batch)
        assert preview.status_code == 200, preview.text
        diff = preview.json()["changes"][0]
        assert diff["action"] == "update_flow"
        assert diff["before"] == before
        assert diff["after"]["protocol"] == "HTTPS"
        flow = next(f for f in client.get("/api/flows", headers=ADMIN).json()
                    if f["id"] == flow_id)
        assert flow["protocol"] == "TCP"
        commit = client.post("/api/board/commit", headers=ADMIN, json=batch)
        assert commit.status_code == 200, commit.text
        updated = next(f for f in client.get("/api/flows", headers=ADMIN).json()
                       if f["id"] == flow_id)
        assert updated["name"] == "HR employee export"
        assert updated["port"] == "8443"
        assert updated["security"] == "TLS"
        assert updated["data_description"] == "employee id and work location"
        assert updated["schedule"] == "hourly"
        assert updated["verification"] == "verified"
        history = client.get("/api/board/audit", headers=ADMIN).json()
        assert any(h["id"] == commit.json()["audit_id"] and
                   h["changes"][0]["before"] == before and
                   h["changes"][0]["after"]["verification"] == "verified"
                   for h in history)
        # The stale original revision can never overwrite newer data.
        assert client.post("/api/board/commit", headers=ADMIN, json=batch).status_code == 409


def test_existing_flow_review_rejects_invalid_or_unauthorized_edits():
    with TestClient(app) as client:
        _, source = create_system_and_vm(client)
        _, target = create_system_and_vm(client)
        created = client.post("/api/flows", headers=ADMIN, json={
            "source_id": source, "target_id": target, "name": "Flow original"})
        assert created.status_code == 201, created.text
        before = {key: created.json()[key] for key in (
            "name", "protocol", "port", "security", "data_description", "schedule", "verification")}
        change = {"action": "update_flow", "id": created.json()["id"],
                  "source_id": source, "target_id": target,
                  "previous_flow": before, **before}
        batch = {"reason": "Edit flow permissions and revision", "changes": [
            {**change, "name": "Updated"}]}
        assert client.post("/api/board/preview", headers=VIEWER, json=batch).status_code == 403
        assert client.post("/api/board/commit", headers=VIEWER, json=batch).status_code == 403
        assert client.post("/api/board/commit", headers=ADMIN, json={
            **batch, "changes": [{k:v for k,v in batch["changes"][0].items()
                                  if k != "previous_flow"}]}).status_code == 422
        assert client.post("/api/board/preview", headers=ADMIN, json={
            **batch, "changes": [change]}).status_code == 422
        assert client.post("/api/board/preview", headers=ADMIN, json={
            **batch, "changes": [{**change, "source_id": target, "name": "Updated"}]}).status_code == 409
        assert client.post("/api/board/preview", headers=ADMIN, json={
            **batch, "changes": [{**change, "previous_flow": {**before, "port": "999"},
                                  "name": "Updated"}]}).status_code == 409
        assert client.post("/api/board/commit", headers=ADMIN, json={
            **batch, "changes": [{**change, "name": "Updated"}]}).status_code == 200


def test_reviewed_flow_reconnect_preserves_id_and_rejects_stale_endpoints():
    with TestClient(app) as client:
        _, source = create_system_and_vm(client)
        _, target = create_system_and_vm(client)
        _, replacement = create_system_and_vm(client)
        created = client.post("/api/flows", headers=ADMIN, json={
            "source_id": source, "target_id": target, "name": "Endpoint change",
            "protocol": "HTTPS", "port": "443",
        })
        assert created.status_code == 201, created.text
        flow = created.json()
        values = {key: flow[key] for key in (
            "name", "protocol", "port", "security", "data_description", "schedule", "verification",
        )}
        reconnect = {
            "action": "update_flow", "id": flow["id"], "source_id": replacement, "target_id": target,
            "previous_source_id": source, "previous_target_id": target, "previous_flow": values, **values,
        }
        batch = {"reason": "Move export to a new source", "changes": [reconnect]}
        invalid = {**batch, "changes": [{**reconnect, "source_id": target}]}
        assert client.post("/api/board/preview", headers=ADMIN, json=invalid).status_code == 422

        preview = client.post("/api/board/preview", headers=ADMIN, json=batch)
        assert preview.status_code == 200, preview.text
        change = preview.json()["changes"][0]
        assert change["endpoints"] == {"before": [source, target], "after": [replacement, target]}
        assert flow in client.get("/api/flows", headers=ADMIN).json()

        committed = client.post("/api/board/commit", headers=ADMIN, json=batch)
        assert committed.status_code == 200, committed.text
        assert {**flow, "source_id": replacement} in client.get("/api/flows", headers=ADMIN).json()
        assert client.post("/api/board/commit", headers=ADMIN, json=batch).status_code == 409
        audit = client.get("/api/board/audit", headers=ADMIN).json()
        assert any(row["id"] == committed.json()["audit_id"] and row["changes"] == [change] for row in audit)
