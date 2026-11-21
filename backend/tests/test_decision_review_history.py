"""Review history stays visible after revising a proposed architecture."""
from uuid import uuid4
from fastapi.testclient import TestClient
from app.main import app, SessionLocal, TechnicalDecisionReview

ADMIN = {"Authorization": "Bearer ci-admin-token-123456789012345678901234"}


def test_previous_review_is_visible_but_cannot_approve_new_version():
    with TestClient(app) as client:
        system = client.post("/api/objects", headers=ADMIN, json={
            "kind": "system", "name": "QA-WORK-Decision-" + uuid4().hex[:8]
        })
        assert system.status_code == 201, system.text
        row = client.post("/api/technical-decisions", headers=ADMIN, json={
            "title": "QA-WORK-Proposal", "system_id": system.json()["id"]
        })
        assert row.status_code == 201, row.text
        entry = row.json()
        url = "/api/technical-decisions/" + entry["id"]
        vm = {"id": str(uuid4()), "system_id": system.json()["id"],
              "kind": "vm", "name": "QA-WORK-Proposed", "x": 50, "y": 70}
        draft = client.put(url, headers=ADMIN, json={
            "expected_revision": entry["revision"], "title": "QA-WORK-Proposal",
            "proposed_vms": [vm], "required_services": ["engineer", "security"]
        })
        assert draft.status_code == 200, draft.text
        sent = client.post(url + "/submit", headers=ADMIN, json={
            "expected_revision": draft.json()["revision"]
        })
        assert sent.status_code == 200, sent.text
        revision = sent.json()["revision"]
        with SessionLocal() as db:
            db.add(TechnicalDecisionReview(
                decision_id=__import__("uuid").UUID(entry["id"]),
                revision=revision, service="engineer",
                actor="qa-synthetic-reviewer", verdict="approved",
                note="QA-WORK reviewed"
            ))
            db.commit()
        checked = client.get(url, headers=ADMIN)
        assert checked.status_code == 200
        assert len(checked.json()["approvals"]) == 1
        assert len(checked.json()["review_history"]) == 1
        assert checked.json()["review_history"][0]["revision"] == revision
        returned = client.post(url + "/withdraw", headers=ADMIN, json={
            "expected_revision": revision
        })
        assert returned.status_code == 200
        new_draft = client.put(url, headers=ADMIN, json={
            "expected_revision": returned.json()["revision"],
            "title": "QA-WORK-Proposal", "proposed_vms": [vm],
            "required_services": ["engineer", "security"]
        })
        assert new_draft.status_code == 200
        again = client.post(url + "/submit", headers=ADMIN, json={
            "expected_revision": new_draft.json()["revision"]
        })
        assert again.status_code == 200
        assert again.json()["approvals"] == []
        assert len(again.json()["review_history"]) == 1
