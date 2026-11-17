"""Logo uploads belong to an IS and must never permit external or active media."""
from uuid import uuid4
from fastapi.testclient import TestClient
from app.main import app

ADMIN = {"Authorization": "Bearer ci-admin-token-123456789012345678901234"}
PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlXcDwAAAAASUVORK5CYII="


def test_logo_is_a_safe_attribute_of_one_system_and_survives_update():
    with TestClient(app) as client:
        suffix = str(uuid4())
        payload = {"kind": "system", "name": "QA-WORK-Logo-" + suffix,
                   "attributes": {"environment": "TEST", "system_logo": PNG}}
        created = client.post("/api/objects", headers=ADMIN, json=payload)
        assert created.status_code == 201, created.text
        sys_id = created.json()["id"]
        assert created.json()["attributes"]["system_logo"] == PNG
        assert any(o["id"] == sys_id and o["attributes"]["system_logo"] == PNG
                   for o in client.get("/api/objects", headers=ADMIN).json())
        changed = client.put("/api/objects/" + sys_id, headers=ADMIN,
                             json={**payload, "name": "QA-WORK-New title " + suffix})
        assert changed.status_code == 200, changed.text
        assert changed.json()["id"] == sys_id
        assert changed.json()["attributes"]["environment"] == "TEST"
        assert changed.json()["attributes"]["system_logo"] == PNG
        removed = client.put("/api/objects/" + sys_id, headers=ADMIN,
                             json={**payload, "attributes": {"environment": "TEST"}})
        assert removed.status_code == 200, removed.text
        assert removed.json()["id"] == sys_id
        assert "system_logo" not in removed.json()["attributes"]


def test_logo_rejects_svg_url_wrong_bytes_oversize_and_non_system_object():
    from base64 import b64encode
    with TestClient(app) as client:
        suffix = str(uuid4())
        base = {"kind": "system", "name": "QA-WORK-Bad-logo-" + suffix}
        invalid = [
            "https://unknown.example/logo.png",
            "data:image/svg+xml;base64," + b64encode(b"<svg/onload=alert(1)>").decode(),
            "data:image/png;base64," + b64encode(b"not a PNG").decode(),
            "data:image/png;base64," + b64encode(b"\\x89PNG\\r\\n\\x1a\\n" + b"0" * 110_000).decode(),
            "data:image/png;base64,not!base64",
        ]
        for value in invalid:
            response = client.post("/api/objects", headers=ADMIN,
                                   json={**base, "attributes": {"system_logo": value}})
            assert response.status_code == 422, (value[:30], response.text)
        other = client.post("/api/objects", headers=ADMIN,
                            json={"kind": "process", "name": base["name"] + "-legacy",
                                  "attributes": {"system_logo": PNG}})
        assert other.status_code == 422, other.text
