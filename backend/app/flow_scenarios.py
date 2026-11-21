"""Saved, collaborative sequences of existing technical data flows.

A scenario documents an intended exchange order; it does NOT verify traffic or
create any new technical flow. Repeated references to the same flow are valid.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Uuid, UniqueConstraint, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, Session, mapped_column

from .main import Base, BusinessProcess, DataFlow, db_session

router = APIRouter(prefix="/api/flow-scenarios", tags=["flows"])


class FlowScenario(Base):
    __tablename__ = "flow_scenarios"
    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    description: Mapped[str] = mapped_column(String(2000), default="", nullable=False)
    process_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("business_processes.id"), nullable=True, index=True)
    revision: Mapped[int] = mapped_column(default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)


class FlowScenarioStep(Base):
    __tablename__ = "flow_scenario_steps"
    __table_args__ = (UniqueConstraint("scenario_id", "position", name="uq_flow_scenario_step_position"),)
    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    scenario_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("flow_scenarios.id", ondelete="CASCADE"), nullable=False, index=True)
    flow_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("data_flows.id"), nullable=False, index=True)
    position: Mapped[int] = mapped_column(nullable=False)
    reply: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    note: Mapped[str] = mapped_column(String(1000), default="", nullable=False)


class StepInput(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    flow_id: UUID
    reply: bool = False
    note: str = Field(default="", max_length=1000)


class ScenarioInput(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    process_id: UUID | None = None
    steps: list[StepInput] = Field(default_factory=list, max_length=150)

    @model_validator(mode="after")
    def validate_values(self):
        self.name = self.name.strip()
        self.description = self.description.strip()
        if not self.name:
            raise ValueError("Scenario name must not be blank")
        if len({step.id for step in self.steps}) != len(self.steps):
            raise ValueError("Scenario step identifiers must be unique")
        # Duplicate flow_ids are legitimate: the same registered flow may be
        # called twice during one business execution.
        return self


class ScenarioUpdate(ScenarioInput):
    expected_revision: int = Field(ge=1)


def _step_dict(step: FlowScenarioStep) -> dict:
    return {
        "id": str(step.id), "flow_id": str(step.flow_id),
        "reply": step.reply, "note": step.note, "position": step.position,
    }


def _dto(row: FlowScenario, db: Session) -> dict:
    steps = db.scalars(select(FlowScenarioStep).where(
        FlowScenarioStep.scenario_id == row.id,
    ).order_by(FlowScenarioStep.position)).all()
    return {
        "id": str(row.id), "name": row.name,
        "description": row.description,
        "process_id": str(row.process_id) if row.process_id else None,
        "revision": row.revision,
        "steps": [_step_dict(step) for step in steps],
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
    }


def _check_refs(payload: ScenarioInput, db: Session) -> None:
    if payload.process_id is not None and db.get(BusinessProcess, payload.process_id) is None:
        raise HTTPException(422, "Business process does not exist")
    ids = {step.flow_id for step in payload.steps}
    existing = set(db.scalars(select(DataFlow.id).where(DataFlow.id.in_(ids))).all()) if ids else set()
    if missing := ids - existing:
        raise HTTPException(422, f"Scenario contains {len(missing)} unknown registered flow(s)")


def _write_steps(row: FlowScenario, payload: ScenarioInput, db: Session) -> None:
    # Replacing positions is atomic with the parent revision and audit entry.
    # Existing step UUIDs persist in the submitted model; only row persistence
    # changes. SQLite/SQLAlchemy may reorder inserts without a flush here.
    old = db.scalars(select(FlowScenarioStep).where(FlowScenarioStep.scenario_id == row.id)).all()
    for step in old:
        db.delete(step)
    db.flush()
    db.add_all([
        FlowScenarioStep(
            id=step.id, scenario_id=row.id, flow_id=step.flow_id,
            position=pos, reply=step.reply, note=step.note.strip()
        ) for pos, step in enumerate(payload.steps)
    ])
    db.flush()


@router.get("")
def list_scenarios(db: Session = Depends(db_session)):
    scenarios = db.scalars(select(FlowScenario).order_by(FlowScenario.name)).all()
    return [_dto(item, db) for item in scenarios]


@router.get("/{scenario_id}")
def get_scenario(scenario_id: UUID, db: Session = Depends(db_session)):
    row = db.get(FlowScenario, scenario_id)
    if row is None:
        raise HTTPException(404, "Exchange scenario not found")
    return _dto(row, db)


@router.post("", status_code=201)
def create_scenario(payload: ScenarioInput, request: Request, db: Session = Depends(db_session)):
    from .main import audit_direct_edit
    _check_refs(payload, db)
    if db.scalar(select(FlowScenario.id).where(FlowScenario.name == payload.name)):
        raise HTTPException(409, "Scenario name already exists")
    row = FlowScenario(name=payload.name, description=payload.description, process_id=payload.process_id)
    db.add(row)
    db.flush()
    _write_steps(row, payload, db)
    audit_direct_edit(db, request, "create_flow_scenario", row.id, None,
                      {"name": row.name, "steps": [step.model_dump(mode="json") for step in payload.steps]},
                      "Создан сценарий обмена " + row.name)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Scenario name or step IDs are already in use") from exc
    return _dto(row, db)


@router.put("/{scenario_id}")
def update_scenario(scenario_id: UUID, payload: ScenarioUpdate, request: Request,
                    db: Session = Depends(db_session)):
    from .main import audit_direct_edit
    row = db.get(FlowScenario, scenario_id)
    if row is None:
        raise HTTPException(404, "Exchange scenario not found")
    _check_refs(payload, db)
    if db.scalar(select(FlowScenario.id).where(
        FlowScenario.name == payload.name, FlowScenario.id != scenario_id)):
        raise HTTPException(409, "Scenario name already exists")
    before = _dto(row, db)
    now = datetime.now(timezone.utc)
    result = db.execute(update(FlowScenario).where(
        FlowScenario.id == scenario_id,
        FlowScenario.revision == payload.expected_revision,
    ).values(revision=payload.expected_revision + 1,
             name=payload.name, description=payload.description,
             process_id=payload.process_id, updated_at=now))
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "Scenario was changed by another editor. Refresh before saving")
    _write_steps(row, payload, db)
    db.refresh(row)
    audit_direct_edit(db, request, "update_flow_scenario", row.id, before,
                      _dto(row, db), "Изменён сценарий обмена " + row.name)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Scenario name or step IDs conflict") from exc
    return _dto(row, db)


@router.delete("/{scenario_id}", status_code=204)
def delete_scenario(scenario_id: UUID, request: Request, db: Session = Depends(db_session)):
    from .main import audit_direct_edit
    row = db.get(FlowScenario, scenario_id)
    if row is None:
        raise HTTPException(404, "Exchange scenario not found")
    before = _dto(row, db)
    for step in db.scalars(select(FlowScenarioStep).where(
        FlowScenarioStep.scenario_id == scenario_id)).all():
        db.delete(step)
    audit_direct_edit(db, request, "delete_flow_scenario", row.id, before, None,
                      "Удалён сценарий обмена " + row.name)
    db.delete(row)
    db.commit()
