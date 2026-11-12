"""Reviewed flow attribute edits: preview is read-only, commit is atomic and audited."""
from uuid import uuid4

from fastapi.testclient import TestClient
from app.main import app

ADMIN = {"Authorization": "Bearer ci-admin-token-123456789012345678901234"}
VIEWER = {"Authorization": "Bearer ci-viewer-token-123456789012345678901234"}


def make(client, path, data):
    response = client.post(path, headers=ADMIN, json=data)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def setup(client):
    marker = uuid4().hex[:10]
    system = make(client, "/api/objects", {"name": "Flow review system " + marker, "kind": "system"})
    consumer = make(client, "/api/objects", {"name": "Consumer " + marker, "kind": "system"})
    process_category = make(client, "/api/business/categories", {"name": "Review category " + marker})
    process = make(client, "/api/business/processes", {"name": "Review process " + marker,
                                                        "category_id": process_category})
    source = make(client, "/api/infra", {"system_id": system, "name": "Review source " + marker, "kind": "service"})
    target = make(client, "/api/infra", {"system_id": system, "name": "Review target " + marker, "kind": "service"})
    flow = make(client, "/api/flows", {"source_id": source, "target_id": target, "name": "Review flow " + marker})
    attribute = make(client, "/api/data-attributes", {"code": "review_field_" + marker,
                                                       "name": "Review metadata " + marker})
    alternate = make(client, "/api/data-attributes", {"code": "alternate_" + marker,
                                                       "name": "Alternate metadata " + marker})
    return flow, process, consumer, attribute, alternate


def test_flow_data_review_preview_commit_conflicts_and_atomic_rollback():
    with TestClient(app) as client:
        flow, process, consumer, attribute, alternate = setup(client)
        path = "/api/flows/" + flow + "/data-map"
        current = client.get(path, headers=ADMIN).json()
        assert current["attributes"] == []
        assert len(current["revision"]) == 64
        audit_before = len(client.get("/api/board/audit?limit=200", headers=ADMIN).json())

        operation = {"action": "add", "attribute_id": attribute,
                     "process_id": process, "consumer_system_id": consumer,
                     "purpose": "Needed for directory lookup", "verification": "assumed"}
        payload = {"expected_revision": current["revision"], "reason": "Review scoped field transfer",
                   "operations": [operation, {"action": "add", "attribute_id": alternate}]}
        preview = client.post(path + "/preview", headers=ADMIN, json=payload)
        assert preview.status_code == 200, preview.text
        assert preview.json()["count"] == 2
        assert client.get(path, headers=ADMIN).json() == current
        assert len(client.get("/api/board/audit?limit=200", headers=ADMIN).json()) == audit_before

        assert client.post(path + "/preview", headers=VIEWER, json=payload).status_code == 403
        assert client.post(path + "/commit", headers=VIEWER, json=payload).status_code == 403

        commit = client.post(path + "/commit", headers=ADMIN, json=payload)
        assert commit.status_code == 200, commit.text
        assert commit.json()["count"] == 2
        saved = client.get(path, headers=ADMIN).json()
        assert saved["revision"] != current["revision"]
        assert len(saved["attributes"]) == 2
        assert any(row["process_id"] == process and row["consumer_system_id"] == consumer
                   for row in saved["attributes"])
        audit = client.get("/api/board/audit?limit=200", headers=ADMIN).json()
        assert any(row["id"] == commit.json()["audit_id"] and len(row["changes"]) == 2
                   and row["reason"] == "Review scoped field transfer" for row in audit)
        assert client.post(path + "/commit", headers=ADMIN, json=payload).status_code == 409

        original = next(row for row in saved["attributes"] if row["attribute_id"] == attribute)
        secondary = next(row for row in saved["attributes"] if row["attribute_id"] == alternate)
        edit = {"expected_revision": saved["revision"], "reason": "Correct purpose and remove redundant field",
                "operations": [
                    {"action": "update", "id": original["id"], "attribute_id": attribute,
                     "process_id": process, "consumer_system_id": consumer,
                     "purpose": "Used by verified employee search", "verification": "verified"},
                    {"action": "remove", "id": secondary["id"]},
                ]}
        assert client.post(path + "/preview", headers=ADMIN, json=edit).status_code == 200
        assert len(client.get(path, headers=ADMIN).json()["attributes"]) == 2
        result = client.post(path + "/commit", headers=ADMIN, json=edit)
        assert result.status_code == 200, result.text
        after = client.get(path, headers=ADMIN).json()
        assert len(after["attributes"]) == 1
        assert after["attributes"][0]["verification"] == "verified"
        assert after["attributes"][0]["purpose"] == "Used by verified employee search"

        invalid = {"expected_revision": after["revision"], "reason": "Invalid second operation",
                   "operations": [
                       {"action": "add", "attribute_id": alternate},
                       {"action": "remove", "id": str(uuid4())},
                   ]}
        assert client.post(path + "/commit", headers=ADMIN, json=invalid).status_code == 422
        assert client.get(path, headers=ADMIN).json() == after

        duplicate = {"expected_revision": after["revision"], "reason": "Duplicate scoped use",
                     "operations": [{"action": "add", "attribute_id": attribute,
                                     "process_id": process, "consumer_system_id": consumer}]}
        assert client.post(path + "/preview", headers=ADMIN, json=duplicate).status_code == 409
        assert client.get(path, headers=ADMIN).json() == after


def test_flow_data_edit_rejects_other_flow_mapping():
    with TestClient(app) as client:
        flow, process, consumer, attribute, _ = setup(client)
        other_flow, _, _, _, _ = setup(client)
        mapped_id = make(client, "/api/flow-data-uses", {
            "flow_id": other_flow, "attribute_id": attribute, "process_id": process,
            "consumer_system_id": consumer,
        })
        path = "/api/flows/" + flow + "/data-map"
        revision = client.get(path, headers=ADMIN).json()["revision"]
        response = client.post(path + "/commit", headers=ADMIN, json={
            "expected_revision": revision, "reason": "Attempt to delete foreign mapping",
            "operations": [{"action": "remove", "id": mapped_id}],
        })
        assert response.status_code == 422
        assert client.get("/api/flow-data-uses?flow_id=" + other_flow, headers=ADMIN).json()[0]["id"] == mapped_id
