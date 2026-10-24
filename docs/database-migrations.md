# Управление схемой данных (Alembic)

Команды выполняются из папки `backend`. **Перед первой миграцией сделайте копию** файла `backend/architecture_hub.db` при остановленном FastAPI. Docker использует отдельную PostgreSQL, а локальный запуск – SQLite.

```powershell
cd C:\Users\tarly\Architecture-Hub\backend
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m alembic current
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m alembic current
```

Первая ревизия `0001_baseline` создаёт только отсутствующие таблицы и таблицу версий Alembic. Существующие таблицы и записи не удаляет. Она не исправляет автоматически различия в колонках старых БД – при несовпадении схемы следует остановиться и выполнить отдельную проверенную миграцию. Откат baseline намеренно запрещён.

В текущем переходном состоянии `Base.metadata.create_all` при запуске приложения пока сохраняется ради совместимости с уже работающим локальным окружением. **Новые изменения структуры должны вноситься отдельными Alembic-ревизиями**, а не через изменение `create_all`. Удалить устаревший bootstrap можно после подтверждения миграции рабочих БД.
