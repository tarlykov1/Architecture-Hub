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
