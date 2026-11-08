import json
import zipfile
from pathlib import Path
from scripts.playwright_ai_triage import visual_evidence, triage


def test_trace_metadata_only_and_images_off(tmp_path):
    trace = tmp_path / "trace.zip"
    with zipfile.ZipFile(trace, "w") as z:
        z.writestr("test.trace", '{"secret":"DO_NOT_SEND"}')
        z.writestr("test.network", "private network")
    screenshot = tmp_path / "shot.png"
    screenshot.write_bytes(b"test image")
    report = {"suites": [{"tests": [{"results": [{"status": "failed", "error": {"message": "Timeout"},
        "attachments": [{"path": str(trace)}, {"path": str(screenshot)}]}]}]}]}
    metadata, images = visual_evidence(report, tmp_path)
    assert metadata == [{"trace_present": True, "events_file": True, "network_file": True, "screenshots_in_trace": 0}]
    assert images == []
    assert "DO_NOT_SEND" not in json.dumps(metadata)


def test_no_external_request_without_key(tmp_path):
    report = {"suites": [{"title": "test", "tests": [{"results": [{"status": "failed", "error": {"message": "Timeout"}}]}]}]}
    result = triage(report, "", root=tmp_path)
    assert "not configured" in result

def test_sensitive_values_are_redacted():
    from scripts.playwright_ai_triage import sanitize

    message = "Authorization: Bearer abc123XYZ token=tok_secret password: myPassword api_key=abc123 https://internal.example/item"
    cleaned = sanitize(message)
    for secret in ("abc123XYZ", "tok_secret", "myPassword", "abc123", "internal.example"):
        assert secret not in cleaned
    assert "Bearer [REDACTED]" in cleaned
    assert "password=[REDACTED]" in cleaned
    assert "[URL]" in cleaned


def test_playwright_relative_paths_and_nested_suites(tmp_path):
    report_dir = tmp_path / "test-results"
    report_dir.mkdir()
    artifact_dir = report_dir / "nested"
    artifact_dir.mkdir()
    trace = artifact_dir / "trace.zip"
    with zipfile.ZipFile(trace, "w") as archive:
        archive.writestr("run.trace", "DO_NOT_SEND")
        archive.writestr("run.network", "sensitive")
    report = {"suites": [{"suites": [{"suites": [{"tests": [
        {"results": [{"status": "failed", "attachments": [
            {"path": "test-results/nested/trace.zip"}]}]}]}]}]}]}
    metadata, images = visual_evidence(report, report_dir)
    assert len(metadata) == 1
    assert metadata[0]["events_file"] is True
    assert metadata[0]["network_file"] is True
    assert images == []


def test_outside_workspace_attachment_is_ignored(tmp_path):
    report_dir = tmp_path / "workspace" / "test-results"
    report_dir.mkdir(parents=True)
    outside = tmp_path / "private.png"
    outside.write_bytes(b"private")
    report = {"suites": [{"tests": [{"results": [{
        "status": "failed", "attachments": [{"path": str(outside)}]}]}]}]}
    metadata, images = visual_evidence(report, report_dir, allow_images=True)
    assert metadata == []
    assert images == []

