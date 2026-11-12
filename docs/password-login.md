# Вход по паролю без Keycloak

Architecture Hub supports a shared administrator password for **initial setup** and now
supports **named individual accounts** with role-based API access. Leave the username
blank to sign in with the transitional shared password; enter a username to use a
personal account. See [user-accounts.md](user-accounts.md) for setup, roles and limits.
This is **not SSO or MFA**.

## How it works

1. Browser sends the entered password via **POST /api/auth/login** over HTTPS.
2. Backend checks a 600,000-round PBKDF2-SHA256 verifier with a random salt.
   Only the verifier and a different session signing secret live on the server.
3. Backend issues a signed **8-hour** bearer session. For named users the
   server checks current role, account status and session revision on every request.
   JavaScript keeps the session in `sessionStorage` (per tab), not the password.
4. The existing API authorization and roles still apply. Logging out clears
   the browser session; a previously copied session token remains valid until
   expiry unless the signing secret is rotated.
5. Six failed attempts from the same source address in a two-minute window
   are throttled in each server process. Add an **Nginx/HAProxy rate limit**
   and access logging without request bodies if using multiple workers.
   Avoid logging request bodies or bearer authorization headers.

Old `ARCH_HUB_ACCESS_KEYS` remain supported for CI and integrations during
the migration. The UI keeps them under **«Служебный вход по ключу»** as a
temporary fallback. Once password login is verified, rotate API keys and
disable the fallback in a separate coordinated change.

## Configure the test stand (requires root on the existing VPS)

The deployment script does **not** write credentials. Keep them solely in
the service's existing root-owned `/etc/architecture-hub.env` EnvironmentFile.
Do not send the password in a chat, commit it, put it in a GitHub variable, or
paste it into a terminal command where it may enter shell history.

After the feature's backend version has been deployed:

```bash
sudo -i
cd /opt/architecture-hub/backend
/opt/architecture-hub/backend/.venv/bin/python -m app.password_auth
```

Enter a new password (12+ characters) twice, interactively. Copy the one-line
`pbkdf2_sha256$...` output into the root-owned EnvironmentFile:

```ini
ARCH_HUB_LOGIN_PASSWORD_HASH=pbkdf2_sha256$600000$<salt>$<digest>
ARCH_HUB_SESSION_SECRET=<separately generated 32+-character random value>
```

Generate the separate random secret on the server, **never reuse the password**
or hash as a signing key:

```bash
/opt/architecture-hub/backend/.venv/bin/python -c 'import secrets; print(secrets.token_urlsafe(48))'
sudoedit /etc/architecture-hub.env
chown root:root /etc/architecture-hub.env
chmod 600 /etc/architecture-hub.env
systemctl restart architecture-hub.service
systemctl status architecture-hub.service --no-pager
curl --fail --silent https://test.web-tie.ru/api/health
```

Preserve every existing EnvironmentFile value including `DATABASE_URL` and
`ARCH_HUB_ACCESS_KEYS`. Back up the file under a private root-only location
before editing it. If the unit uses a different EnvironmentFile, verify
`systemctl cat architecture-hub.service` first.

Now open **https://test.web-tie.ru/** in a private tab, choose **«Войти»**,
enter the password, verify that actual architecture data is available,
reload, then click **«Выйти»**. Wrong passwords should return a neutral error.
Do not use `GET` on the login endpoint. The UI reports a configuration
message if the password hasn't been provisioned yet, while service-key login
remains available.

To change the password later, generate a new verifier and replace it in the
EnvironmentFile. Rotate `ARCH_HUB_SESSION_SECRET` at the same time to revoke
all previously signed password sessions; restart the backend.

## Security scope

This remains a test-stand identity system, not a production SSO solution.
Named-user actions have stable account identities, but the legacy shared
administrator password cannot distinguish individual people. There is no MFA,
and sessionStorage bearer tokens are accessible to
scripts running in the same origin. For production, use per-user identity
(SSO/Keycloak or another identity provider), HTTP-only sessions, CSRF
protection and centrally enforced rate limiting.
