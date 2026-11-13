"""Canonical metadata for *logical IS-to-IS* relations.

The generic /api/relations table contains ArchitectureObject IDs, NOT VM,
NetworkInterface, VRF or Flow IDs. Never interpret a line on the IS canvas as
proof that a technical network path or a transported attribute exists.

Existing rows with unknown/legacy kinds remain readable; new writes are
limited to the registry below. Technical data exchanges must use /api/flows.
"""
from __future__ import annotations

from typing import Any

LOGICAL_RELATION_TYPES: tuple[dict[str, Any], ...] = (
    {
        "kind": "integrates_with",
        "label": "Интеграционная зависимость",
        "description": "Декларируемое логическое взаимодействие ИС. Не подтверждает протокол, порт и маршрут.",
        "source_kind": "system",
        "target_kind": "system",
        "directional": True,
        "technical_flow": False,
        "deprecated": False,
    },
    {
        "kind": "depends_on",
        "label": "Зависит от",
        "description": "Направленная зависимость ИС от другой ИС; источник зависит от получателя.",
        "source_kind": "system",
        "target_kind": "system",
        "directional": True,
        "technical_flow": False,
        "deprecated": False,
    },
    {
        "kind": "data_flow",
        "label": "Заявленный обмен (устаревший тип)",
        "description": "Историческая общая связь двух ИС. Не является подтверждённым техническим потоком; используйте /api/flows.",
        "source_kind": "system",
        "target_kind": "system",
        "directional": True,
        "technical_flow": False,
        "deprecated": True,
    },
)

_BY_KIND = {item["kind"]: item for item in LOGICAL_RELATION_TYPES}


def get_logical_relation_types() -> list[dict[str, Any]]:
    """Return independently copyable documented contracts for clients."""
    return [dict(item) for item in LOGICAL_RELATION_TYPES]


def logical_relation_validation_error(kind: str, source_kind: str, target_kind: str) -> str | None:
    """Validate *new writes*, without retroactively deleting historical links."""
    definition = _BY_KIND.get(kind)
    if definition is None:
        return "Неизвестный тип связи ИС. Используйте тип из /api/metamodel/relation-types."
    if source_kind != definition["source_kind"] or target_kind != definition["target_kind"]:
        return "Логическая связь ИС допускает только две информационные системы (kind=system)."
    return None
