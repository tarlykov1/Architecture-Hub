"""Atomic multi-region editing: stale data never overwrites another author."""
from uuid import uuid4

from fastapi.testclient import TestClient
from app.main import app

ADMIN = {"Authorization": "Bearer ci-admin-token-123456789012345678901234"}
VIEWER = {"Authorization": "Bearer ci-viewer-token-123456789012345678901234"}
ROOT = "/api/diagrams/layer-regions"


def _category(client: TestClient) -> str:
    response = client.post("/api/business/categories", headers=ADMIN, json={
        "name": "QA-WORK-Revision category " + str(uuid4()),
    })
    assert response.status_code == 201, response.text
    return "business:" + response.json()["id"]


def _region(group_key: str, *, x: float, revision: int | None) -> dict:
    return {
        "group_key": group_key,
        "expected_revision": revision,
        "x": x, "y": 45, "width": 460, "height": 270,
        "color": "#2563eb", "opacity": .26, "members": [],
    }


def _all(client: TestClient):
    response = client.get(ROOT, headers=VIEWER)
    assert response.status_code == 200, response.text
    return {row["group_key"]: row for row in response.json()}


def test_region_batch_is_all_or_nothing_and_rejects_stale_revision():
    with TestClient(app) as client:
        left, right = _category(client), _category(client)
        initial = client.put(ROOT, headers=ADMIN, json={
            "regions": [_region(left, x=100, revision=None),
                        _region(right, x=200, revision=None)],
        })
        assert initial.status_code == 200, initial.text
        assert {row["revision"] for row in initial.json()} == {1}
        assert _all(client)[left]["x"] == 100

        # Another user saves a new revision of the second region.
        other = client.put(ROOT + "/" + right, headers=ADMIN, json={
            **_region(right, x=222, revision=1),
        })
        assert other.status_code == 200, other.text
        assert other.json()["revision"] == 2

        # The first region is valid, but the second has a stale revision.
        # Neither update may be persisted or audited.
        before = client.get("/api/board/audit?limit=200", headers=ADMIN).json()
        stale = client.put(ROOT, headers=ADMIN, json={
            "regions": [_region(left, x=111, revision=1),
                        _region(right, x=333, revision=1)],
        })
        assert stale.status_code == 409, stale.text
        rows = _all(client)
        assert (rows[left]["x"], rows[left]["revision"]) == (100, 1)
        assert (rows[right]["x"], rows[right]["revision"]) == (222, 2)
        assert len(client.get("/api/board/audit?limit=200", headers=ADMIN).json()) == len(before)

        # With fresh versions, both are committed in one transaction.
        retry = client.put(ROOT, headers=ADMIN, json={
            "regions": [_region(left, x=111, revision=1),
                        _region(right, x=333, revision=2)],
        })
        assert retry.status_code == 200, retry.text
        assert [(r["x"], r["revision"]) for r in retry.json()] == [(111, 2), (333, 3)]
        rows = _all(client)
        assert (rows[left]["revision"], rows[right]["revision"]) == (2, 3)

        # Reusing either earlier version fails, including old client payloads
        # which omit the expected_revision field.
        old_client = _region(left, x=999, revision=None)
        old_client.pop("expected_revision")
        assert client.put(ROOT + "/" + left, headers=ADMIN, json=old_client).status_code == 409
        assert _all(client)[left]["x"] == 111


def test_batch_rejects_duplicate_keys_and_invalid_members_without_partial_write():
    with TestClient(app) as client:
        left, right = _category(client), _category(client)
        duplicate = client.put(ROOT, headers=ADMIN, json={
            "regions": [_region(left, x=1, revision=None),
                        _region(left, x=2, revision=None)],
        })
        assert duplicate.status_code == 422
        assert left not in _all(client)

        bad_member = client.put(ROOT, headers=ADMIN, json={
            "regions": [_region(left, x=111, revision=None), {
                **_region(right, x=222, revision=None), "members": [str(uuid4())],
            }],
        })
        assert bad_member.status_code == 422
        assert left not in _all(client) and right not in _all(client)
        assert client.put(ROOT, headers=VIEWER, json={"regions": [
            _region(left, x=10, revision=None),
        ]}).status_code == 403


def test_existing_regions_are_versioned_without_altering_visual_membership():
    with TestClient(app) as client:
        key = _category(client)
        first = client.put(ROOT + "/" + key, headers=ADMIN, json={
            **_region(key, x=170, revision=None),
            "color": "#1188aa", "opacity": .42,
        })
        assert first.status_code == 200, first.text
        assert first.json()["revision"] == 1
        second = client.put(ROOT + "/" + key, headers=ADMIN, json={
            **_region(key, x=180, revision=1),
            "color": "#1188aa", "opacity": .42,
        })
        assert second.status_code == 200, second.text
        assert second.json()["revision"] == 2
        assert _all(client)[key]["color"] == "#1188aa"
        assert _all(client)[key]["opacity"] == .42
