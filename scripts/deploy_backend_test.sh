#!/usr/bin/env bash
# Install as root-owned /usr/local/sbin/architecture-hub-deploy-backend.
# Execute ONLY through a narrowly scoped sudoers entry for archdeploy.
set -Eeuo pipefail
umask 077

STAGING=/home/archdeploy/backend-release
APP=/opt/architecture-hub/backend
DB=/var/lib/architecture-hub/architecture_hub.db
BACKUPS=/var/backups/architecture-hub
SERVICE=architecture-hub.service
VENV="$APP/.venv"
USER_NAME=archhub
ENV_FILE=/etc/architecture-hub.env

fail(){ echo "Backend deploy: $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || fail "must run as root through restricted sudo"
[ -f "$STAGING/app/main.py" ] && [ -f "$STAGING/requirements.txt" ] && [ -f "$STAGING/alembic.ini" ] || fail "staging is incomplete"
[ ! -L "$STAGING" ] && [ ! -L "$STAGING/app" ] && [ ! -L "$STAGING/alembic" ] || fail "symlinks in staging not allowed"
[ -d "$APP" ] || fail "backend directory missing: $APP"
[ -f "$DB" ] || fail "database missing: $DB; refusing deployment"
[ -x "$VENV/bin/python" ] || fail "venv missing: $VENV; provision it before enabling CI"
[ -f "$ENV_FILE" ] || fail "EnvironmentFile missing: $ENV_FILE"
command -v rsync >/dev/null || fail "rsync not installed"
command -v runuser >/dev/null || fail "runuser not installed"

install -d -m 0700 "$BACKUPS"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
snapshot="$BACKUPS/$stamp"
install -d -m 0700 "$snapshot"
tar -C "$APP" -czf "$snapshot/code.tar.gz" app alembic alembic.ini requirements.txt
# Online SQLite backup, run as the database owner. Backup lives in root-only storage.
install -d -o "$USER_NAME" -g "$USER_NAME" -m 0700 "$snapshot/db"
runuser -u "$USER_NAME" -- /usr/bin/python3 - "$DB" "$snapshot/db/architecture_hub.db" <<'PY'
import sqlite3, sys
source, destination = sys.argv[1:]
with sqlite3.connect(f"file:{source}?mode=ro", uri=True, timeout=30) as src:
    with sqlite3.connect(destination, timeout=30) as dst:
        src.backup(dst, pages=100, sleep=0.1)
        assert dst.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
PY
chmod 0700 "$snapshot/db"
echo "Database and code backup complete: $snapshot"

restore_code(){
  echo "Restoring previous backend code" >&2
  rm -rf -- "$APP/app" "$APP/alembic"
  tar -C "$APP" -xzf "$snapshot/code.tar.gz"
  chown -R "$USER_NAME:$USER_NAME" "$APP/app" "$APP/alembic" "$APP/alembic.ini" "$APP/requirements.txt"
}
restarted=0
rollback(){
  rc=$?
  trap - ERR
  echo "Backend deployment failed (exit $rc)" >&2
  restore_code || true
  if [ "$restarted" = 1 ]; then systemctl restart "$SERVICE" || true; fi
  echo "SQLite was NOT automatically restored. Backup: $snapshot/db/architecture_hub.db" >&2
  exit "$rc"
}
trap rollback ERR

rsync -r --delete --no-links "$STAGING/app/" "$APP/app/"
rsync -r --delete --no-links "$STAGING/alembic/" "$APP/alembic/"
install -m 0644 "$STAGING/alembic.ini" "$APP/alembic.ini"
install -m 0644 "$STAGING/requirements.txt" "$APP/requirements.txt"
chown -R "$USER_NAME:$USER_NAME" "$APP/app" "$APP/alembic" "$APP/alembic.ini" "$APP/requirements.txt"

# Keep dependency installs, migrations and API code running as archhub, never root.
runuser -u "$USER_NAME" -- "$VENV/bin/python" -m pip install --disable-pip-version-check -r "$APP/requirements.txt"

# Migration is intentionally opt-in. Existing databases may not have an Alembic stamp.
# Only enable after reviewing 'alembic current' against the production DB.
if [ -f /etc/architecture-hub-enable-migrations ]; then
  set -a
  # This must be a root-managed, shell-compatible EnvironmentFile.
  source "$ENV_FILE"
  set +a
  (cd "$APP" && runuser -u "$USER_NAME" --preserve-environment -- "$VENV/bin/python" -m alembic upgrade head)
else
  echo "Alembic migrations skipped (require explicit /etc/architecture-hub-enable-migrations)"
fi

restarted=1
systemctl restart "$SERVICE"
for attempt in $(seq 1 20); do
  if curl --fail --silent --max-time 3 http://127.0.0.1:8001/api/health >/dev/null; then
    trap - ERR
    echo "Backend deployed successfully. Backup: $snapshot"
    exit 0
  fi
  sleep 2
done
echo "API healthcheck failed after restart" >&2
false
