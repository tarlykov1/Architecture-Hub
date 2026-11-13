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


def summarize_legacy_relations(
    object_kinds: dict[str, str], relations: list[dict[str, str]],
) -> dict[str, Any]:
    """Read-only migration inventory; never rewrite existing IDs or links.

    Examples are capped so the diagnostic endpoint remains bounded and
    independent of the text/content of real architecture passports.
    """
    object_counts: dict[str, int] = {}
    for kind in object_kinds.values():
        object_counts[kind] = object_counts.get(kind, 0) + 1

    relation_counts: dict[str, int] = {}
    problems: dict[str, int] = {
        "unknown_kind": 0, "invalid_endpoints": 0,
        "orphan_endpoints": 0, "duplicate_direction": 0,
        "deprecated_data_flow": 0,
    }
    samples: list[dict[str, str]] = []
    seen: set[tuple[str, str, str]] = set()
    for relation in relations:
        kind, source, target = (
            relation["kind"], relation["source_id"], relation["target_id"]
        )
        relation_counts[kind] = relation_counts.get(kind, 0) + 1
        issues: list[str] = []
        if kind not in _BY_KIND:
            issues.append("unknown_kind")
        if source not in object_kinds or target not in object_kinds:
            issues.append("orphan_endpoints")
        elif kind in _BY_KIND and logical_relation_validation_error(
            kind, object_kinds[source], object_kinds[target]
        ):
            issues.append("invalid_endpoints")
        signature = (kind, source, target)
        if signature in seen:
            issues.append("duplicate_direction")
        seen.add(signature)
        if kind == "data_flow":
            issues.append("deprecated_data_flow")
        for issue in issues:
            problems[issue] += 1
        if issues and len(samples) < 20:
            samples.append({"relation_id": relation["id"], "issues": ",".join(issues)})
    return {
        "objects": len(object_kinds),
        "relations": len(relations),
        "object_kinds": dict(sorted(object_counts.items())),
        "relation_kinds": dict(sorted(relation_counts.items())),
        "issues": problems,
        "samples": samples,
        "read_only": True,
    }
