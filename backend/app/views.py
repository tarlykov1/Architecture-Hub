"""Shared, server-backed workspace views. Personal browser-only views remain separate."""
from __future__ import annotations
from uuid import UUID,uuid4
from datetime import datetime,timezone
from fastapi import APIRouter,Depends,HTTPException,Request
from pydantic import BaseModel,Field
from sqlalchemy import String,Uuid,DateTime,select,UniqueConstraint
from sqlalchemy.orm import Mapped,mapped_column,Session
from .main import Base,db_session
from .access import ROLE_ACCESS
router=APIRouter(prefix="/api/views",tags=["views"])
class SharedView(Base):
    __tablename__="shared_views"
    __table_args__=(UniqueConstraint("layer","name",name="uq_shared_view_layer_name"),)
    id:Mapped[UUID]=mapped_column(Uuid(as_uuid=True),primary_key=True,default=uuid4)
    layer:Mapped[str]=mapped_column(String(40))
    name:Mapped[str]=mapped_column(String(80))
    query:Mapped[str]=mapped_column(String(500),default="")
    kind:Mapped[str]=mapped_column(String(80),default="all")
    verification:Mapped[str]=mapped_column(String(40),default="all")
    updated_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),default=lambda:datetime.now(timezone.utc))
class ViewInput(BaseModel):
    layer:str=Field(pattern="^(business|systems|infrastructure|flows)$")
    name:str=Field(min_length=1,max_length=80)
    query:str=Field(default="",max_length=500)
    kind:str=Field(default="all",max_length=80)
    verification:str=Field(default="all",pattern="^(all|draft|assumed|verified)$")
def dto(row:SharedView):
    return {"id":str(row.id),"layer":row.layer,"name":row.name,"query":row.query,
      "kind":row.kind,"verification":row.verification}
@router.get("")
def list_views(request:Request,db:Session=Depends(db_session)):
    role=getattr(request.state,"role",None)
    grants=ROLE_ACCESS.get(role,{}) if role else None
    rows=db.scalars(select(SharedView).order_by(SharedView.layer,SharedView.name)).all()
    return [dto(row) for row in rows if grants is None or grants.get(row.layer) in ("read","write")]
@router.post("",status_code=201)
def add_view(payload:ViewInput,request:Request,db:Session=Depends(db_session)):
    role=getattr(request.state,"role",None)
    if role and ROLE_ACCESS[role].get(payload.layer) not in ("read","write"):
        raise HTTPException(403,"No access to requested architecture layer")
    if db.scalar(select(SharedView).where(SharedView.layer==payload.layer,SharedView.name==payload.name)):
        raise HTTPException(409,"View name already exists in this section")
    row=SharedView(**payload.model_dump());db.add(row);db.commit();db.refresh(row);return dto(row)
@router.put("/{view_id}")
def update_view(view_id:UUID,payload:ViewInput,request:Request,db:Session=Depends(db_session)):
    role=getattr(request.state,"role",None)
    if role and ROLE_ACCESS[role].get(payload.layer) not in ("read","write"):
        raise HTTPException(403,"No access to requested architecture layer")
    row=db.get(SharedView,view_id)
    if not row:raise HTTPException(404,"View not found")
    if role and ROLE_ACCESS[role].get(row.layer) not in ("read","write"):
        raise HTTPException(403,"No access to existing architecture layer")
    conflict=db.scalar(select(SharedView).where(SharedView.layer==payload.layer,SharedView.name==payload.name,SharedView.id!=view_id))
    if conflict:raise HTTPException(409,"View name already exists in this section")
    for key,value in payload.model_dump().items():setattr(row,key,value)
    row.updated_at=datetime.now(timezone.utc)
    db.commit();db.refresh(row);return dto(row)
@router.delete("/{view_id}",status_code=204)
def delete_view(view_id:UUID,db:Session=Depends(db_session)):
    row=db.get(SharedView,view_id)
    if not row:raise HTTPException(404,"View not found")
    db.delete(row);db.commit()
