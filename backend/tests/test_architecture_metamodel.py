"""P0 metamodel: public logical-IS relation semantics and server enforcement."""
from uuid import uuid4

from fastapi.testclient import TestClient
from app.architecture_metamodel import get_logical_relation_types, logical_relation_validation_error, summarize_legacy_relations
from app.main import app

ADMIN = {"Authorization": "Bearer ci-admin-token-123456789012345678901234"}
VIEWER = {"Authorization": "Bearer ci-viewer-token-123456789012345678901234"}


def _object(client: TestClient, kind="system") -> str:
    result = client.post(
        "/api/objects", headers=ADMIN,
        json={"kind": kind, "name": "QA-WORK-IS-" + str(uuid4())},
    )
    assert result.status_code == 201, result.text
    return result.json()["id"]


def test_relation_type_catalog_covers_legacy_and_is_not_a_transport_graph():
    registry = get_logical_relation_types()
    assert {row["kind"] for row in registry} == {
        "integrates_with", "depends_on", "data_flow",
    }
    assert all(row["source_kind"] == row["target_kind"] == "system" for row in registry)
    assert all(row["technical_flow"] is False for row in registry)
    assert next(item for item in registry if item["kind"] == "data_flow")["deprecated"] is True
    assert logical_relation_validation_error("integrates_with", "system", "system") is None
    assert logical_relation_validation_error("data_flow", "system", "system") is not None
    assert logical_relation_validation_error("depends_on", "system", "vm")
    assert logical_relation_validation_error("made_up_link", "system", "system")


def test_relation_catalog_is_readonly_and_uses_existing_system_permissions():
    with TestClient(app) as client:
        result = client.get("/api/metamodel/relation-types", headers=VIEWER)
        assert result.status_code == 200, result.text
        assert len(result.json()) == 3
        assert client.post("/api/metamodel/relation-types", headers=ADMIN, json={}).status_code in (403, 405)
        assert client.get("/api/metamodel/relation-types").status_code == 401


def test_relation_writes_validate_types_and_direction_without_changing_existing_rows():
    with TestClient(app) as client:
        source, target = _object(client), _object(client)
        non_system = _object(client, "vm")
        url = "/api/relations"
        base = {"source_id": source, "target_id": target, "kind": "integrates_with"}

        unknown = client.post(url, json={**base, "kind": "arbitrary_fact"}, headers=ADMIN)
        assert unknown.status_code == 422
        deprecated = client.post(url, json={**base, "kind": "data_flow"}, headers=ADMIN)
        assert deprecated.status_code == 422
        invalid_source = client.post(
            url, json={**base, "source_id": non_system}, headers=ADMIN,
        )
        assert invalid_source.status_code == 422
        invalid_target = client.post(
            url, json={**base, "target_id": non_system}, headers=ADMIN,
        )
        assert invalid_target.status_code == 422
        assert client.post(url, json={**base, "target_id": source}, headers=ADMIN).status_code == 422
        assert client.post(url, json={**base, "target_id": str(uuid4())}, headers=ADMIN).status_code == 422

        created = client.post(url, json=base, headers=ADMIN)
        assert created.status_code == 201, created.text
        assert created.json()["id"]
        duplicate = client.post(url, json=base, headers=ADMIN)
        assert duplicate.status_code == 409, duplicate.text

        # Directed relations are not silently made symmetric.
        reverse = client.post(url, json={**base, "source_id": target, "target_id": source}, headers=ADMIN)
        assert reverse.status_code == 201, reverse.text

        rows = client.get(url, headers=VIEWER)
        assert rows.status_code == 200
        assert sum(row["source_id"] == source and row["target_id"] == target
                   and row["kind"] == "integrates_with" for row in rows.json()) == 1
        assert client.post(url, json=base, headers=VIEWER).status_code == 403


def test_readonly_mapping_report_distinguishes_duplicates_legacy_and_bad_endpoint_types():
    a, b, vm = str(uuid4()), str(uuid4()), str(uuid4())
    rows = [
        {"id": "1", "kind": "integrates_with", "source_id": a, "target_id": b},
        {"id": "2", "kind": "integrates_with", "source_id": a, "target_id": b},
        {"id": "3", "kind": "data_flow", "source_id": b, "target_id": a},
        {"id": "4", "kind": "depends_on", "source_id": vm, "target_id": b},
        {"id": "5", "kind": "unsupported", "source_id": a, "target_id": str(uuid4())},
    ]
    report = summarize_legacy_relations({a: "system", b: "system", vm: "vm"}, rows)
    assert report["read_only"] is True
    assert report["objects"] == 3 and report["relations"] == 5
    assert report["issues"] == {
        "unknown_kind": 1, "invalid_endpoints": 1,
        "orphan_endpoints": 1, "duplicate_direction": 1,
        "deprecated_data_flow": 1,
    }
    assert len(report["samples"]) == 4
    assert report["object_kinds"] == {"system": 2, "vm": 1}


def test_readonly_relation_audit_uses_system_reader_permission():
    with TestClient(app) as client:
        result = client.get("/api/metamodel/relation-audit", headers=VIEWER)
        assert result.status_code == 200, result.text
        assert result.json()["read_only"] is True
        assert "issues" in result.json() and "relation_kinds" in result.json()
        assert client.get("/api/metamodel/relation-audit").status_code == 401
        assert client.put("/api/metamodel/relation-audit", headers=ADMIN, json={}).status_code in (403, 405)
