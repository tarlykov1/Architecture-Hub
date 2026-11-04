# Подключение Wiki.js к Architecture Hub на тестовом сервере

Wiki.js состоит из отдельного контейнера приложения и PostgreSQL. Файлы Wiki.js не хранятся в SQLite Architecture Hub. Настройки `WIKI_API_TOKEN`, `WIKI_API_URL`, `WIKI_PUBLIC_URL` используются backend, а прямой адрес `VITE_WIKI_URL` – сборкой frontend.

## Перед началом: проверить, может ли VPS запускать контейнеры

На сервере под root:

```bash
uname -r
command -v docker || true
docker info --format '{{.ServerVersion}}' 2>&1 || true
docker compose version 2>&1 || true
systemctl show architecture-hub.service -p EnvironmentFiles
```

Сервер может быть OpenVZ с ядром 3.10; не пытайтесь устанавливать Docker, пока не подтверждена поддержка контейнеризации у провайдера. Если Docker не поддерживается, Wiki.js необходимо разместить на другом Docker/VPS-хосте, а backend настроить на его защищённый API.

## Когда Docker и Compose работают

1. Обновить checkout на сервере из `main` без сброса локальных файлов. Убедиться, что в `/opt/architecture-hub` есть `compose.wikijs.yml`.
2. Проверить существующие volumes и переменные. **Не изменять существующий `WIKI_DB_PASSWORD`** на уже запущенной PostgreSQL Wiki.js:
   ```bash
   cd /opt/architecture-hub
   docker compose -f compose.wikijs.yml ps
   docker volume ls | grep -i wiki || true
   test -f .env && echo 'Existing .env: preserve it'
   ```
3. Только для *новой установки*, когда PostgreSQL Wiki.js ещё нет: записать новый сильный `WIKI_DB_PASSWORD` в защищённый локальный `.env`. Не выводить пароль в чат или в GitHub, установить `chmod 600 .env`. Не перезаписывать старый файл `.env`.
4. Запустить `docker compose -f compose.wikijs.yml up -d` и проверить `curl -I http://127.0.0.1:3000`.
5. Настроить отдельный HTTPS-домен для Wiki.js через reverse proxy (не публиковать 3000 наружу), пройти начальную настройку администратора и создать API token в администрации Wiki.js с правом чтения списка страниц.
6. В действующем серверном EnvironmentFile backend (`/etc/architecture-hub.env`) добавить **не печатая секреты в лог**:
   ```text
   WIKI_API_URL=http://127.0.0.1:3000/graphql
   WIKI_PUBLIC_URL=https://<действительный-публичный-домен-wiki>
   WIKI_API_TOKEN=<действительный-токен-из-Wiki.js>
   ```
   Для вынесенного Wiki.js использовать защищённый внутренний API URL на отдельном хосте. Отсутствие DNS/HTTPS-имени нельзя обходить ссылкой на `localhost`.
7. После изменения server environment перезапустить backend через `systemctl restart architecture-hub.service`, проверить API через авторизованный интерфейс: `GET /api/knowledge/status` должен возвращать `configured:true`, а поиск `/api/knowledge/pages` должен выдавать страницы (или пустой массив, если Wiki.js ещё пустая).
8. Для ссылки на Wiki.js из верхней шапки добавить **Repository variable** `VITE_WIKI_URL=https://<действительный-публичный-домен-wiki>` и провести очередной frontend-деплой.

**Резервное копирование:** Wiki.js PostgreSQL volume требует отдельного backup/restore; backup SQLite Architecture Hub его не охватывает. При миграции материалов из Confluence необходим отдельный экспорт страниц и вложений.
