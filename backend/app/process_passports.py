"""Canonical business-process passports and ordered steps.

The existing business_processes table remains the one canonical process
registry. These rows extend it, never create a second business-process entity.
A step references real IS, components, flows and data-attribute definitions.
No transmitted values or employee personal records are stored.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import DateTime, ForeignKey, JSON, String, Uuid, UniqueConstraint, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, Session, mapped_column

from .main import (
    Base, ArchitectureObject, BusinessProcess, DataAttribute, DataFlow,
    InfrastructureItem, db_session,
)

router = APIRouter(prefix="/api/business/process-passports", tags=["business"])


class ProcessPassport(Base):
    __tablename__ = "business_process_passports"
    process_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("business_processes.id", ondelete="CASCADE"),
        primary_key=True,
    )
    parent_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("business_processes.id"), nullable=True, index=True,
    )
    owner: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    participants: Mapped[str] = mapped_column(String(1000), default="", nullable=False)
    result: Mapped[str] = mapped_column(String(2000), default="", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False)
    revision: Mapped[int] = mapped_column(default=1, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


class ProcessStep(Base):
    __tablename__ = "business_process_steps"
    __table_args__ = (
        UniqueConstraint("process_id", "position", name="uq_business_process_step_position"),
    )
    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    process_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("business_processes.id", ondelete="CASCADE"),
        index=True, nullable=False,
    )
    position: Mapped[int] = mapped_column(nullable=False)
    name: Mapped[str] = mapped_column(String(250), nullable=False)
    description: Mapped[str] = mapped_column(String(2000), default="", nullable=False)
    responsible: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    input: Mapped[str] = mapped_column(String(2000), default="", nullable=False)
    output: Mapped[str] = mapped_column(String(2000), default="", nullable=False)
    system_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("objects.id"), nullable=True,
    )
    component_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("infrastructure_items.id"), nullable=True,
    )
    flow_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("data_flows.id"), nullable=True,
    )
    attribute_ids: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)


class StepInput(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    name: str = Field(min_length=1, max_length=250)
    description: str = Field(default="", max_length=2000)
    responsible: str = Field(default="", max_length=200)
    input: str = Field(default="", max_length=2000)
    output: str = Field(default="", max_length=2000)
    system_id: UUID | None = None
    component_id: UUID | None = None
    flow_id: UUID | None = None
    attribute_ids: list[UUID] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def normalized(self):
        self.name = self.name.strip()
        if not self.name:
            raise ValueError("Process step name must not be empty")
        if len(set(self.attribute_ids)) != len(self.attribute_ids):
            raise ValueError("Duplicate data attribute references")
        return self


class PassportInput(BaseModel):
    expected_revision: int = Field(ge=0)
    parent_id: UUID | None = None
    owner: str = Field(default="", max_length=200)
    participants: str = Field(default="", max_length=1000)
    result: str = Field(default="", max_length=2000)
    status: Literal["draft", "active", "retired"] = "draft"
    steps: list[StepInput] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def validate_steps(self):
        if len({step.id for step in self.steps}) != len(self.steps):
            raise ValueError("Duplicate business process step identifiers")
        return self


def _step_dto(row: ProcessStep) -> dict:
    return {
        "id": str(row.id), "position": row.position, "name": row.name,
        "description": row.description, "responsible": row.responsible,
        "input": row.input, "output": row.output,
        "system_id": str(row.system_id) if row.system_id else None,
        "component_id": str(row.component_id) if row.component_id else None,
        "flow_id": str(row.flow_id) if row.flow_id else None,
        "attribute_ids": list(row.attribute_ids or []),
    }


def _dto(process: BusinessProcess, db: Session) -> dict:
    record = db.get(ProcessPassport, process.id)
    steps = db.scalars(select(ProcessStep).where(
        ProcessStep.process_id == process.id,
    ).order_by(ProcessStep.position)).all()
    return {
        "process_id": str(process.id), "category_id": str(process.category_id),
        "name": process.name, "description": process.description,
        "parent_id": str(record.parent_id) if record and record.parent_id else None,
        "owner": record.owner if record else "",
        "participants": record.participants if record else "",
        "result": record.result if record else "",
        "status": record.status if record else "draft",
        "revision": record.revision if record else 0,
        "updated_at": record.updated_at.isoformat() if record else None,
        "steps": [_step_dto(step) for step in steps],
    }


def _check_parent(process: BusinessProcess, parent_id: UUID | None, db: Session):
    if parent_id is None:
        return
    if parent_id == process.id:
        raise HTTPException(422, "A process cannot be its own parent")
    visited = {process.id}
    cursor: UUID | None = parent_id
    for _ in range(250):
        if cursor is None:
            return
        if cursor in visited:
            raise HTTPException(422, "Process hierarchy cannot contain a cycle")
        visited.add(cursor)
        parent = db.get(BusinessProcess, cursor)
        if parent is None:
            raise HTTPException(422, "Parent business process does not exist")
        if parent.category_id != process.category_id:
            raise HTTPException(422, "Parent business process must belong to the same category")
        profile = db.get(ProcessPassport, cursor)
        cursor = profile.parent_id if profile else None
    raise HTTPException(422, "Process hierarchy exceeds supported depth")


def _validate(process: BusinessProcess, payload: PassportInput, db: Session):
    _check_parent(process, payload.parent_id, db)
    ids = {s.id for s in payload.steps}
    if ids:
        other_ids = set(db.scalars(select(ProcessStep.id).where(
            ProcessStep.id.in_(ids), ProcessStep.process_id != process.id,
        )).all())
        if other_ids:
            raise HTTPException(409, "A step identifier belongs to another business process")
    system_ids = {s.system_id for s in payload.steps if s.system_id}
    component_ids = {s.component_id for s in payload.steps if s.component_id}
    flow_ids = {s.flow_id for s in payload.steps if s.flow_id}
    attribute_ids = {id for s in payload.steps for id in s.attribute_ids}
    systems = {
        row.id: row for row in db.scalars(select(ArchitectureObject).where(
            ArchitectureObject.id.in_(system_ids))).all()
    } if system_ids else {}
    if any(id not in systems or systems[id].kind != "system" for id in system_ids):
        raise HTTPException(422, "A step references an unknown information system")
    components = {
        row.id: row for row in db.scalars(select(InfrastructureItem).where(
            InfrastructureItem.id.in_(component_ids))).all()
    } if component_ids else {}
    if component_ids - set(components):
        raise HTTPException(422, "A step references an unknown component")
    existing_flows = set(db.scalars(select(DataFlow.id).where(
        DataFlow.id.in_(flow_ids))).all()) if flow_ids else set()
    if flow_ids - existing_flows:
        raise HTTPException(422, "A step references an unknown technical flow")
    existing_attributes = set(db.scalars(select(DataAttribute.id).where(
        DataAttribute.id.in_(attribute_ids))).all()) if attribute_ids else set()
    if attribute_ids - existing_attributes:
        raise HTTPException(422, "A step references an unknown data attribute")
    for step in payload.steps:
        if step.component_id:
            if not step.system_id:
                raise HTTPException(422, "Specify an IS for the selected component")
            if components[step.component_id].system_id != step.system_id:
                raise HTTPException(422, "A component must belong to the selected IS")


def _replace_steps(process_id: UUID, incoming: list[StepInput], db: Session) -> None:
    old = db.scalars(select(ProcessStep).where(ProcessStep.process_id == process_id)).all()
    for item in old:
        db.delete(item)
    db.flush()
    db.add_all([
        ProcessStep(
            id=step.id, process_id=process_id, position=idx,
            name=step.name.strip(), description=step.description.strip(),
            responsible=step.responsible.strip(), input=step.input.strip(),
            output=step.output.strip(), system_id=step.system_id,
            component_id=step.component_id, flow_id=step.flow_id,
            attribute_ids=[str(id) for id in step.attribute_ids],
        ) for idx, step in enumerate(incoming)
    ])
    db.flush()


@router.get("")
def list_passports(db: Session = Depends(db_session)):
    processes = db.scalars(select(BusinessProcess).order_by(BusinessProcess.name)).all()
    return [_dto(process, db) for process in processes]


@router.get("/{process_id}")
def get_passport(process_id: UUID, db: Session = Depends(db_session)):
    process = db.get(BusinessProcess, process_id)
    if process is None:
        raise HTTPException(404, "Business process not found")
    return _dto(process, db)


@router.put("/{process_id}")
def save_passport(process_id: UUID, payload: PassportInput, request: Request,
                  db: Session = Depends(db_session)):
    from .main import audit_direct_edit
    process = db.get(BusinessProcess, process_id)
    if process is None:
        raise HTTPException(404, "Business process not found")
    _validate(process, payload, db)
    before = _dto(process, db)
    now = datetime.now(timezone.utc)
    row = db.get(ProcessPassport, process_id)
    if row is None:
        if payload.expected_revision != 0:
            raise HTTPException(409, "Process passport version changed. Refresh before saving")
        row = ProcessPassport(
            process_id=process_id, parent_id=payload.parent_id,
            owner=payload.owner.strip(), participants=payload.participants.strip(),
            result=payload.result.strip(), status=payload.status, revision=1,
            updated_at=now,
        )
        db.add(row)
        try:
            db.flush()
        except IntegrityError as exc:
            db.rollback()
            raise HTTPException(409, "Process passport was created concurrently") from exc
    else:
        changed = db.execute(update(ProcessPassport).where(
            ProcessPassport.process_id == process_id,
            ProcessPassport.revision == payload.expected_revision,
        ).values(
            revision=payload.expected_revision+1, parent_id=payload.parent_id,
            owner=payload.owner.strip(), participants=payload.participants.strip(),
            result=payload.result.strip(), status=payload.status,
            updated_at=now,
        ))
        if changed.rowcount != 1:
            db.rollback()
            raise HTTPException(409, "Process passport changed. Refresh before saving")
    _replace_steps(process_id, payload.steps, db)
    db.expire(row)
    after = _dto(process, db)
    audit_direct_edit(db, request, "update_business_process_passport", process_id,
                      before, after, "Обновлён паспорт бизнес-процесса "+process.name)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Process steps have a conflicting identifier") from exc
    return _dto(process, db)
