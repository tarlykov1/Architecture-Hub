"""AH-04 – canonical business processes, ordered steps and reference safety."""
from uuid import uuid4

from fastapi.testclient import TestClient
from app.main import app

ADMIN={"Authorization":"Bearer ci-admin-token-123456789012345678901234"}


def create(client,endpoint,data):
    response=client.post(endpoint,json=data,headers=ADMIN)
    assert response.status_code==201,(endpoint,response.status_code,response.text)
    return response.json()


def fixture(client):
    suffix=uuid4().hex[:9]
    category=create(client,"/api/business/categories",{"name":"QA-WORK-BP-Area-"+suffix})
    process=create(client,"/api/business/processes",{
        "category_id":category["id"],"name":"QA-WORK-BP-Receive-"+suffix,
        "description":"Existing canonical process"
    })
    other=create(client,"/api/business/processes",{
        "category_id":category["id"],"name":"QA-WORK-BP-Check-"+suffix
    })
    is_a=create(client,"/api/objects",{"kind":"system","name":"QA-WORK-BP-System-A-"+suffix})
    is_b=create(client,"/api/objects",{"kind":"system","name":"QA-WORK-BP-System-B-"+suffix})
    component_a=create(client,"/api/infra",{
        "system_id":is_a["id"],"kind":"vm","name":"QA-WORK-BP-VM-A-"+suffix
    })
    component_b=create(client,"/api/infra",{
        "system_id":is_b["id"],"kind":"vm","name":"QA-WORK-BP-VM-B-"+suffix
    })
    flow=create(client,"/api/flows",{
        "source_id":component_a["id"],"target_id":component_b["id"],
        "name":"QA-WORK-BP-Exchange-"+suffix,"protocol":"HTTPS","port":"443"
    })
    attribute=create(client,"/api/data-attributes",{
        "code":"qa.work.bp."+suffix,"name":"Employee reference identifier",
        "sensitivity":"internal"
    })
    return category,process,other,is_a,is_b,component_a,component_b,flow,attribute


def test_process_passport_steps_ref_canonical_objects_and_survive_reload():
    with TestClient(app) as c:
        category,process,other,is_a,is_b,vm_a,vm_b,flow,attribute=fixture(c)
        endpoint="/api/business/process-passports/"+process["id"]
        empty=c.get(endpoint,headers=ADMIN)
        assert empty.status_code==200,empty.text
        assert empty.json()["revision"]==0
        assert empty.json()["steps"]==[]
        step_id=str(uuid4())
        payload={
            "expected_revision":0,
            "parent_id":other["id"],
            "owner":"HR process owner",
            "participants":"HR department, IT services",
            "status":"active",
            "result":"Employee account provisioned",
            "steps":[{
                "id":step_id,"name":"Transfer employee record",
                "description":"Validated reference data only",
                "responsible":"HR officer","input":"Approved record",
                "output":"Provisioning request",
                "system_id":is_a["id"],"component_id":vm_a["id"],
                "flow_id":flow["id"],"attribute_ids":[attribute["id"]]
            }]
        }
        saved=c.put(endpoint,json=payload,headers=ADMIN)
        assert saved.status_code==200,saved.text
        data=saved.json()
        assert data["process_id"]==process["id"]
        assert data["revision"]==1
        assert data["parent_id"]==other["id"]
        assert data["status"]=="active"
        assert data["steps"][0]["id"]==step_id
        assert data["steps"][0]["flow_id"]==flow["id"]
        assert data["steps"][0]["attribute_ids"]==[attribute["id"]]
        assert c.get(endpoint,headers=ADMIN).json()==data
        # The old process and IS registries still own the same canonical IDs.
        assert any(row["id"]==process["id"] for row in c.get("/api/business/processes",headers=ADMIN).json())
        assert any(row["id"]==flow["id"] for row in c.get("/api/flows",headers=ADMIN).json())
        assert any(row["id"]==vm_a["id"] for row in c.get("/api/infra",headers=ADMIN).json())
        assert not any(row["name"]==process["name"] for row in c.get("/api/objects",headers=ADMIN).json())
        assert any(row["process_id"]==process["id"] for row in c.get("/api/business/process-passports",headers=ADMIN).json())

        # No silent orphaning of objects referenced from a process step.
        assert c.delete("/api/flows/"+flow["id"],headers=ADMIN).status_code==409
        assert c.delete("/api/infra/"+vm_a["id"],headers=ADMIN).status_code==409
        assert c.delete("/api/objects/"+is_a["id"],headers=ADMIN).status_code==409
        after=c.put(endpoint,json={
            **payload,"expected_revision":1,
            "owner":"Process improvement team","steps":[]
        },headers=ADMIN)
        assert after.status_code==200,after.text
        assert after.json()["revision"]==2
        assert after.json()["steps"]==[]
        assert c.delete("/api/flows/"+flow["id"],headers=ADMIN).status_code==204
        assert c.get(endpoint,headers=ADMIN).json()["owner"]=="Process improvement team"


def test_hierarchy_cycles_categories_and_invalid_links_are_rejected():
    with TestClient(app) as c:
        category,process,other,is_a,is_b,vm_a,vm_b,flow,attr=fixture(c)
        process_url="/api/business/process-passports/"+process["id"]
        other_url="/api/business/process-passports/"+other["id"]
        parent=c.put(process_url,json={"expected_revision":0,"parent_id":other["id"]},headers=ADMIN)
        assert parent.status_code==200,parent.text
        for invalid in [
            {"expected_revision":0,"parent_id":other["id"]}, # self parent
            {"expected_revision":0,"parent_id":process["id"]}, # cycle
        ]:
            bad=c.put(other_url,json=invalid,headers=ADMIN)
            assert bad.status_code==422,bad.text
        foreign_category=create(c,"/api/business/categories",{"name":"QA-WORK-OtherArea-"+uuid4().hex[:9]})
        foreign=create(c,"/api/business/processes",{
            "category_id":foreign_category["id"],"name":"QA-WORK-OtherProcess-"+uuid4().hex[:8]
        })
        assert c.put(process_url,json={"expected_revision":1,"parent_id":foreign["id"]},headers=ADMIN).status_code==422
        for step in [
            {"name":"Unknown flow","flow_id":str(uuid4())},
            {"name":"Unknown attribute","attribute_ids":[str(uuid4())]},
            {"name":"Wrong system","system_id":is_b["id"],"component_id":vm_a["id"]},
            {"name":"Missing IS","component_id":vm_a["id"]},
            {"name":"Unknown IS","system_id":str(uuid4())},
            {"name":"Unknown component","system_id":is_a["id"],"component_id":str(uuid4())},
            {"name":"Duplicate attributes","attribute_ids":[attr["id"],attr["id"]]},
        ]:
            invalid=c.put(process_url,json={
                "expected_revision":1,"steps":[step]
            },headers=ADMIN)
            assert invalid.status_code==422,(step,invalid.status_code,invalid.text)
        assert c.get(process_url,headers=ADMIN).json()["revision"]==1


def test_reordering_preserves_step_ids_and_prevents_stale_editor():
    with TestClient(app) as c:
        _,process,_,is_a,_,_,_,_,_=fixture(c)
        endpoint="/api/business/process-passports/"+process["id"]
        step1={"id":str(uuid4()),"name":"Register","system_id":is_a["id"]}
        step2={"id":str(uuid4()),"name":"Verify"}
        initial=c.put(endpoint,json={
            "expected_revision":0,"steps":[step1,step2]
        },headers=ADMIN)
        assert initial.status_code==200,initial.text
        swapped=c.put(endpoint,json={
            "expected_revision":1,"steps":[step2,step1]
        },headers=ADMIN)
        assert swapped.status_code==200,swapped.text
        ids=[x["id"] for x in swapped.json()["steps"]]
        assert ids==[step2["id"],step1["id"]]
        assert [x["position"] for x in swapped.json()["steps"]]==[0,1]
        bad=c.put(endpoint,json={
            "expected_revision":1,"steps":[step1]
        },headers=ADMIN)
        assert bad.status_code==409,bad.text
        assert [x["id"] for x in c.get(endpoint,headers=ADMIN).json()["steps"]]==ids
        assert c.get("/api/board/history",headers=ADMIN).status_code in (200,404)



def test_changing_category_requires_detaching_process_hierarchy():
    with TestClient(app) as c:
        category,child,parent,is_a,_,_,_,_,_=fixture(c)
        # The canonical process records remain the only process identities.
        result=c.put("/api/business/process-passports/"+child["id"],headers=ADMIN,json={
            "expected_revision":0,"parent_id":parent["id"]
        })
        assert result.status_code==200,result.text
        other_category=create(c,"/api/business/categories",{
            "name":"QA-WORK-BP-Relocation-"+uuid4().hex[:9]
        })
        def move(process):
            return c.put("/api/business/processes/"+process["id"],headers=ADMIN,json={
                "category_id":other_category["id"],"name":process["name"],"description":""
            })
        # Changing either end would violate the parent/category invariant.
        assert move(child).status_code==409
        assert move(parent).status_code==409
        assert any(p["id"]==child["id"] and p["category_id"]==category["id"]
                   for p in c.get("/api/business/processes",headers=ADMIN).json())
        detached=c.put("/api/business/process-passports/"+child["id"],headers=ADMIN,json={
            "expected_revision":1,"parent_id":None
        })
        assert detached.status_code==200,detached.text
        assert move(child).status_code==200
