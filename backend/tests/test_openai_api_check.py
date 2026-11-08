import io
import json
from urllib.error import HTTPError, URLError
from scripts.check_openai_api import check_openai


class FakeResponse:
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def read(self, *args): return json.dumps({"id": "resp_test", "status": "completed"}).encode()


def test_missing_key_is_rejected_without_network():
    assert check_openai("", opener=lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("network called")))[0] is False


def test_successful_api_response():
    ok, message = check_openai("test-secret", opener=lambda req, timeout: FakeResponse())
    assert ok and "reachable" in message
    assert "test-secret" not in message


def test_api_error_does_not_leak_secret_or_response_body():
    def reject(req, timeout):
        raise HTTPError(req.full_url, 429, "quota", {}, io.BytesIO(b"secret-test-body"))
    ok, message = check_openai("test-secret", opener=reject)
    assert not ok and "429" in message
    assert "secret-test-body" not in message and "test-secret" not in message


def test_network_failure_is_safe():
    def fail(req, timeout): raise URLError("private-network-details")
    ok, message = check_openai("test-secret", opener=fail)
    assert not ok and "private-network-details" not in message
