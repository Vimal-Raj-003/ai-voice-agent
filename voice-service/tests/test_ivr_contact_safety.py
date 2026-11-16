"""Transfer and spoken contact regressions, with no dialing or paid sessions."""
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock

import pytest

from contact_corrections import latest_email
from tools import AppointmentTools


@pytest.mark.parametrize('caller', ['919000000001', '+919000000001', '9000000001'])
async def test_transfer_to_the_current_callers_number_is_blocked_before_refer(caller):
    refer = AsyncMock(side_effect=AssertionError('Must not call the caller back'))
    ctx = NS(room=NS(name='offline'), api=NS(sip=NS(transfer_sip_participant=refer)))
    owner = AppointmentTools(ctx, caller)
    owner.transfer_targets = {'other':{'category':'other','label':'Contact 1','phone':'+919000000001','priority':10}}
    result = await owner.transfer_to_human('other')
    assert 'TRANSFER_FAILED' in result
    assert 'same number' in result
    refer.assert_not_awaited()
    assert owner._transfer_started is False


@pytest.mark.parametrize('spoken,expected', [
    ('N I L A underscore S four three at example dot test','nila_s43@example.test'),
    ('N I L A dash S four three at example dot test','nila-s43@example.test'),
    ('N I L A plus S four three at example dot test','nila+s43@example.test'),
    ('N I L A dot S four three at example dot test','nila.s43@example.test'),
])
def test_explicit_spoken_email_symbols_keep_the_entire_local_part(spoken, expected):
    assert latest_email(spoken) == expected


def test_email_symbol_words_in_ordinary_sentences_are_not_joined_as_a_recipient():
    assert latest_email('my address is first.last@example.test') == 'first.last@example.test'
    assert latest_email('please add a plus point to the website') == ''


async def test_demo_uses_saved_ivr_team_labels_without_exposing_or_dialing_numbers():
    from callstate import CallState
    from gpt_live_experiment import sandbox_tools
    events = []
    owner, _ = sandbox_tools(NS(room=NS(name='offline')), CallState(),
        lambda event, **fields: events.append((event, fields)), slow_seconds=0,
        transfer_targets={'software':{'label':'Software (Tamil)','phone':'+919000000001'}})
    result = await owner.transfer_to_human('software')
    assert 'TEST_ONLY_TRANSFER_SIMULATED' in result
    assert 'Software (Tamil)' in result
    assert '+919000000001' not in result
    assert owner.transfer_targets == {}  # Real destinations never enter the sandbox owner.
    assert events[-1][1]['human_connected'] is False
    assert 'unavailable' in await owner.transfer_to_human('Tamil support')
