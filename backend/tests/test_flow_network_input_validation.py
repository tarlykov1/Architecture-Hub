"""Regressions for browser audit AH-QA-01, AH-QA-02 and AH-QA-17.

Only new writes are validated: reading historical records must not be broken
merely because a previously recorded port or address is invalid.
"""
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app, _require_valid_flow_port, _require_valid_interface_ip

ADMIN = {"Authorization": "Bearer ci-admin-token-123456789012345678901234"}


def _create(client, path, value):
    response = client.post(path, headers=ADMIN, json=value)
    assert response.status_code == 201, response.text
    return response.json()


def test_flow_rename_preserves_unset_protocol_port_and_security():
    with TestClient(app) as client:
        system = _create(client, "/api/objects", {
            "kind": "system", "name": "QA-WORK-VALIDATION-" + uuid4().hex[:8]
        })
        source = _create(client, "/api/infra", {
            "system_id": system["id"], "name": "QA-WORK-source", "kind": "vm"
        })
        target = _create(client, "/api/infra", {
            "system_id": system["id"], "name": "QA-WORK-target", "kind": "vm"
        })
        payload = {
            "source_id": source["id"], "target_id": target["id"],
            "name": "QA-WORK-unknown-technical-fields",
            "protocol": "", "port": "", "security": "unknown",
        }
        created = _create(client, "/api/flows", payload)
        assert (created["protocol"], created["port"], created["security"]) == ("", "", "unknown")
        renamed = client.put("/api/flows/" + created["id"], headers=ADMIN, json={
            **payload, "name": "QA-WORK-renamed-only",
        })
        assert renamed.status_code == 200, renamed.text
        assert (renamed.json()["protocol"], renamed.json()["port"], renamed.json()["security"]) == ("", "", "unknown")

        for port in ["-1", "0", "65536", "70000", "abc", "443,70000", "1-65535"]:
            bad = client.put("/api/flows/" + created["id"], headers=ADMIN,
                             json={**payload, "name": "QA-WORK-invalid-write", "port": port})
            assert bad.status_code == 422, (port, bad.text)
        stored = client.get("/api/flows", headers=ADMIN)
        assert stored.status_code == 200, stored.text
        row = next(flow for flow in stored.json() if flow["id"] == created["id"])
        assert row["name"] == "QA-WORK-renamed-only"
        assert row["port"] == ""
        for port in ["1", "443", "65535"]:
            ok = client.put("/api/flows/" + created["id"], headers=ADMIN,
                            json={**payload, "port": port})
            assert ok.status_code == 200, (port, ok.text)


def test_network_interface_ip_rejects_invalid_but_keeps_valid_and_empty():
    with TestClient(app) as client:
        system = _create(client, "/api/objects", {
            "kind": "system", "name": "QA-WORK-NIC-" + uuid4().hex[:8]
        })
        vm = _create(client, "/api/infra", {
            "system_id": system["id"], "name": "QA-WORK-NIC-VM", "kind": "vm"
        })
        payload = {"item_id": vm["id"], "name": "eth0", "ip_address": ""}
        nic = _create(client, "/api/network-interfaces", payload)
        for ip in ["999.999.999.999", "192.0.2.999", "not-an-ip", "192.0.2.1/33",
                   "2001:db8::1/129", "192.0.2.1,192.0.2.2"]:
            response = client.put("/api/network-interfaces/" + nic["id"],
                                  headers=ADMIN, json={**payload, "ip_address": ip})
            assert response.status_code == 422, (ip, response.text)
            create = client.post("/api/network-interfaces", headers=ADMIN,
                                 json={**payload, "name": "QA-WORK-invalid", "ip_address": ip})
            assert create.status_code == 422, (ip, create.text)

        for ip in ["192.0.2.19", "192.0.2.19/24", "2001:db8::19", "2001:db8::19/64", ""]:
            response = client.put("/api/network-interfaces/" + nic["id"],
                                  headers=ADMIN, json={**payload, "ip_address": ip})
            assert response.status_code == 200, (ip, response.text)
            assert response.json()["ip_address"] == ip
        records = client.get("/api/network-interfaces", headers=ADMIN)
        assert records.status_code == 200
        assert next(n for n in records.json() if n["id"] == nic["id"])["ip_address"] == ""


def test_board_flow_input_uses_same_port_validation():
    from fastapi import HTTPException
    for port in ("70000", "-1", "65536", "abc"):
        try:
            _require_valid_flow_port(port)
        except HTTPException as exc:
            assert exc.status_code == 422
        else:
            raise AssertionError("Invalid board flow port accepted: " + port)
    for port in ("", "1", "443", "65535"):
        _require_valid_flow_port(port)
    for address in ("", "192.0.2.19", "2001:db8::1/64"):
        _require_valid_interface_ip(address)
