"""Native speech hints and logging: no paid model, carrier or external writes."""
import re
import pytest
from native_voice import initial_native_language, spoken_native_text


@pytest.mark.parametrize('greeting,expected', [
    ('வணக்கம், உங்கள் enquiry என்ன?', 'ta'),
    ('నమస్కారం, మీకు ఎలా సహాయం చేయగలను?', 'te'),
    ('നമസ്കാരം, എങ്ങനെ സഹായിക്കാം?', 'ml'),
    ('नमस्ते, कैसे मदद करूँ?', 'hi'),
])
def test_native_language_hint_uses_the_saved_spoken_greeting(greeting, expected):
    assert initial_native_language({'first_message':greeting,'stt_language':'en'})==expected


def test_native_language_falls_back_to_operator_choice_without_an_indic_greeting():
    assert initial_native_language({'first_message':'Hello','stt_language':'en-US'})=='en'
    assert initial_native_language({'stt_language':'multi'},'ta')=='ta'


def test_carrier_announcements_and_internal_snapshots_never_become_caller_speech():
    carrier=re.compile(r'^This call is now being recorded\.?$',re.I)
    assert spoken_native_text('user','This call is now being recorded.',carrier)==''
    assert spoken_native_text('assistant','[APPLICATION CALL MEMORY; turn=1]\n{"language":"ta"}',carrier)==''
    assert spoken_native_text('assistant','Spoken answer.[APPLICATION CALL MEMORY; turn=1]\n{}',carrier)=='Spoken answer.'
    # Caller-supplied strings are not application memory or a different role.
    quote='What does [APPLICATION CALL MEMORY] mean?'
    assert spoken_native_text('user',quote,carrier)==quote
    assert spoken_native_text('tool','private tool receipt',carrier)==''
