"""Isolated plans to modify/remove existing VMs and technical flows.

All edits stay in technical_decisions.existing_changes until a separate,
explicitly verified implementation workflow. Publishing an approved decision
never updates registered infrastructure or flow records.
"""
from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import JSON, ForeignKey, Uuid, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from .main import Base


class DecisionChangePlan(Base):
    """Separate additive table: safe if server skipped altering old decision table."""
    __tablename__ = "technical_decision_change_plans"
    decision_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("technical_decisions.id", ondelete="CASCADE"),
        primary_key=True)
    changes: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)


def read_staged(row: Any, db: Session) -> list[dict[str, Any]]:
    plan = db.get(DecisionChangePlan, row.id)
    return list(plan.changes or []) if plan else []


def write_staged(row: Any, changes: list[dict[str, Any]], db: Session) -> None:
    plan = db.get(DecisionChangePlan, row.id)
    if plan is None:
        db.add(DecisionChangePlan(decision_id=row.id, changes=changes))
    else:
        plan.changes = changes
    db.flush()


VM_FIELDS = frozenset({"name", "kind", "description", "environment"})
FLOW_FIELDS = frozenset({
    "name", "source_id", "target_id", "data_description",
    "protocol", "port", "security", "schedule", "verification",
})
LENGTHS = {
    "name": 250, "kind": 60, "description": 4000, "environment": 120,
    "data_description": 4000, "protocol": 80, "port": 80,
    "security": 80, "schedule": 160, "verification": 30,
    "source_id": 40, "target_id": 40,
}


class ExistingChangeInput(BaseModel):
    """Client sends desired changes; the backend owns original fact snapshots."""
    model_config = ConfigDict(extra="forbid")
    kind: Literal["vm", "flow"]
    action: Literal["update", "remove"]
    id: UUID
    fields: dict[str, str] = Field(default_factory=dict, max_length=10)
    # Snapshots are read-only echo fields; clients cannot decide what is true.
    before: dict[str, str] | None = None
    after: dict[str, str] | None = None

    @model_validator(mode="after")
    def validate_fields(self):
        allowed = VM_FIELDS if self.kind == "vm" else FLOW_FIELDS
        if self.action == "remove" and self.fields:
            raise ValueError("Removal must not include update fields")
        if self.action == "update" and not self.fields:
            raise ValueError("Choose at least one property to update")
        for key, value in self.fields.items():
            if key not in allowed:
                raise ValueError("Unsupported property for this architecture object")
            if not isinstance(value, str) or len(value) > LENGTHS[key]:
                raise ValueError("Invalid architecture property length")
            if key == "name" and not value.strip():
                raise ValueError("Architecture object name must not be empty")
            if key == "kind" and value not in {"vm", "server", "host"}:
                raise ValueError("Invalid VM kind")
            if key == "verification" and value not in {"draft", "assumed", "verified"}:
                raise ValueError("Invalid verification state")
        return self


def snapshot(kind: str, item_id: UUID, db: Session) -> dict[str, str] | None:
    from .main import InfrastructureItem, DataFlow
    if kind == "vm":
        item = db.get(InfrastructureItem, item_id)
        if item is None:
            return None
        return {
            "name": item.name, "kind": item.kind,
            "description": item.description or "",
            "environment": str((item.details or {}).get("environment") or ""),
        }
    flow = db.get(DataFlow, item_id)
    if flow is None:
        return None
    return {
        "name": flow.name, "source_id": str(flow.source_id),
        "target_id": str(flow.target_id),
        "protocol": flow.protocol or "", "port": flow.port or "",
        "data_description": flow.data_description or "",
        "security": flow.security or "", "schedule": flow.schedule or "",
        "verification": flow.verification or "",
    }


def compare_registered_change(
    row: Any, changes: list[ExistingChangeInput], db: Session,
    proposed_vms: list[Any] | None = None,
    proposed_flows: list[Any] | None = None,
) -> list[dict[str, Any]]:
    """Check scope and dependencies, return server-authored diff snapshots."""
    from .main import (
        InfrastructureItem, DataFlow, NetworkInterface, SystemTechnology,
        _require_valid_flow_port,
    )
    keys = [(c.kind, c.id) for c in changes]
    if len(set(keys)) != len(keys):
        raise HTTPException(422, "Duplicate change for the same existing object")
    existing = {
        (str(c["kind"]), str(c["id"])): c
        for c in read_staged(row, db) if isinstance(c, dict)
    }
    local = set(db.scalars(select(InfrastructureItem.id).where(
        InfrastructureItem.system_id == row.system_id
    )).all())
    pending_delete_vms = {c.id for c in changes if c.kind == "vm" and c.action == "remove"}
    pending_delete_flows = {c.id for c in changes if c.kind == "flow" and c.action == "remove"}
    proposed_vm_rows = proposed_vms if proposed_vms is not None else (row.proposed_vms or [])
    proposed_flow_rows = proposed_flows if proposed_flows is not None else (row.proposed_flows or [])
    def get_field(record: Any, key: str):
        return record[key] if isinstance(record, dict) else getattr(record, key)
    proposed_ids = {UUID(str(get_field(vm, "id"))) for vm in proposed_vm_rows}
    output: list[dict[str, Any]] = []
    for change in changes:
        before = snapshot(change.kind, change.id, db)
        if before is None:
            raise HTTPException(422, "Referenced existing architecture object not found")
        original = existing.get((change.kind, str(change.id)))
        if original and original.get("before") != before:
            raise HTTPException(409, "Registered architecture changed since the edit was staged")
        if change.kind == "vm":
            if change.id not in local:
                raise HTTPException(422, "Only existing VMs of the selected IS can be modified")
            if change.action == "remove":
                if db.scalar(select(InfrastructureItem.id).where(
                    InfrastructureItem.parent_id == change.id
                )) is not None:
                    raise HTTPException(422, "Unlink child components before proposing VM removal")
                if db.scalar(select(NetworkInterface.id).where(
                    NetworkInterface.item_id == change.id
                )) is not None:
                    raise HTTPException(422, "Unlink interfaces before proposing VM removal")
                if db.scalar(select(SystemTechnology.id).where(
                    SystemTechnology.component_id == change.id
                )) is not None:
                    raise HTTPException(422, "Unlink technology inventory before proposing VM removal")
                attached = set(db.scalars(select(DataFlow.id).where(
                    (DataFlow.source_id == change.id) |
                    (DataFlow.target_id == change.id)
                )).all())
                if attached - pending_delete_flows:
                    raise HTTPException(422, "Stage deletion of connected flows before VM removal")
                for proposed in proposed_flow_rows:
                    if str(change.id) in {str(get_field(proposed, "source_id")), str(get_field(proposed, "target_id"))}:
                        raise HTTPException(422, "A proposed flow still references the removed VM")
        else:
            flow = db.get(DataFlow, change.id)
            if flow is None or not ({flow.source_id, flow.target_id} & local):
                raise HTTPException(422, "Only flows touching the selected IS can be modified")
            if change.action == "update":
                start = change.fields.get("source_id", before["source_id"])
                end = change.fields.get("target_id", before["target_id"])
                try:
                    source, target = UUID(start), UUID(end)
                except ValueError as exc:
                    raise HTTPException(422, "Invalid proposed flow endpoint ID") from exc
                endpoints = local | proposed_ids
                for endpoint in (source, target):
                    if endpoint not in proposed_ids and db.get(InfrastructureItem, endpoint) is None:
                        raise HTTPException(422, "Unknown proposed flow endpoint")
                if source == target:
                    raise HTTPException(422, "Flow source and target must be different")
                if source not in endpoints and target not in endpoints:
                    raise HTTPException(422, "Edited flow must remain connected to the selected IS")
                if source in pending_delete_vms or target in pending_delete_vms:
                    raise HTTPException(422, "Edited flow references a VM staged for removal")
                _require_valid_flow_port(change.fields.get("port", before["port"]))
        after = {**before, **change.fields} if change.action == "update" else None
        if change.action == "update" and after == before:
            raise HTTPException(422, "The staged edit does not change any registered property")
        output.append({
            "kind": change.kind, "id": str(change.id), "action": change.action,
            "fields": change.fields, "before": before, "after": after,
        })
    return output


def verify_staged_architecture(row: Any, db: Session) -> None:
    """Blocks review if a referenced fact changed since planning."""
    for changed in read_staged(row, db):
        latest = snapshot(changed["kind"], UUID(str(changed["id"])), db)
        if latest != changed.get("before"):
            raise HTTPException(409, "The original architecture has changed. Rework the proposal before review")
