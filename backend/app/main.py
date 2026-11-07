from __future__ import annotations

import os
import hashlib
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, HTTPException, Request
from .access import access_middleware, configured_keys, ROLE_ACCESS
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import DateTime, ForeignKey, JSON, String, Uuid, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./architecture_hub.db")
engine = create_engine(DATABASE_URL, pool_pre_ping=True, connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {})
SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass


class ArchitectureObject(Base):
    __tablename__ = "objects"
    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    kind: Mapped[str] = mapped_column(String(60), default="system")
    name: Mapped[str] = mapped_column(String(250), index=True)
    description: Mapped[str] = mapped_column(String(4000), default="")
    status: Mapped[str] = mapped_column(String(40), default="active")
    attributes: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class Relation(Base):
    __tablename__ = "relations"
    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    source_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("objects.id", ondelete="CASCADE"))
    target_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("objects.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(60), default="integrates_with")
    description: Mapped[str] = mapped_column(String(4000), default="")


class Diagram(Base):
    __tablename__ = "diagrams"
    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(250))
    positions: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))



class InfrastructureItem(Base):
    __tablename__ = "infrastructure_items"
    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    system_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("objects.id"), index=True)
    parent_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("infrastructure_items.id"), nullable=True)
    kind: Mapped[str] = mapped_column(String(50))
    name: Mapped[str] = mapped_column(String(250))
    description: Mapped[str] = mapped_column(String(4000), default="")
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class DataFlow(Base):
    __tablename__ = "data_flows"
    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    source_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("infrastructure_items.id"))
    target_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("infrastructure_items.id"))
    name: Mapped[str] = mapped_column(String(250))
    data_description: Mapped[str] = mapped_column(String(4000), default="")
    protocol: Mapped[str] = mapped_column(String(80), default="")
    port: Mapped[str] = mapped_column(String(80), default="")
    security: Mapped[str] = mapped_column(String(80), default="unknown")
    schedule: Mapped[str] = mapped_column(String(160), default="")
    verification: Mapped[str] = mapped_column(String(30), default="draft")


class DataAttribute(Base):
    """Canonical description of a data element, never the sensitive value itself."""
    __tablename__ = "data_attributes"
    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    code: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(250))
    description: Mapped[str] = mapped_column(String(4000), default="")
    data_type: Mapped[str] = mapped_column(String(80), default="string")
    sensitivity: Mapped[str] = mapped_column(String(40), default="unclassified")


class FlowDataUse(Base):
    """A flow may expose different attributes to different systems and BPs."""
    __tablename__ = "flow_data_uses"
    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    flow_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("data_flows.id"), index=True)
    attribute_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("data_attributes.id"), index=True)
    process_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("business_processes.id"), nullable=True)
    consumer_system_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("objects.id"), nullable=True)
    purpose: Mapped[str] = mapped_column(String(2000), default="")
    verification: Mapped[str] = mapped_column(String(30), default="draft")


class AttributeInput(BaseModel):
    code: str = Field(min_length=1, max_length=160, pattern=r"^[A-Za-z0-9_.-]+$")
    name: str = Field(min_length=1, max_length=250)
    description: str = Field(default="", max_length=4000)
    data_type: str = Field(default="string", max_length=80)
    sensitivity: str = Field(default="unclassified", pattern="^(unclassified|internal|personal|restricted)$")


class AttributeOutput(AttributeInput):
    model_config = ConfigDict(from_attributes=True)
    id: UUID


class FlowUseInput(BaseModel):
    flow_id: UUID
    attribute_id: UUID
    process_id: UUID | None = None
    consumer_system_id: UUID | None = None
    purpose: str = Field(default="", max_length=2000)
    verification: str = Field(default="draft", pattern="^(draft|assumed|verified)$")


class FlowUseOutput(FlowUseInput):
    model_config = ConfigDict(from_attributes=True)
    id: UUID


class InfraInput(BaseModel):
    system_id: UUID
    parent_id: UUID | None = None
    kind: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=250)
    description: str = Field(default="", max_length=4000)
    details: dict[str, Any] = Field(default_factory=dict)


class InfraOutput(InfraInput):
    model_config = ConfigDict(from_attributes=True)
    id: UUID


class FlowInput(BaseModel):
    source_id: UUID
    target_id: UUID
    name: str = Field(min_length=1, max_length=250)
    data_description: str = Field(default="", max_length=4000)
    protocol: str = Field(default="", max_length=80)
    port: str = Field(default="", max_length=80)
    security: str = Field(default="unknown", max_length=80)
    schedule: str = Field(default="", max_length=160)
    verification: str = Field(default="draft", max_length=30)


class FlowOutput(FlowInput):
    model_config = ConfigDict(from_attributes=True)
    id: UUID


class NetworkSegment(Base):
    __tablename__ = "network_segments"
    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(250), unique=True)
    kind: Mapped[str] = mapped_column(String(30))
    description: Mapped[str] = mapped_column(String(2000), default="")
    verification: Mapped[str] = mapped_column(String(30), default="assumed")


class NetworkInterface(Base):
    __tablename__ = "network_interfaces"
    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    item_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("infrastructure_items.id"))
    name: Mapped[str] = mapped_column(String(100))
    ip_address: Mapped[str] = mapped_column(String(120), default="")
    zone_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("network_segments.id"), nullable=True)
    vlan_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("network_segments.id"), nullable=True)
    vrf_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("network_segments.id"), nullable=True)


class SegmentInput(BaseModel):
    name: str = Field(min_length=1, max_length=250)
    kind: str = Field(pattern="^(zone|vlan|vrf)$")
    description: str = Field(default="", max_length=2000)
    verification: str = Field(default="assumed", pattern="^(assumed|verified|draft)$")


class SegmentOutput(SegmentInput):
    model_config = ConfigDict(from_attributes=True)
    id: UUID


class NetworkAsset(Base):
    """Reusable network/security infrastructure object; never a statement of actual reachability."""
    __tablename__ = "network_assets"
    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(250), index=True)
    kind: Mapped[str] = mapped_column(String(40))
    description: Mapped[str] = mapped_column(String(2000), default="")
    address: Mapped[str] = mapped_column(String(120), default="")
    verification: Mapped[str] = mapped_column(String(30), default="draft")


class FlowNetworkHop(Base):
    """Ordered declared passage via a network object, NOT automatically discovered routing."""
    __tablename__ = "flow_network_hops"
    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    flow_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("data_flows.id"), index=True)
    asset_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("network_assets.id"), index=True, nullable=True)
    segment_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("network_segments.id"), index=True, nullable=True)
    position: Mapped[int] = mapped_column(default=0)
    notes: Mapped[str] = mapped_column(String(2000), default="")
    verification: Mapped[str] = mapped_column(String(30), default="draft")


class NetworkAssetInput(BaseModel):
    name: str = Field(min_length=1, max_length=250)
    kind: str = Field(pattern="^(subnet|dmz|firewall|waf|ptaf|router|gateway|load_balancer|vpn|other)$")
    description: str = Field(default="", max_length=2000)
    address: str = Field(default="", max_length=120)
    verification: str = Field(default="draft", pattern="^(draft|assumed|verified)$")


class NetworkAssetOutput(NetworkAssetInput):
    model_config = ConfigDict(from_attributes=True)
    id: UUID


class NetworkHopInput(BaseModel):
    asset_id: UUID | None = None
    segment_id: UUID | None = None
    position: int = Field(ge=0, le=10000)
    notes: str = Field(default="", max_length=2000)
    verification: str = Field(default="draft", pattern="^(draft|assumed|verified)$")


class NetworkHopOutput(NetworkHopInput):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    flow_id: UUID


class NICInput(BaseModel):
    item_id: UUID
    name: str = Field(min_length=1, max_length=100)
    ip_address: str = Field(default="", max_length=120)
    zone_id: UUID | None = None
    vlan_id: UUID | None = None
    vrf_id: UUID | None = None


class NICOutput(NICInput):
    model_config = ConfigDict(from_attributes=True)
    id: UUID


class BusinessCategory(Base):
    __tablename__ = "business_categories"
    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(250), unique=True)


class BusinessProcess(Base):
    __tablename__ = "business_processes"
    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    category_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("business_categories.id"))
    name: Mapped[str] = mapped_column(String(250))
    description: Mapped[str] = mapped_column(String(2000), default="")


class ProcessSystem(Base):
    __tablename__ = "process_systems"
    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    process_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("business_processes.id"))
    system_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("objects.id"))
    role: Mapped[str] = mapped_column(String(100), default="supporting")


class CategoryInput(BaseModel):
    name: str = Field(min_length=1, max_length=250)


class CategoryOutput(CategoryInput):
    model_config = ConfigDict(from_attributes=True)
    id: UUID


class ProcessInput(BaseModel):
    category_id: UUID
    name: str = Field(min_length=1, max_length=250)
    description: str = Field(default="", max_length=2000)


class ProcessOutput(ProcessInput):
    model_config = ConfigDict(from_attributes=True)
    id: UUID


class ProcessSystemInput(BaseModel):
    process_id: UUID
    system_id: UUID
    role: str = Field(default="supporting", max_length=100)


class ProcessSystemOutput(ProcessSystemInput):
    model_config = ConfigDict(from_attributes=True)
    id: UUID


class ObjectCreate(BaseModel):
    kind: str = Field(default="system", max_length=60)
    name: str = Field(min_length=1, max_length=250)
    description: str = Field(default="", max_length=4000)
    status: str = Field(default="active", max_length=40)
    attributes: dict[str, Any] = Field(default_factory=dict)


class ObjectOut(ObjectCreate):
    model_config = ConfigDict(from_attributes=True)
    id: UUID


class RelationCreate(BaseModel):
    source_id: UUID
    target_id: UUID
    kind: str = Field(default="integrates_with", max_length=60)
    description: str = Field(default="", max_length=4000)


class RelationOut(RelationCreate):
    model_config = ConfigDict(from_attributes=True)
    id: UUID


class DiagramCreate(BaseModel):
    name: str = Field(min_length=1, max_length=250)
    positions: dict[str, Any] = Field(default_factory=dict)


class DiagramOut(DiagramCreate):
    model_config = ConfigDict(from_attributes=True)
    id: UUID


def db_session():
    with SessionLocal() as session:
        yield session


@asynccontextmanager
async def lifespan(app: FastAPI):
    # MVP bootstrap only: switch to Alembic before production rollout.
    Base.metadata.create_all(engine)
    yield


app = FastAPI(title="Architecture Hub API", version="0.7.0", lifespan=lifespan)
app.state.arch_hub_keys = configured_keys()
app.middleware("http")(access_middleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5174", "http://127.0.0.1:5174"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/objects", response_model=list[ObjectOut])
def list_objects(db: Session = Depends(db_session)):
    return db.scalars(select(ArchitectureObject).order_by(ArchitectureObject.name)).all()


@app.post("/api/objects", response_model=ObjectOut, status_code=201)
def add_object(payload: ObjectCreate, db: Session = Depends(db_session)):
    obj = ArchitectureObject(**payload.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@app.put("/api/objects/{object_id}", response_model=ObjectOut)
def update_object(object_id: UUID, payload: ObjectCreate, db: Session = Depends(db_session)):
    obj = db.get(ArchitectureObject, object_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="Object not found")
    for key, value in payload.model_dump().items():
        setattr(obj, key, value)
    db.commit()
    db.refresh(obj)
    return obj


@app.delete("/api/objects/{object_id}", status_code=204)
def delete_object(object_id: UUID, db: Session = Depends(db_session)):
    obj = db.get(ArchitectureObject, object_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="Object not found")
    for rel in db.scalars(select(Relation).where((Relation.source_id == object_id) | (Relation.target_id == object_id))).all():
        db.delete(rel)
    # Diagram positions may contain orphan IDs; UI filters them on load.
    db.delete(obj)
    db.commit()


@app.get("/api/relations", response_model=list[RelationOut])
def list_relations(db: Session = Depends(db_session)):
    return db.scalars(select(Relation)).all()


@app.post("/api/relations", response_model=RelationOut, status_code=201)
def add_relation(payload: RelationCreate, db: Session = Depends(db_session)):
    if payload.source_id == payload.target_id:
        raise HTTPException(status_code=422, detail="Self-connections are not supported in MVP")
    if not db.get(ArchitectureObject, payload.source_id) or not db.get(ArchitectureObject, payload.target_id):
        raise HTTPException(status_code=422, detail="Both objects must exist")
    rel = Relation(**payload.model_dump())
    db.add(rel)
    db.commit()
    db.refresh(rel)
    return rel


@app.delete("/api/relations/{relation_id}", status_code=204)
def delete_relation(relation_id: UUID, db: Session = Depends(db_session)):
    rel = db.get(Relation, relation_id)
    if rel is None:
        raise HTTPException(status_code=404, detail="Relation not found")
    db.delete(rel)
    db.commit()


@app.get("/api/diagrams", response_model=list[DiagramOut])
def list_diagrams(db: Session = Depends(db_session)):
    return db.scalars(select(Diagram).order_by(Diagram.name)).all()


@app.post("/api/diagrams", response_model=DiagramOut, status_code=201)
def add_diagram(payload: DiagramCreate, db: Session = Depends(db_session)):
    diagram = Diagram(**payload.model_dump())
    db.add(diagram)
    db.commit()
    db.refresh(diagram)
    return diagram


@app.put("/api/diagrams/{diagram_id}", response_model=DiagramOut)
def save_diagram(diagram_id: UUID, payload: DiagramCreate, db: Session = Depends(db_session)):
    diagram = db.get(Diagram, diagram_id)
    if diagram is None:
        raise HTTPException(status_code=404, detail="Diagram not found")
    diagram.name = payload.name
    diagram.positions = payload.positions
    diagram.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(diagram)
    return diagram


# Safe, repeatable import of demonstrational data based on essential_gsp_demo.xlsx.
# Existing user-created objects and diagrams are never removed or overwritten.
DEMO_SYSTEMS = [
    ("Naumen", "ITSM", "Управление заявками и ИТ-услугами"),
    ("1С ЗУП", "HRM", "Кадровый учёт, данные сотрудников"),
    ("DATAREON", "Интеграционная платформа", "Обмен данными между системами"),
    ("Active Directory", "Каталог", "Учётные записи и группы"),
    ("Bitrix24", "BPM / CRM", "Бизнес-процессы и задачи"),
    ("ЕИБД", "Реестр идентификаторов", "Единая идентификация и жизненный цикл идентификаторов сотрудников; детали уточняются"),
    ("Телефонный справочник", "Корпоративный справочник", "Каталог контактных данных сотрудников; состав и источники уточняются"),
]
DEMO_FLOWS = [
    ("1С ЗУП", "DATAREON", "Телефонный справочник · способ и периодичность уточнить"),
    ("DATAREON", "Naumen", "Данные справочника сотрудников · API (параметры уточнить)"),
    ("1С ЗУП", "Active Directory", "Данные сотрудников · 1 раз в час (проверить актуальность)"),
]


@app.post("/api/demo/load")
def load_demo(db: Session = Depends(db_session)):
    """Add sample systems/flows idempotently; leave existing real data untouched."""
    existing = db.scalars(select(ArchitectureObject)).all()
    by_name = {o.name.casefold(): o for o in existing}
    sample: dict[str, ArchitectureObject] = {}
    added_objects = 0
    added_relations = 0
    for name, subtype, description in DEMO_SYSTEMS:
        obj = by_name.get(name.casefold())
        if obj is None:
            obj = ArchitectureObject(
                name=name, kind="system", description=description, status="demo",
                attributes={"subtype": subtype, "origin": "demo", "verification": "requires_review"}
            )
            db.add(obj)
            db.flush()
            by_name[name.casefold()] = obj
            added_objects += 1
        sample[name] = obj
    existing_relations = db.scalars(select(Relation)).all()
    relation_keys = {(r.source_id, r.target_id, r.kind) for r in existing_relations}
    for source, target, description in DEMO_FLOWS:
        s_id, t_id = sample[source].id, sample[target].id
        key = (s_id, t_id, "data_flow")
        if key not in relation_keys:
            db.add(Relation(source_id=s_id, target_id=t_id, kind="data_flow", description=description))
            relation_keys.add(key)
            added_relations += 1
    diagram = db.scalars(select(Diagram).where(Diagram.name == "Демо · Архитектура ГСП")).first()
    if diagram is None:
        positions = {
            str(sample[name].id): {"x": x, "y": y}
            for name, x, y in [
                ("1С ЗУП", 35, 70), ("DATAREON", 335, 70),
                ("Naumen", 635, 60), ("Active Directory", 335, 255),
                ("Bitrix24", 635, 255), ("ЕИБД", 35, 255),
                ("Телефонный справочник", 335, 430)
            ]
        }
        diagram = Diagram(name="Демо · Архитектура ГСП", positions=positions)
        db.add(diagram)
        db.flush()
    db.commit()
    return {
        "diagram_id": str(diagram.id),
        "created_objects": added_objects,
        "created_relations": added_relations,
        "notice": "Демонстрационные сведения. Неподтверждённые параметры требуют уточнения."
    }


# Infrastructure is deliberately separate from logical systems.
# No assumptions about real IPs, VLANs or services are hardcoded.
@app.get("/api/infra", response_model=list[InfraOutput])
def list_infra(system_id: UUID | None = None, db: Session = Depends(db_session)):
    query = select(InfrastructureItem)
    if system_id:
        query = query.where(InfrastructureItem.system_id == system_id)
    return db.scalars(query.order_by(InfrastructureItem.name)).all()


@app.post("/api/infra", response_model=InfraOutput, status_code=201)
def create_infra(payload: InfraInput, db: Session = Depends(db_session)):
    if not db.get(ArchitectureObject, payload.system_id):
        raise HTTPException(422, "System not found")
    if payload.parent_id:
        parent = db.get(InfrastructureItem, payload.parent_id)
        if not parent or parent.system_id != payload.system_id:
            raise HTTPException(422, "Parent must be in the same system")
    item = InfrastructureItem(**payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@app.put("/api/infra/{item_id}", response_model=InfraOutput)
def update_infra(item_id: UUID, payload: InfraInput, db: Session = Depends(db_session)):
    item = db.get(InfrastructureItem, item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    if not db.get(ArchitectureObject, payload.system_id):
        raise HTTPException(422, "System not found")
    if payload.parent_id:
        parent = db.get(InfrastructureItem, payload.parent_id)
        if not parent or parent.system_id != payload.system_id or parent.id == item_id:
            raise HTTPException(422, "Invalid parent")
        cursor = parent
        while cursor.parent_id:
            if cursor.parent_id == item_id:
                raise HTTPException(422, "Containment cycle")
            cursor = db.get(InfrastructureItem, cursor.parent_id)
            if cursor is None:
                break
    for k, v in payload.model_dump().items():
        setattr(item, k, v)
    db.commit()
    db.refresh(item)
    return item


@app.post("/api/demo/attributes")
def seed_demo_attributes(db: Session = Depends(db_session)):
    """Add synthetic metadata for existing enterprise-demo flows; safe to repeat."""
    specs = [
        ("employee_id", "Идентификатор сотрудника", "string", "internal", "Стабильный ключ записи сотрудника"),
        ("full_name", "ФИО сотрудника", "string", "personal", "Отображаемое имя в справочнике"),
        ("department", "Подразделение", "string", "internal", "Организационная принадлежность"),
        ("position", "Должность", "string", "internal", "Должность в организационной структуре"),
        ("work_email", "Рабочая почта", "string", "personal", "Контактный адрес"),
        ("work_phone", "Рабочий телефон", "string", "personal", "Контактный номер"),
        ("employment_status", "Статус занятости", "enum", "internal", "Состояние трудовых отношений"),
        ("account_id", "Идентификатор учётной записи", "string", "internal", "Технический идентификатор пользователя"),
        ("login", "Логин", "string", "internal", "Имя учётной записи"),
        ("group_code", "Код группы доступа", "string", "restricted", "Идентификатор группы авторизации"),
        ("oidc_subject", "OIDC subject", "string", "internal", "Субъект токена идентификации, не сам токен"),
    ]
    existing = {a.code: a for a in db.scalars(select(DataAttribute)).all()}
    added_attributes = 0
    for code, name, dtype, sensitivity, description in specs:
        if code not in existing:
            row = DataAttribute(code=code, name=name, data_type=dtype,
                                sensitivity=sensitivity, description="ДЕМО: " + description)
            db.add(row)
            db.flush()
            existing[code] = row
            added_attributes += 1
    flows = {f.name: f for f in db.scalars(select(DataFlow)).all()
             if f.data_description.startswith("ДЕМО: ")}
    systems = {o.name: o for o in db.scalars(select(ArchitectureObject)).all()}
    mapping_specs = [
        ("Кадровые события", "DATAREON", ["employee_id", "full_name", "department", "position", "work_email", "work_phone", "employment_status"]),
        ("Обновление справочника", "Телефонный справочник", ["employee_id", "full_name", "department", "position", "work_email", "work_phone"]),
        ("Запись в API", "Телефонный справочник", ["employee_id", "full_name", "department", "position"]),
        ("Справочные данные в Naumen", "Naumen", ["employee_id", "full_name", "department", "work_email"]),
        ("Идентификаторы для процессов", "ЕИБД", ["employee_id", "account_id", "login"]),
        ("Сопоставление пользователей", "ЕИБД", ["employee_id", "account_id"]),
        ("Получение идентификаторов", "ЕИБД", ["employee_id", "account_id"]),
        ("Вход пользователей Bitrix24", "Keycloak", ["account_id", "login", "oidc_subject"]),
        ("Вход пользователей Naumen", "Keycloak", ["account_id", "login", "oidc_subject"]),
        ("Вход пользователей справочника", "Keycloak", ["account_id", "login", "oidc_subject"]),
        ("Федерация идентичностей", "Active Directory", ["account_id", "login", "group_code"]),
    ]
    existing_uses = {(u.flow_id, u.attribute_id, u.consumer_system_id)
                     for u in db.scalars(select(FlowDataUse)).all() if u.process_id is None}
    added_mappings = 0
    for flow_name, consumer, codes in mapping_specs:
        flow, system = flows.get(flow_name), systems.get(consumer)
        if flow is None or system is None:
            continue
        for code in codes:
            key = (flow.id, existing[code].id, system.id)
            if key in existing_uses:
                continue
            db.add(FlowDataUse(flow_id=flow.id, attribute_id=existing[code].id,
                               consumer_system_id=system.id, process_id=None,
                               purpose="ДЕМО: используется системой «" + consumer + "» в потоке «" + flow_name + "»",
                               verification="assumed"))
            existing_uses.add(key)
            added_mappings += 1
    db.commit()
    return {"added_attributes": added_attributes, "added_mappings": added_mappings,
            "total_demo_attributes": len(specs)}


@app.get("/api/data-attributes", response_model=list[AttributeOutput])
def list_data_attributes(db: Session = Depends(db_session)):
    return db.scalars(select(DataAttribute).order_by(DataAttribute.code)).all()


@app.post("/api/data-attributes", response_model=AttributeOutput, status_code=201)
def create_data_attribute(payload: AttributeInput, db: Session = Depends(db_session)):
    if db.scalars(select(DataAttribute).where(DataAttribute.code == payload.code)).first():
        raise HTTPException(409, "Attribute code already exists")
    item = DataAttribute(**payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@app.put("/api/data-attributes/{attribute_id}", response_model=AttributeOutput)
def update_data_attribute(attribute_id: UUID, payload: AttributeInput, db: Session = Depends(db_session)):
    item = db.get(DataAttribute, attribute_id)
    if item is None:
        raise HTTPException(404, "Attribute not found")
    conflict = db.scalars(select(DataAttribute).where(
        DataAttribute.code == payload.code, DataAttribute.id != attribute_id)).first()
    if conflict:
        raise HTTPException(409, "Attribute code already exists")
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    db.commit()
    db.refresh(item)
    return item


@app.get("/api/flow-data-uses", response_model=list[FlowUseOutput])
def list_flow_data_uses(flow_id: UUID | None = None, db: Session = Depends(db_session)):
    stmt = select(FlowDataUse).order_by(FlowDataUse.id)
    if flow_id is not None:
        stmt = stmt.where(FlowDataUse.flow_id == flow_id)
    return db.scalars(stmt).all()


@app.post("/api/flow-data-uses", response_model=FlowUseOutput, status_code=201)
def create_flow_data_use(payload: FlowUseInput, db: Session = Depends(db_session)):
    if db.get(DataFlow, payload.flow_id) is None:
        raise HTTPException(422, "Unknown flow")
    if db.get(DataAttribute, payload.attribute_id) is None:
        raise HTTPException(422, "Unknown attribute")
    if payload.process_id and db.get(BusinessProcess, payload.process_id) is None:
        raise HTTPException(422, "Unknown business process")
    if payload.consumer_system_id and db.get(ArchitectureObject, payload.consumer_system_id) is None:
        raise HTTPException(422, "Unknown consuming system")
    duplicate = db.scalars(select(FlowDataUse).where(
        FlowDataUse.flow_id == payload.flow_id,
        FlowDataUse.attribute_id == payload.attribute_id,
        FlowDataUse.process_id == payload.process_id,
        FlowDataUse.consumer_system_id == payload.consumer_system_id,
    )).first()
    if duplicate is not None:
        raise HTTPException(409, "Attribute is already mapped to this flow, process and system")
    mapping = FlowDataUse(**payload.model_dump())
    db.add(mapping)
    db.commit()
    db.refresh(mapping)
    return mapping


@app.delete("/api/flow-data-uses/{mapping_id}", status_code=204)
def delete_flow_data_use(mapping_id: UUID, db: Session = Depends(db_session)):
    mapping = db.get(FlowDataUse, mapping_id)
    if mapping is None:
        raise HTTPException(404, "Mapping not found")
    db.delete(mapping)
    db.commit()


@app.get("/api/flows/{flow_id}/data-map")
def flow_data_map(flow_id: UUID, db: Session = Depends(db_session)):
    flow = db.get(DataFlow, flow_id)
    if flow is None:
        raise HTTPException(404, "Flow not found")
    rows = db.scalars(select(FlowDataUse).where(FlowDataUse.flow_id == flow_id)).all()
    attributes = {a.id: a for a in db.scalars(select(DataAttribute).where(
        DataAttribute.id.in_([row.attribute_id for row in rows]))).all()} if rows else {}
    processes = {p.id: p for p in db.scalars(select(BusinessProcess).where(
        BusinessProcess.id.in_([row.process_id for row in rows if row.process_id]))).all()} if rows else {}
    systems = {x.id: x for x in db.scalars(select(ArchitectureObject).where(
        ArchitectureObject.id.in_([row.consumer_system_id for row in rows if row.consumer_system_id]))).all()} if rows else {}
    return {
        "flow_id": flow.id, "source_id": flow.source_id, "target_id": flow.target_id,
        "attributes": [
            {"id": row.id, "attribute_id": row.attribute_id,
             "code": attributes[row.attribute_id].code,
             "name": attributes[row.attribute_id].name,
             "data_type": attributes[row.attribute_id].data_type,
             "sensitivity": attributes[row.attribute_id].sensitivity,
             "process_id": row.process_id,
             "process_name": processes[row.process_id].name if row.process_id else None,
             "consumer_system_id": row.consumer_system_id,
             "consumer_system_name": systems[row.consumer_system_id].name if row.consumer_system_id else None,
             "purpose": row.purpose, "verification": row.verification}
            for row in rows
        ],
    }


@app.get("/api/flows", response_model=list[FlowOutput])
def list_flows(db: Session = Depends(db_session)):
    return db.scalars(select(DataFlow).order_by(DataFlow.name)).all()


@app.post("/api/flows", response_model=FlowOutput, status_code=201)
def create_flow(payload: FlowInput, db: Session = Depends(db_session)):
    if payload.source_id == payload.target_id:
        raise HTTPException(422, "Source and destination must differ")
    if not db.get(InfrastructureItem, payload.source_id) or not db.get(InfrastructureItem, payload.target_id):
        raise HTTPException(422, "Both endpoints must exist")
    flow = DataFlow(**payload.model_dump())
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return flow


@app.put("/api/flows/{flow_id}", response_model=FlowOutput)
def update_flow(flow_id: UUID, payload: FlowInput, db: Session = Depends(db_session)):
    flow = db.get(DataFlow, flow_id)
    if not flow:
        raise HTTPException(404, "Flow not found")
    if payload.source_id == payload.target_id or not db.get(InfrastructureItem, payload.source_id) or not db.get(InfrastructureItem, payload.target_id):
        raise HTTPException(422, "Invalid endpoints")
    for k, v in payload.model_dump().items():
        setattr(flow, k, v)
    db.commit()
    db.refresh(flow)
    return flow


@app.delete("/api/flows/{flow_id}", status_code=204)
def delete_flow(flow_id: UUID, db: Session = Depends(db_session)):
    flow = db.get(DataFlow, flow_id)
    if flow is None:
        raise HTTPException(status_code=404, detail="Flow not found")
    for use in db.scalars(select(FlowDataUse).where(FlowDataUse.flow_id == flow_id)).all():
        db.delete(use)
    for hop in db.scalars(select(FlowNetworkHop).where(FlowNetworkHop.flow_id == flow_id)).all():
        db.delete(hop)
    db.delete(flow)
    db.commit()


@app.delete("/api/infra/{item_id}", status_code=204)
def delete_infra(item_id: UUID, db: Session = Depends(db_session)):
    item = db.get(InfrastructureItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Infrastructure item not found")
    if db.scalars(select(InfrastructureItem).where(InfrastructureItem.parent_id == item_id)).first():
        raise HTTPException(status_code=409, detail="Delete child components first")
    if db.scalars(select(DataFlow).where(
        (DataFlow.source_id == item_id) | (DataFlow.target_id == item_id)
    )).first():
        raise HTTPException(status_code=409, detail="Delete connected data flows first")
    if db.scalars(select(NetworkInterface).where(NetworkInterface.item_id == item_id)).first():
        raise HTTPException(status_code=409, detail="Delete network interfaces first")
    db.delete(item)
    db.commit()


# Fully synthetic scenario: never use these names or network notes as confirmed production topology.
ENTERPRISE_DEMO_KEY = "enterprise_demo_v1"


@app.post("/api/demo/enterprise")
def load_enterprise_demo(db: Session = Depends(db_session)):
    """Idempotent, additive demo with VMs, environments, EIBD tables and directed flows."""
    systems = [
        ("Телефонный справочник", "Корпоративный справочник"),
        ("Bitrix24", "Управление процессами и задачами"),
        ("Naumen", "ITSM платформа"),
        ("ЕИБД", "Единая база идентификаторов"),
        ("Keycloak", "Провайдер аутентификации OIDC"),
        ("Active Directory", "Корпоративный каталог пользователей"),
        ("1С ЗУП", "Источник кадровых данных"),
        ("DATAREON", "Интеграционная платформа"),
    ]
    original = {o.name.casefold(): o for o in db.scalars(select(ArchitectureObject)).all()}
    sys = {}
    new_systems = 0
    for name, descr in systems:
        obj = original.get(name.casefold())
        if obj is None:
            obj = ArchitectureObject(name=name, kind="system", description=descr, status="demo",
                                     attributes={"origin": ENTERPRISE_DEMO_KEY, "verification": "assumed"})
            db.add(obj)
            db.flush()
            new_systems += 1
        sys[name] = obj

    # Each component has its own deployment and network tags. These are fictional labels,
    # not real IPs, VLAN IDs, VRFs or routes.
    specs = []
    def add(system, name, kind, env, zone, vrf, role, parent=None):
        specs.append((system, name, kind, env, zone, vrf, role, parent))

    for i, role in enumerate(["Web / UI", "Backend API", "Сервис синхронизации"], 1):
        add("Телефонный справочник", f"DIR-PROD-VM-{i:02}", "vm", "PROD", "APP-ZONE", "VRF-APP", role)
    for i, role in enumerate(["Web / API", "Тестовая БД"], 1):
        add("Телефонный справочник", f"DIR-TEST-VM-{i:02}", "vm", "TEST", "TEST-ZONE", "VRF-TEST", role)
    for i, role in enumerate(["Frontend / Web", "Backend / Workers", "Database"], 1):
        add("Bitrix24", f"B24-PROD-VM-{i:02}", "vm", "PROD", "APP-ZONE" if i < 3 else "DB-ZONE", "VRF-APP" if i < 3 else "VRF-DATA", role)
    naumen_roles = [
        "Load balancer", "Frontend A", "Frontend B", "Application A", "Application B",
        "Integration API", "Worker A", "Worker B", "Message broker", "Database primary", "Database replica"
    ]
    for i, role in enumerate(naumen_roles, 1):
        zone = "DMZ-DEMO" if i == 1 else ("DB-ZONE" if i >= 10 else "APP-ZONE")
        vrf = "VRF-DMZ" if i == 1 else ("VRF-DATA" if i >= 10 else "VRF-APP")
        add("Naumen", f"NAU-PROD-VM-{i:02}", "vm", "PROD", zone, vrf, role)
    add("ЕИБД", "EIBD-DB-VM-01", "vm", "PROD", "ISOLATED-DATA-ZONE", "VRF-EIBD", "Единая БД идентификаторов")
    add("ЕИБД", "EIBD / PostgreSQL", "database", "PROD", "ISOLATED-DATA-ZONE", "VRF-EIBD", "Демо-хранилище ЕИБД", "EIBD-DB-VM-01")
    for table, purpose in [
        ("persons", "Псевдоним и учётные идентификаторы"),
        ("identifiers", "Соответствие идентификаторов систем"),
        ("system_accounts", "Учётные записи в прикладных системах"),
        ("employment_events", "События жизненного цикла"),
        ("access_mappings", "Соответствия прав и систем"),
    ]:
        add("ЕИБД", "EIBD.table." + table, "table", "PROD", "ISOLATED-DATA-ZONE", "VRF-EIBD", purpose, "EIBD / PostgreSQL")
    add("Keycloak", "KC-AUTH-VM-01", "vm", "PROD", "AUTH-ZONE", "VRF-AUTH", "OIDC identity provider")
    add("Active Directory", "AD-DC-VM-01", "vm", "PROD", "IDENTITY-ZONE", "VRF-IDENTITY", "LDAP / directory service")
    add("1С ЗУП", "HR-EXPORT-SVC", "service", "PROD", "APP-ZONE", "VRF-APP", "Экспорт кадровых событий")
    add("DATAREON", "DATAREON-ADAPTER", "service", "PROD", "INTEGRATION-ZONE", "VRF-INTEGRATION", "Адаптер интеграции")

    old_items = db.scalars(select(InfrastructureItem)).all()
    item_lookup = {(str(i.system_id), i.name): i for i in old_items}
    created_items = 0
    nodes = {}
    for system, name, kind, env, zone, vrf, role, parent in specs:
        owner = sys[system]
        item = item_lookup.get((str(owner.id), name))
        if item is None:
            item = InfrastructureItem(system_id=owner.id, name=name, kind=kind,
                description=role, details={
                    "environment": env, "security_zone": zone, "vrf": vrf,
                    "vlan": "уточнить", "demo": True, "verification": "assumed",
                    "network_notes": "СИНТЕТИЧЕСКИЙ ПРИМЕР – параметры не проверены"
                })
            db.add(item)
            db.flush()
            item_lookup[(str(owner.id), name)] = item
            created_items += 1
        nodes[name] = item
    for system, name, kind, env, zone, vrf, role, parent in specs:
        if parent and nodes[name].parent_id is None:
            nodes[name].parent_id = nodes[parent].id

    leg_specs = [
        ("HR-EXPORT-SVC", "DATAREON-ADAPTER", "Кадровые события", "Состав кадровых полей", "HTTPS", "443", "TLS"),
        ("DATAREON-ADAPTER", "DIR-PROD-VM-03", "Обновление справочника", "Контакты и подразделения", "HTTPS", "443", "TLS"),
        ("DIR-PROD-VM-03", "DIR-PROD-VM-02", "Запись в API", "Карточки сотрудников", "HTTPS", "443", "TLS"),
        ("DIR-PROD-VM-02", "NAU-PROD-VM-06", "Справочные данные в Naumen", "Сведения о сотрудниках", "HTTPS", "443", "mTLS"),
        ("B24-PROD-VM-02", "EIBD-DB-VM-01", "Идентификаторы для процессов", "Псевдонимы и идентификаторы", "HTTPS", "443", "private_connector"),
        ("NAU-PROD-VM-06", "EIBD-DB-VM-01", "Сопоставление пользователей", "Идентификаторы пользователей", "HTTPS", "443", "private_connector"),
        ("DIR-PROD-VM-02", "EIBD-DB-VM-01", "Получение идентификаторов", "Псевдонимы пользователей", "HTTPS", "443", "private_connector"),
        ("B24-PROD-VM-01", "KC-AUTH-VM-01", "Вход пользователей Bitrix24", "OIDC авторизация", "HTTPS", "443", "TLS"),
        ("NAU-PROD-VM-02", "KC-AUTH-VM-01", "Вход пользователей Naumen", "OIDC авторизация", "HTTPS", "443", "TLS"),
        ("DIR-PROD-VM-01", "KC-AUTH-VM-01", "Вход пользователей справочника", "OIDC авторизация", "HTTPS", "443", "TLS"),
        ("KC-AUTH-VM-01", "AD-DC-VM-01", "Федерация идентичностей", "LDAP / группы", "LDAPS", "636", "TLS"),
        ("NAU-PROD-VM-04", "NAU-PROD-VM-10", "Работа с основной БД Naumen", "Данные заявок", "TCP", "5432", "unknown"),
        ("NAU-PROD-VM-10", "NAU-PROD-VM-11", "Репликация БД", "Данные БД", "TCP", "5432", "unknown"),
        ("DIR-TEST-VM-01", "DIR-TEST-VM-02", "Тестовые запросы", "Синтетические тестовые данные", "TCP", "5432", "unknown"),
    ]
    existing = {(f.source_id, f.target_id, f.name) for f in db.scalars(select(DataFlow)).all()}
    created_flows = 0
    for s, t, name, payload, proto, port, sec in leg_specs:
        key = (nodes[s].id, nodes[t].id, name)
        if key not in existing:
            db.add(DataFlow(source_id=nodes[s].id, target_id=nodes[t].id,
                name=name, data_description="ДЕМО: " + payload,
                protocol=proto, port=port, security=sec, verification="assumed",
                schedule="Не установлено"))
            existing.add(key)
            created_flows += 1
    db.commit()
    return {"new_systems": new_systems, "new_components": created_items,
            "new_flows": created_flows, "systems": len(systems),
            "telephone_prod_vm": 3, "telephone_test_vm": 2,
            "bitrix_vm": 3, "naumen_vm": 11,
            "notice": "Все инфраструктурные имена, сети, роли и каналы демонстрационные."}


@app.get("/api/network-paths/usage")
def network_path_usage(db: Session = Depends(db_session)):
    """Reverse lookup: which data flows declare passage through each network object."""
    rows = db.scalars(select(FlowNetworkHop).order_by(FlowNetworkHop.position)).all()
    flow_ids = [row.flow_id for row in rows]
    by_id = {f.id: f for f in db.scalars(select(DataFlow).where(DataFlow.id.in_(flow_ids))).all()} if rows else {}
    return [
        {"flow_id": hop.flow_id, "flow_name": by_id[hop.flow_id].name,
         "asset_id": hop.asset_id, "segment_id": hop.segment_id,
         "position": hop.position, "verification": hop.verification}
        for hop in rows
    ]


@app.get("/api/network-assets", response_model=list[NetworkAssetOutput])
def list_network_assets(db: Session = Depends(db_session)):
    return db.scalars(select(NetworkAsset).order_by(NetworkAsset.kind, NetworkAsset.name)).all()


@app.post("/api/network-assets", response_model=NetworkAssetOutput, status_code=201)
def add_network_asset(payload: NetworkAssetInput, db: Session = Depends(db_session)):
    if db.scalars(select(NetworkAsset).where(NetworkAsset.name == payload.name, NetworkAsset.kind == payload.kind)).first():
        raise HTTPException(409, "Network object already exists")
    asset = NetworkAsset(**payload.model_dump())
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset


@app.put("/api/network-assets/{asset_id}", response_model=NetworkAssetOutput)
def update_network_asset(asset_id: UUID, payload: NetworkAssetInput, db: Session = Depends(db_session)):
    asset = db.get(NetworkAsset, asset_id)
    if asset is None:
        raise HTTPException(404, "Network object not found")
    if db.scalars(select(NetworkAsset).where(NetworkAsset.name == payload.name, NetworkAsset.kind == payload.kind, NetworkAsset.id != asset_id)).first():
        raise HTTPException(409, "Network object already exists")
    for key, value in payload.model_dump().items():
        setattr(asset, key, value)
    db.commit()
    db.refresh(asset)
    return asset


@app.delete("/api/network-assets/{asset_id}", status_code=204)
def delete_network_asset(asset_id: UUID, db: Session = Depends(db_session)):
    asset = db.get(NetworkAsset, asset_id)
    if asset is None:
        raise HTTPException(404, "Network object not found")
    if db.scalars(select(FlowNetworkHop).where(FlowNetworkHop.asset_id == asset_id)).first():
        raise HTTPException(409, "Object is referenced by flow paths")
    db.delete(asset)
    db.commit()


@app.get("/api/flows/{flow_id}/network-path")
def flow_network_path(flow_id: UUID, db: Session = Depends(db_session)):
    flow = db.get(DataFlow, flow_id)
    if flow is None:
        raise HTTPException(404, "Flow not found")
    rows = db.scalars(select(FlowNetworkHop).where(FlowNetworkHop.flow_id == flow_id).order_by(FlowNetworkHop.position, FlowNetworkHop.id)).all()
    assets = {a.id: a for a in db.scalars(select(NetworkAsset).where(
        NetworkAsset.id.in_([row.asset_id for row in rows if row.asset_id]))).all()} if rows else {}
    segments = {a.id: a for a in db.scalars(select(NetworkSegment).where(
        NetworkSegment.id.in_([row.segment_id for row in rows if row.segment_id]))).all()} if rows else {}
    return {
        "flow_id": flow_id, "source_id": flow.source_id, "target_id": flow.target_id,
        "declared_only": True, "hops": [
            {"id": hop.id, "flow_id": hop.flow_id, "asset_id": hop.asset_id,
             "segment_id": hop.segment_id,
             "position": hop.position, "notes": hop.notes, "verification": hop.verification,
             "name": assets[hop.asset_id].name if hop.asset_id else segments[hop.segment_id].name,
             "kind": assets[hop.asset_id].kind if hop.asset_id else segments[hop.segment_id].kind,
             "address": assets[hop.asset_id].address if hop.asset_id else ""}
            for hop in rows
        ],
    }


@app.put("/api/flows/{flow_id}/network-path", response_model=list[NetworkHopOutput])
def replace_flow_network_path(flow_id: UUID, payload: list[NetworkHopInput], db: Session = Depends(db_session)):
    if db.get(DataFlow, flow_id) is None:
        raise HTTPException(404, "Flow not found")
    refs = [(row.asset_id, row.segment_id) for row in payload]
    if any((asset is None) == (segment is None) for asset, segment in refs):
        raise HTTPException(422, "Specify exactly one of asset_id or segment_id")
    if len(refs) != len(set(refs)):
        raise HTTPException(422, "Each network object can occur once in a flow path")
    positions = [row.position for row in payload]
    if sorted(positions) != list(range(len(payload))):
        raise HTTPException(422, "Positions must be consecutive from zero")
    for asset_id, segment_id in refs:
        if asset_id is not None and db.get(NetworkAsset, asset_id) is None:
            raise HTTPException(422, "Unknown network object")
        if segment_id is not None and db.get(NetworkSegment, segment_id) is None:
            raise HTTPException(422, "Unknown network segment")
    # Validate the entire path before mutating anything.
    for old in db.scalars(select(FlowNetworkHop).where(FlowNetworkHop.flow_id == flow_id)).all():
        db.delete(old)
    db.flush()
    new = [FlowNetworkHop(flow_id=flow_id, **row.model_dump()) for row in sorted(payload, key=lambda row: row.position)]
    db.add_all(new)
    db.commit()
    for row in new:
        db.refresh(row)
    return new


@app.get("/api/networks", response_model=list[SegmentOutput])
def get_networks(db: Session = Depends(db_session)):
    return db.scalars(select(NetworkSegment).order_by(NetworkSegment.kind, NetworkSegment.name)).all()


@app.post("/api/networks", response_model=SegmentOutput, status_code=201)
def add_network(payload: SegmentInput, db: Session = Depends(db_session)):
    if db.scalars(select(NetworkSegment).where(NetworkSegment.name == payload.name)).first():
        raise HTTPException(409, "Network name exists")
    row = NetworkSegment(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.put("/api/networks/{segment_id}", response_model=SegmentOutput)
def update_network(segment_id: UUID, payload: SegmentInput, db: Session = Depends(db_session)):
    segment = db.get(NetworkSegment, segment_id)
    if segment is None:
        raise HTTPException(404, "Network not found")
    duplicate = db.scalars(select(NetworkSegment).where(NetworkSegment.name == payload.name, NetworkSegment.id != segment_id)).first()
    if duplicate:
        raise HTTPException(409, "Network name exists")
    if segment.kind != payload.kind:
        refs = db.scalars(select(NetworkInterface).where(
            (NetworkInterface.zone_id == segment_id) |
            (NetworkInterface.vlan_id == segment_id) |
            (NetworkInterface.vrf_id == segment_id)
        )).first()
        if refs or db.scalars(select(FlowNetworkHop).where(FlowNetworkHop.segment_id == segment_id)).first():
            raise HTTPException(409, "Cannot change kind of network referenced by interfaces or flow paths")
    for field, value in payload.model_dump().items():
        setattr(segment, field, value)
    db.commit()
    db.refresh(segment)
    return segment


@app.get("/api/network-interfaces", response_model=list[NICOutput])
def get_nics(db: Session = Depends(db_session)):
    return db.scalars(select(NetworkInterface)).all()


@app.post("/api/network-interfaces", response_model=NICOutput, status_code=201)
def add_nic(payload: NICInput, db: Session = Depends(db_session)):
    if not db.get(InfrastructureItem, payload.item_id):
        raise HTTPException(422, "Unknown VM/component")
    for field, kind in [("zone_id", "zone"), ("vlan_id", "vlan"), ("vrf_id", "vrf")]:
        value = getattr(payload, field)
        if value:
            segment = db.get(NetworkSegment, value)
            if not segment or segment.kind != kind:
                raise HTTPException(422, "Invalid " + field)
    row = NetworkInterface(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.put("/api/network-interfaces/{interface_id}", response_model=NICOutput)
def update_nic(interface_id: UUID, payload: NICInput, db: Session = Depends(db_session)):
    row = db.get(NetworkInterface, interface_id)
    if row is None:
        raise HTTPException(404, "Network interface not found")
    if not db.get(InfrastructureItem, payload.item_id):
        raise HTTPException(422, "Unknown VM/component")
    for field, kind in [("zone_id", "zone"), ("vlan_id", "vlan"), ("vrf_id", "vrf")]:
        segment_id = getattr(payload, field)
        if segment_id:
            segment = db.get(NetworkSegment, segment_id)
            if segment is None or segment.kind != kind:
                raise HTTPException(422, "Invalid " + field)
    for field, value in payload.model_dump().items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


@app.delete("/api/network-interfaces/{interface_id}", status_code=204)
def delete_nic(interface_id: UUID, db: Session = Depends(db_session)):
    row = db.get(NetworkInterface, interface_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Network interface not found")
    db.delete(row)
    db.commit()


@app.delete("/api/networks/{segment_id}", status_code=204)
def delete_network(segment_id: UUID, db: Session = Depends(db_session)):
    segment = db.get(NetworkSegment, segment_id)
    if segment is None:
        raise HTTPException(status_code=404, detail="Network not found")
    if db.scalars(select(NetworkInterface).where(
        (NetworkInterface.zone_id == segment_id) |
        (NetworkInterface.vlan_id == segment_id) |
        (NetworkInterface.vrf_id == segment_id)
    )).first():
        raise HTTPException(status_code=409, detail="Network is referenced by interfaces")
    if db.scalars(select(FlowNetworkHop).where(FlowNetworkHop.segment_id == segment_id)).first():
        raise HTTPException(409, "Network segment is referenced by flow paths")
    db.delete(segment)
    db.commit()


@app.post("/api/demo/networks")
def seed_networks(db: Session = Depends(db_session)):
    # Additive synthetic data, no user objects overwritten.
    items = db.scalars(select(InfrastructureItem)).all()
    demo_items = [x for x in items if x.details.get("demo") is True]
    if not demo_items:
        return {"added_segments": 0, "added_interfaces": 0, "message": "Load enterprise demo first"}
    segments = {s.name: s for s in db.scalars(select(NetworkSegment)).all()}
    added_segments = 0
    added_interfaces = 0
    for item in demo_items:
        details = item.details or {}
        for kind, name in [("zone",details.get("security_zone")),("vrf",details.get("vrf"))]:
            if name and name not in segments:
                row = NetworkSegment(name=name, kind=kind, description="Синтетическая демонстрационная сеть", verification="assumed")
                db.add(row); db.flush(); segments[name] = row; added_segments += 1
    existing = {(n.item_id,n.name) for n in db.scalars(select(NetworkInterface)).all()}
    for item in demo_items:
        key = (item.id, "eth0")
        if item.kind not in ("vm", "service", "database") or key in existing:
            continue
        details = item.details or {}
        db.add(NetworkInterface(item_id=item.id, name="eth0",
            zone_id=segments[details["security_zone"]].id if details.get("security_zone") in segments else None,
            vrf_id=segments[details["vrf"]].id if details.get("vrf") in segments else None,
            ip_address=""))
        existing.add(key); added_interfaces += 1
    db.commit()
    return {"added_segments": added_segments, "added_interfaces": added_interfaces}

@app.get("/api/business/categories", response_model=list[CategoryOutput])
def categories(db: Session = Depends(db_session)):
    return db.scalars(select(BusinessCategory).order_by(BusinessCategory.name)).all()


@app.post("/api/business/categories", response_model=CategoryOutput, status_code=201)
def add_category(payload: CategoryInput, db: Session = Depends(db_session)):
    if db.scalars(select(BusinessCategory).where(BusinessCategory.name == payload.name)).first():
        raise HTTPException(409, "Category already exists")
    x = BusinessCategory(**payload.model_dump()); db.add(x); db.commit(); db.refresh(x); return x


@app.get("/api/business/processes", response_model=list[ProcessOutput])
def processes(db: Session = Depends(db_session)):
    return db.scalars(select(BusinessProcess).order_by(BusinessProcess.name)).all()


@app.post("/api/business/processes", response_model=ProcessOutput, status_code=201)
def add_process(payload: ProcessInput, db: Session = Depends(db_session)):
    if not db.get(BusinessCategory, payload.category_id):
        raise HTTPException(422, "Category not found")
    x = BusinessProcess(**payload.model_dump()); db.add(x); db.commit(); db.refresh(x); return x


@app.get("/api/business/system-links", response_model=list[ProcessSystemOutput])
def business_links(db: Session = Depends(db_session)):
    return db.scalars(select(ProcessSystem)).all()


@app.post("/api/business/system-links", response_model=ProcessSystemOutput, status_code=201)
def add_business_link(payload: ProcessSystemInput, db: Session = Depends(db_session)):
    if not db.get(BusinessProcess, payload.process_id) or not db.get(ArchitectureObject, payload.system_id):
        raise HTTPException(422, "Process or system not found")
    x = db.scalars(select(ProcessSystem).where(ProcessSystem.process_id == payload.process_id,ProcessSystem.system_id == payload.system_id)).first()
    if x: return x
    x = ProcessSystem(**payload.model_dump()); db.add(x); db.commit(); db.refresh(x); return x


@app.post("/api/demo/business")
def seed_business(db: Session = Depends(db_session)):
    specs = {
        "Управление персоналом": {"Приём сотрудника": ["1С ЗУП", "ЕИБД", "Active Directory", "Naumen", "Bitrix24"],
                                   "Обновление данных сотрудника": ["1С ЗУП", "Телефонный справочник", "DATAREON"]},
        "Управление ИТ-услугами": {"Обработка обращений": ["Naumen", "Active Directory"],
                                  "Управление доступами": ["Keycloak", "Active Directory", "ЕИБД"]},
    }
    systems = {o.name:o for o in db.scalars(select(ArchitectureObject)).all()}
    cats = {c.name:c for c in db.scalars(select(BusinessCategory)).all()}
    created = 0
    for category, processes in specs.items():
        c = cats.get(category)
        if not c:
            c=BusinessCategory(name=category);db.add(c);db.flush();created+=1
        for name,names in processes.items():
            p=db.scalars(select(BusinessProcess).where(BusinessProcess.category_id==c.id,BusinessProcess.name==name)).first()
            if not p:
                p=BusinessProcess(category_id=c.id,name=name,description="Демонстрационный процесс, требует проверки");db.add(p);db.flush();created+=1
            for system in names:
                if system not in systems:continue
                if not db.scalars(select(ProcessSystem).where(ProcessSystem.process_id==p.id,ProcessSystem.system_id==systems[system].id)).first():
                    db.add(ProcessSystem(process_id=p.id,system_id=systems[system].id,role="demo"));created+=1
    db.commit()
    return {"created":created,"notice":"All process links are illustrative."}


# Import after defining database models to avoid circular dependencies.
from .kis_import import router as kis_router
from . import kis_export  # registers export route before router is mounted
app.include_router(kis_router)

from .knowledge import router as knowledge_router
app.include_router(knowledge_router)

from .incidents import router as incident_router
app.include_router(incident_router)

from .views import router as views_router
app.include_router(views_router)


# Board edits are applied as a single reviewed transaction. For existing interface
# assignments the client supplies the expected previous value (optimistic check).
class BoardChange(BaseModel):
    action: str = Field(pattern="^(create_vm|create_network|create_flow|create_interface|move_interface|update_vm)$")
    id: UUID | None = None
    system_id: UUID | None = None
    name: str = Field(default="", max_length=250)
    kind: str = Field(default="vm", max_length=50)
    description: str = Field(default="", max_length=2000)
    source_id: UUID | None = None
    target_id: UUID | None = None
    protocol: str = Field(default="", max_length=80)
    port: str = Field(default="", max_length=80)
    security: str = Field(default="unknown", max_length=80)
    data_description: str = Field(default="", max_length=4000)
    schedule: str = Field(default="", max_length=160)
    verification: str = Field(default="draft", max_length=30)
    interface_id: UUID | None = None
    item_id: UUID | None = None
    interface_name: str = Field(default="eth0", min_length=1, max_length=100)
    network_id: UUID | None = None
    previous_network_id: UUID | None = None
    previous_name: str | None = None
    previous_description: str | None = None
    details_patch: dict[str, str] = Field(default_factory=dict)
    previous_details: dict[str, Any] = Field(default_factory=dict)
    network_field: str = Field(default="zone_id", pattern="^(zone_id|vlan_id|vrf_id)$")

class BoardBatch(BaseModel):
    changes: list[BoardChange] = Field(min_length=1, max_length=100)
    reason: str = Field(min_length=3, max_length=1000)

class BoardAudit(Base):
    __tablename__ = "board_audit"
    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    reason: Mapped[str] = mapped_column(String(1000))
    actor: Mapped[str] = mapped_column(String(100), default="local-development")
    changes: Mapped[list[dict[str, Any]]] = mapped_column(JSON)

def authorize_board(payload: BoardBatch, request: Request) -> None:
    role = getattr(request.state, 'role', None)
    if role is None:  # Existing local development mode; not suitable for shared deployment.
        return
    grants = ROLE_ACCESS[role]
    for change in payload.changes:
        layer = 'networks' if change.action in ('create_network', 'create_interface', 'move_interface') else ('flows' if change.action == 'create_flow' else 'infrastructure')
        if grants.get(layer) != 'write':
            raise HTTPException(403, f'Insufficient permission to modify {layer}')

def board_actor(request: Request) -> str:
    role = getattr(request.state, 'role', None)
    if role is None:
        return 'local-development'
    token = request.headers.get('authorization', '').removeprefix('Bearer ')
    return role + ':' + hashlib.sha256(token.encode('utf-8')).hexdigest()[:16]

def apply_board_changes(payload: BoardBatch, db: Session) -> list[dict[str, Any]]:
    """Validate and stage all edits in the current SQLAlchemy transaction."""
    output: list[dict[str, Any]] = []
    ids_seen: set[UUID] = set()
    for change in payload.changes:
        if change.action in {"create_vm", "create_flow", "create_network", "create_interface"}:
            if change.id is None:
                raise HTTPException(422, "New objects require a stable UUID id")
            if change.id in ids_seen:
                raise HTTPException(422, "Duplicate UUID in batch")
            ids_seen.add(change.id)
        if change.action == "create_vm":
            if change.kind not in {"vm", "server", "host"} or not change.name.strip() or change.system_id is None:
                raise HTTPException(422, "VM requires system, name and supported kind")
            if db.get(InfrastructureItem, change.id):
                raise HTTPException(409, "VM already exists")
            if not db.get(ArchitectureObject, change.system_id):
                raise HTTPException(422, "Unknown system")
            vm = InfrastructureItem(id=change.id, system_id=change.system_id, kind=change.kind,
                                    name=change.name.strip(), description=change.description, details={})
            db.add(vm)
            output.append({"action": "create_vm", "id": str(vm.id), "after": {"name": vm.name, "system_id": str(vm.system_id)}, "before": None})
        elif change.action == "update_vm":
            if change.id is None:
                raise HTTPException(422, "Component id is required")
            vm = db.get(InfrastructureItem, change.id)
            if vm is None or vm.kind not in {"vm", "server", "host"}:
                raise HTTPException(404, "Component not found")
            if change.system_id is not None and vm.system_id != change.system_id:
                raise HTTPException(409, "Component has moved to another system")
            if change.previous_name is None or change.previous_description is None:
                raise HTTPException(422, "Expected previous values are required")
            if vm.name != change.previous_name or vm.description != change.previous_description:
                raise HTTPException(409, "Component changed since it was opened; refresh and review")
            if not change.name.strip():
                raise HTTPException(422, "Component name is required")
            if set(change.details_patch) - {"purpose", "environment"}:
                raise HTTPException(422, "Unsupported component detail field")
            if set(change.previous_details) != set(change.details_patch):
                raise HTTPException(422, "Expected previous detail fields are required")
            current_details = dict(vm.details or {})
            for key, expected in change.previous_details.items():
                if current_details.get(key) != expected:
                    raise HTTPException(409, "Component details changed since preview; refresh and review")
            before = {"name": vm.name, "description": vm.description,
                      "details": {key: current_details.get(key) for key in change.details_patch}}
            vm.name = change.name.strip()
            vm.description = change.description
            current_details.update(change.details_patch)
            vm.details = current_details
            output.append({"action": "update_vm", "id": str(vm.id), "before": before,
                           "after": {"name": vm.name, "description": vm.description,
                                     "details": {key: current_details[key] for key in change.details_patch}}})
        elif change.action == "create_network":
            if not change.name.strip() or change.kind not in {"zone", "vlan", "vrf"}:
                raise HTTPException(422, "Network requires name and valid type")
            if db.get(NetworkSegment, change.id) or db.scalars(select(NetworkSegment).where(NetworkSegment.name == change.name.strip())).first():
                raise HTTPException(409, "Network already exists")
            segment = NetworkSegment(id=change.id, name=change.name.strip(), kind=change.kind,
                                     description=change.description, verification="draft")
            db.add(segment)
            output.append({"action": "create_network", "id": str(segment.id), "before": None,
                           "after": {"name": segment.name, "kind": segment.kind}})
        elif change.action == "create_flow":
            if not change.name.strip() or not change.source_id or not change.target_id or change.source_id == change.target_id:
                raise HTTPException(422, "Flow requires two different components and a name")
            db.flush()
            if db.get(DataFlow, change.id):
                raise HTTPException(409, "Flow already exists")
            if not db.get(InfrastructureItem, change.source_id) or not db.get(InfrastructureItem, change.target_id):
                raise HTTPException(422, "Flow endpoints not found")
            flow = DataFlow(id=change.id, source_id=change.source_id, target_id=change.target_id, name=change.name.strip(),
                            protocol=change.protocol, port=change.port, security=change.security,
                            data_description=change.data_description, schedule=change.schedule, verification=change.verification)
            db.add(flow)
            output.append({"action": "create_flow", "id": str(flow.id), "before": None,
                           "after": {"source_id": str(flow.source_id), "target_id": str(flow.target_id),
                                     "name": flow.name, "protocol": flow.protocol, "port": flow.port, "security": flow.security}})
        elif change.action == "create_interface":
            if change.item_id is None or change.network_id is None:
                raise HTTPException(422, "New interface requires VM and network")
            db.flush()
            if db.get(NetworkInterface, change.id):
                raise HTTPException(409, "Interface already exists")
            item = db.get(InfrastructureItem, change.item_id)
            if item is None:
                raise HTTPException(422, "Interface component not found")
            network = db.get(NetworkSegment, change.network_id)
            expected_kind = {"zone_id": "zone", "vlan_id": "vlan", "vrf_id": "vrf"}[change.network_field]
            if network is None or network.kind != expected_kind:
                raise HTTPException(422, "Network type mismatch")
            if db.scalars(select(NetworkInterface).where(
                NetworkInterface.item_id == change.item_id,
                NetworkInterface.name == change.interface_name,
            )).first():
                raise HTTPException(409, "Interface with that name already exists")
            nic = NetworkInterface(id=change.id, item_id=change.item_id,
                                   name=change.interface_name, ip_address="",
                                   **{change.network_field: change.network_id})
            db.add(nic)
            output.append({"action": "create_interface", "id": str(nic.id), "before": None,
                           "after": {"item_id": str(nic.item_id), "name": nic.name,
                                     "network_field": change.network_field, "network_id": str(change.network_id)}})
        elif change.action == "move_interface":
            if change.interface_id is None:
                raise HTTPException(422, "Choose a concrete interface for network membership")
            db.flush()
            nic = db.get(NetworkInterface, change.interface_id)
            if nic is None:
                raise HTTPException(404, "Interface not found")
            old = getattr(nic, change.network_field)
            if old != change.previous_network_id:
                raise HTTPException(409, "Network assignment changed since preview; refresh and review")
            expected_kind = {"zone_id": "zone", "vlan_id": "vlan", "vrf_id": "vrf"}[change.network_field]
            if change.network_id is not None:
                segment = db.get(NetworkSegment, change.network_id)
                if not segment or segment.kind != expected_kind:
                    raise HTTPException(422, "Target network kind does not match interface field")
            setattr(nic, change.network_field, change.network_id)
            output.append({"action": "move_interface", "id": str(nic.id), "item_id": str(nic.item_id),
                           "field": change.network_field, "before": str(old) if old else None,
                           "after": str(change.network_id) if change.network_id else None})
    db.flush()
    return output

@app.post("/api/board/preview")
def preview_board_batch(payload: BoardBatch, request: Request, db: Session = Depends(db_session)):
    authorize_board(payload, request)
    try:
        changes = apply_board_changes(payload, db)
        return {"changes": changes, "count": len(changes), "review_required": True}
    finally:
        db.rollback()

@app.post("/api/board/commit")
def commit_board_batch(payload: BoardBatch, request: Request, db: Session = Depends(db_session)):
    authorize_board(payload, request)
    try:
        changes = apply_board_changes(payload, db)
        audit = BoardAudit(reason=payload.reason.strip(), actor=board_actor(request), changes=changes)
        db.add(audit)
        db.commit()
        return {"audit_id": str(audit.id), "changes": changes, "count": len(changes)}
    except Exception:
        db.rollback()
        raise

@app.get("/api/board/audit")
def list_board_audit(limit: int = 50, db: Session = Depends(db_session)):
    rows = db.scalars(select(BoardAudit).order_by(BoardAudit.timestamp.desc()).limit(max(1, min(limit, 200)))).all()
    return [{"id": str(row.id), "timestamp": row.timestamp.isoformat(),
             "reason": row.reason, "actor": row.actor, "changes": row.changes} for row in rows]
