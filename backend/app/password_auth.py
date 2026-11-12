"""Password login and short-lived, signed session tokens for Architecture Hub.

Only a salted password *verifier* and a server-side signing secret are configured.
The browser sends the password only to POST /api/auth/login over HTTPS; it receives
a time-limited opaque-looking bearer session, never the password verifier.
The existing automation access keys remain supported independently.
"""
from __future__ import annotations

import base64
from collections import defaultdict
from dataclasses import dataclass
import getpass
import hashlib
import hmac
import json
import os
import secrets
import threading
import time

HASH_ROUNDS = 600_000
SESSION_SECONDS = 8 * 60 * 60
MAX_ATTEMPTS = 6
WINDOW_SECONDS = 120


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def make_password_hash(password: str) -> str:
    """Generate a verifier using a fresh random 128-bit salt (never commit it)."""
    if len(password) < 12:
        raise ValueError("Use a password of at least 12 characters")
    if len(password) > 256:
        raise ValueError("Password is too long")
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, HASH_ROUNDS)
    return f"pbkdf2_sha256${HASH_ROUNDS}${_b64(salt)}${_b64(digest)}"


def _parse_hash(encoded: str) -> tuple[int, bytes, bytes]:
    try:
        algorithm, rounds_text, salt_text, digest_text = encoded.split("$")
        rounds = int(rounds_text)
        salt = _decode(salt_text)
        digest = _decode(digest_text)
        if algorithm != "pbkdf2_sha256" or not 400_000 <= rounds <= 2_000_000:
            raise ValueError("Unsupported password verifier")
        if len(salt) < 16 or len(digest) != 32:
            raise ValueError("Invalid password verifier bytes")
        return rounds, salt, digest
    except (ValueError, TypeError, base64.binascii.Error) as exc:
        raise ValueError("Invalid ARCH_HUB_LOGIN_PASSWORD_HASH format") from exc


@dataclass(frozen=True)
class PasswordAuthConfig:
    password_hash: str
    signing_secret: bytes


def configured_password_auth() -> PasswordAuthConfig | None:
    password_hash = os.getenv("ARCH_HUB_LOGIN_PASSWORD_HASH", "").strip()
    secret = os.getenv("ARCH_HUB_SESSION_SECRET", "").strip()
    if not password_hash and not secret:
        return None
    if not password_hash or len(secret) < 32:
        raise RuntimeError("Configure both ARCH_HUB_LOGIN_PASSWORD_HASH and a long ARCH_HUB_SESSION_SECRET")
    _parse_hash(password_hash)
    return PasswordAuthConfig(password_hash=password_hash, signing_secret=secret.encode("utf-8"))


def check_password(password: str, config: PasswordAuthConfig) -> bool:
    if not isinstance(password, str) or len(password) > 256:
        return False
    rounds, salt, expected = _parse_hash(config.password_hash)
    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, rounds)
    return hmac.compare_digest(actual, expected)


def issue_session(config: PasswordAuthConfig, now: int | None = None) -> str:
    issued = int(time.time()) if now is None else now
    payload = {"v": 1, "role": "admin", "iat": issued, "exp": issued + SESSION_SECONDS,
               "nonce": secrets.token_hex(16)}
    body = _b64(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signature = hmac.new(config.signing_secret, b"archhub-session.v1." + body.encode("ascii"),
                         hashlib.sha256).digest()
    return f"ah1.{body}.{_b64(signature)}"


def verify_session(token: str, config: PasswordAuthConfig | None,
                   now: int | None = None) -> str | None:
    if config is None or not token.startswith("ah1.") or len(token) > 2048:
        return None
    try:
        version, body, signed = token.split(".")
        if version != "ah1":
            return None
        expected = hmac.new(config.signing_secret, b"archhub-session.v1." + body.encode("ascii"),
                            hashlib.sha256).digest()
        if not hmac.compare_digest(_decode(signed), expected):
            return None
        payload = json.loads(_decode(body))
        current = int(time.time()) if now is None else now
        if not isinstance(payload, dict) or payload.get("v") != 1 or payload.get("role") != "admin":
            return None
        issued, expires = payload.get("iat"), payload.get("exp")
        if type(issued) is not int or type(expires) is not int:
            return None
        if issued > current + 60 or expires <= current or expires - issued != SESSION_SECONDS:
            return None
        if not isinstance(payload.get("nonce"), str) or len(payload["nonce"]) != 32:
            return None
        return "admin"
    except (ValueError, TypeError, UnicodeDecodeError, base64.binascii.Error):
        return None


# Best-effort per-process throttle. Reverse proxy rate-limits should also be
# enabled for multi-worker environments, because this state is not distributed.
_failures: dict[str, list[float]] = defaultdict(list)
_failure_lock = threading.Lock()


def login_allowed(address: str) -> bool:
    with _failure_lock:
        now = time.monotonic()
        recent = [at for at in _failures.get(address, []) if now - at < WINDOW_SECONDS]
        if recent:
            _failures[address] = recent
        else:
            _failures.pop(address, None)
        return len(recent) < MAX_ATTEMPTS


def record_login_attempt(address: str, *, success: bool) -> None:
    with _failure_lock:
        if success:
            _failures.pop(address, None)
        else:
            now = time.monotonic()
            _failures[address] = [at for at in _failures.get(address, [])
                                  if now - at < WINDOW_SECONDS][-MAX_ATTEMPTS:] + [now]


if __name__ == "__main__":
    print("Architecture Hub: create a password verifier for your server EnvironmentFile.")
    first = getpass.getpass("New password (at least 12 characters): ")
    second = getpass.getpass("Repeat password: ")
    if first != second:
        raise SystemExit("Passwords do not match")
    try:
        print(make_password_hash(first))
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
