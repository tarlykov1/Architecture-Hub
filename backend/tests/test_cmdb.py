"""CMDB projection: nodes and explicit potential impact, no duplicate inventory records."""
from uuid import uuid4
from fastapi.testclient import TestClient
from app.main import app

ADMIN = {"Authorization": "Bearer ci-admin-token-123456789012345678901234"}
VIEWER = {"Authorization": "Bearer ci-viewer-token-123456789012345678901234"}


def create(client, path: str, data: dict):
    result = client.post(path, json=data, headers=ADMIN)
    assert result.status_code == 201, result.text
    return result.json()


def test_cmdb_graph_preserves_ci_identity_and_typed_relations():
    with TestClient(app) as client:
        token = str(uuid4())[:8]
        source = create(client, "/api/objects", {"name": "Source CMDB " + token, "kind": "system"})
        consumer = create(client, "/api/objects", {"name": "Consumer CMDB " + token, "kind": "system"})
        vm_a = create(client, "/api/infra", {
            "system_id": source["id"], "kind": "vm", "name": "Source VM " + token})
        vm_b = create(client, "/api/infra", {
            "system_id": consumer["id"], "kind": "database", "name": "Consumer DB " + token})
        flow = create(client, "/api/flows", {
            "source_id": vm_a["id"], "target_id": vm_b["id"],
            "name": "Sync " + token, "protocol": "HTTPS", "port": "443"})

        graph = client.get("/api/cmdb/graph", headers=VIEWER)
        assert graph.status_code == 200, graph.text
        payload = graph.json()
        node_index = {node["id"]: node for node in payload["nodes"]}
        assert node_index["system:" + source["id"]]["ci_class"] == "application"
        assert node_index["component:" + vm_b["id"]]["ci_class"] == "database"
        assert node_index["component:" + vm_a["id"]]["owner"] is None
        relevant = [edge for edge in payload["edges"] if edge["id"] == "flow:" + flow["id"]]
        assert len(relevant) == 1
        assert relevant[0]["source"] == "component:" + vm_a["id"]
        assert relevant[0]["target"] == "component:" + vm_b["id"]
        assert relevant[0]["verified"] is False
        assert relevant[0]["origin"] == "data_flow"

        affected = client.get("/api/cmdb/impact", headers=VIEWER,
                              params={"ci_id": "component:" + vm_a["id"], "depth": 3})
        assert affected.status_code == 200, affected.text
        records = {a["node"]["id"]: a for a in affected.json()["affected"]}
        assert "component:" + vm_b["id"] in records
        assert records["component:" + vm_b["id"]]["relations"] == ["supplies_data_to"]
        assert records["component:" + vm_b["id"]]["confidence"] == "requires_verification"
        assert "system:" + consumer["id"] in records
        assert affected.json()["disclaimer"].startswith("Потенциальное влияние")

        reverse = client.get("/api/cmdb/impact", headers=VIEWER,
                             params={"ci_id": "component:" + vm_b["id"], "depth": 3}).json()
        assert "component:" + vm_a["id"] not in {r["node"]["id"] for r in reverse["affected"]}


def test_cmdb_generic_integration_is_not_a_failure_dependency():
    with TestClient(app) as client:
        a = create(client, "/api/objects", {"name": "CMDB A " + str(uuid4()), "kind": "system"})
        b = create(client, "/api/objects", {"name": "CMDB B " + str(uuid4()), "kind": "system"})
        create(client, "/api/relations", {
            "source_id": a["id"], "target_id": b["id"], "kind": "integrates_with"})
        result = client.get("/api/cmdb/impact", headers=ADMIN,
                            params={"ci_id": "system:" + a["id"], "depth": 1})
        assert result.status_code == 200
        assert "system:" + b["id"] not in {v["node"]["id"] for v in result.json()["affected"]}


def test_cmdb_business_process_impact_and_validation():
    with TestClient(app) as client:
        token = str(uuid4())[:8]
        system = create(client, "/api/objects", {"name": "CMDB business " + token})
        cat = create(client, "/api/business/categories", {"name": "CMDB " + str(uuid4())})
        process = create(client, "/api/business/processes", {
            "name": "Business process " + token, "category_id": cat["id"]})
        create(client, "/api/business/system-links", {
            "system_id": system["id"], "process_id": process["id"], "role": "supporting"})
        response = client.get("/api/cmdb/impact", headers=ADMIN,
                              params={"ci_id": "system:" + system["id"], "depth": 1})
        assert response.status_code == 200
        assert "process:" + process["id"] in {a["node"]["id"] for a in response.json()["affected"]}
        assert client.get("/api/cmdb/impact", headers=ADMIN,
                          params={"ci_id": "system:" + str(uuid4())}).status_code == 404
        assert client.get("/api/cmdb/impact", headers=ADMIN,
                          params={"ci_id": "system:" + system["id"], "depth": 7}).status_code == 422
        assert client.get("/api/cmdb/impact").status_code == 401


def test_cmdb_graph_cycle_and_stale_data_handled():
    from app.cmdb import potential_impact
    graph = {
        "nodes": [
            {"id": "component:a", "name": "A"},
            {"id": "component:b", "name": "B"},
            {"id": "component:c", "name": "C"},
        ],
        "edges": [
            {"id": "a-b", "source": "component:a", "target": "component:b",
             "kind": "supplies_data_to", "verified": True, "impact_candidate": True},
            {"id": "b-a", "source": "component:b", "target": "component:a",
             "kind": "supplies_data_to", "verified": False, "impact_candidate": True},
            {"id": "b-c", "source": "component:b", "target": "component:c",
             "kind": "supplies_data_to", "verified": False, "impact_candidate": True},
            {"id": "c-a", "source": "component:c", "target": "component:a",
             "kind": "relates_to", "verified": False, "impact_candidate": False},
        ],
    }
    affected = potential_impact(graph, "component:a", 5)
    assert affected["count"] == 2
    records = {row["node"]["id"]: row for row in affected["affected"]}
    assert records["component:b"]["confidence"] == "known_relation"
    assert records["component:c"]["confidence"] == "requires_verification"
    assert records["component:c"]["path"] == ["component:a", "component:b", "component:c"]
