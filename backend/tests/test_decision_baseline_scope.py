"""Guard technical decisions against changes in the architecture being reviewed.

QA-WORK data only. Published decisions remain documents; this test never
updates actual infrastructure from a proposal.
"""
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app


def _new(client, endpoint, payload):
    response = client.post(endpoint, json=payload)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _setup_flow(client):
    suffix = uuid4().hex[:10]
    system = _new(client, "/api/objects", {
        "kind": "system", "name": "QA-WORK-Decisions-" + suffix
    })
    remote_system = _new(client, "/api/objects", {
        "kind": "system", "name": "QA-WORK-Remote-" + suffix
    })
    source = _new(client, "/api/infra", {
        "kind": "vm", "name": "QA-WORK-Source-" + suffix, "system_id": system
    })
    target = _new(client, "/api/infra", {
        "kind": "vm", "name": "QA-WORK-RemoteTarget-" + suffix, "system_id": remote_system
    })
    flow = _new(client, "/api/flows", {
        "name": "QA-WORK-Exchange-" + suffix,
        "source_id": source, "target_id": target,
        "protocol": "HTTPS", "port": "443",
    })
    return suffix, system, source, target, flow


def _in_review(client, system, suffix):
    title = "QA-WORK-Proposal-" + suffix + "-" + uuid4().hex[:6]
    response = client.post("/api/technical-decisions", json={
        "title": title, "system_id": system,
    })
    assert response.status_code == 201, response.text
    row = response.json()
    url = "/api/technical-decisions/" + row["id"]
    proposal = client.put(url, json={
        "title": title,
        "expected_revision": row["revision"],
        "proposed_vms": [{
            "id": str(uuid4()), "system_id": system,
            "kind": "vm", "name": "QA-WORK-Proposed-" + uuid4().hex[:8],
            "x": 350, "y": 20,
        }],
    })
    assert proposal.status_code == 200, proposal.text
    sent = client.post(url + "/submit", json={
        "expected_revision": proposal.json()["revision"]
    })
    assert sent.status_code == 200, sent.text
    assert sent.json()["status"] == "in_review"
    assert sent.json()["base_changed"] is False
    return url


def _assert_changed(client, url):
    response = client.get(url)
    assert response.status_code == 200, response.text
    assert response.json()["base_changed"] is True
    assert response.json()["status"] == "in_review"


def test_decision_detects_nic_vlan_and_network_path_changes(monkeypatch):
    admin = "ci-admin-token-123456789012345678901234"
    monkeypatch.setenv("ARCH_HUB_ACCESS_KEYS", '{"%s":"admin"}' % admin)
    with TestClient(app, headers={"Authorization": "Bearer " + admin}) as client:
        suffix, system, source, _target, flow = _setup_flow(client)
        vlan_name = "QA-WORK-VLAN-" + suffix
        vlan = _new(client, "/api/networks", {
            "name": vlan_name, "kind": "vlan", "description": "initial",
        })
        nic = _new(client, "/api/network-interfaces", {
            "item_id": source, "name": "eth0",
            "ip_address": "192.0.2.10", "vlan_id": vlan,
        })

        # An existing NIC change must invalidate the review.
        first = _in_review(client, system, suffix)
        changed = client.put("/api/network-interfaces/" + nic, json={
            "item_id": source, "name": "eth0",
            "ip_address": "192.0.2.11", "vlan_id": vlan,
        })
        assert changed.status_code == 200, changed.text
        _assert_changed(client, first)

        # The referenced segment's own metadata matters too.
        second = _in_review(client, system, suffix)
        changed = client.put("/api/networks/" + vlan, json={
            "name": vlan_name, "kind": "vlan", "description": "updated",
        })
        assert changed.status_code == 200, changed.text
        _assert_changed(client, second)

        # Adding a declared network hop after review must also invalidate it.
        asset = _new(client, "/api/network-assets", {
            "name": "QA-WORK-Firewall-" + suffix, "kind": "firewall",
        })
        third = _in_review(client, system, suffix)
        changed = client.put("/api/flows/" + flow + "/network-path", json=[{
            "asset_id": asset, "position": 0,
            "notes": "reviewed route", "verification": "assumed",
        }])
        assert changed.status_code == 200, changed.text
        _assert_changed(client, third)

        # Referenced network asset changes also affect approved context.
        fourth = _in_review(client, system, suffix)
        changed = client.put("/api/network-assets/" + asset, json={
            "name": "QA-WORK-Firewall-" + suffix, "kind": "firewall",
            "description": "new ACL design",
        })
        assert changed.status_code == 200, changed.text
        _assert_changed(client, fourth)


def test_decision_detects_flow_attribute_and_security_drift(monkeypatch):
    admin = "ci-admin-token-123456789012345678901234"
    monkeypatch.setenv("ARCH_HUB_ACCESS_KEYS", '{"%s":"admin"}' % admin)
    with TestClient(app, headers={"Authorization": "Bearer " + admin}) as client:
        suffix, system, source, target, flow = _setup_flow(client)
        attr = _new(client, "/api/data-attributes", {
            "code": "qa.work." + suffix,
            "name": "QA-WORK-Data field", "sensitivity": "internal",
        })
        mapping = _new(client, "/api/flow-data-uses", {
            "flow_id": flow, "attribute_id": attr,
            "purpose": "QA-WORK-data exchange", "verification": "draft",
        })

        first = _in_review(client, system, suffix)
        changed = client.put("/api/data-attributes/" + attr, json={
            "code": "qa.work." + suffix,
            "name": "QA-WORK-Data field", "sensitivity": "personal",
        })
        assert changed.status_code == 200, changed.text
        _assert_changed(client, first)

        second = _in_review(client, system, suffix)
        removed = client.delete("/api/flow-data-uses/" + mapping)
        assert removed.status_code == 204, removed.text
        _assert_changed(client, second)

        third = _in_review(client, system, suffix)
        changed = client.put("/api/flows/" + flow, json={
            "source_id": source, "target_id": target,
            "name": "QA-WORK-Exchange-" + suffix,
            "protocol": "HTTPS", "port": "443",
            "security": "mutual TLS", "verification": "verified",
        })
        assert changed.status_code == 200, changed.text
        _assert_changed(client, third)


def test_unrelated_network_change_does_not_invalidate_decision(monkeypatch):
    admin = "ci-admin-token-123456789012345678901234"
    monkeypatch.setenv("ARCH_HUB_ACCESS_KEYS", '{"%s":"admin"}' % admin)
    with TestClient(app, headers={"Authorization": "Bearer " + admin}) as client:
        suffix, system, _source, _target, _flow = _setup_flow(client)
        other = _new(client, "/api/networks", {
            "name": "QA-WORK-Unrelated-" + suffix, "kind": "vrf",
        })
        url = _in_review(client, system, suffix)
        changed = client.put("/api/networks/" + other, json={
            "name": "QA-WORK-Unrelated-" + suffix, "kind": "vrf",
            "description": "irrelevant change",
        })
        assert changed.status_code == 200, changed.text
        response = client.get(url)
        assert response.status_code == 200, response.text
        assert response.json()["base_changed"] is False



def test_resaving_identical_declared_network_path_keeps_review_baseline(monkeypatch):
    """A PUT replaces hop row UUIDs, not the meaning of the network path."""
    admin = "ci-admin-token-123456789012345678901234"
    monkeypatch.setenv("ARCH_HUB_ACCESS_KEYS", '{"%s":"admin"}' % admin)
    with TestClient(app, headers={"Authorization": "Bearer " + admin}) as client:
        suffix, system, _source, _target, flow = _setup_flow(client)
        asset = _new(client, "/api/network-assets", {
            "name": "QA-WORK-FW-Baseline-" + suffix, "kind": "firewall"
        })
        path = [{
            "asset_id": asset, "position": 0,
            "verification": "assumed", "notes": "approved logical route",
        }]
        put = client.put("/api/flows/" + flow + "/network-path", json=path)
        assert put.status_code == 200, put.text
        decision = _in_review(client, system, suffix)
        same = client.put("/api/flows/" + flow + "/network-path", json=path)
        assert same.status_code == 200, same.text
        result = client.get(decision)
        assert result.status_code == 200, result.text
        assert result.json()["base_changed"] is False
        changed = client.put("/api/flows/" + flow + "/network-path", json=[
            {**path[0], "notes": "new route assumptions"}
        ])
        assert changed.status_code == 200, changed.text
        _assert_changed(client, decision)
