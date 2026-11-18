"""QA-WORK security inventory and approved passive monitoring evidence."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from fastapi.testclient import TestClient
from app.main import app

ADMIN={"Authorization":"Bearer ci-admin-token-123456789012345678901234"}
VIEWER={"Authorization":"Bearer ci-viewer-token-123456789012345678901234"}
BASE="http://127.0.0.1:8001"


def create(client,path,data,headers=ADMIN,status=201):
    response=client.post(path,headers=headers,json=data)
    assert response.status_code==status,response.text
    return response.json()


def test_versions_per_environment_component_monitoring_scope_and_append_only_evidence():
    with TestClient(app) as client:
        suffix=str(uuid4())
        system=create(client,"/api/objects",{"kind":"system","name":"QA-WORK-stack-"+suffix})
        other=create(client,"/api/objects",{"kind":"system","name":"QA-WORK-other-"+suffix})
        component=create(client,"/api/infra",{"system_id":system["id"],
                          "kind":"vm","name":"QA-WORK-prod-vm-"+suffix})
        foreign_component=create(client,"/api/infra",{"system_id":other["id"],
                                  "kind":"vm","name":"QA-WORK-foreign-vm-"+suffix})
        root="/api/systems/"+system["id"]
        data={"name":"QA-WORK-Python","category":"runtime","version":"3.11.9",
              "environment":"prod","component_id":component["id"],
              "verification":"assumed","source":"Owner report",
              "lifecycle":"current"}
        tech=create(client,root+"/technologies",data)
        techid=tech["id"]
        assert tech["component_id"]==component["id"]
        assert tech["verification"]=="assumed"
        rejected=client.post(root+"/technologies",headers=ADMIN,json=data)
        assert rejected.status_code==409,rejected.text
        foreign=client.post(root+"/technologies",headers=ADMIN,json={**data,"component_id":foreign_component["id"]})
        assert foreign.status_code==422,foreign.text
        stage=create(client,root+"/technologies",{**data,"environment":"test","version":"3.12.0"})
        assert stage["id"]!=techid
        assert stage["version"]=="3.12.0"
        inventory=client.get("/api/technology-inventory?q=QA-WORK-Python&environment=prod",
                             headers=VIEWER)
        assert inventory.status_code==200,inventory.text
        assert inventory.json()["count"]==1
        assert inventory.json()["items"][0]["system_id"]==system["id"]
        assert inventory.json()["items"][0]["component_id"]==component["id"]
        assert inventory.json()["items"][0]["version"]=="3.11.9"
        records=client.get(root+"/technologies",headers=VIEWER)
        assert records.status_code==200,records.text
        assert {row["id"] for row in records.json()}=={techid,stage["id"]}
        assert client.post(root+"/technologies",headers=VIEWER,json=data).status_code==403
        source=create(client,"/api/monitoring/sources",{
            "name":"QA-WORK-Zabbix-"+suffix,"kind":"zabbix",
            "base_url":"https://monitoring.example.invalid","enabled":True})
        # A dashboard merely visualizing the VM does not authorize observations.
        visualization=create(client,"/api/monitoring/links",{
            "source_id":source["id"],"target_type":"component",
            "target_id":component["id"],"relation_kind":"visualizes",
            "dashboard_url":"https://monitoring.example.invalid/dashboard"})
        now=datetime.now(timezone.utc).isoformat()
        report={"source_id":source["id"],"observed_at":now,
                "observed_version":"3.11.8","reachable":True,
                "notes":"QA-WORK telemetry from monitoring adapter"}
        path=root+"/technologies/"+techid+"/observations"
        unauthorized=client.post(path,headers=ADMIN,json=report)
        assert unauthorized.status_code==422,unauthorized.text
        link=create(client,"/api/monitoring/links",{
            "source_id":source["id"],"target_type":"component",
            "target_id":component["id"],"relation_kind":"monitors",
            "external_ref":"qa-host-id"})
        observed=create(client,path,report)
        # Evidence keeps attribution: monitoring source must not disappear
        # while its reported checks remain in architecture history.
        assert client.delete("/api/monitoring/sources/"+source["id"],headers=ADMIN).status_code==409
        assert observed["system_id"]==system["id"]
        assert observed["technology_id"]==techid
        assert observed["observed_version"]=="3.11.8"
        assert observed["reachable"] is True
        assert client.post(path,headers=VIEWER,json=report).status_code==403
        assert client.post("/api/systems/"+other["id"]+"/technologies/"+techid+"/observations",
                           headers=ADMIN,json=report).status_code==404
        results=client.get(root+"/technology-observations",headers=VIEWER)
        assert results.status_code==200
        assert [item["id"] for item in results.json()]==[observed["id"]]
        assert client.get("/api/systems/"+other["id"]+"/technology-observations",headers=ADMIN).json()==[]
        inventory=client.get("/api/technology-inventory?q=QA-WORK-Python&environment=prod",
                             headers=VIEWER)
        assert inventory.status_code==200,inventory.text
        item=inventory.json()["items"][0]
        assert item["observed_version"]=="3.11.8"
        assert item["version_mismatch"] is True
        assert item["reachable"] is True
        assert item["observation_source"]==source["name"]
        invalid=[
            {**report,"observed_at":datetime.now().replace(microsecond=0).isoformat()},
            {**report,"observed_at":(datetime.now(timezone.utc)+timedelta(hours=3)).isoformat()},
            {**report,"observed_version":"","reachable":None},
        ]
        for bad in invalid:
            result=client.post(path,headers=ADMIN,json=bad)
            assert result.status_code==422,result.text
        # Changing the declared version does not mutate historical observations.
        edited=client.put(root+"/technologies/"+techid,headers=ADMIN,json={
            **data,"version":"3.11.10","verification":"verified"
        })
        assert edited.status_code==200,edited.text
        assert edited.json()["id"]==techid
        assert edited.json()["version"]=="3.11.10"
        assert client.get(root+"/technology-observations",headers=ADMIN).json()[0]["observed_version"]=="3.11.8"
        blocked=client.delete("/api/infra/"+component["id"],headers=ADMIN)
        assert blocked.status_code==409,blocked.text
        assert client.delete(root+"/technologies/"+techid,headers=ADMIN).status_code==204
        assert client.get(root+"/technology-observations",headers=ADMIN).json()==[]
        # The other environment/version remains intact.
        remaining=client.get(root+"/technologies",headers=ADMIN).json()
        assert len(remaining)==1 and remaining[0]["id"]==stage["id"]
        assert client.get("/api/monitoring/sources",headers=ADMIN).status_code==200


def test_disabled_or_unlinked_monitor_cannot_report_version():
    with TestClient(app) as client:
        suffix=str(uuid4())
        system=create(client,"/api/objects",{"kind":"system","name":"QA-WORK-stack-scope-"+suffix})
        base="/api/systems/"+system["id"]
        tech=create(client,base+"/technologies",{"name":"QA-WORK-PostgreSQL",
            "category":"database","version":"16.2","environment":"prod"})
        source=create(client,"/api/monitoring/sources",{
            "name":"QA-WORK-disabled-"+suffix,"kind":"prometheus",
            "base_url":"https://telemetry.example.invalid","enabled":False})
        create(client,"/api/monitoring/links",{"source_id":source["id"],
              "target_type":"system","target_id":system["id"],"relation_kind":"monitors"})
        report={"source_id":source["id"],"observed_at":datetime.now(timezone.utc).isoformat(),
                "reachable":False}
        res=client.post(base+"/technologies/"+tech["id"]+"/observations",headers=ADMIN,json=report)
        assert res.status_code==422,res.text
        assert client.get(base+"/technology-observations",headers=ADMIN).json()==[]
