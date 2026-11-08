"""Read-only CMDB projection and conservative impact analysis.

The architecture register owns the configuration items. This module creates
views over existing objects instead of duplicating inventory records.
"""
from __future__ import annotations

from collections import defaultdict, deque
from typing import Any


def ci_graph(systems: list[Any], components: list[Any], relations: list[Any],
             flows: list[Any], processes: list[Any], process_systems: list[Any]) -> dict:
    nodes: dict[str, dict] = {}
    edges: list[dict] = []

    def add_node(key: str, name: str, ci_class: str, lifecycle: str = "unknown",
                 owner: Any = None, criticality: Any = None, verified_at: Any = None):
        nodes[key] = {
            "id": key, "name": name, "ci_class": ci_class,
            "lifecycle": lifecycle, "owner": str(owner) if owner else None,
            "criticality": str(criticality) if criticality else None,
            "verified_at": str(verified_at) if verified_at else None,
            "source": "architecture_hub",
        }

    for s in systems:
        attributes = s.attributes or {}
        add_node(f"system:{s.id}", s.name, "application",
                 s.status or "unknown", attributes.get("owner"),
                 attributes.get("criticality"), attributes.get("last_verified_at"))
    for c in components:
        details = c.details or {}
        add_node(f"component:{c.id}", c.name, c.kind or "component",
                 str(details.get("lifecycle") or "unknown"),
                 details.get("owner"), details.get("criticality"),
                 details.get("last_verified_at"))
        parent = f"system:{c.system_id}"
        if parent in nodes:
            edges.append({
                "id": f"member:{c.id}", "source": f"component:{c.id}", "target": parent,
                "kind": "supports", "verified": False, "impact_candidate": True,
                "origin": "system_membership",
            })

    for p in processes:
        add_node(f"process:{p.id}", p.name, "business_process")
    for ps in process_systems:
        source, target = f"system:{ps.system_id}", f"process:{ps.process_id}"
        if source in nodes and target in nodes:
            edges.append({
                "id": f"process-system:{ps.id}", "source": source, "target": target,
                "kind": "supports_process", "verified": False,
                "impact_candidate": True, "origin": "process_system_link",
            })

    for relation in relations:
        source, target = f"system:{relation.source_id}", f"system:{relation.target_id}"
        if source not in nodes or target not in nodes:
            continue
        # A generic integration is NOT evidence of an operational dependency.
        kind = (relation.kind or "integrates_with").lower()
        impact_direction = (target, source) if kind == "depends_on" else None
        edges.append({
            "id": f"system-relation:{relation.id}",
            "source": impact_direction[0] if impact_direction else source,
            "target": impact_direction[1] if impact_direction else target,
            "kind": kind, "verified": False,
            "impact_candidate": bool(impact_direction), "origin": "architecture_relation",
        })

    for component in components:
        if component.parent_id:
            source, target = f"component:{component.id}", f"component:{component.parent_id}"
            if source in nodes and target in nodes:
                edges.append({
                    "id": f"hierarchy:{component.id}", "source": source, "target": target,
                    "kind": "part_of", "verified": False,
                    "impact_candidate": False, "origin": "component_hierarchy",
                })

    for flow in flows:
        source, target = f"component:{flow.source_id}", f"component:{flow.target_id}"
        if source in nodes and target in nodes:
            edges.append({
                "id": f"flow:{flow.id}", "source": source, "target": target,
                "kind": "supplies_data_to", "verified": flow.verification == "verified",
                "impact_candidate": True, "origin": "data_flow",
                "protocol": flow.protocol or None, "port": flow.port or None,
                "verification": flow.verification or "draft",
            })

    return {"nodes": sorted(nodes.values(), key=lambda x: (x["ci_class"], x["name"], x["id"])),
            "edges": sorted(edges, key=lambda x: x["id"])}


def potential_impact(graph: dict, ci_id: str, depth: int = 3) -> dict:
    """Follow directed, explicit candidate dependencies, not mere visual links.

    Results are POTENTIAL impact, not confirmed incidents or health states.
    Cycles and repeated edges are deduplicated. The shortest path wins.
    """
    node_by_id = {node["id"]: node for node in graph["nodes"]}
    if ci_id not in node_by_id:
        raise KeyError(ci_id)
    adjacency = defaultdict(list)
    for edge in graph["edges"]:
        if edge["impact_candidate"]:
            adjacency[edge["source"]].append(edge)
    for group in adjacency.values():
        group.sort(key=lambda edge: (edge["target"], edge["id"]))

    visited = {ci_id}
    queue = deque([(ci_id, 0, [ci_id], [], True)])
    affected = []
    while queue:
        current, distance, path, relations, fully_verified = queue.popleft()
        if distance >= depth:
            continue
        for edge in adjacency[current]:
            target = edge["target"]
            if target in visited:
                continue
            visited.add(target)
            route = path + [target]
            via = relations + [edge["kind"]]
            affected.append({
                "node": node_by_id[target], "depth": distance + 1,
                "path": route, "relations": via,
                "confidence": "known_relation" if fully_verified and edge["verified"] else "requires_verification",
            })
            queue.append((target, distance + 1, route, via, fully_verified and edge["verified"]))
    return {
        "root": node_by_id[ci_id], "depth": depth,
        "affected": affected, "count": len(affected),
        "disclaimer": "Потенциальное влияние по зарегистрированным связям; не подтверждает отказ и не заменяет анализ критичности и отказоустойчивости.",
    }
