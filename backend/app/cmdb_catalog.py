"""CMDB schema and relationship policy validation.

Built-in inventory remains authoritative. Catalog rules are metadata;
their absence never blocks legacy application flows.
"""
from __future__ import annotations

from typing import Any

ALLOWED_FIELDS = {"lifecycle", "owner", "technical_owner", "criticality",
                  "source_system", "source_record_id", "notes"}
ALLOWED_TYPES = {"text", "number", "boolean", "choice"}
RELATION_KINDS = {"supplies_data_to", "integrates_with", "depends_on"}


def validate_class_schema(required: list[str], fields: list[dict[str, Any]]) -> str | None:
    keys = [item.get("key") for item in fields]
    if any(not isinstance(key, str) or not key.isidentifier() or
           not key.isascii() or len(key) > 50 or key in ALLOWED_FIELDS for key in keys):
        return "Invalid or reserved custom field key"
    if len(set(keys)) != len(keys):
        return "Custom field keys must be unique"
    if any(item.get("type") not in ALLOWED_TYPES for item in fields):
        return "Invalid custom field type"
    if any(item.get("type") == "choice" and not item.get("options") for item in fields):
        return "Choice fields require options"
    options = [item.get("options", []) for item in fields]
    if any(len(set(values)) != len(values) for values in options):
        return "Choice options must be unique"
    available = ALLOWED_FIELDS | set(keys)
    if any(key not in available for key in required):
        return "Required fields must exist in the class schema"
    if len(set(required)) != len(required):
        return "Required fields must not be repeated"
    return None


def validate_custom_values(fields: list[dict[str, Any]], values: dict[str, Any]) -> str | None:
    by_key = {item["key"]: item for item in fields}
    for key, value in values.items():
        field = by_key.get(key)
        if field is None:
            return "Unknown custom field: " + key
        if value is None or value == "":
            continue
        typ = field["type"]
        if typ == "boolean" and type(value) is not bool:
            return "Boolean value expected for " + key
        if typ == "number" and (type(value) not in (int, float) or not float("-inf") < value < float("inf")):
            return "Finite number expected for " + key
        if typ in {"text", "choice"} and (not isinstance(value, str) or len(value) > 2000):
            return "Text value expected for " + key
        if typ == "choice" and value not in field.get("options", []):
            return "Unknown choice for " + key
    return None


def missing_required(node: dict, required: list[str], values: dict[str, Any]) -> list[str]:
    result = []
    for key in required:
        value = values.get(key) if key not in ALLOWED_FIELDS else node.get(key)
        if value is None or value == "" or value == "unknown":
            result.append(key)
    return result


def assess_relation(kind: str, source_class: str, target_class: str, rules: list) -> dict:
    """One enforced source-kind scope is opt-in; other paths stay backward-compatible.

    Unmatched advisory rules are warnings only. All rules carry source/target
    classes so generic drawing links cannot silently become dependencies.
    """
    scoped = [rule for rule in rules
              if rule.relation_kind == kind and rule.source_class == source_class and rule.enabled]
    enforced = [rule for rule in scoped if rule.mode == "enforced"]
    selected = next((rule for rule in scoped if rule.target_class == target_class), None)
    allowed = (not enforced) or any(rule.target_class == target_class for rule in enforced)
    if not allowed:
        message = "Relation is blocked by the enforced CMDB rule for this source class"
    elif selected:
        message = "Relation matches the active CMDB class rule"
    elif scoped:
        message = "No matching recommendation; review the relation class"
    else:
        message = "Legacy relationship: no class rule configured"
    return {
        "allowed": allowed, "enforced": bool(enforced),
        "matched": bool(selected), "message": message,
        "source_class": source_class, "target_class": target_class,
        "relation_kind": kind,
    }
