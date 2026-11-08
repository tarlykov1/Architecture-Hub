"""Safe OpenAI API connectivity check. No key, prompt, or response body is logged."""
from __future__ import annotations

import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def check_openai(api_key: str, model: str = "gpt-4.1-mini", opener=urlopen) -> tuple[bool, str]:
    if not api_key.strip():
        return False, "OPENAI_API_KEY is not configured"
    if not model or any(char not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-" for char in model):
        return False, "Invalid OPENAI_MODEL"
    body = json.dumps({
        "model": model,
        "input": "Reply with exactly: OK",
        "max_output_tokens": 16,
    }).encode("utf-8")
    req = Request(
        "https://api.openai.com/v1/responses",
        data=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with opener(req, timeout=20) as response:
            payload = json.load(response)
        if payload.get("id") and payload.get("status") in ("completed", "in_progress"):
            return True, f"OpenAI API reachable; model={model}; response accepted"
        return False, "OpenAI API returned an unexpected response shape"
    except HTTPError as exc:
        # Never print server response bodies: they can contain sensitive information.
        explanations = {401: "API key rejected", 403: "Access denied", 404: "Model or endpoint unavailable", 429: "Rate limit or insufficient quota"}
        return False, f"OpenAI API HTTP {exc.code}: {explanations.get(exc.code, 'request failed')}"
    except (URLError, TimeoutError, OSError, ValueError) as exc:
        return False, f"OpenAI API connectivity or response error ({type(exc).__name__})"


if __name__ == "__main__":
    ok, message = check_openai(os.getenv("OPENAI_API_KEY", ""), os.getenv("OPENAI_MODEL", "gpt-4.1-mini"))
    print(message)
    sys.exit(0 if ok else 1)
