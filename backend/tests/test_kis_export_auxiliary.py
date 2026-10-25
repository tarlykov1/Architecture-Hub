from uuid import uuid4
from app.main import ArchitectureObject, InfrastructureItem, NetworkInterface, NetworkSegment
from app.knowledge import KnowledgeLink
from app.kis_export import build_card
from app.kis_import import _sheet_map

def test_export_supplemental_sheets():
    system=ArchitectureObject(id=uuid4(),name="Sample",kind="system",attributes={"kis_passport":{"Владелец ИС":"Operations"}})
    vm=InfrastructureItem(id=uuid4(),system_id=system.id,name="vm01",kind="vm",details={})
    segment=NetworkSegment(id=uuid4(),name="VRF-TEST",kind="vrf")
    nic=NetworkInterface(id=uuid4(),item_id=vm.id,name="eth0",ip_address="192.0.2.1",vrf_id=segment.id)
    link=KnowledgeLink(id=uuid4(),entity_type="system",entity_id=system.id,wiki_page_id=12,wiki_path="architecture/test",title="Design document",relation_type="documentation")
    data=_sheet_map(build_card(system,[vm],[nic],[segment],[],[link]))
    assert data["Зоны ответственности"][7]["D"]=="Operations"
    assert "VRF-TEST" in data["Сетевая доступность"][7]["H"]
    assert data["Документация"][7]["C"]=="Design document"
