# Wiki.js knowledge service (Architecture Hub)

Wiki.js is an optional companion service, deployed from this repository but using its own PostgreSQL database. This avoids implementing a separate knowledge editor. It **does not** automatically import Confluence or configure SSO.

## Windows or Linux with Docker Engine

1. Copy the sample environment: `cp .env.wiki.example .env` (PowerShell: `Copy-Item .env.wiki.example .env`); set a strong `WIKI_DB_PASSWORD` in `.env`.
2. Run `docker compose -f compose.wikijs.yml up -d`.
3. Open `http://127.0.0.1:3000` and complete Wiki.js initial administrator setup.
4. The data is persisted in the `wiki_pgdata` Docker volume. Include it in **separate regular backups**.
5. For lifecycle: `docker compose -f compose.wikijs.yml pull && docker compose -f compose.wikijs.yml up -d`. Test version updates before production.

Running this does not change Architecture Hub's SQLite database. Existing Architecture Hub can stay on ports 8001/5174.

## CI/CD and production caveats

A GitHub Actions workflow validates the Wiki.js compose specification for each change. **That is CI, not automatic deployment**. Running containers requires a Docker-capable host or runner; provisioning the host, HTTPS reverse proxy, backup storage and DNS are infrastructure tasks. Do not expose port 3000 publicly; compose binds to 127.0.0.1 only. Configure reverse proxy with TLS and proper authentication before remote use.

Use a secret store for production credentials, never repository files. Before Confluence shutdown make an independent, verified export of pages, attachments and metadata. Confluence migration, user provisioning, SSO and article-level links from Architecture Hub are separate integration steps.
