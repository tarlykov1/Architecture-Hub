"""Attribute dictionary: reuse the same element across distinct consumers and BPs."""
from uuid import uuid4

from fastapi.testclient import TestClient
from app.main import app

ADMIN = {"Authorization": "Bearer ci-admin-token-123456789012345678901234"}
VIEWER = {"Authorization": "Bearer ci-viewer-token-123456789012345678901234"}


def create(client, endpoint, data):
    result = client.post(endpoint, headers=ADMIN, json=data)
    assert result.status_code == 201, result.text
    return result.json()["id"]


def test_flow_attributes_are_context_specific_and_do_not_store_personal_values():
    with TestClient(app) as client:
        key = str(uuid4())[:8]
        source_id = create(client, "/api/objects", {"name": "ZUP " + key, "kind": "system"})
        hub_id = create(client, "/api/objects", {"name": "EIBD " + key, "kind": "system"})
        consumer_a = create(client, "/api/objects", {"name": "Portal " + key, "kind": "system"})
        consumer_b = create(client, "/api/objects", {"name": "ITSM " + key, "kind": "system"})
        category_id = create(client, "/api/business/categories", {"name": "HR " + key})
        process_a = create(client, "/api/business/processes", {"name": "Directory " + key, "category_id": category_id})
        process_b = create(client, "/api/business/processes", {"name": "Support " + key, "category_id": category_id})
        source_vm = create(client, "/api/infra", {"system_id": source_id, "name": "ZUP export", "kind": "service"})
        hub_vm = create(client, "/api/infra", {"system_id": hub_id, "name": "EIBD import", "kind": "service"})
        flow_id = create(client, "/api/flows", {"source_id": source_vm, "target_id": hub_vm, "name": "Staff data"})
        attr_name = create(client, "/api/data-attributes", {
            "code": "employee.full_name." + key, "name": "ФИО", "data_type": "string", "sensitivity": "personal"})
        attr_email = create(client, "/api/data-attributes", {
            "code": "employee.corporate_email." + key, "name": "Рабочая почта", "sensitivity": "internal"})
        assert client.post("/api/data-attributes", headers=ADMIN, json={
            "code": "employee.full_name." + key, "name": "Дубликат"}).status_code == 409
        bindings = [
            (attr_name, process_a, consumer_a),
            (attr_email, process_a, consumer_a),
            (attr_name, process_b, consumer_b),
        ]
        for attribute_id, process_id, consumer_system_id in bindings:
            create(client, "/api/flow-data-uses", {
                "flow_id": flow_id, "attribute_id": attribute_id,
                "process_id": process_id, "consumer_system_id": consumer_system_id,
                "purpose": "Test mapped definition", "verification": "draft"})
        detail = client.get("/api/flows/" + flow_id + "/data-map", headers=ADMIN)
        assert detail.status_code == 200, detail.text
        rows = detail.json()["attributes"]
        assert len(rows) == 3
        assert {r["name"] for r in rows if r["consumer_system_id"] == consumer_a} == {"ФИО", "Рабочая почта"}
        assert {r["name"] for r in rows if r["consumer_system_id"] == consumer_b} == {"ФИО"}
        assert all(r["process_name"] and r["consumer_system_name"] for r in rows)
        assert client.post("/api/flow-data-uses", headers=ADMIN, json={
            "flow_id": flow_id, "attribute_id": attr_name,
            "process_id": process_a, "consumer_system_id": consumer_a}).status_code == 409
        assert client.get("/api/data-attributes", headers=VIEWER).status_code == 403
        assert client.post("/api/data-attributes", headers=VIEWER, json={
            "code": "forbidden."+key, "name": "No"}).status_code == 403
        deletion = client.delete("/api/flows/"+flow_id, headers=ADMIN)
        assert deletion.status_code == 204
        assert client.get("/api/flow-data-uses?flow_id="+flow_id, headers=ADMIN).json() == []
