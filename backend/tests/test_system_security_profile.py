"""Security classification is optional metadata on an information system passport.

No personal records are stored; missing metadata remains unknown.
"""
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app

ADMIN = {"Authorization": "Bearer ci-admin-token-123456789012345678901234"}
VIEWER = {"Authorization": "Bearer ci-viewer-token-123456789012345678901234"}


def _create(client, attributes=None, kind="system"):
    payload = {
        "kind": kind, "name": "QA-WORK-PDn-" + uuid4().hex[:8],
        "attributes": attributes or {},
    }
    response = client.post("/api/objects", headers=ADMIN, json=payload)
    return response, payload


def test_legacy_systems_remain_unknown_without_security_profile():
    with TestClient(app) as client:
        response, _ = _create(client, {"kis_passport": {"Владелец ИС": "ИТ"}})
        assert response.status_code == 201, response.text
        system = response.json()
        assert "security_profile" not in system["attributes"]
        assert system["attributes"]["kis_passport"]["Владелец ИС"] == "ИТ"
        read = client.get("/api/objects", headers=ADMIN)
        assert read.status_code == 200
        stored = next(item for item in read.json() if item["id"] == system["id"])
        assert "security_profile" not in stored["attributes"]


def test_security_metadata_round_trip_and_existing_attributes_preserved():
    profile = {
        "personal_data": "yes",
        "pdn_level": "UZ2",
        "gis_class": "not_applicable",
        "internal_class": "Внутренний B",
        "categories": ["general", "special"],
        "verification": "verified",
        "notes": "Основание: реестр ИБ, без персональных записей",
    }
    with TestClient(app) as client:
        created, payload = _create(client, {
            "kis_passport": {"Владелец ИС": "ИБ"},
            "unrelated_field": {"name": "retained"},
            "security_profile": profile,
        })
        assert created.status_code == 201, created.text
        system = created.json()
        assert system["attributes"]["security_profile"] == profile
        assert client.put("/api/objects/" + system["id"], headers=VIEWER,
                          json={**payload, "name": payload["name"] + " edit"}).status_code == 403

        changed_profile = {**profile, "personal_data": "no", "pdn_level": "", "categories": [],
                           "verification": "unverified"}
        updated = client.put("/api/objects/" + system["id"], headers=ADMIN, json={
            **payload, "attributes": {
                **system["attributes"], "security_profile": changed_profile
            },
        })
        assert updated.status_code == 200, updated.text
        attrs = updated.json()["attributes"]
        assert attrs["security_profile"] == changed_profile
        assert attrs["unrelated_field"] == {"name": "retained"}
        assert attrs["kis_passport"]["Владелец ИС"] == "ИБ"

        reread = client.get("/api/objects", headers=VIEWER)
        assert reread.status_code == 200
        assert next(item for item in reread.json() if item["id"] == system["id"])["attributes"]["security_profile"] == changed_profile


def test_invalid_security_metadata_rejected_on_create_and_update():
    valid_profile = {
        "personal_data": "yes", "pdn_level": "", "gis_class": "",
        "internal_class": "", "categories": [], "verification": "unverified",
        "notes": "",
    }
    invalid = [
        {**valid_profile, "personal_data": "no", "pdn_level": "UZ1"},
        {**valid_profile, "personal_data": "unknown", "categories": ["general"]},
        {**valid_profile, "personal_data": "no", "categories": ["general"]},
        {**valid_profile, "pdn_level": "UZ5"},
        {**valid_profile, "gis_class": "K4"},
        {**valid_profile, "personal_data": "perhaps"},
        {**valid_profile, "categories": ["general", "general"]},
        {**valid_profile, "categories": ["real_name"]},
        {**valid_profile, "notes": "x" * 1001},
        {**valid_profile, "unexpected": "data"},
    ]
    with TestClient(app) as client:
        created, payload = _create(client, {"security_profile": valid_profile})
        assert created.status_code == 201, created.text
        system_id = created.json()["id"]
        for index, profile in enumerate(invalid):
            response, _ = _create(client, {"security_profile": profile})
            assert response.status_code == 422, (index, response.text)
            update = client.put("/api/objects/" + system_id, headers=ADMIN,
                                json={**payload, "attributes": {"security_profile": profile}})
            assert update.status_code == 422, (index, update.text)
        others, _ = _create(client, {"security_profile": valid_profile}, kind="process")
        assert others.status_code == 422, others.text
        current = next(row for row in client.get("/api/objects", headers=ADMIN).json()
                       if row["id"] == system_id)
        assert current["attributes"]["security_profile"] == valid_profile
