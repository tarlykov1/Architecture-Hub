"""Persist diagram positions and directional data-flow metadata in CI's temporary DB."""
from uuid import uuid4
from fastapi.testclient import TestClient
from app.main import app

ADMIN = {"Authorization": "Bearer ci-admin-token-123456789012345678901234"}


def test_diagram_positions_and_directional_flow_round_trip():
    marker = f"CI-FLOW-{uuid4().hex[:12]}"
    with TestClient(app) as client:
        system_ids, infra_ids, flow_id = [], [], None
        try:
            for suffix in ("SOURCE", "TARGET"):
                response = client.post("/api/objects", headers=ADMIN, json={
                    "kind": "system", "name": f"{marker}-{suffix}",
                    "description": "Isolated flow test", "attributes": {"test_marker": marker},
                })
                assert response.status_code == 201, response.text
                system_ids.append(response.json()["id"])
            for system_id, suffix in zip(system_ids, ("SOURCE", "TARGET")):
                response = client.post("/api/infra", headers=ADMIN, json={
                    "system_id": system_id, "kind": "vm", "name": f"{marker}-{suffix}",
                    "details": {"test_marker": marker},
                })
                assert response.status_code == 201, response.text
                infra_ids.append(response.json()["id"])

            positions = {system_ids[0]: {"x": 140, "y": -80}, system_ids[1]: {"x": 480, "y": 210}}
            response = client.post("/api/diagrams", headers=ADMIN, json={
                "name": marker, "positions": positions,
            })
            assert response.status_code == 201, response.text
            diagram_id = response.json()["id"]
            moved = {system_ids[0]: {"x": -120, "y": 75}, system_ids[1]: {"x": 600, "y": 300}}
            response = client.put(f"/api/diagrams/{diagram_id}", headers=ADMIN, json={
                "name": f"{marker}-UPDATED", "positions": moved,
            })
            assert response.status_code == 200, response.text
            diagrams = client.get("/api/diagrams", headers=ADMIN)
            assert diagrams.status_code == 200
            saved = next(d for d in diagrams.json() if d["id"] == diagram_id)
            assert saved["positions"] == moved
            assert saved["name"] == f"{marker}-UPDATED"

            source, target = infra_ids
            flow_payload = {
                "source_id": source, "target_id": target, "name": marker,
                "data_description": "Employee attributes", "protocol": "HTTPS",
                "port": "443", "security": "encrypted", "schedule": "hourly",
                "verification": "draft",
            }
            response = client.post("/api/flows", headers=ADMIN, json=flow_payload)
            assert response.status_code == 201, response.text
            flow_id = response.json()["id"]
            assert response.json()["source_id"] == source
            assert response.json()["target_id"] == target
            updated = {**flow_payload, "data_description": "Subset of employee attributes", "schedule": "daily"}
            response = client.put(f"/api/flows/{flow_id}", headers=ADMIN, json=updated)
            assert response.status_code == 200, response.text
            flows = client.get("/api/flows", headers=ADMIN)
            assert flows.status_code == 200
            saved_flow = next(f for f in flows.json() if f["id"] == flow_id)
            for key, expected in updated.items():
                assert saved_flow[key] == expected, key
            invalid = client.post("/api/flows", headers=ADMIN, json={**updated, "target_id": source})
            assert invalid.status_code == 422
        finally:
            if flow_id:
                assert client.delete(f"/api/flows/{flow_id}", headers=ADMIN).status_code in (204, 404)
            for item_id in reversed(infra_ids):
                assert client.delete(f"/api/infra/{item_id}", headers=ADMIN).status_code in (204, 404)
            for system_id in reversed(system_ids):
                assert client.delete(f"/api/objects/{system_id}", headers=ADMIN).status_code in (204, 404)
