"""Design-time VM and flow metadata survives revisions without touching live CMDB."""
from uuid import uuid4

from fastapi.testclient import TestClient
from app.main import app


def test_proposed_vm_and_flow_are_editable_isolated_and_persist_after_review_withdraw(monkeypatch):
    admin = "ci-admin-token-123456789012345678901234"
    monkeypatch.setenv("ARCH_HUB_ACCESS_KEYS", '{"%s":"admin"}' % admin)
    with TestClient(app, headers={"Authorization": "Bearer " + admin}) as client:
        suffix = uuid4().hex[:10]
        system = client.post("/api/objects", json={
            "kind": "system", "name": "QA-WORK-Metadata-" + suffix,
        }).json()["id"]
        registered = client.post("/api/infra", json={
            "system_id": system, "kind": "vm", "name": "QA-WORK-Existing-" + suffix
        }).json()["id"]
        created = client.post("/api/technical-decisions", json={
            "title": "QA-WORK-Metadata-" + suffix, "system_id": system
        }).json()
        url = "/api/technical-decisions/" + created["id"]
        vm_id, flow_id = str(uuid4()), str(uuid4())
        vm = {
            "id": vm_id, "system_id": system, "kind": "server",
            "name": "QA-WORK-New Server", "x": 100, "y": 200,
            "description": "Service node in the new design", "environment": "test"
        }
        flow = {
            "id": flow_id, "source_id": registered, "target_id": vm_id,
            "name": "QA-WORK-Sync", "protocol": "HTTPS", "port": "443",
            "data_description": "Only reference identifiers",
            "security": "mTLS", "schedule": "Every 15 minutes",
            "verification": "draft"
        }
        changed = client.put(url, json={
            "title": created["title"], "expected_revision": created["revision"],
            "proposed_vms": [vm], "proposed_flows": [flow],
        })
        assert changed.status_code == 200, changed.text
        assert changed.json()["proposed_vms"] == [vm]
        assert changed.json()["proposed_flows"][0].items() >= flow.items()

        # Existing records are not modified by design-time editing or review.
        assert all(x["id"] != vm_id for x in client.get("/api/infra").json())
        assert all(x["id"] != flow_id for x in client.get("/api/flows").json())

        current = changed.json()
        submitted = client.post(url + "/submit", json={
            "expected_revision": current["revision"]
        })
        assert submitted.status_code == 200, submitted.text
        assert submitted.json()["proposed_vms"] == [vm]
        assert submitted.json()["proposed_flows"][0]["security"] == "mTLS"
        withdrawn = client.post(url + "/withdraw", json={
            "expected_revision": submitted.json()["revision"]
        })
        assert withdrawn.status_code == 200, withdrawn.text
        assert withdrawn.json()["proposed_flows"][0]["data_description"] == flow["data_description"]


def test_proposal_contract_fields_are_validated(monkeypatch):
    admin = "ci-admin-token-123456789012345678901234"
    monkeypatch.setenv("ARCH_HUB_ACCESS_KEYS", '{"%s":"admin"}' % admin)
    with TestClient(app, headers={"Authorization": "Bearer " + admin}) as client:
        name = "QA-WORK-MetadataValidation-" + uuid4().hex[:8]
        system = client.post("/api/objects", json={
            "kind": "system", "name": name
        }).json()["id"]
        row = client.post("/api/technical-decisions", json={
            "title": name, "system_id": system
        }).json()
        vm_id = str(uuid4())
        vm = {
            "id": vm_id, "system_id": system, "name": "QA-WORK-Proposed",
            "kind": "vm", "x": 0, "y": 0,
        }
        wrong = client.put("/api/technical-decisions/" + row["id"], json={
            "title": name, "expected_revision": row["revision"],
            "proposed_vms": [vm],
            "proposed_flows": [{
                "id": str(uuid4()), "source_id": vm_id, "target_id": str(uuid4()),
                "name": name, "verification": "impossible",
            }],
        })
        assert wrong.status_code == 422, wrong.text
        overly_long = client.put("/api/technical-decisions/" + row["id"], json={
            "title": name, "expected_revision": row["revision"],
            "proposed_vms": [{**vm, "environment": "x"*121}],
        })
        assert overly_long.status_code == 422, overly_long.text
        assert client.get("/api/technical-decisions/" + row["id"]).json()["revision"] == row["revision"]
