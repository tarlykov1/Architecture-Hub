"""The flow passport owns an easy attribute workflow; catalog stays reusable."""
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app

ADMIN={"Authorization":"Bearer ci-admin-token-123456789012345678901234"}
VIEWER={"Authorization":"Bearer ci-viewer-token-123456789012345678901234"}


def _make(client, route, payload):
    response=client.post(route,headers=ADMIN,json=payload)
    assert response.status_code==201,response.text
    return response.json()


def _map(client, flow_id):
    response=client.get("/api/flows/"+flow_id+"/data-map",headers=ADMIN)
    assert response.status_code==200,response.text
    return response.json()


def test_create_and_attach_in_one_operation_then_unlink_without_destroying_catalog_definition():
    with TestClient(app) as client:
        system=_make(client,"/api/objects",{
            "kind":"system","name":"QA-WORK-ATTR-"+uuid4().hex[:10]})["id"]
        source=_make(client,"/api/infra",{"system_id":system,"name":"Source","kind":"vm"})["id"]
        target=_make(client,"/api/infra",{"system_id":system,"name":"Target","kind":"vm"})["id"]
        flow=_make(client,"/api/flows",{
            "source_id":source,"target_id":target,"name":"QA-WORK attribute flow"})["id"]
        revision=_map(client,flow)["revision"]

        result=client.post("/api/flows/"+flow+"/attributes",headers=ADMIN,json={
            "expected_revision":revision,
            "new_attribute":{"name":"Табельный номер "+uuid4().hex[:6],
                             "data_type":"string","sensitivity":"personal"}
        })
        assert result.status_code==201,result.text
        item=result.json()
        assert item["created_definition"] is True
        assert item["attribute_name"].startswith("Табельный номер")
        attributes=client.get("/api/data-attributes",headers=ADMIN).json()
        definition=next(a for a in attributes if a["id"]==item["attribute_id"])
        assert definition["name"]==item["attribute_name"]
        assert definition["sensitivity"]=="personal"
        assert definition["code"].startswith("attr_")
        map_after=_map(client,flow)
        assert map_after["attributes"][0]["name"]==item["attribute_name"]
        assert map_after["attributes"][0]["id"]==item["id"]

        again=client.post("/api/flows/"+flow+"/attributes",headers=ADMIN,json={
            "expected_revision":map_after["revision"],"attribute_id":item["attribute_id"]
        })
        assert again.status_code==409,again.text

        stale=client.delete("/api/flows/"+flow+"/attributes/"+item["id"],
                            params={"expected_revision":revision},headers=ADMIN)
        assert stale.status_code==409,stale.text
        assert len(_map(client,flow)["attributes"])==1
        viewer=client.delete("/api/flows/"+flow+"/attributes/"+item["id"],
                             params={"expected_revision":map_after["revision"]},headers=VIEWER)
        assert viewer.status_code==403,viewer.text
        deleted=client.delete("/api/flows/"+flow+"/attributes/"+item["id"],
                              params={"expected_revision":map_after["revision"]},headers=ADMIN)
        assert deleted.status_code==204,deleted.text
        assert _map(client,flow)["attributes"]==[]
        assert any(a["id"]==item["attribute_id"] for a in client.get("/api/data-attributes",headers=ADMIN).json())

        reused=client.post("/api/flows/"+flow+"/attributes",headers=ADMIN,json={
            "expected_revision":_map(client,flow)["revision"],"attribute_id":item["attribute_id"]
        })
        assert reused.status_code==201,reused.text
        assert reused.json()["created_definition"] is False
        assert len(_map(client,flow)["attributes"])==1


def test_quick_attribute_revisions_and_cross_flow_deletion_are_isolated():
    with TestClient(app) as client:
        system=_make(client,"/api/objects",{
            "kind":"system","name":"QA-WORK-FLOW-ATTR-"+uuid4().hex[:10]})["id"]
        source=_make(client,"/api/infra",{"system_id":system,"name":"Source","kind":"vm"})["id"]
        target=_make(client,"/api/infra",{"system_id":system,"name":"Target","kind":"vm"})["id"]
        first=_make(client,"/api/flows",{
            "source_id":source,"target_id":target,"name":"Source to Target A"})["id"]
        second=_make(client,"/api/flows",{
            "source_id":source,"target_id":target,"name":"Source to Target B"})["id"]
        attr=_make(client,"/api/data-attributes",{
            "code":"QA-WORK_ATTR_"+uuid4().hex[:12],"name":"Код подразделения",
            "sensitivity":"internal"})["id"]
        row=_make(client,"/api/flows/"+first+"/attributes",{
            "expected_revision":_map(client,first)["revision"],"attribute_id":attr
        })
        second_row=_make(client,"/api/flows/"+second+"/attributes",{
            "expected_revision":_map(client,second)["revision"],"attribute_id":attr
        })
        assert row["id"]!=second_row["id"]
        illegal=client.delete("/api/flows/"+second+"/attributes/"+row["id"],headers=ADMIN,
            params={"expected_revision":_map(client,second)["revision"]})
        assert illegal.status_code==404,illegal.text
        assert len(_map(client,first)["attributes"])==1
        assert len(_map(client,second)["attributes"])==1

        invalid_both=client.post("/api/flows/"+first+"/attributes",headers=ADMIN,json={
            "expected_revision":_map(client,first)["revision"],
            "attribute_id":attr,"new_attribute":{"name":"Дубликат"}
        })
        assert invalid_both.status_code==422,invalid_both.text
        invalid_none=client.post("/api/flows/"+first+"/attributes",headers=ADMIN,json={
            "expected_revision":_map(client,first)["revision"]
        })
        assert invalid_none.status_code==422,invalid_none.text

        dup_name=client.post("/api/flows/"+first+"/attributes",headers=ADMIN,json={
            "expected_revision":_map(client,first)["revision"],
            "new_attribute":{"name":"код подразделения"}
        })
        assert dup_name.status_code==409,dup_name.text
        assert len(_map(client,first)["attributes"])==1
