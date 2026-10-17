from __future__ import annotations

import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, HTTPException
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


app = FastAPI(title="Architecture Hub API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type"],
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
