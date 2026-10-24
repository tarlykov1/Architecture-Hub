"""Architecture-linked incident registry. Incidents can affect multiple entities."""
from __future__ import annotations
from datetime import datetime, timezone
from uuid import UUID,uuid4
from collections import deque
from fastapi import APIRouter,Depends,HTTPException,Request
from pydantic import BaseModel,Field
from sqlalchemy import String,Uuid,DateTime,JSON,select
from sqlalchemy.orm import Mapped,mapped_column,Session
from .main import Base,db_session,ArchitectureObject,InfrastructureItem,NetworkSegment,DataFlow,Relation,NetworkInterface

router=APIRouter(prefix="/api/incidents",tags=["incidents"])
ALLOWED={"system":ArchitectureObject,"component":InfrastructureItem,"network":NetworkSegment,"flow":DataFlow}
class Incident(Base):
    __tablename__="incidents"
    id:Mapped[UUID]=mapped_column(Uuid(as_uuid=True),primary_key=True,default=uuid4)
    title:Mapped[str]=mapped_column(String(250))
    description:Mapped[str]=mapped_column(String(8000),default="")
    status:Mapped[str]=mapped_column(String(32),default="open")
    severity:Mapped[str]=mapped_column(String(16),default="medium")
    owner:Mapped[str]=mapped_column(String(200),default="")
    assignee:Mapped[str]=mapped_column(String(200),default="")
    resolution:Mapped[str]=mapped_column(String(8000),default="")
    links:Mapped[list]=mapped_column(JSON,default=list)
    created_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),default=lambda:datetime.now(timezone.utc))
    updated_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),default=lambda:datetime.now(timezone.utc))
class IncidentInput(BaseModel):
    title:str=Field(min_length=2,max_length=250)
    description:str=Field(default="",max_length=8000)
    status:str=Field(default="open",pattern="^(open|investigating|monitoring|resolved|closed)$")
    severity:str=Field(default="medium",pattern="^(critical|high|medium|low)$")
    owner:str=Field(default="",max_length=200)
    assignee:str=Field(default="",max_length=200)
    resolution:str=Field(default="",max_length=8000)
    links:list[dict[str,str]]=Field(default_factory=list,max_length=60)

def validate_links(db:Session, links:list[dict[str,str]])->list[dict[str,str]]:
    result=[];seen=set()
    for item in links:
        kind=item.get("entity_type");key=item.get("entity_id")
        if kind not in ALLOWED:raise HTTPException(422,"Unsupported entity type")
        try: entity_id=UUID(key)
        except (ValueError,TypeError,AttributeError):raise HTTPException(422,"Invalid entity ID")
        if not db.get(ALLOWED[kind],entity_id):raise HTTPException(422,"Linked entity does not exist")
        if (kind,str(entity_id)) not in seen:
            seen.add((kind,str(entity_id)));result.append({"entity_type":kind,"entity_id":str(entity_id)})
    return result

def _walk(db:Session, links:list[dict], limit:int=250):
    """One hop of likely impact via direct system relations, data flows and component -> system.
    Direction is intentionally conservative: output is a hypothesis, not a verified outage."""
    systems=set()
    components=set()
    for link in links:
        uid=UUID(link["entity_id"])
        if link["entity_type"]=="system": systems.add(uid)
        elif link["entity_type"]=="component": components.add(uid)
        elif link["entity_type"]=="flow":
            flow=db.get(DataFlow,uid)
            if flow: components.update([flow.source_id,flow.target_id])
        elif link["entity_type"]=="network":
            for nic in db.scalars(select(NetworkInterface).where(
                (NetworkInterface.zone_id==uid)|(NetworkInterface.vlan_id==uid)|(NetworkInterface.vrf_id==uid))):
                components.add(nic.item_id)
    for component_id in list(components):
        item=db.get(InfrastructureItem,component_id)
        if item: systems.add(item.system_id)
    related=set(systems)
    for flow in db.scalars(select(DataFlow)):
        if flow.source_id in components or flow.target_id in components:
            for cid in (flow.source_id,flow.target_id):
                item=db.get(InfrastructureItem,cid)
                if item: related.add(item.system_id)
    for relation in db.scalars(select(Relation)):
        if relation.source_id in systems: related.add(relation.target_id)
        if relation.target_id in systems: related.add(relation.source_id)
    explicit={(l["entity_type"],l["entity_id"]) for l in links}
    return [{"entity_type":"system","entity_id":str(x),"name":db.get(ArchitectureObject,x).name}
        for x in list(related)[:limit] if db.get(ArchitectureObject,x) and ("system",str(x)) not in explicit]

def output(row:Incident):
    return {"id":str(row.id),"title":row.title,"description":row.description,"status":row.status,
       "severity":row.severity,"owner":row.owner,"assignee":row.assignee,"resolution":row.resolution,
       "links":row.links,"created_at":row.created_at.isoformat(),"updated_at":row.updated_at.isoformat()}

@router.get("")
def list_incidents(db:Session=Depends(db_session)):
    return [output(i) for i in db.scalars(select(Incident).order_by(Incident.updated_at.desc())).all()]
@router.get("/{incident_id}")
def get_incident(incident_id:UUID,db:Session=Depends(db_session)):
    item=db.get(Incident,incident_id)
    if not item:raise HTTPException(404,"Incident not found")
    return output(item)
@router.post("",status_code=201)
def add_incident(payload:IncidentInput,db:Session=Depends(db_session)):
    values=payload.model_dump();values["links"]=validate_links(db,values["links"])
    item=Incident(**values);db.add(item);db.commit();db.refresh(item)
    return output(item)
@router.put("/{incident_id}")
def edit_incident(incident_id:UUID,payload:IncidentInput,db:Session=Depends(db_session)):
    item=db.get(Incident,incident_id)
    if not item:raise HTTPException(404,"Incident not found")
    values=payload.model_dump();values["links"]=validate_links(db,values["links"])
    for k,v in values.items():setattr(item,k,v)
    item.updated_at=datetime.now(timezone.utc);db.commit();db.refresh(item)
    return output(item)
@router.get("/{incident_id}/impact")
def impact(incident_id:UUID,db:Session=Depends(db_session)):
    item=db.get(Incident,incident_id)
    if not item:raise HTTPException(404,"Incident not found")
    return {"explicit":item.links,"potentially_affected":_walk(db,item.links),
        "caution":"Предполагаемое влияние по связям и потокам, не подтверждённый отказ."}
