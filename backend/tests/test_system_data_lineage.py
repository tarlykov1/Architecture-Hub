"""Regression tests for system-centric declared data lineage.

Run with: cd backend && pytest tests/test_system_data_lineage.py
"""
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.main import (
    Base, ArchitectureObject, InfrastructureItem, DataFlow,
    DataAttribute, FlowDataUse, BusinessCategory, BusinessProcess,
    system_data_lineage,
)


def test_system_data_lineage_groups_process_specific_usage():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        source = ArchitectureObject(name="ЗУП", kind="system")
        hub = ArchitectureObject(name="ЕИБД", kind="system")
        consumer = ArchitectureObject(name="Naumen", kind="system")
        db.add_all([source, hub, consumer])
        db.flush()
        source_item = InfrastructureItem(system_id=source.id, kind="service", name="ЗУП API")
        target_item = InfrastructureItem(system_id=hub.id, kind="service", name="ЕИБД API")
        db.add_all([source_item, target_item])
        db.flush()
        flow = DataFlow(source_id=source_item.id, target_id=target_item.id, name="Кадровые данные")
        attribute = DataAttribute(code="employee.number", name="Табельный номер")
        category = BusinessCategory(name="Кадры")
        db.add_all([flow, attribute, category])
        db.flush()
        process = BusinessProcess(category_id=category.id, name="Обработка заявок")
        db.add(process)
        db.flush()
        db.add(FlowDataUse(
            flow_id=flow.id, attribute_id=attribute.id,
            process_id=process.id, consumer_system_id=consumer.id,
            verification="verified",
        ))
        db.commit()

        result = system_data_lineage(consumer.id, db)
        assert result["system_name"] == "Naumen"
        assert len(result["flows"]) == 1
        assert result["flows"][0]["declared_attribute_count"] == 1
        assert result["flows"][0]["data_uses"][0]["process_name"] == "Обработка заявок"
        assert result["flows"][0]["data_uses"][0]["code"] == "employee.number"
        assert {x["name"] for x in result["related_systems"]} == {"ЗУП", "ЕИБД"}

        source_result = system_data_lineage(source.id, db)
        assert len(source_result["flows"]) == 1
        assert source_result["flows"][0]["source_system_id"] == source.id

    engine.dispose()


def test_empty_and_unknown_system():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        system = ArchitectureObject(name="Пустая ИС", kind="system")
        db.add(system)
        db.commit()
        result = system_data_lineage(system.id, db)
        assert result["flows"] == []
        assert result["related_systems"] == []
        with pytest.raises(HTTPException) as exc:
            system_data_lineage(uuid4(), db)
        assert exc.value.status_code == 404
    engine.dispose()
