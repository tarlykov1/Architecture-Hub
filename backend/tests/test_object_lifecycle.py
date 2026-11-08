"""Isolated CI database regression: create, edit, relate, reload, delete."""
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app

ADMIN = {"Authorization": "Bearer ci-admin-token-123456789012345678901234"}
VIEWER = {"Authorization": "Bearer ci-viewer-token-123456789012345678901234"}


def test_object_lifecycle_and_relation_cleanup():
    prefix = f"CI-LIFECYCLE-{uuid4().hex[:12]}"
    created = []
    with TestClient(app) as client:
        try:
            for suffix in ("SOURCE", "TARGET"):
                response = client.post("/api/objects", headers=ADMIN, json={
                    "kind": "system", "name": f"{prefix}-{suffix}",
                    "description": "Isolated automated regression",
                    "status": "draft", "attributes": {"test_marker": prefix},
                })
                assert response.status_code == 201, response.text
                created.append(response.json()["id"])

            source, target = created
            response = client.put(f"/api/objects/{source}", headers=ADMIN, json={
                "kind": "system", "name": f"{prefix}-UPDATED",
                "description": "Edited in automated regression",
                "status": "active", "attributes": {"test_marker": prefix, "revision": 2},
            })
            assert response.status_code == 200, response.text
            assert response.json()["name"] == f"{prefix}-UPDATED"

            listing = client.get("/api/objects", headers=ADMIN)
            assert listing.status_code == 200
            persisted = next(item for item in listing.json() if item["id"] == source)
            assert persisted["description"] == "Edited in automated regression"
            assert persisted["attributes"]["revision"] == 2

            relation = client.post("/api/relations", headers=ADMIN, json={
                "source_id": source, "target_id": target,
                "kind": "integrates_with", "description": prefix,
            })
            assert relation.status_code == 201, relation.text
            relation_id = relation.json()["id"]
            relations = client.get("/api/relations", headers=ADMIN)
            assert relations.status_code == 200
            assert any(item["id"] == relation_id for item in relations.json())

            assert client.put(f"/api/objects/{source}", headers=VIEWER, json={
                "kind": "system", "name": "FORBIDDEN", "description": "",
            }).status_code == 403
            assert client.delete(f"/api/objects/{target}", headers=ADMIN).status_code == 204
            created.remove(target)
            relations = client.get("/api/relations", headers=ADMIN)
            assert not any(item["id"] == relation_id for item in relations.json())
        finally:
            for object_id in created:
                response = client.delete(f"/api/objects/{object_id}", headers=ADMIN)
                assert response.status_code in (204, 404), response.text

        remaining = client.get("/api/objects", headers=ADMIN)
        assert remaining.status_code == 200
        assert not any(item.get("attributes", {}).get("test_marker") == prefix for item in remaining.json())
