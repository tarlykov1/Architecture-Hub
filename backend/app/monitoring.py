"""Stage 1 monitoring registry: discoverable sources and reviewed CI dashboard links.

No calls are made to user-supplied URLs here; API secrets and live telemetry
are intentionally outside the stage-one scope.
"""
from __future__ import annotations

from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import ForeignKey, String, Uuid, Boolean, UniqueConstraint, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from .main import (Base, SessionLocal, ArchitectureObject, InfrastructureItem,
                   audit_direct_edit)

router = APIRouter(prefix="/api/monitoring", tags=["monitoring"])


class MonitoringSource(Base):
    __tablename__ = "monitoring_sources"
    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(30))
    base_url: Mapped[str] = mapped_column(String(2048))
    system_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("objects.id"), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    description: Mapped[str] = mapped_column(String(1000), default="")


class MonitoringLink(Base):
    __tablename__ = "monitoring_links"
    __table_args__ = (UniqueConstraint("source_id", "target_type", "target_id", "relation_kind",
                                       name="uq_monitoring_link"),)
    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    source_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("monitoring_sources.id"), index=True)
    target_type: Mapped[str] = mapped_column(String(20))
    target_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), index=True)
    relation_kind: Mapped[str] = mapped_column(String(24), default="monitors")
    dashboard_url: Mapped[str] = mapped_column(String(2048), default="")
    external_ref: Mapped[str] = mapped_column(String(250), default="")
    notes: Mapped[str] = mapped_column(String(1000), default="")


def db_session():
    with SessionLocal() as db:
        yield db


def safe_http_url(value: str, *, optional: bool = False) -> str:
    """Only navigable HTTP(S) links; never treat these as server fetch targets."""
    value = value.strip()
    if optional and not value:
        return ""
    if not value or len(value) > 2048 or any(ch.isspace() for ch in value) or "\\" in value:
        raise ValueError("Provide a valid http:// or https:// URL without whitespace")
    try:
        parsed = urlsplit(value)
        if parsed.scheme.lower() not in ("http", "https") or not parsed.hostname:
            raise ValueError("Only HTTP(S) URLs are supported")
        if parsed.username is not None or parsed.password is not None:
            raise ValueError("Credentials must not be embedded in a URL")
        if parsed.port is not None and not 1 <= parsed.port <= 65535:
            raise ValueError("Invalid port")
        if parsed.fragment and any(key in parsed.fragment.lower() for key in ("token=", "password=", "apikey=")):
            raise ValueError("Do not embed secrets in links")
    except (ValueError, UnicodeError) as exc:
        raise ValueError("Invalid HTTP(S) URL: " + str(exc)) from exc
    return value


class SourceInput(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    kind: Literal["grafana", "prometheus", "zabbix", "other"]
    base_url: str = Field(min_length=1, max_length=2048)
    system_id: UUID | None = None
    enabled: bool = True
    description: str = Field(default="", max_length=1000)

    @field_validator("base_url")
    @classmethod
    def url_valid(cls, value: str) -> str:
        return safe_http_url(value)


class SourceOutput(SourceInput):
    model_config = ConfigDict(from_attributes=True)
    id: UUID


class LinkInput(BaseModel):
    source_id: UUID
    target_type: Literal["component", "system"]
    target_id: UUID
    relation_kind: Literal["monitors", "visualizes"] = "monitors"
    dashboard_url: str = Field(default="", max_length=2048)
    external_ref: str = Field(default="", max_length=250)
    notes: str = Field(default="", max_length=1000)

    @field_validator("dashboard_url")
    @classmethod
    def url_valid(cls, value: str) -> str:
        return safe_http_url(value, optional=True)


class LinkOutput(LinkInput):
    model_config = ConfigDict(from_attributes=True)
    id: UUID


def validate_target(db: Session, kind: str, identifier: UUID) -> None:
    model = InfrastructureItem if kind == "component" else ArchitectureObject
    if db.get(model, identifier) is None:
        raise HTTPException(status_code=422, detail="Monitoring target does not exist")


def validate_source_system(db: Session, system_id: UUID | None) -> None:
    if system_id is not None and not db.get(ArchitectureObject, system_id):
        raise HTTPException(status_code=422, detail="Linked monitoring system does not exist")


def source_payload(row: MonitoringSource) -> dict:
    return {"id": str(row.id), "name": row.name, "kind": row.kind,
            "base_url": row.base_url, "system_id": str(row.system_id) if row.system_id else None,
            "enabled": row.enabled, "description": row.description}


def link_payload(row: MonitoringLink) -> dict:
    return {"id": str(row.id), "source_id": str(row.source_id),
            "target_type": row.target_type, "target_id": str(row.target_id),
            "relation_kind": row.relation_kind, "dashboard_url": row.dashboard_url,
            "external_ref": row.external_ref, "notes": row.notes}


@router.get("/sources", response_model=list[SourceOutput])
def get_sources(db: Session = Depends(db_session)):
    return db.scalars(select(MonitoringSource).order_by(MonitoringSource.name)).all()


@router.post("/sources", response_model=SourceOutput, status_code=201)
def create_source(payload: SourceInput, request: Request, db: Session = Depends(db_session)):
    validate_source_system(db, payload.system_id)
    source = MonitoringSource(**payload.model_dump())
    db.add(source)
    db.flush()
    audit_direct_edit(db, request, "create_monitoring_source", source.id, None,
                      source_payload(source), "Добавлен источник мониторинга")
    db.commit()
    db.refresh(source)
    return source


@router.put("/sources/{source_id}", response_model=SourceOutput)
def update_source(source_id: UUID, payload: SourceInput, request: Request,
                  db: Session = Depends(db_session)):
    source = db.get(MonitoringSource, source_id)
    if source is None:
        raise HTTPException(404, "Monitoring source not found")
    validate_source_system(db, payload.system_id)
    before = source_payload(source)
    for key, val in payload.model_dump().items():
        setattr(source, key, val)
    after = source_payload(source)
    if before != after:
        audit_direct_edit(db, request, "update_monitoring_source", source.id, before, after,
                          "Обновлён источник мониторинга")
    db.commit()
    return source


@router.delete("/sources/{source_id}", status_code=204)
def delete_source(source_id: UUID, request: Request, db: Session = Depends(db_session)):
    source = db.get(MonitoringSource, source_id)
    if source is None:
        raise HTTPException(404, "Monitoring source not found")
    if db.scalars(select(MonitoringLink.id).where(MonitoringLink.source_id == source_id)).first():
        raise HTTPException(409, "Remove monitoring links before deleting this source")
    before = source_payload(source)
    db.delete(source)
    audit_direct_edit(db, request, "delete_monitoring_source", source_id, before, None,
                      "Удалён источник мониторинга")
    db.commit()


@router.get("/links", response_model=list[LinkOutput])
def get_links(target_type: Literal["component", "system"] | None = None,
              target_id: UUID | None = None, db: Session = Depends(db_session)):
    if (target_type is None) != (target_id is None):
        raise HTTPException(422, "Specify both target_type and target_id")
    query = select(MonitoringLink)
    if target_type:
        query = query.where(MonitoringLink.target_type == target_type,
                            MonitoringLink.target_id == target_id)
    return db.scalars(query.order_by(MonitoringLink.id)).all()


@router.post("/links", response_model=LinkOutput, status_code=201)
def create_link(payload: LinkInput, request: Request, db: Session = Depends(db_session)):
    if db.get(MonitoringSource, payload.source_id) is None:
        raise HTTPException(422, "Monitoring source does not exist")
    validate_target(db, payload.target_type, payload.target_id)
    duplicate = db.scalars(select(MonitoringLink).where(
        MonitoringLink.source_id == payload.source_id,
        MonitoringLink.target_type == payload.target_type,
        MonitoringLink.target_id == payload.target_id,
        MonitoringLink.relation_kind == payload.relation_kind)).first()
    if duplicate:
        raise HTTPException(409, "Monitoring link already exists")
    link = MonitoringLink(**payload.model_dump())
    db.add(link)
    db.flush()
    audit_direct_edit(db, request, "create_monitoring_link", link.id, None,
                      link_payload(link), "Настроена связь мониторинга")
    db.commit()
    db.refresh(link)
    return link


@router.put("/links/{link_id}", response_model=LinkOutput)
def update_link(link_id: UUID, payload: LinkInput, request: Request,
                db: Session = Depends(db_session)):
    link = db.get(MonitoringLink, link_id)
    if link is None:
        raise HTTPException(404, "Monitoring link not found")
    if db.get(MonitoringSource, payload.source_id) is None:
        raise HTTPException(422, "Monitoring source does not exist")
    validate_target(db, payload.target_type, payload.target_id)
    duplicate = db.scalars(select(MonitoringLink).where(
        MonitoringLink.id != link_id, MonitoringLink.source_id == payload.source_id,
        MonitoringLink.target_type == payload.target_type,
        MonitoringLink.target_id == payload.target_id,
        MonitoringLink.relation_kind == payload.relation_kind)).first()
    if duplicate:
        raise HTTPException(409, "Monitoring link already exists")
    before = link_payload(link)
    for key, val in payload.model_dump().items():
        setattr(link, key, val)
    after = link_payload(link)
    if before != after:
        audit_direct_edit(db, request, "update_monitoring_link", link.id, before, after,
                          "Обновлена связь мониторинга")
    db.commit()
    return link


@router.delete("/links/{link_id}", status_code=204)
def delete_link(link_id: UUID, request: Request, db: Session = Depends(db_session)):
    link = db.get(MonitoringLink, link_id)
    if link is None:
        raise HTTPException(404, "Monitoring link not found")
    before = link_payload(link)
    db.delete(link)
    audit_direct_edit(db, request, "delete_monitoring_link", link_id, before, None,
                      "Удалена связь мониторинга")
    db.commit()
