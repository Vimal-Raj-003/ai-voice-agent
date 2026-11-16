import json

import pytest

from callstate import CallState
from gemini_live_runtime import memory_snapshot
from spoken_details import english_date, english_time, phone_readback


@pytest.mark.parametrize('day,suffix', [(1,'1st'),(2,'2nd'),(3,'3rd'),(11,'11th'),(12,'12th'),(13,'13th'),(21,'21st'),(23,'23rd')])
def test_english_booking_date_ordinals(day, suffix):
    assert english_date(f'2026-11-{day:02d}') == f'November {suffix}, 2026'


def test_spoken_readbacks_do_not_change_the_actual_booking_slot_or_email():
    state = CallState(entities={'date':'2026-11-13','time':'11:00','phone':'9750666666','email':'nila66@example.test'})
    original = dict(state.entities)
    snapshot = json.loads(memory_snapshot(state))
    assert snapshot['spoken_details']['date'] == 'November 13th, 2026'
    assert snapshot['spoken_details']['time'] == "11 o'clock in the morning"
    assert snapshot['spoken_details']['phone'] == 'nine seven five zero triple six triple six'
    assert 'email' not in snapshot['spoken_details']
    assert state.entities == original


@pytest.mark.parametrize('value,expected', [('97500066','nine seven five triple zero double six'),
    ('97506666','nine seven five zero triple six six'),
    ('+9190000011','plus nine one nine triple zero double zero double one')])
def test_phone_double_triple_groups_preserve_all_digits(value, expected):
    assert phone_readback(value) == expected


def test_noon_midnight_and_invalid_values_are_not_guessed():
    assert english_time('12:00') == '12 noon'
    assert english_time('00:00') == '12 midnight'
    assert english_time('16:30') == '4:30 in the afternoon'
    assert english_date('tomorrow') == ''
    assert english_time('25:00') == ''
    assert phone_readback('nil a66@example.test') == ''
