"""Exchange scenarios reference canonical flows; never duplicate their traffic data."""
from uuid import uuid4

from fastapi.testclient import TestClient
from app.main import app

ADMIN = "ci-admin-token-123456789012345678901234"
VIEWER = "ci-viewer-token-123456789012345678901234"


def create(client, path, body):
    r = client.post(path, json=body)
    assert r.status_code == 201, (path, r.status_code, r.text)
    return r.json()


def context(client):
    suffix = uuid4().hex[:10]
    a = create(client, "/api/objects", {"kind": "system", "name": "QA-WORK-ScenarioSource-" + suffix})
    b = create(client, "/api/objects", {"kind": "system", "name": "QA-WORK-ScenarioTarget-" + suffix})
    source = create(client, "/api/infra", {"system_id": a["id"], "kind": "vm", "name": "QA-WORK-Src"})
    target = create(client, "/api/infra", {"system_id": b["id"], "kind": "vm", "name": "QA-WORK-Dst"})
    sent = create(client, "/api/flows", {
        "source_id": source["id"], "target_id": target["id"], "name": "QA-WORK-Send-" + suffix,
        "protocol": "HTTPS", "port": "443",
    })
    received = create(client, "/api/flows", {
        "source_id": target["id"], "target_id": source["id"], "name": "QA-WORK-Reply-" + suffix,
        "protocol": "HTTPS", "port": "8443",
    })
    category = create(client, "/api/business/categories", {"name": "QA-WORK-Category-" + suffix})
    process = create(client, "/api/business/processes", {
        "name": "QA-WORK-Process-" + suffix, "category_id": category["id"]
    })
    return suffix, sent, received, process


def test_scenario_reuses_real_flows_with_repeat_steps_and_business_process(monkeypatch):
    monkeypatch.setenv("ARCH_HUB_ACCESS_KEYS", '{"%s":"admin","%s":"viewer"}' % (ADMIN, VIEWER))
    with TestClient(app, headers={"Authorization": "Bearer " + ADMIN}) as c:
        suffix, flow_a, flow_b, process = context(c)
        step_a, step_b, step_c = str(uuid4()), str(uuid4()), str(uuid4())
        base = {
            "name": "QA-WORK-Sequence-" + suffix,
            "description": "Приём сотрудника",
            "process_id": process["id"],
            "steps": [
                {"id": step_a, "flow_id": flow_a["id"], "note": "Проверка идентификатора"},
                {"id": step_b, "flow_id": flow_b["id"], "reply": True},
                {"id": step_c, "flow_id": flow_a["id"], "note": "Повторная передача"},
            ]
        }
        created = create(c, "/api/flow-scenarios", base)
        assert created["revision"] == 1
        assert created["process_id"] == process["id"]
        assert [s["flow_id"] for s in created["steps"]] == [flow_a["id"], flow_b["id"], flow_a["id"]]
        assert [s["position"] for s in created["steps"]] == [0, 1, 2]
        assert created["steps"][1]["reply"] is True
        assert [s["id"] for s in created["steps"]] == [step_a, step_b, step_c]
        url = "/api/flow-scenarios/" + created["id"]
        assert c.get(url).json()["steps"] == created["steps"]
        assert any(s["id"] == created["id"] for s in c.get("/api/flow-scenarios").json())

        # A scenario does not create or mutate any live flow.
        assert c.get("/api/flows/" + flow_a["id"]).status_code == 405 or                any(row["id"] == flow_a["id"] and row["port"] == "443" for row in c.get("/api/flows").json())
        assert any(row["id"] == flow_b["id"] and row["port"] == "8443" for row in c.get("/api/flows").json())
        blocked = c.delete("/api/flows/" + flow_a["id"])
        assert blocked.status_code == 409, blocked.text

        revised_steps = [
            {k: v for k, v in step.items() if k != "position"}
            for step in reversed(created["steps"])
        ]
        revised_steps[0]["note"] = "Новый первый шаг"
        edit = c.put(url, json={**base, "steps": revised_steps, "expected_revision": 1})
        assert edit.status_code == 200, edit.text
        new = edit.json()
        assert new["revision"] == 2
        assert [step["id"] for step in new["steps"]] == [step_c, step_b, step_a]
        assert new["steps"][0]["note"] == "Новый первый шаг"

        stale = c.put(url, json={**base, "expected_revision": 1})
        assert stale.status_code == 409
        assert c.get(url).json()["revision"] == 2

        removal = c.put(url, json={**base, "steps": [], "expected_revision": 2})
        assert removal.status_code == 200, removal.text
        assert c.delete("/api/flows/" + flow_a["id"]).status_code == 204
        assert c.delete(url).status_code == 204
        assert c.get(url).status_code == 404


def test_scenario_validates_missing_flow_process_duplicates_and_permissions(monkeypatch):
    monkeypatch.setenv("ARCH_HUB_ACCESS_KEYS", '{"%s":"admin","%s":"viewer"}' % (ADMIN, VIEWER))
    with TestClient(app, headers={"Authorization": "Bearer " + ADMIN}) as c:
        suffix, flow, _, _ = context(c)
        name = "QA-WORK-Validation-" + suffix
        good = {"name": name, "steps": [{"flow_id": flow["id"]}]}
        first = create(c, "/api/flow-scenarios", good)
        assert c.post("/api/flow-scenarios", json=good).status_code == 409
        invalid = [
            {"name": "QA-WORK-Missing-" + suffix, "steps": [{"flow_id": str(uuid4())}]},
            {"name": "QA-WORK-WrongBP-" + suffix, "process_id": str(uuid4())},
            {"name": "QA-WORK-DuplicateSteps-" + suffix, "steps": [
                {"id": str(uuid4()), "flow_id": flow["id"]},
            ] * 2},
            {"name": "  "},
        ]
        for payload in invalid:
            assert c.post("/api/flow-scenarios", json=payload).status_code == 422
        with TestClient(app, headers={"Authorization": "Bearer " + VIEWER}) as viewer:
            assert viewer.get("/api/flow-scenarios").status_code == 403
            assert viewer.post("/api/flow-scenarios", json={
                "name": "QA-WORK-Forbidden-" + suffix
            }).status_code == 403
        assert c.get("/api/flow-scenarios/" + first["id"]).status_code == 200
