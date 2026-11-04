"""Prove synthetic action replay cannot reach customer delivery or SQL/HTTP."""
import smtplib
import httpx
import pytest
from scripts.verification_sandbox import strict_business_sandbox


@pytest.mark.asyncio
async def test_business_delivery_sql_and_http_fail_before_network():
    import db
    import notify
    with strict_business_sandbox():
        with pytest.raises(RuntimeError, match='customer delivery'):
            notify.send_sms('synthetic-recipient', 'synthetic message')
        with pytest.raises(RuntimeError, match='SMTP'):
            smtplib.SMTP('mail.example.test')
        with pytest.raises(RuntimeError, match='business SQL'):
            await db.get_pool()
        async with httpx.AsyncClient() as client:
            with pytest.raises(RuntimeError, match='non-LLM HTTP'):
                await client.post('https://business.example.test/send-email')


@pytest.mark.asyncio
async def test_only_chat_endpoint_is_allowed_using_a_local_mock_transport(monkeypatch):
    monkeypatch.setenv('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1')
    seen = []
    def transport(request):
        seen.append(request.url.path)
        return httpx.Response(200, json={'synthetic': True})
    with strict_business_sandbox():
        async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
            reply = await client.post('https://openrouter.ai/api/v1/chat/completions')
            assert reply.status_code == 200
            with pytest.raises(RuntimeError, match='non-LLM HTTP'):
                await client.post('https://openrouter.ai/api/v1/other')
    assert seen == ['/api/v1/chat/completions']
