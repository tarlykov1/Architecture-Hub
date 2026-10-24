"""Optional API access policies for Architecture Hub.

Set ARCH_HUB_ACCESS_KEYS to a JSON object of opaque bearer tokens and roles:
{"<long-random-token>":"architect","<other-token>":"security"}
When unset, preserve the existing *local-development-only* unauthenticated mode.
Do not expose this development mode on a network.
"""
from __future__ import annotations

import hmac
import json
import os

from fastapi import Request
from starlette.responses import JSONResponse

# Permissions are enforced at API level, not by hiding frontend tabs.
# 'read' and 'write' map to layers; no access is the default.
ROLE_ACCESS = {
    "admin": {"business": "write", "systems": "write", "infrastructure": "write", "networks": "write", "flows": "write", "diagrams": "write", "import": "write", "knowledge": "write", "incidents": "write", "views": "write"},
    "architect": {"business": "write", "systems": "write", "infrastructure": "write", "networks": "read", "flows": "write", "diagrams": "write", "import": "write", "knowledge": "write", "views": "write", "incidents": "write"},
    "engineer": {"systems": "read", "infrastructure": "write", "networks": "write", "flows": "read", "diagrams": "read", "incidents": "read", "views": "read"},
    "security": {"systems": "read", "infrastructure": "read", "networks": "write", "flows": "read", "diagrams": "read", "views": "read"},
    "business_owner": {"business": "write", "systems": "read", "diagrams": "read", "views": "read"},
    "viewer": {"systems": "read", "business": "read", "diagrams": "read", "incidents": "read", "views": "read"},
}

def classify(path: str) -> str | None:
    if path.startswith("/api/demo/"):
        return "demo"
    if path.startswith("/api/views"):
        return "views"
    if path.startswith("/api/incidents"):
        return "incidents"
    if path.startswith("/api/knowledge/"):
        return "knowledge"
    if path.startswith("/api/kis/"):
        return "import"
    if path.startswith("/api/business/"):
        return "business"
    if path.startswith("/api/networks") or path.startswith("/api/network-interfaces"):
        return "networks"
    if path.startswith("/api/infra"):
        return "infrastructure"
    if path.startswith("/api/flows"):
        return "flows"
    if path.startswith("/api/diagrams"):
        return "diagrams"
    if path.startswith("/api/objects") or path.startswith("/api/relations"):
        return "systems"
    return None

def configured_keys() -> dict[str, str] | None:
    raw = os.getenv("ARCH_HUB_ACCESS_KEYS", "").strip()
    if not raw:
        return None
    try:
        result = json.loads(raw)
        if not isinstance(result, dict) or not result or any(
            not isinstance(token, str) or len(token) < 24 or role not in ROLE_ACCESS
            for token, role in result.items()
        ):
            raise ValueError("Expected nonempty token-to-role map (tokens >= 24 characters)")
        return result
    except (ValueError, TypeError) as exc:
        raise RuntimeError("Invalid ARCH_HUB_ACCESS_KEYS configuration") from exc

async def access_middleware(request: Request, call_next):
    path = request.url.path
    keys = request.app.state.arch_hub_keys
    if keys is None:
        return await call_next(request)
    if request.method.upper() == "OPTIONS" or path in ("/api/health", "/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc"):
        return await call_next(request)
    if not path.startswith("/api/"):
        return await call_next(request)
    auth = request.headers.get("authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else ""
    role = next((role for key, role in keys.items() if hmac.compare_digest(key, token)), None)
    if not role:
        return JSONResponse({"detail":"Authentication required"}, status_code=401, headers={"WWW-Authenticate":"Bearer"})
    layer = classify(path)
    if layer == "demo":
        return JSONResponse({"detail":"Demo seed endpoints are disabled in access-controlled mode"}, status_code=403)
    if layer is None:
        return JSONResponse({"detail":"Unknown API endpoint is not authorized"}, status_code=403)
    grant = ROLE_ACCESS[role].get(layer)
    method = request.method.upper()
    if grant not in ("read", "write") or (method not in ("GET", "HEAD", "OPTIONS") and grant != "write"):
        return JSONResponse({"detail":"Insufficient permissions for "+layer}, status_code=403)
    request.state.role = role
    return await call_next(request)
