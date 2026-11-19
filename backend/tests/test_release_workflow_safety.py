"""Static contract for the safety-critical test deployment workflow chain.

The live VPS and repository secrets are not accessible to this test. It
verifies that all automatic deployment paths fail closed until CI, backend
deployment, migrations and exact commit identity have been verified.
"""
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"


def _workflow(name: str):
    with (WORKFLOWS / name).open(encoding="utf-8") as stream:
        # BaseLoader preserves the literal YAML key "on" rather than treating
        # it as the YAML-1.1 boolean True.
        return yaml.load(stream, Loader=yaml.BaseLoader)


def _steps(data: dict) -> dict[str, tuple[int, str]]:
    return {
        step["name"]: (index, str(step.get("run", "")))
        for index, step in enumerate(data["jobs"]["deploy"]["steps"])
        if "name" in step
    }


def test_backend_deploy_rejects_unverified_or_stale_main():
    data = _workflow("deploy-backend-test.yml")
    assert data["on"]["workflow_run"]["workflows"] == ["Architecture Hub CI"]
    assert data["on"]["workflow_run"]["types"] == ["completed"]
    condition = data["jobs"]["deploy"]["if"]
    for clause in (
        "vars.BACKEND_DEPLOY_ENABLED == 'true'",
        "github.event.workflow_run.conclusion == 'success'",
        "github.event.workflow_run.event == 'push'",
        "github.event.workflow_run.head_branch == 'main'",
    ):
        assert clause in condition
    steps = _steps(data)
    order = [
        "Verify the tested commit is still the current main revision",
        "Checkout exact successful CI commit",
        "Configure pinned SSH identity",
        "Stage verified backend code (without database or secrets)",
        "Ensure database migration opt-in exists on test VPS",
        "Apply backed-up release using restricted root-owned script",
        "Validate public API",
        "Record the exact backend revision that was deployed",
        "Provide verified backend revision to the frontend workflow",
    ]
    assert [steps[name][0] for name in order] == sorted(steps[name][0] for name in order)
    assert 'gh api "repos/' in steps[order[0]][1]
    assert "architecture-hub-enable-migrations" in steps[order[4]][1]
    assert "sudo -n /usr/local/sbin/architecture-hub-deploy-backend" in steps[order[5]][1]
    assert data["jobs"]["deploy"]["environment"] == "test"
    artifact = next(step for step in data["jobs"]["deploy"]["steps"]
                    if step.get("name") == order[8])
    assert artifact["with"]["name"] == "backend-release-revision"


def test_frontend_only_deploys_after_matching_backend_commit():
    data = _workflow("deploy-test.yml")
    assert data["on"]["workflow_run"]["workflows"] == [
        "Deploy Architecture Hub backend (test)"
    ]
    assert data["on"]["workflow_run"]["types"] == ["completed"]
    assert data["permissions"]["actions"] == "read"
    condition = data["jobs"]["deploy"]["if"]
    for clause in (
        "vars.DEPLOY_ENABLED == 'true'",
        "vars.BACKEND_DEPLOY_ENABLED == 'true'",
        "github.event.workflow_run.conclusion == 'success'",
        "github.event.workflow_run.event == 'workflow_run'",
        "github.event.workflow_run.head_branch == 'main'",
    ):
        assert clause in condition
    steps = _steps(data)
    order = [
        "Download release revision from the successful backend workflow",
        "Verify the backend revision matches the current main",
        "Checkout the exact commit deployed by the successful backend workflow",
        "Build frontend",
        "Install SSH identity and pinned host key",
        "Verify remote deployment directory",
        "Publish frontend (never touch API, SQLite, or .well-known)",
        "Verify public HTTPS (valid certificate required)",
        "Verify deployed frontend revision matches the tested commit",
    ]
    assert [steps[name][0] for name in order] == sorted(steps[name][0] for name in order)
    download = next(step for step in data["jobs"]["deploy"]["steps"]
                    if step.get("name") == order[0])
    assert download["with"]["name"] == "backend-release-revision"
    assert "github.event.workflow_run.id" in download["with"]["run-id"]
    verify_sha = steps[order[1]][1]
    assert "gh api " in verify_sha
    assert "expected" in verify_sha and "current" in verify_sha
    checkout = next(step for step in data["jobs"]["deploy"]["steps"]
                    if step.get("name") == order[2])
    assert "steps.revision.outputs.sha" in checkout["with"]["ref"]
    build = next(step for step in data["jobs"]["deploy"]["steps"]
                 if step.get("name") == order[3])
    assert "steps.revision.outputs.sha" in build["env"]["BUILD_REVISION"]
    assert "--exclude='.well-known/'" in steps[order[6]][1]
    assert "build-info.json" in steps[order[-1]][1]


def test_server_release_guard_is_backup_before_migration():
    source = (ROOT / "scripts" / "deploy_backend_test.sh").read_text(
        encoding="utf-8"
    )
    assert "src.backup(dst" in source
    assert "PRAGMA integrity_check" in source
    assert "/etc/architecture-hub-enable-migrations" in source
    assert "sudoers" in source
    assert source.index("src.backup(dst") < source.index("alembic upgrade head")
    assert "SQLite was NOT automatically restored" in source


def test_release_preflight_does_not_run_alembic_on_live_database():
    content = (ROOT / "scripts" / "preflight_test_release.sh").read_text(
        encoding="utf-8"
    )
    assert "src.backup" not in content  # Name in current preflight is original.backup
    assert "original.backup(saved" in content
    assert 'mode=ro' in content
    assert "HAVING COUNT(*) > 1" in content
    assert "READY_FOR_TEST_RELEASE_PRECHECK=1" in content
    assert "alembic upgrade head" not in content
