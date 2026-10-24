
## Safe SQLite backups

The unified Windows launcher creates a consistent SQLite snapshot before starting the API, if `backend/architecture_hub.db` exists. Snapshots live in `.runtime/backups/`, which is ignored by Git. A failed backup prevents a new API from being started. The Python `sqlite3.backup` API supports safe snapshots with concurrent readers/writers; it does not export Wiki.js PostgreSQL data.

To run a backup manually:

```powershell
cd C:\Users\tarly\Architecture-Hub
.\backend\.venv\Scripts\python.exe .\scripts\backup_db.py
```

Backups are intentionally **not automatically deleted**. Store a protected external copy before major migrations, check available disk space, and separately back up Wiki.js PostgreSQL. Automatic backups do not replace a tested restore process.
