# Управление схемой Architecture Hub (SQLite / Alembic)

**Правило релиза:** успешный CI или успешный перезапуск FastAPI не доказывают, что таблица `alembic_version` тестового VPS соответствует текущей модели. На стенде временно используется `Base.metadata.create_all`, который может создать новые таблицы **без фиксации Alembic-ревизии**. Не исправляйте это слепым `alembic stamp head`.

## 1. Проверка только для чтения

Используйте штатный виртуальный Python c Alembic и каталог проверенной версии репозитория:

```bash
/opt/architecture-hub/backend/.venv/bin/python \
  scripts/check_test_schema.py --db /var/lib/architecture-hub/architecture_hub.db
```

Запускайте из checkout репозитория, которому соответствует рабочая версия. Скрипт не читает значения пользовательских записей, не создаёт файл, не изменяет таблицы. Сообщение `BLOCKED` означает: **остановиться**, а не включать принудительный upgrade.

## 2. Dry-run upgrade только на копии

```bash
/opt/architecture-hub/backend/.venv/bin/python \
  scripts/dry_run_test_migrations.py --db /var/lib/architecture-hub/architecture_hub.db
```

Скрипт:

1. Открывает исходную SQLite в `mode=ro` и создаёт согласованную копию через SQLite backup API в защищённом временном каталоге.
2. Проверяет `integrity_check`, одну известную Alembic-ревизию и её присутствие в истории миграций.
3. Выполняет `alembic upgrade head` **только на временной копии**, переопределяя `DATABASE_URL` на её путь.
4. Повторно проверяет Alembic-ревизию, структуру/индексы, foreign keys и сохранность количества записей в существующих реестрах.
5. Удаляет временную копию; возвращает JSON `PASS` или `BLOCKED` без самих архитектурных данных.

Нулевая ревизия, неизвестный `alembic_version` или отличия структуры – не повод `stamp`. Сначала нужно вручную выяснить историческое состояние схемы.

**Важно:** dry-run `PASS` на копии – необходимая подготовка, но не разрешение автоматически изменять живую БД. Перед upgrade нужны реальная проверенная резервная копия, проверка восстановления, контроль установленного сервиса и схема отката.

## 3. Выпуск backend

CI выкладывает код через ограниченный root-owned `architecture-hub-deploy-backend`, делает онлайн-резервную копию, но миграции выполняются только при наличии осознанно установленного `/etc/architecture-hub-enable-migrations`. Если флага нет, журнал содержит `Alembic migrations skipped`. Это **не** означает, что база прошла миграцию.

Когда администратор отдельно подтвердил восстановление бэкапа и dry-run на копии именно текущей SQLite, используйте регламентированное включение миграций в тестовой среде. Не включайте флаг без проверки и не запускайте `alembic upgrade` от имени случайного пользователя или с неустановленным `DATABASE_URL`.

Локальная разработка может использовать Alembic на одноразовой базе, например:

```bash
cd backend
python -m pip install -r requirements.txt
python -m alembic current
python -m alembic upgrade head
python -m alembic current
```

Эти команды **не выполнять бездумно на рабочей SQLite**. В CI должна использоваться одноразовая копия.

## 4. Приёмочные доказательства

- `backend/tests/test_schema_readonly_preflight.py`: строгий read-only контроль актуальности.
- `backend/tests/test_migration_copy_dry_run.py`: миграции старой ревизии, избыточные таблицы от `create_all`, неопознанная и отсутствующая БД; проверка, что исходный файл не изменён.
- `backend/tests/test_technology_migrations.py` и `backend/tests/test_flow_scenario_migration.py`: аддитивные миграции с сохранением существующих ИС.
- Для тестового VPS дополнительно нужен **отдельный зафиксированный read-only отчёт** реальной базы и тест восстановления её бэкапа. Пока такого отчёта нет, задача [#215](https://github.com/tarlykov1/Architecture-Hub/issues/215) остаётся открытой.
