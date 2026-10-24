"""Network assignment and flow editing regression checks."""
from uuid import uuid4
from fastapi.testclient import TestClient
from app.main import app
ADMIN={"Authorization":"Bearer ci-admin-token-123456789012345678901234"}
VIEWER={"Authorization":"Bearer ci-viewer-token-123456789012345678901234"}

def test_network_interface_edit_and_flow_update():
    with TestClient(app) as c:
        system=c.post("/api/objects",headers=ADMIN,json={"name":"Network test "+uuid4().hex[:8],"kind":"system"})
        assert system.status_code==201,system.text
        system_id=system.json()["id"]
        components=[]
        for name in ["API","Database"]:
            res=c.post("/api/infra",headers=ADMIN,json={"system_id":system_id,"name":name,"kind":"service"})
            assert res.status_code==201,res.text
            components.append(res.json()["id"])
        network_ids={}
        for kind in ("vrf","vlan","zone"):
            r=c.post("/api/networks",headers=ADMIN,json={"name":"CI-"+kind+"-"+uuid4().hex[:8],"kind":kind})
            assert r.status_code==201,r.text
            network_ids[kind]=r.json()["id"]
        nic={"item_id":components[0],"name":"eth0","ip_address":"","vrf_id":network_ids["vrf"],"vlan_id":None,"zone_id":None}
        assert c.post("/api/network-interfaces",headers=VIEWER,json=nic).status_code==403
        result=c.post("/api/network-interfaces",headers=ADMIN,json=nic)
        assert result.status_code==201,result.text
        nic_id=result.json()["id"]
        nic.update({"vlan_id":network_ids["vlan"],"zone_id":network_ids["zone"],"ip_address":"192.0.2.10"})
        update=c.put("/api/network-interfaces/"+nic_id,headers=ADMIN,json=nic)
        assert update.status_code==200,update.text
        assert update.json()["vlan_id"]==network_ids["vlan"]
        assert update.json()["zone_id"]==network_ids["zone"]
        assert update.json()["ip_address"]=="192.0.2.10"
        invalid={**nic,"vlan_id":network_ids["vrf"]}
        assert c.put("/api/network-interfaces/"+nic_id,headers=ADMIN,json=invalid).status_code==422
        assert c.get("/api/network-interfaces",headers=ADMIN).status_code==200
        flow={"source_id":components[0],"target_id":components[1],"name":"API to DB","protocol":"TCP","port":"5432","security":"TLS","verification":"draft"}
        created=c.post("/api/flows",headers=ADMIN,json=flow)
        assert created.status_code==201,created.text
        flow.update({"verification":"verified","schedule":"on demand"})
        updated=c.put("/api/flows/"+created.json()["id"],headers=ADMIN,json=flow)
        assert updated.status_code==200,updated.text
        assert updated.json()["schedule"]=="on demand"
        assert updated.json()["verification"]=="verified"
        assert c.put("/api/flows/"+created.json()["id"],headers=VIEWER,json=flow).status_code==403

def test_network_kind_change_blocked_for_used_segment():
    with TestClient(app) as c:
        obj=c.post("/api/objects",headers=ADMIN,json={"name":"Network-references "+uuid4().hex[:8],"kind":"system"}).json()
        component=c.post("/api/infra",headers=ADMIN,json={"system_id":obj["id"],"name":"VM","kind":"vm"}).json()
        network=c.post("/api/networks",headers=ADMIN,json={"name":"CI-VRF-"+uuid4().hex[:8],"kind":"vrf"}).json()
        c.post("/api/network-interfaces",headers=ADMIN,json={"item_id":component["id"],"name":"eth0","vrf_id":network["id"]})
        response=c.put("/api/networks/"+network["id"],headers=ADMIN,json={"name":network["name"],"kind":"vlan"})
        assert response.status_code==409,response.text
