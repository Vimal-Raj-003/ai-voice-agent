"""Fail closed on business I/O during synthetic model verification.

Only configured OpenRouter chat-completion HTTP is allowed. Recipient/book
operations are simulated by replay_understanding's explicitly patched methods.
No change is made to the live worker's environment or read-only mode.
"""
from contextlib import ExitStack, contextmanager
import os
from urllib.parse import urlparse
from unittest.mock import patch
import httpx


@contextmanager
def strict_business_sandbox():
    import db
    import notify
    endpoint = urlparse(os.getenv('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'))
    original_send = httpx.AsyncClient.send
    async def chat_only(client, request, *args, **kwargs):
        if (request.url.host != endpoint.hostname or request.method != 'POST'
                or request.url.path != endpoint.path.rstrip('/') + '/chat/completions'):
            raise RuntimeError('Verification sandbox blocked non-LLM HTTP; no business request sent')
        return await original_send(client, request, *args, **kwargs)
    with ExitStack() as stack:
        stack.enter_context(patch.object(httpx.AsyncClient, 'send', chat_only))
        stack.enter_context(patch.object(db, 'get_pool', side_effect=RuntimeError('Verification sandbox blocked business SQL')))
        for name in ('send_booking_confirmation_email', 'send_sms', 'send_whatsapp', 'send_telegram',
                     'send_webhook', 'send_signed_webhook', 'send_existing_delivery'):
            stack.enter_context(patch.object(notify, name, side_effect=RuntimeError('Verification sandbox blocked customer delivery')))
        for name in ('SMTP', 'SMTP_SSL'):
            stack.enter_context(patch('smtplib.' + name, side_effect=RuntimeError('Verification sandbox blocked SMTP')))
        stack.enter_context(patch('requests.sessions.Session.request', side_effect=RuntimeError('Verification sandbox blocked business HTTP')))
        yield
