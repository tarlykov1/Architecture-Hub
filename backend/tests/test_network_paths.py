"""Network/security asset catalog and declared path regression tests."""
from uuid import uuid4
from fastapi.testclient import TestClient
from app.main import app

ADMIN={"Authorization":"Bearer ci-admin-token-123456789012345678901234"}
VIEWER={"Authorization":"Bearer ci-viewer-token-123456789012345678901234"}

def create(client, path, payload):
    response=client.post(path, headers=ADMIN, json=payload)
    assert response.status_code==201, response.text
    return response.json()["id"]

def test_declared_flow_network_path_is_ordered_validated_and_reusable():
    with TestClient(app) as client:
        suffix=str(uuid4())[:8]
        owner=create(client,"/api/objects",{"name":"Network test "+suffix,"kind":"system"})
        source=create(client,"/api/infra",{"name":"Source "+suffix,"kind":"vm","system_id":owner})
        target=create(client,"/api/infra",{"name":"Target "+suffix,"kind":"vm","system_id":owner})
        flow=create(client,"/api/flows",{"name":"HR data "+suffix,"source_id":source,"target_id":target})
        firewall=create(client,"/api/network-assets",{
            "name":"Firewall "+suffix,"kind":"firewall","description":"Boundary","verification":"assumed"})
        vrf=create(client,"/api/networks",{"name":"VRF-"+suffix,"kind":"vrf","verification":"verified"})
        ptaf=create(client,"/api/network-assets",{
            "name":"PTAF "+suffix,"kind":"ptaf","description":"Application protection","verification":"draft"})
        assert client.get("/api/network-assets",headers=VIEWER).status_code==403
        assert client.post("/api/network-assets",headers=VIEWER,json={"name":"Forbidden","kind":"waf"}).status_code==403
        path="/api/flows/"+flow+"/network-path"
        response=client.put(path,headers=ADMIN,json=[
            {"asset_id":firewall,"position":0,"notes":"DMZ ingress","verification":"assumed"},
            {"asset_id":ptaf,"position":1,"notes":"Protection point","verification":"draft"},
        ])
        assert response.status_code==200,response.text
        assert len(response.json())==2
        detail=client.get(path,headers=ADMIN)
        assert detail.status_code==200
        assert detail.json()["declared_only"] is True
        assert [row["kind"] for row in detail.json()["hops"]]==["firewall","ptaf"]
        assert detail.json()["hops"][0]["notes"]=="DMZ ingress"
        assert client.delete("/api/network-assets/"+firewall,headers=ADMIN).status_code==409
        invalid=client.put(path,headers=ADMIN,json=[
            {"asset_id":firewall,"position":0},
            {"asset_id":str(uuid4()),"position":1},
        ])
        assert invalid.status_code==422
        assert len(client.get(path,headers=ADMIN).json()["hops"])==2
        assert client.put(path,headers=ADMIN,json=[
            {"asset_id":firewall,"position":0},
            {"asset_id":firewall,"position":1},
        ]).status_code==422
        assert client.put(path,headers=ADMIN,json=[
            {"asset_id":firewall,"position":0},
            {"asset_id":ptaf,"position":3},
        ]).status_code==422
        assert client.put(path,headers=ADMIN,json=[
            {"asset_id":ptaf,"position":0,"verification":"verified"},
        ]).status_code==200
        assert [x["asset_id"] for x in client.get(path,headers=ADMIN).json()["hops"]]==[ptaf]
        mixed=client.put(path,headers=ADMIN,json=[
            {"segment_id":vrf,"position":0,"verification":"verified"},
            {"asset_id":ptaf,"position":1,"verification":"assumed"},
        ])
        assert mixed.status_code==200,mixed.text
        assert [x["kind"] for x in client.get(path,headers=ADMIN).json()["hops"]]==["vrf","ptaf"]
        usage=client.get("/api/network-paths/usage",headers=ADMIN)
        assert usage.status_code==200
        assert any(x["flow_id"]==flow and x["segment_id"]==vrf for x in usage.json())
        assert any(x["flow_id"]==flow and x["asset_id"]==ptaf for x in usage.json())
        assert client.get("/api/network-paths/usage",headers=VIEWER).status_code==403
        assert client.delete("/api/networks/"+vrf,headers=ADMIN).status_code==409
        assert client.put(path,headers=ADMIN,json=[
            {"asset_id":ptaf,"segment_id":vrf,"position":0},
        ]).status_code==422
        assert len(client.get(path,headers=ADMIN).json()["hops"])==2
        assert client.delete("/api/network-assets/"+firewall,headers=ADMIN).status_code==204
        assert client.delete("/api/flows/"+flow,headers=ADMIN).status_code==204
        assert client.delete("/api/networks/"+vrf,headers=ADMIN).status_code==204
        assert client.delete("/api/network-assets/"+ptaf,headers=ADMIN).status_code==204
