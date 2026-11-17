"""QA-WORK regression for IS contracts, licences, renewal dates and SLA.

All writes use the isolated CI database. No production records are modified.
"""
from uuid import uuid4
from fastapi.testclient import TestClient
from app.main import app

ADMIN={"Authorization":"Bearer ci-admin-token-123456789012345678901234"}
VIEWER={"Authorization":"Bearer ci-viewer-token-123456789012345678901234"}


def create_system(client, suffix):
    result=client.post("/api/objects",headers=ADMIN,json={
        "kind":"system","name":"QA-WORK-commercial-"+suffix,
        "attributes":{"architecture_owner":"QA"}
    })
    assert result.status_code==201,result.text
    return result.json()["id"]


def contract_payload(suffix):
    return {
        "title":"QA-WORK-Поддержка "+suffix,"contract_number":"QA-WORK-2026-13",
        "agreement_type":"purchase","vendor":"Вендор QA","contractor":"Подрядчик QA",
        "start_date":"2026-01-01","end_date":"2027-12-31",
        "renewal_date":"2027-11-01","automatic_renewal":False,
        "notice_days":45,"support_level":"Premium","support_window":"24x7",
        "sla_response_hours":2.5,"sla_availability_percent":99.9,
        "support_contact":"support@example.invalid","notes":"Без лицензионных ключей"
    }


def test_contract_and_two_licenses_survive_updates_without_changing_object_identity():
    with TestClient(app) as client:
        suffix=str(uuid4())
        system=create_system(client,suffix)
        other=create_system(client,"other-"+suffix)
        url="/api/systems/"+system
        payload=contract_payload(suffix)
        response=client.post(url+"/contracts",headers=ADMIN,json=payload)
        assert response.status_code==201,response.text
        contract=response.json()
        contract_id=contract["id"]
        assert contract["system_id"]==system
        assert contract["renewal_date"]=="2027-11-01"
        assert contract["sla_response_hours"]==2.5
        assert client.get(url+"/contracts",headers=VIEWER).status_code==200
        assert client.post(url+"/contracts",headers=VIEWER,json=payload).status_code==403
        assert client.put(url+"/contracts/"+contract_id,headers=VIEWER,json=payload).status_code==403
        licenses=[]
        for amount,kind in [(1300,"concurrent"),(3000,"named")]:
            data={"contract_id":contract_id,"product":"QA-WORK-лицензия "+kind+" "+suffix,
                  "quantity":amount,"license_type":kind,"valid_from":"2026-01-01",
                  "valid_until":"2027-12-31","notes":"Количественный учёт"}
            response=client.post(url+"/licenses",headers=ADMIN,json=data)
            assert response.status_code==201,response.text
            licenses.append(response.json())
        assert len(client.get(url+"/licenses",headers=VIEWER).json())==2
        wrong=client.post("/api/systems/"+other+"/licenses",headers=ADMIN,json={
            "contract_id":contract_id,"product":"QA-WORK-cross-system","license_type":"named","quantity":1})
        assert wrong.status_code==422,wrong.text
        assert client.get("/api/systems/"+other+"/contracts",headers=ADMIN).json()==[]
        changed=client.put(url+"/contracts/"+contract_id,headers=ADMIN,json={
            **payload,"support_window":"8x5","renewal_date":"2027-10-15",
            "sla_response_hours":4.0
        })
        assert changed.status_code==200,changed.text
        assert changed.json()["id"]==contract_id
        assert changed.json()["support_window"]=="8x5"
        old_license=licenses[0]
        updated=client.put(url+"/licenses/"+old_license["id"],headers=ADMIN,json={
            "product":old_license["product"],"contract_id":contract_id,
            "license_type":"concurrent","quantity":1500,
            "valid_from":"2026-01-01","valid_until":"2028-01-01"
        })
        assert updated.status_code==200,updated.text
        assert updated.json()["id"]==old_license["id"]
        assert updated.json()["quantity"]==1500
        blocked=client.delete(url+"/contracts/"+contract_id,headers=ADMIN)
        assert blocked.status_code==409,blocked.text
        # Never cascade-delete financial/licensing metadata with the IS.
        protected=client.delete("/api/objects/"+system,headers=ADMIN)
        assert protected.status_code==409,protected.text
        for lic in licenses:
            assert client.delete(url+"/licenses/"+lic["id"],headers=ADMIN).status_code==204
        assert client.delete(url+"/contracts/"+contract_id,headers=ADMIN).status_code==204
        assert client.get(url+"/contracts",headers=ADMIN).json()==[]
        assert client.get(url+"/licenses",headers=ADMIN).json()==[]
        objects=client.get("/api/objects",headers=ADMIN).json()
        matches=[obj for obj in objects if obj["id"]==system]
        assert len(matches)==1
        assert matches[0]["attributes"]["architecture_owner"]=="QA"


def test_invalid_dates_quantities_sla_and_non_system_parent():
    with TestClient(app) as client:
        suffix=str(uuid4())
        system=create_system(client,suffix)
        url="/api/systems/"+system
        base=contract_payload(suffix)
        invalid=[
            {**base,"start_date":"2027-12-31","end_date":"2026-01-01"},
            {**base,"sla_availability_percent":101},
            {**base,"sla_response_hours":-2},
            {**base,"notice_days":-1},
        ]
        for payload in invalid:
            result=client.post(url+"/contracts",headers=ADMIN,json=payload)
            assert result.status_code==422,result.text
        for quantity in [0,-2]:
            result=client.post(url+"/licenses",headers=ADMIN,json={
                "product":"QA-WORK-invalid","quantity":quantity,"license_type":"named"})
            assert result.status_code==422,result.text
        wrong_dates=client.post(url+"/licenses",headers=ADMIN,json={
            "product":"QA-WORK-wrong dates","quantity":1,"license_type":"named",
            "valid_from":"2027-09-01","valid_until":"2026-02-01"})
        assert wrong_dates.status_code==422
        legacy=client.post("/api/objects",headers=ADMIN,json={
            "kind":"process","name":"QA-WORK-legacy process "+suffix
        })
        assert legacy.status_code==201,legacy.text
        not_system=client.post("/api/systems/"+legacy.json()["id"]+"/contracts",headers=ADMIN,json=base)
        assert not_system.status_code==404
        assert client.get(url+"/contracts",headers=ADMIN).json()==[]
