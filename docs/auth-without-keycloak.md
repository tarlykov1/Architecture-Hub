# Authentication strategy without Keycloak

Architecture Hub intentionally **does not require Keycloak** for local testing.

## Local development
The Windows `start.ps1` binds FastAPI and Vite only to `127.0.0.1`. When `ARCH_HUB_ACCESS_KEYS` is **unset**, API access is not authenticated. This is **only for a trusted local machine**. Do not expose ports 8001/5174 publicly or via a reverse proxy in this mode.

## Role-based test mode
Set `ARCH_HUB_ACCESS_KEYS` in the backend process environment to JSON mapping randomly generated opaque bearer tokens (at least 24 characters) to the predefined roles: `admin`, `architect`, `engineer`, `security`, `business_owner`, `viewer`. These are API credentials, not named-user identities.

Use the UI's access-key field to authenticate requests. Do not commit keys or add them to URLs. The server enforces API permissions even when UI controls remain visible. Integration tests use throwaway CI-only tokens.

`admin` and `architect` may edit incidents. Per-entity owner/assignee/first-line specialist authorization **is not supported yet** – names in the incident form are metadata, not authenticated principals. Do not rely on them as authorization checks.

## Future SSO
Later, Keycloak or another identity provider can verify user tokens and supply an authenticated principal to the same role / resource authorization layer. Until then, there is **no claim of real single sign-on or user-specific ownership permissions**.

## Team views
Shared views are persisted on the API server. Readers can see only views for architecture sections they can access. Only global `views:write` roles can create/edit/delete, with an additional section-access check. The identity of the author is not recorded, so views cannot have reliable individual owners until user authentication is implemented.
