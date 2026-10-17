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
