"""AH-05: isolated planning of changes to existing registered architecture."""
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app


def created(client, path, data):
    response = client.post(path, json=data)
    assert response.status_code == 201, response.text
    return response.json()


def infrastructure(client):
    suffix = str(uuid4())[:12]
    system = created(client, "/api/objects", {
        "kind": "system", "name": "QA-WORK-DecisionScope-" + suffix,
    })
    remote = created(client, "/api/objects", {
        "kind": "system", "name": "QA-WORK-RemoteScope-" + suffix,
    })
    source = created(client, "/api/infra", {
        "kind": "vm", "name": "QA-WORK-ExistingVM-" + suffix,
        "system_id": system["id"], "description": "Before design",
    })
    external = created(client, "/api/infra", {
        "kind": "vm", "name": "QA-WORK-ExternalVM-" + suffix,
        "system_id": remote["id"],
    })
    existing_flow = created(client, "/api/flows", {
        "name": "QA-WORK-LiveExchange-" + suffix,
        "source_id": source["id"], "target_id": external["id"],
        "protocol": "HTTPS", "port": "443", "security": "TLS",
    })
    decision = created(client, "/api/technical-decisions", {
        "title": "QA-WORK-ModifyExisting-" + suffix, "system_id": system["id"],
    })
    return system, remote, source, external, existing_flow, decision


def put(client, decision, changes, **other):
    return client.put("/api/technical-decisions/" + decision["id"], json={
        "title": decision["title"],
        "expected_revision": decision["revision"],
        "existing_changes": changes,
        **other,
    })


def test_existing_vm_flow_update_saved_as_before_after_without_touching_live_register():
    with TestClient(app, headers=ADMIN) as client:
        system, _, vm, _, flow, decision = infrastructure(client)
        changes = [
            {
                "kind": "vm", "action": "update", "id": vm["id"],
                "fields": {
                    "name": "QA-WORK-TargetVM",
                    "description": "New purpose", "environment": "prod",
                },
            },
            {
                "kind": "flow", "action": "update", "id": flow["id"],
                "fields": {
                    "name": "QA-WORK-TargetFlow", "port": "8443",
                    "protocol": "HTTPS", "security": "mTLS",
                    "data_description": "Reference identifiers only",
                },
            },
        ]
        updated = put(client, decision, changes)
        assert updated.status_code == 200, updated.text
        saved = updated.json()
        assert saved["revision"] == decision["revision"] + 1
        assert saved["existing_changes_count"] == 2
        first, second = saved["existing_changes"]
        assert first["before"]["name"] == vm["name"]
        assert first["after"]["name"] == "QA-WORK-TargetVM"
        assert first["before"]["environment"] == ""
        assert second["before"]["port"] == "443"
        assert second["after"]["port"] == "8443"
        assert second["after"]["security"] == "mTLS"
        assert first["id"] == vm["id"]
        assert second["id"] == flow["id"]

        # Persisted changes do not change active infrastructure or registered flows.
        actual_vm = next(v for v in client.get("/api/infra").json() if v["id"] == vm["id"])
        actual_flow = next(f for f in client.get("/api/flows").json() if f["id"] == flow["id"])
        assert actual_vm["name"] == vm["name"]
        assert actual_vm["description"] == "Before design"
        assert actual_flow["port"] == "443"
        assert actual_flow["security"] == "TLS"

        # Old clients may omit the new field; this must preserve proposed changes.
        legacy = client.put("/api/technical-decisions/" + saved["id"], json={
            "title": saved["title"], "description": "Legacy UI edit",
            "expected_revision": saved["revision"],
        })
        assert legacy.status_code == 200, legacy.text
        assert legacy.json()["existing_changes"] == saved["existing_changes"]

        submitted = client.post(
            "/api/technical-decisions/" + saved["id"] + "/submit",
            json={"expected_revision": legacy.json()["revision"]},
        )
        assert submitted.status_code == 200, submitted.text
        assert submitted.json()["status"] == "in_review"
        assert submitted.json()["base_changed"] is False

        # Comment is attached to the registered object being changed.
        comment = client.post(
            "/api/technical-decisions/" + saved["id"] + "/comments",
            json={"anchor_kind": "vm", "anchor_id": vm["id"],
                  "body": "QA-WORK-Need infrastructure review"},
        )
        assert comment.status_code == 201, comment.text
        assert comment.json()["comments"][-1]["anchor_id"] == vm["id"]

        final = client.get("/api/technical-decisions/" + saved["id"]).json()
        assert final["existing_changes"][1]["after"]["port"] == "8443"
        assert any(v["id"] == vm["id"] and v["name"] == vm["name"]
                   for v in client.get("/api/infra").json())


def test_staged_only_removals_and_dependency_guard_protect_live_records():
    with TestClient(app, headers=ADMIN) as client:
        _, _, vm, _, flow, decision = infrastructure(client)
        blocked = put(client, decision, [{
            "kind": "vm", "action": "remove", "id": vm["id"],
        }])
        assert blocked.status_code == 422, blocked.text
        changes = [
            {"kind": "flow", "action": "remove", "id": flow["id"]},
            {"kind": "vm", "action": "remove", "id": vm["id"]},
        ]
        staged = put(client, decision, changes)
        assert staged.status_code == 200, staged.text
        assert staged.json()["existing_changes"][0]["after"] is None
        assert staged.json()["existing_changes"][1]["after"] is None
        review = client.post(
            "/api/technical-decisions/" + decision["id"] + "/submit",
            json={"expected_revision": staged.json()["revision"]},
        )
        assert review.status_code == 200, review.text
        assert review.json()["status"] == "in_review"
        assert any(row["id"] == vm["id"] for row in client.get("/api/infra").json())
        assert any(row["id"] == flow["id"] for row in client.get("/api/flows").json())


def test_invalid_scope_duplicate_actions_ports_endpoints_are_rejected_atomically():
    with TestClient(app, headers=ADMIN) as client:
        _, _, vm, external, flow, decision = infrastructure(client)
        cases = [
            [{"kind": "vm", "action": "update", "id": external["id"],
              "fields": {"name": "Cannot edit outside IS"}}],
            [{"kind": "vm", "action": "update", "id": vm["id"],
              "fields": {"unknown_field": "unsafe"}}],
            [{"kind": "flow", "action": "update", "id": flow["id"],
              "fields": {"port": "999999"}}],
            [{"kind": "flow", "action": "update", "id": flow["id"],
              "fields": {"source_id": str(uuid4())}}],
            [{"kind": "vm", "action": "remove", "id": vm["id"],
              "fields": {"name": "Invalid"}}],
            [{"kind": "flow", "action": "update", "id": flow["id"],
              "fields": {"port": "443"}}],  # No actual difference
            [
                {"kind": "vm", "action": "update", "id": vm["id"],
                 "fields": {"name": "First"}},
                {"kind": "vm", "action": "remove", "id": vm["id"]},
            ],
        ]
        for changes in cases:
            response = put(client, decision, changes)
            assert response.status_code in (409, 422), (changes, response.status_code, response.text)
            after = client.get("/api/technical-decisions/" + decision["id"]).json()
            assert after["revision"] == decision["revision"]
            assert after["existing_changes"] == []


def test_stale_live_architecture_blocks_staged_edit_and_review():
    with TestClient(app, headers=ADMIN) as client:
        _, _, _, _, flow, decision = infrastructure(client)
        staged = put(client, decision, [{
            "kind": "flow", "action": "update", "id": flow["id"],
            "fields": {"port": "8443"},
        }])
        assert staged.status_code == 200, staged.text
        external = client.put("/api/flows/" + flow["id"], json={
            "name": flow["name"], "source_id": flow["source_id"],
            "target_id": flow["target_id"], "protocol": "HTTPS",
            "port": "8080", "security": "TLS",
        })
        assert external.status_code == 200, external.text

        pending = client.post(
            "/api/technical-decisions/" + decision["id"] + "/submit",
            json={"expected_revision": staged.json()["revision"]},
        )
        assert pending.status_code == 409, pending.text
        changed = client.put("/api/technical-decisions/" + decision["id"], json={
            "title": decision["title"],
            "expected_revision": staged.json()["revision"],
            "existing_changes": staged.json()["existing_changes"],
        })
        assert changed.status_code == 409
        assert client.get("/api/technical-decisions/" + decision["id"]).json()["status"] == "draft"
