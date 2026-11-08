"""OpenAI system analysis contracts: no real external calls."""
import io
import json
from types import SimpleNamespace
from uuid import uuid4
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.ai_analysis import AnalysisRequest, analyze_system
from app.main import ArchitectureObject, Base, Relation


class Response:
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def read(self, *args):
        return json.dumps({"output": [{"content": [{"type": "output_text", "text": "Проверьте документацию."}]}]}).encode()


def setup_db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    return engine


def test_analysis_sends_only_allowlisted_fields(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    engine = setup_db()
    with Session(engine) as db:
        obj = ArchitectureObject(kind="system", name="Test system", description="Test description", attributes={"password": "NEVER_SEND"})
        db.add(obj)
        db.commit()
        db.refresh(obj)
        def opener(req, timeout):
            assert timeout == 30
            body = req.data.decode()
            assert "NEVER_SEND" not in body and "Test system" in body
            assert "test-key" not in body
            return Response()
        result = analyze_system(db, ArchitectureObject, Relation, AnalysisRequest(system_id=obj.id), opener=opener)
        assert result["analysis"] == "Проверьте документацию."


def test_analysis_missing_key_is_safe(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    engine = setup_db()
    with Session(engine) as db:
        with pytest.raises(HTTPException) as exc:
            analyze_system(db, ArchitectureObject, Relation, AnalysisRequest(system_id=uuid4()))
        assert exc.value.status_code == 503


def test_analysis_unknown_system_does_not_call_api(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    engine = setup_db()
    with Session(engine) as db:
        with pytest.raises(HTTPException) as exc:
            analyze_system(db, ArchitectureObject, Relation, AnalysisRequest(system_id=uuid4()), opener=lambda *a, **kw: pytest.fail("external request"))
        assert exc.value.status_code == 404
