"""Replay corrected letter chunks followed by a domain in its own phone turn."""
import json

from callstate import CallState
from gemini_live_runtime import memory_snapshot


def collecting():
    state = CallState(entities={'name':'Nila','service':'Consultation','date':'2026-12-03','time':'17:00'})
    state.require_email_readback = True
    state.set_pending('email', 'Please say your email.')
    return state


def test_bare_domain_finishes_corrected_spelling_instead_of_extending_local_part():
    state = collecting()
    state.observe_user('nilasht43@example.test', 'one')
    state.observe_user('spelling சொல்லட்டுமா?', 'two')
    state.observe_user('N I L A S R I. Four.', 'three')
    state.observe_user('Three.', 'four')
    state.observe_user('example.test.', 'five')
    assert state.entities['email'] == 'nilasri43@example.test'
    assert state.email_spelled_local == ''
    assert state.entities['name'] == 'Nila'
    assert state.entities['time'] == '17:00'
    assert state.entities['email_confirmed'] == 'no'


def test_suffix_domain_with_a_readback_request_keeps_preceding_letters():
    state = collecting()
    state.observe_user('N I L A', 'one')
    state.observe_user('four three at example dot test நீங்களும் சொல்லுங்க.', 'two')
    assert state.entities['email'] == 'nila43@example.test'


def test_draft_memory_does_not_direct_the_model_to_repeat_rejected_old_candidate():
    state = collecting()
    state.observe_user('old43@example.test', 'one')
    state.observe_user('N I L A', 'two')
    snapshot = json.loads(memory_snapshot(state))
    assert snapshot['email_spelled_local'] == 'nila'
    assert 'readback' not in snapshot.get('contact_guidance','').lower() or 'old43' not in snapshot.get('email_readback','')
    assert not snapshot.get('entities',{}).get('email')


def test_request_to_spell_a_candidate_is_not_confirmation_or_more_local_letters():
    state = collecting()
    state.observe_user('nila43@example.test','one')
    state.observe_assistant('n i l a 4 3 @ example.test correct?')
    state.observe_user('நீ சொல்றது சரிதான் ஆனா spelling சொல்லு.', 'two')
    assert state.entities['email_confirmed'] == 'no'
    assert state.entities['email'] == 'nila43@example.test'
    assert state.spelling_field == 'email'
    assert not state.email_spelled_local
    assert not state.can_confirm_email()


def test_partial_new_spelling_cannot_confirm_the_old_readback():
    state = collecting()
    state.observe_user('old43@example.test','one')
    state.observe_assistant('o l d 4 3 @ example.test correct?')
    state.observe_user('N I L A','two')
    assert not state.can_confirm_email()
    snapshot = json.loads(memory_snapshot(state))
    assert 'old43' not in json.dumps(snapshot.get('entities',{}))
    assert state.entities['name'] == 'Nila'


def test_position_correction_then_full_respelling_replaces_wrong_draft_not_appends_it():
    state = collecting()
    state.observe_user('N I R A','one')
    state.observe_user('N-க்கு அப்புறம் I I I ஓகேவா N-க்கு அப்புறம் I.', 'two')
    state.observe_user('N I L A S R I. Four.','three')
    state.observe_user('Three.','four')
    state.observe_user('example.test.','five')
    assert state.entities['email'] == 'nilasri43@example.test'
    assert state.entities.get('email_confirmed') != 'yes'


def test_correction_of_letter_position_does_not_certify_a_domain_before_new_letters_arrive():
    state = collecting()
    state.observe_user('N I R A','one')
    state.observe_user('N-க்கு அப்புறம் I.', 'two')
    state.observe_user('example.test.','three')
    assert state.entities.get('email_confirmed') != 'yes'
    assert not state.can_confirm_email()
