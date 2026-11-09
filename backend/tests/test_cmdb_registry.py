"""Versioned CMDB metadata: lifecycle, owners, quality, verification and audit."""
from uuid import uuid4

from fastapi.testclient import TestClient
from app.main import app

ADMIN = {"Authorization": "Bearer ci-admin-token-123456789012345678901234"}
VIEWER = {"Authorization": "Bearer ci-viewer-token-123456789012345678901234"}


def create(client, path, data):
    result = client.post(path, json=data, headers=ADMIN)
    assert result.status_code == 201, result.text
    return result.json()


def metadata(rev=0, **updates):
    return {
        "expected_revision": rev, "lifecycle": "active",
        "owner": "Business owner", "technical_owner": "Platform team",
        "criticality": "high", "source_system": "architecture_hub",
        "source_record_id": "", "notes": "CI confirmed by owner",
        "reason": "Initial passport review", **updates,
    }


def test_cmdb_metadata_review_and_quality_does_not_mutate_inventory():
    with TestClient(app) as client:
        item = create(client, "/api/objects", {
            "name": "CMDB lifecycle " + str(uuid4()),
            "kind": "system", "status": "planned",
            "attributes": {"unchanged": "keep"},
        })
        key = "system:" + item["id"]
        before = client.get("/api/cmdb/records/" + key, headers=VIEWER)
        assert before.status_code == 200, before.text
        assert before.json()["revision"] == 0
        assert before.json()["verification_status"] == "unverified"

        classes = client.get("/api/cmdb/classes", headers=VIEWER)
        assert classes.status_code == 200
        assert any(c["id"] == "application" for c in classes.json()["classes"])

        initial = client.put("/api/cmdb/records/" + key,
                             json=metadata(source_system="manual-review",
                                           source_record_id="proof-" + str(uuid4())),
                             headers=ADMIN)
        assert initial.status_code == 200, initial.text
        assert initial.json()["revision"] == 1
        assert initial.json()["owner"] == "Business owner"
        assert initial.json()["lifecycle"] == "active"
        assert initial.json()["verification_status"] == "unverified"

        # Read roles can inspect metadata but cannot change them.
        assert client.put("/api/cmdb/records/" + key, headers=VIEWER,
                          json=metadata(rev=1)).status_code == 403
        assert client.post("/api/cmdb/records/" + key + "/verify", headers=VIEWER,
                           json={"expected_revision": 1, "evidence": "Checked with owner"}).status_code == 403

        verified = client.post("/api/cmdb/records/" + key + "/verify",
                               json={"expected_revision": 1,
                                     "evidence": "Confirmed from the platform inventory"},
                               headers=ADMIN)
        assert verified.status_code == 200, verified.text
        assert verified.json()["verification_status"] == "verified"
        assert verified.json()["revision"] == 2
        assert verified.json()["verified_at"]

        graph = client.get("/api/cmdb/graph", headers=VIEWER).json()
        current = next(n for n in graph["nodes"] if n["id"] == key)
        assert current["lifecycle"] == "active"
        assert current["technical_owner"] == "Platform team"
        assert current["verification_status"] == "verified"
        assert current["source"] == "manual-review"

        quality = client.get("/api/cmdb/quality", headers=VIEWER).json()
        record = next(row for row in quality["items"] if row["ci_id"] == key)
        assert record["verified"] is True
        assert record["completeness_percent"] == 100
        assert record["missing"] == []

        history = client.get("/api/cmdb/records/" + key + "/history", headers=VIEWER).json()
        assert [row["action"] for row in history[:2]] == ["verification", "update"]
        assert history[0]["before"]["revision"] == 1
        assert history[0]["after"]["revision"] == 2
        assert history[0]["actor_role"] == "admin"

        # Overlay does not mutate the canonical IS passport.
        canonical = next(o for o in client.get("/api/objects", headers=VIEWER).json()
                         if o["id"] == item["id"])
        assert canonical["status"] == "planned"
        assert canonical["attributes"]["unchanged"] == "keep"

        conflict = client.put("/api/cmdb/records/" + key,
                              headers=ADMIN, json=metadata(rev=1))
        assert conflict.status_code == 409

        edit = client.put("/api/cmdb/records/" + key,
                          headers=ADMIN, json=metadata(rev=2,
                              criticality="critical", reason="Change review approved"))
        assert edit.status_code == 200, edit.text
        assert edit.json()["revision"] == 3
        assert edit.json()["verification_status"] == "unverified"
        assert edit.json()["verified_at"] is None


def test_cmdb_lifecycle_identity_rules_and_verification_guard():
    with TestClient(app) as client:
        sys1 = create(client, "/api/objects", {"name": "CMDB source " + str(uuid4())})
        sys2 = create(client, "/api/objects", {"name": "CMDB target " + str(uuid4())})
        a, b = "system:" + sys1["id"], "system:" + sys2["id"]
        source_record_id = "naumen-" + str(uuid4())
        first = client.put("/api/cmdb/records/" + a, headers=ADMIN,
            json=metadata(source_system="Naumen", source_record_id=source_record_id))
        assert first.status_code == 200, first.text
        duplicate = client.put("/api/cmdb/records/" + b, headers=ADMIN,
            json=metadata(source_system="Naumen", source_record_id=source_record_id))
        assert duplicate.status_code == 409

        # Reject false confidence from incomplete or outdated version.
        bad_evidence = client.post("/api/cmdb/records/" + a + "/verify",
            headers=ADMIN, json={"expected_revision": 1, "evidence": "no"})
        assert bad_evidence.status_code == 422
        nonexistent = client.get("/api/cmdb/records/system:" + str(uuid4()),
                                 headers=ADMIN)
        assert nonexistent.status_code == 404

        retired = client.put("/api/cmdb/records/" + a, headers=ADMIN,
            json=metadata(rev=1, lifecycle="retired", reason="System decommissioned"))
        assert retired.status_code == 200
        reactivate = client.put("/api/cmdb/records/" + a, headers=ADMIN,
            json=metadata(rev=2, lifecycle="active", reason="Reactivation without approval"))
        assert reactivate.status_code == 422
        verify_retired = client.post("/api/cmdb/records/" + a + "/verify",
            headers=ADMIN, json={"expected_revision": 2,
                                 "evidence": "Verification should not reactivate retired"})
        assert verify_retired.status_code == 422


def test_cmdb_quality_reports_unknown_instead_of_claiming_missing_links_are_healthy():
    with TestClient(app) as client:
        system = create(client, "/api/objects", {"name": "Unreviewed " + str(uuid4())})
        component = create(client, "/api/infra", {
            "system_id": system["id"], "kind": "vm",
            "name": "Unreviewed VM " + str(uuid4())})
        key = "component:" + component["id"]
        record = client.get("/api/cmdb/records/" + key, headers=VIEWER)
        assert record.status_code == 200
        assert record.json()["lifecycle"] == "unknown"
        quality = client.get("/api/cmdb/quality?stale_days=30", headers=VIEWER)
        assert quality.status_code == 200
        row = next(x for x in quality.json()["items"] if x["ci_id"] == key)
        assert "technical_owner" in row["missing"]
        assert row["verified"] is False
        assert quality.json()["stale_days"] == 30
        assert client.get("/api/cmdb/quality?stale_days=0", headers=VIEWER).status_code == 422
        assert client.get("/api/cmdb/quality").status_code == 401
