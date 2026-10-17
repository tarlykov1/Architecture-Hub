# Architecture Hub

MVP корпоративного реестра ИТ-архитектуры и редактора схем.

Stack: FastAPI, PostgreSQL, React, TypeScript, React Flow, Docker Compose.

## Quick start

```bash
docker compose up --build
```

- Web UI: http://localhost:5173
- API: http://localhost:8000/docs

MVP supports creating systems, adding and editing directed relationships, and building architecture diagrams from catalog objects. Data is stored in PostgreSQL.

**Security:** the local MVP has no authentication yet. Use only on a trusted local machine with non-sensitive sample data. Do not expose it to the internet or enter real confidential enterprise data until authentication and access restrictions are implemented.
