from callstate import CallState


def test_latest_call_keeps_bare_name_and_service_after_date_and_time_questions():
    state = CallState()
    state.observe_user("appointment book பண்ணலாமா?")
    state.set_pending(None, "ஆம், appointment book பண்ணலாம். உங்கள் பெயர் என்ன?")
    state.observe_user("Abhilasthi.")
    assert state.entities.get("name") == "Abhilasthi"
    state.set_pending(None, "நீங்கள் எந்த சேவைக்கு நியமனம் செய்ய விரும்புகிறீர்கள்?")
    state.observe_user("Flipkart e-commerce-க்கு எனக்கு.")
    assert "e-commerce" in state.entities.get("service", "")
    state.observe_user("நான் book பண்ணிக்கிறேன்.")
    state.set_pending(None, "நீங்கள் எந்த தேதிக்கு நியமனம் செய்ய விரும்புகிறீர்கள்?")
    state.observe_user("November six.")
    state.set_pending(None, "எந்த நேரத்திற்கு நியமனம் செய்ய விரும்புகிறீர்கள்?")
    state.observe_user("11:00 AM")
    assert state.entities["name"] == "Abhilasthi"
    assert "Flipkart" in state.entities["service"]
    assert state.entities["date"] == "November six"
    assert state.entities["time"] == "11:00 AM"
    assert "time=11:00 AM" in state.to_directive()
    assert "Known values are background facts" in state.to_directive()


def test_repeated_tamil_rejection_clears_wrong_email_without_a_new_address():
    state = CallState()
    state.observe_user("wrong@example.test")
    state.observe_user("தப்பு தப்பு தப்பு தப்பு.")
    assert "email" not in state.entities
    assert state.pending_slug == "email"
    assert state.contact_repair


def test_known_field_question_does_not_overwrite_answer_with_a_different_guess():
    state = CallState(entities={"name": "Abi", "service": "e-commerce", "date": "November 6"})
    state.set_pending(None, "உங்கள் பெயர் என்ன?")
    assert state.entities["name"] == "Abi"
    assert state.pending_slug != "name"


def test_presence_or_confusion_is_not_recorded_as_a_name():
    state = CallState()
    state.set_pending(None, "உங்கள் பெயர் என்ன?")
    state.observe_user("Hello.")
    state.observe_user("எதுக்கு திருப்பி திருப்பி கேக்குறீங்க?")
    assert "name" not in state.entities


def test_question_followed_by_service_examples_still_tracks_the_answer():
    state = CallState()
    state.observe_assistant("நீங்கள் எந்த சேவைக்கு நியமனம் விரும்புகிறீர்கள்? Software, web மற்றும் e-commerce உள்ளன.")
    assert state.pending_slug == "service"
    state.observe_user("e-commerce")
    assert state.entities["service"] == "e-commerce"


def test_rejected_name_requires_spelling_instead_of_repeating_wrong_name():
    state = CallState(entities={"name": "Wrong Name"})
    state.observe_user("என் பெயர் spelling தப்பு")
    assert "name" not in state.entities
    assert state.pending_slug == "name_spelling"
    state.observe_user("A B I")
    assert state.entities["name"] == "ABI"
    assert state.pending_slug == "name_confirmation"
    state.observe_user("correct")
    assert state.entities["name_confirmed"] == "yes"
    assert state.spelling_field is None


def test_saved_intake_survives_actual_sdk_history_truncation():
    import agent
    from types import SimpleNamespace
    from livekit.agents import llm
    state = CallState()
    state.observe_user("appointment book பண்ணலாமா?")
    state.observe_assistant("உங்கள் பெயர் என்ன?")
    state.observe_user("Abi")
    state.observe_assistant("எந்த சேவைக்கு appointment வேண்டும்?")
    state.observe_user("e-commerce")
    ctx = llm.ChatContext()
    for i in range(20):
        ctx.add_message(role="user", content=f"later question {i}")
        ctx.add_message(role="assistant", content="Please continue.")
    ctx.truncate(max_items=6)
    owner = SimpleNamespace(_lang_state=None, _call_state=state, _llm_turn=20)
    result = agent.BoundedAgent._apply_language_directive(owner, ctx)
    context = "\n".join(item.text_content or "" for item in result.items if item.role == "system")
    assert "name=Abi" in context and "service=e-commerce" in context
    assert "Known values are background facts" in context


def test_llm_context_captures_reply_even_if_playback_callback_has_not_run():
    import agent
    from types import SimpleNamespace
    from livekit.agents import llm
    state = CallState()
    ctx = llm.ChatContext()
    ctx.add_message(role="assistant", content="உங்கள் பெயர் என்ன?")
    ctx.add_message(role="user", content="Abi")
    owner = SimpleNamespace(_lang_state=None, _call_state=state, _llm_turn=2)
    agent.BoundedAgent._apply_language_directive(owner, ctx)
    assert state.entities.get("name") == "Abi"


def test_repeated_name_question_cannot_misfile_a_name_as_the_pending_date():
    state = CallState(entities={"name": "Abi", "service": "e-commerce"})
    state.set_pending("date", "Which date?")
    state.observe_assistant("உங்கள் பெயர் என்ன?")
    state.observe_user("Abi")
    assert "date" not in state.entities
