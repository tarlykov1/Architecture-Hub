# Architecture Hub

MVP реестра корпоративной ИТ-архитектуры и интерактивных схем.

## Локальный запуск на Windows **без Docker**

Требуется Python 3.12+ и Node.js 22+.

### Терминал 1 – API

```powershell
cd "$env:USERPROFILE\Architecture-Hub\backend"
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### Терминал 2 – React

```powershell
cd "$env:USERPROFILE\Architecture-Hub\frontend"
npm install
npm run dev
```

Открой http://localhost:5173 (интерфейс) и http://127.0.0.1:8000/docs (API).

При локальном запуске используется SQLite в `backend/architecture_hub.db`. Файл **не загружается в Git**. Сохраняй резервные копии перед обновлениями схемы БД.

## Запуск в Docker (с PostgreSQL)

```powershell
docker compose up --build
```

Здесь используется PostgreSQL. Docker запускается только при работающем Docker Engine.

## Текущее состояние MVP

- CRUD объектов (создание, просмотр, изменение и удаление через API)
- Добавление направленных связей через UI, просмотр и удаление через API
- Интерактивная карта React Flow, перетаскивание объектов
- Создание схем и сохранение координат в базе данных

**Ограничения:** пока нет входа, ролей, миграций Alembic и настоящей метамодели. Карта показывает все зарегистрированные объекты на каждой схеме. Не вводи конфиденциальные данные и не публикуй приложение в интернете. Это локальный прототип.


## Architecture Hub 0.2 (experimental)

The new infrastructure layer models nested services, VM, APIs and directed data flows separately from logical systems. Click a system and use the right-hand forms to add components and flows, or load the synthetic infrastructure sample via **+ Демо инфраструктуры** after **Загрузить демо**. The new tables are additive; existing objects/diagrams remain.

**Caution:** network locations and transport controls in sample entries are fictional. No login or RBAC exists; use only on localhost with non-sensitive data. Back up `backend/architecture_hub.db` before pulling or starting this update. Current implementation is an intermediate model (network notes in JSON), not yet a normalized inventory of VRF/VLAN/DMZ/interfaces or a routing verification engine.
