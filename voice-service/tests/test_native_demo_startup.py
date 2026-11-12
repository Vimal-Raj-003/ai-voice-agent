"""Abandoned microphone startup must not leave a demo's usage pending forever."""
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, Mock
import pytest
from gpt_live_gate import ExperimentRejected


async def test_missing_microphone_marks_demo_failed_without_starting_paid_model(monkeypatch):
    import gemini_live_runtime as native
    import gpt_live_experiment, provider_credentials, voice_usage, observability
    monkeypatch.setattr(gpt_live_experiment,'Journal',Mock(return_value=NS(emit=Mock(),close=Mock())))
    monkeypatch.setattr(gpt_live_experiment,'wait_for_microphone',AsyncMock(side_effect=ExperimentRejected('No microphone')))
    monkeypatch.setattr(provider_credentials,'load_for_org',AsyncMock(return_value={}))
    finish=AsyncMock();monkeypatch.setattr(voice_usage,'finish_demo_call',finish)
    monkeypatch.setattr(observability,'flush_logs',AsyncMock())
    paid=Mock(side_effect=AssertionError('No model without microphone'))
    monkeypatch.setattr(native,'GeminiRuntime',paid)
    ctx=NS(room=NS(name='synthetic-abandoned'))
    selected=NS(room='synthetic-abandoned',direction='INBOUND',assistant_id='synthetic')
    with pytest.raises(ExperimentRejected):
        await native.run_browser_test(ctx,selected,{'id':'synthetic'},Mock())
    paid.assert_not_called()
    finish.assert_awaited_once_with('synthetic-abandoned','FAILED')
