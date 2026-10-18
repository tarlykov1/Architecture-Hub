"""Wiki.js 2 article metadata and Architecture Hub entity links.

No Wiki content is proxied: user follows a Wiki.js URL and authenticates there.
"""
from __future__ import annotations
import json
import os
import urllib.request
import urllib.error
from uuid import UUID, uuid4
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import String, Uuid, UniqueConstraint, select
from sqlalchemy.orm import Mapped, mapped_column, Session
from .main import Base, db_session, ArchitectureObject, InfrastructureItem, DataFlow, NetworkSegment, engine

router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])

class KnowledgeLink(Base):
    __tablename__ = "knowledge_links"
    __table_args__ = (UniqueConstraint("entity_type", "entity_id", "wiki_page_id", name="uq_knowledge_entity_page"),)
    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    entity_type: Mapped[str] = mapped_column(String(50), index=True)
    entity_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), index=True)
    wiki_page_id: Mapped[int] = mapped_column()
    wiki_path: Mapped[str] = mapped_column(String(1000))
    title: Mapped[str] = mapped_column(String(500))
    relation_type: Mapped[str] = mapped_column(String(80), default="documentation")

class LinkCreate(BaseModel):
    entity_type: str
    entity_id: UUID
    wiki_page_id: int = Field(ge=1)
    wiki_path: str = Field(min_length=1, max_length=1000)
    title: str = Field(min_length=1, max_length=500)
    relation_type: str = "documentation"

def _entity_exists(db:Session, entity_type:str, entity_id:UUID)->bool:
    models={"system":ArchitectureObject,"component":InfrastructureItem,"flow":DataFlow,"segment":NetworkSegment}
    model=models.get(entity_type)
    if model is None: raise HTTPException(422,"Unsupported entity type")
    return db.get(model,entity_id) is not None

def _url(path:str)->str:
    base=os.getenv("WIKI_PUBLIC_URL","http://127.0.0.1:3000").rstrip("/")
    if not (base.startswith("http://") or base.startswith("https://")):raise HTTPException(503,"Invalid Wiki.js public URL")
    return base+"/"+path.lstrip("/")

@router.get("/status")
def status():
    return {"configured":bool(os.getenv("WIKI_API_TOKEN")),"public_url":os.getenv("WIKI_PUBLIC_URL","http://127.0.0.1:3000")}

@router.get("/pages")
def pages(query:str="",limit:int=30):
    token=os.getenv("WIKI_API_TOKEN","").strip()
    if not token:raise HTTPException(503,"Configure WIKI_API_TOKEN on the backend")
    gql='query { pages { list(orderBy: TITLE) { id path locale title description } } }'
    payload=json.dumps({"query":gql}).encode()
    endpoint=os.getenv("WIKI_API_URL","http://127.0.0.1:3000/graphql")
    if not endpoint.startswith(("http://","https://")):raise HTTPException(503,"Invalid Wiki.js API URL")
    req=urllib.request.Request(endpoint,data=payload,headers={"Content-Type":"application/json","Authorization":"Bearer "+token},method="POST")
    try:
        with urllib.request.urlopen(req,timeout=8) as response:
            result=json.loads(response.read(2_000_000))
    except (urllib.error.URLError,TimeoutError,OSError,ValueError) as exc:
        raise HTTPException(502,"Wiki.js is unavailable or returned an invalid response") from exc
    if result.get("errors"):raise HTTPException(502,"Wiki.js GraphQL query failed; check API permissions")
    rows=result.get("data",{}).get("pages",{}).get("list",[]) or []
    term=query.strip().casefold()
    return [{"id":r["id"],"title":r["title"],"path":r["path"],"locale":r.get("locale","en"),"description":r.get("description",""),
             "url":_url(((r.get("locale") or "en")+"/" if r.get("locale") else "")+r["path"])}
            for r in rows if not term or term in (r.get("title","")+" "+r.get("path","")).casefold()][:min(max(limit,1),100)]

@router.get("/links")
def links(entity_type:str,entity_id:UUID,db:Session=Depends(db_session)):
    if not _entity_exists(db,entity_type,entity_id):raise HTTPException(404,"Entity not found")
    rows=db.scalars(select(KnowledgeLink).where(KnowledgeLink.entity_type==entity_type,KnowledgeLink.entity_id==entity_id)).all()
    return [{"id":str(r.id),"wiki_page_id":r.wiki_page_id,"title":r.title,"wiki_path":r.wiki_path,
             "relation_type":r.relation_type,"url":_url(r.wiki_path)} for r in rows]

@router.post("/links",status_code=201)
def create_link(payload:LinkCreate,db:Session=Depends(db_session)):
    if not _entity_exists(db,payload.entity_type,payload.entity_id):raise HTTPException(404,"Entity not found")
    path=payload.wiki_path.lstrip("/")
    if ".." in path.split("/") or "://" in path or path.startswith("/"):raise HTTPException(422,"Invalid page path")
    old=db.scalar(select(KnowledgeLink).where(KnowledgeLink.entity_type==payload.entity_type,KnowledgeLink.entity_id==payload.entity_id,KnowledgeLink.wiki_page_id==payload.wiki_page_id))
    if old:raise HTTPException(409,"Article already linked")
    row=KnowledgeLink(**{**payload.model_dump(),"wiki_path":path});db.add(row);db.commit()
    return {"id":str(row.id)}

@router.delete("/links/{link_id}",status_code=204)
def delete_link(link_id:UUID,db:Session=Depends(db_session)):
    row=db.get(KnowledgeLink,link_id)
    if row is None:raise HTTPException(404,"Link not found")
    db.delete(row);db.commit()

# This additive table does not modify existing Architecture Hub records.
Base.metadata.create_all(engine,tables=[KnowledgeLink.__table__])
