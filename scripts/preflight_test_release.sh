#!/usr/bin/env bash
# Read-only release preflight for the existing ArchHub test database, plus an
# online, integrity-checked snapshot. Does not update code, schema, service,
# environment files, repository variables or deployment configuration.
set -Eeuo pipefail
umask 077

APP=/opt/architecture-hub/backend
DB=/var/lib/architecture-hub/architecture_hub.db
BACKUPS=/var/backups/architecture-hub
SERVICE=architecture-hub.service
MIGRATIONS_FLAG=/etc/architecture-hub-enable-migrations
DEPLOY_SCRIPT=/usr/local/sbin/architecture-hub-deploy-backend

abort() { printf 'BLOCKED: %s\n' "$*" >&2; exit 2; }
[ "$(id -u)" = 0 ] || abort "run as root on the test VPS"
[ -f "$DB" ] || abort "SQLite file missing at expected path"
[ -d "$APP" ] || abort "backend app directory missing"
[ -x "$APP/.venv/bin/python" ] || abort "backend Python virtualenv missing"
[ -f /etc/architecture-hub.env ] || abort "backend EnvironmentFile missing"
systemctl is-active --quiet "$SERVICE" || abort "architecture-hub.service is not active"
command -v python3 >/dev/null || abort "Python 3 is unavailable"
systemctl show "$SERVICE" -p EnvironmentFiles --value | grep -Fq '/etc/architecture-hub.env' ||
  abort "service does not use the expected EnvironmentFile"
[ "$(stat -c %U "$DB")" = "archhub" ] ||
  abort "SQLite database owner differs from the documented archhub user"

# The same SQLite path must be configured in systemd's EnvironmentFile.
# Parse it as data (never source/execute it) and never echo credentials.
python3 - /etc/architecture-hub.env "$DB" <<'PY'
from pathlib import Path
import shlex
import sys

file_path, expected = sys.argv[1:]
entries = {}
for raw in Path(file_path).read_text().splitlines():
    line = raw.strip()
    if not line or line.startswith("#"):
        continue
    if line.startswith("DATABASE_URL="):
        entries["DATABASE_URL"] = shlex.split(line.partition("=")[2])[0]
database_url = entries.get("DATABASE_URL", "")
if database_url != "sqlite:////" + expected.lstrip("/"):
    raise SystemExit(
        "BLOCKED: DATABASE_URL differs from the expected SQLite path "
        "or is not explicitly configured; no sensitive values disclosed."
    )
print("PASS: backend environment points to the expected SQLite file")
PY

# Capture a consistent copy through the sqlite backup API, not a raw file
# copy of a live SQLite database. All snapshot files remain root-readable.
install -d -m 0700 "$BACKUPS"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
snapshot="$(mktemp -d "$BACKUPS/release-preflight-$stamp-XXXXXX")"
chmod 0700 "$snapshot"

python3 - "$DB" "$snapshot/architecture_hub.db" <<'PY'
import sqlite3
import sys

source, destination = sys.argv[1:3]
with sqlite3.connect(f"file:{source}?mode=ro", uri=True, timeout=30) as original:
    with sqlite3.connect(destination, timeout=30) as saved:
        original.backup(saved, pages=100, sleep=0.1)
        result = saved.execute("PRAGMA integrity_check").fetchone()[0]
        if result != "ok":
            raise SystemExit(f"BLOCKED: SQLite snapshot integrity check: {result}")
print("PASS: consistent SQLite snapshot created; integrity_check=ok")
PY
chmod 0600 "$snapshot/architecture_hub.db"
printf 'SNAPSHOT: %s/architecture_hub.db\n' "$snapshot"

# Inspect ONLY the snapshot. Never modify the live DB and never enumerate
# names, attributes, passwords, endpoint addresses, or business records.
python3 - "$snapshot/architecture_hub.db" <<'PY'
import sqlite3
import sys

db = sys.argv[1]
with sqlite3.connect(f"file:{db}?mode=ro", uri=True) as connection:
    tables = {
        row[0] for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
    }
    required = {"objects", "relations", "board_layouts", "network_segments",
                "network_interfaces", "data_flows"}
    missing = required - tables
    if missing:
        raise SystemExit("BLOCKED: missing required tables: " + ", ".join(sorted(missing)))

    if "alembic_version" not in tables:
        raise SystemExit(
            "BLOCKED: existing database has no alembic_version table. "
            "Do not stamp or upgrade without reconciling the live schema."
        )
    revisions = [
        row[0] for row in connection.execute(
            "SELECT version_num FROM alembic_version"
        )
    ]
    known = {
        "0009_monitoring_links", "0010_auth_users",
        "0011_architecture_layer_regions", "0012_layer_region_opacity",
        "0013_logical_relation_unique", "0014_layer_region_revisions",
    }
    if len(revisions) != 1 or revisions[0] not in known:
        raise SystemExit(
            "BLOCKED: unknown/ambiguous Alembic baseline; inspect manually. "
            "Reported revisions: " + ", ".join(revisions)
        )
    print("PASS: Alembic baseline:", revisions[0])
    duplicate_count = connection.execute("""
        SELECT COUNT(*) FROM (
            SELECT kind, source_id, target_id
            FROM relations
            WHERE kind IN ('integrates_with', 'depends_on')
            GROUP BY kind, source_id, target_id
            HAVING COUNT(*) > 1
        )
    """).fetchone()[0]
    print("INFO: duplicate active logical IS relations:", duplicate_count)
    if duplicate_count:
        raise SystemExit(
            "BLOCKED: migration 0013 would reject historical duplicate "
            "logical relations. Review their IDs and reconcile manually; "
            "do not delete automatically."
        )
    print("PASS: migration 0013 uniqueness preflight")
PY

if [ ! -x "$DEPLOY_SCRIPT" ]; then
  echo "BLOCKED: restricted root-owned backend deploy script is not installed." >&2
  exit 3
fi
if [ ! -f "$MIGRATIONS_FLAG" ]; then
  echo "BLOCKED: backend migrations have not been explicitly enabled on this VPS." >&2
  exit 3
fi

curl --fail --silent --show-error --max-time 8 http://127.0.0.1:8001/api/health >/dev/null ||
  abort "local backend health check failed"

echo "PASS: backend service active, deployment script and migration flag exist."
echo "READY_FOR_TEST_RELEASE_PRECHECK=1"
echo "IMPORTANT: apply migrations on a COPY of this snapshot before updating the live server."
