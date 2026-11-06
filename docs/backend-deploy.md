# Автоматический деплой backend на тестовый сервер

`deploy-backend-test.yml` создан, но **не активен** до серверного bootstrap и переменной репозитория `BACKEND_DEPLOY_ENABLED=true`.

Frontend продолжает публиковаться независимо. Секреты `DEPLOY_HOST`, `DEPLOY_PORT`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` используются повторно.

## 1. Проверить сервис и окружение – ничего не менять

Запустить на сервере от root:

```bash
systemctl cat architecture-hub.service
systemctl show architecture-hub.service -p User -p ExecStart -p EnvironmentFiles
ls -ld /opt/architecture-hub/backend /opt/architecture-hub/backend/.venv /var/lib/architecture-hub/architecture_hub.db
test -x /opt/architecture-hub/backend/.venv/bin/python && echo "BACKEND VENV OK"
curl --fail --silent http://127.0.0.1:8001/api/health
```

**Не продолжать**, если сервис использует другие каталоги, Python-интерпретатор, UNIX-пользователя или другую БД. В таком случае сперва адаптировать `scripts/deploy_backend_test.sh` под реальные `ExecStart`, `User`, `EnvironmentFile`. **Нельзя включать деплой только потому, что frontend работает.**

## 1.1. Проверить и подготовить права виртуального окружения

Для существующего тестового сервера было подтверждено: `User=archhub`, `ExecStart=/opt/architecture-hub/backend/.venv/bin/python`, Python 3.11.2, `/etc/architecture-hub.env`, SQLite `/var/lib/architecture-hub/architecture_hub.db`; `.venv` пока принадлежит root. Сам backend-каталог оставляем под root, а **только его существующее виртуальное окружение** передаём `archhub`, чтобы обновление `pip` выполнялось без root.

```bash
test -x /opt/architecture-hub/backend/.venv/bin/python || exit 1
chown -R archhub:archhub /opt/architecture-hub/backend/.venv
runuser -u archhub -- test -w /opt/architecture-hub/backend/.venv/lib && echo 'VENV WRITABLE'
runuser -u archhub -- /opt/architecture-hub/backend/.venv/bin/python -m pip --version
```

Это осознанный компромисс **только для тестового сервера**: скомпрометированный процесс `archhub` потенциально сможет изменять свои Python-пакеты. Для production используйте отдельного сборочного пользователя и неизменяемый root-owned venv, переключаемый после проверки релиза.

## 2. Однократно установить контролируемый скрипт

После сопоставления путей с реальной конфигурацией:

```bash
apt-get install -y rsync sudo
curl --fail --location --silent --show-error \
  https://raw.githubusercontent.com/tarlykov1/Architecture-Hub/main/scripts/deploy_backend_test.sh \
  -o /root/architecture-hub-deploy-backend.sh
bash -n /root/architecture-hub-deploy-backend.sh
install -o root -g root -m 0750 /root/architecture-hub-deploy-backend.sh /usr/local/sbin/architecture-hub-deploy-backend
cat > /etc/sudoers.d/architecture-hub-deploy <<'EOF'
archdeploy ALL=(root) NOPASSWD: /usr/local/sbin/architecture-hub-deploy-backend
EOF
chmod 0440 /etc/sudoers.d/architecture-hub-deploy
visudo -cf /etc/sudoers.d/architecture-hub-deploy
```

Не выдавать `archdeploy` доступ к произвольному `sudo`, `systemctl`, `rsync` от root. Скрипт и sudoers должны принадлежать root; не хранить изменяемый экземпляр скрипта в `/home/archdeploy`.

## 3. Миграции

На первом этапе **миграции выключены**. Это намеренно: существующая серверная SQLite могла быть создана до использования Alembic. Сначала проверьте ревизию под тем же `DATABASE_URL`, что и у сервиса, и сделайте отдельную проверенную миграцию.

Файл `/etc/architecture-hub-enable-migrations` по умолчанию отсутствует, поэтому скрипт не вызывает `alembic upgrade head`. Создавать этот файл разрешено только после проверки схемы и теста на копии реальной БД. Никогда не делайте автоматический downgrade SQLite после сбоя миграции.

Скрипт сохраняет резервную копию SQLite через `sqlite3.backup()` в `/var/backups/architecture-hub/`, а также предыдущий код. Бэкапы не публикуются в веб-каталог. Скрипт откатывает файлы при ошибке перезапуска/проверки API. Python-зависимости не откатываются автоматически; для критичных обновлений требуется отдельная политика релизов. Рекомендуется отдельная внешняя резервная копия БД, проверка восстановления и ротация архива.

## 4. Включить и проверить

Проверка активации backend-деплоя: после создания `BACKEND_DEPLOY_ENABLED` как **Repository variable** выполните новый push в `main` и убедитесь, что backend workflow не имеет статуса `skipped`.

После включения переменной используйте отдельный успешный push в `main` для первой проверки: изменение самой переменной не запускает `workflow_run` задним числом. В журнале backend-деплоя убедитесь, что выполнены подготовка релиза, ограниченный серверный скрипт и публичная проверка `/api/health`; один лишь статус `skipped` не подтверждает развёртывание.

Создать **Repository variable** `BACKEND_DEPLOY_ENABLED=true` только после полного bootstrap. Новый push в `main` -> успешный CI -> доставка backend в `/home/archdeploy/backend-release` -> ограниченный sudo-скрипт -> публичная проверка `/api/health`.

При первом запуске контролировать шаги в GitHub Actions. Для аварийного отключения установить `BACKEND_DEPLOY_ENABLED=false` – новые backend деплои не запускаются.

**Важно:** CI не получает доступа к серверному секретному EnvironmentFile или к базе данных напрямую; перезапуск и бэкап выполняются только локально серверным root-owned скриптом.
