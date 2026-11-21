from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app


def test_withdraw_preserves_proposal_and_protects_review_versions(monkeypatch):
    admin = "ci-admin-token-123456789012345678901234"
    viewer = "ci-viewer-token-123456789012345678901234"
    monkeypatch.setenv("ARCH_HUB_ACCESS_KEYS", '{"%s":"admin","%s":"viewer"}' % (admin, viewer))
    with TestClient(app, headers={"Authorization": "Bearer " + admin}) as client:
        title = "QA-WORK-Review-" + uuid4().hex[:8]
        system = client.post("/api/objects", json={"kind": "system", "name": title}).json()["id"]
        base = "/api/technical-decisions"
        row = client.post(base, json={"system_id": system, "title": title}).json()
        url = base + "/" + row["id"]
        vm = {"id": str(uuid4()), "system_id": system, "name": "QA-WORK-VM",
              "kind": "vm", "x": 300, "y": 0}
        draft = client.put(url, json={"expected_revision": row["revision"], "title": title,
                                       "proposed_vms": [vm]}).json()
        review = client.post(url + "/submit", json={"expected_revision": draft["revision"]}).json()
        assert client.post(url + "/withdraw", json={"expected_revision": draft["revision"]}).status_code == 409
        assert client.post(url + "/withdraw", json={"expected_revision": review["revision"]},
                           headers={"Authorization": "Bearer " + viewer}).status_code == 403
        result = client.post(url + "/withdraw", json={"expected_revision": review["revision"]})
        assert result.status_code == 200, result.text
        withdrawn = result.json()
        assert withdrawn["status"] == "draft"
        assert withdrawn["revision"] == review["revision"] + 1
        assert withdrawn["proposed_vms"] == [vm]
        assert not withdrawn["approvals"]
        assert client.post(url + "/withdraw", json={"expected_revision": withdrawn["revision"]}).status_code == 409
        assert client.post(url + "/submit", json={"expected_revision": withdrawn["revision"]}).json()["status"] == "in_review"
