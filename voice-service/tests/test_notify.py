import httpx
import pytest
import respx

import notify


def test_send_telegram_skip_when_unconfigured(monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    assert notify.send_telegram("hi") is False


@pytest.mark.asyncio
async def test_send_webhook_returns_true_on_2xx():
    with respx.mock:
        respx.post("https://example.com/hook").mock(return_value=httpx.Response(200, text="ok"))
        ok = await notify.send_webhook("https://example.com/hook", "test", {"x": 1})
    assert ok is True


@pytest.mark.asyncio
async def test_send_webhook_no_url():
    assert await notify.send_webhook("", "test", {}) is False
