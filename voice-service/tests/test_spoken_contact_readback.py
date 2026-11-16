"""Actual call's approval and speech/recipient separation, with no external sends."""
from unittest.mock import Mock

import pytest

from callstate import CallState
from contact_corrections import email_spelling, latest_email


@pytest.mark.parametrize('approval', ['Correct super.', 'correct, super!', 'Correct thank you.', 'ம் correct தான் confirm.'])
def test_clear_readback_approval_with_praise_confirms_the_canonical_email(approval):
    state = CallState()
    state.observe_user('N I L A four three at example dot test', 'one')
    state.observe_assistant(email_spelling(state.entities['email']) + '. இந்த email address கரெக்ட்டா?')
    state.observe_user(approval, 'two')
    assert state.entities['email'] == 'nila43@example.test'
    assert state.entities['email_confirmed'] == 'yes'
    assert state.pending_slug is None


@pytest.mark.parametrize('reply', ['correct super but wrong email', 'is that correct?', 'correct the email', 'not correct super'])
def test_praise_does_not_override_a_rejection_or_a_question(reply):
    state = CallState()
    state.observe_user('nila43@example.test', 'one')
    state.observe_user(reply, 'two')
    assert state.entities.get('email_confirmed') != 'yes'


def test_spoken_email_readback_has_no_commas_and_roundtrips_to_a_canonical_recipient():
    spoken = email_spelling('NILA43@EXAMPLE.TEST')
    assert ',' not in spoken
    assert latest_email(spoken) == 'nila43@example.test'


@pytest.mark.parametrize('recipient', ['n, i, l, a43@example.test', 'nila43 at example dot test', 'nila43@example.test, other@example.test'])
def test_smtp_boundary_rejects_spoken_or_multiple_recipients(monkeypatch, recipient):
    import smtplib

    import notify
    smtp = Mock(side_effect=AssertionError('Invalid recipient must never open SMTP'))
    monkeypatch.setattr(smtplib, 'SMTP', smtp)
    monkeypatch.setattr(smtplib, 'SMTP_SSL', smtp)
    monkeypatch.setenv('RESEND_API_KEY', '')
    monkeypatch.setenv('SMTP_HOST', 'smtp.example.test')
    monkeypatch.setenv('SMTP_USER', 'sender@example.test')
    monkeypatch.setenv('SMTP_PASSWORD', 'synthetic-secret')
    assert not notify.send_booking_confirmation_email(recipient, 'Nila', '2026-11-13T11:00:00+05:30', 'SYNTHETIC')
    smtp.assert_not_called()
