from callstate import CallState


def test_correction_date_tomorrow_to_saturday():
    s = CallState(role="appointment")
    s.update_entity("date", "tomorrow")
    s.update_entity("date", "Saturday")          # explicit correction
    assert s.entities["date"] == "Saturday"       # latest wins, not both
    assert s.correction_applied == "date:tomorrow→Saturday"


def test_name_correction_ravi_to_raj():
    s = CallState(role="sales")
    s.update_entity("name", "Ravi")
    s.update_entity("name", "Raj")
    assert s.entities["name"] == "Raj"


def test_pending_question_plus_short_answer():
    s = CallState(role="appointment")
    s.set_pending("time", "What time works?")
    assert s.resolve_short_reply("4 PM") is True
    assert s.entities["time"] == "4 PM"
    assert s.pending_slug is None                 # pending cleared after resolve


def test_pending_confirm_yes_no():
    s = CallState()
    s.set_pending("confirm", "Shall I book it?")
    assert s.resolve_short_reply("yes") is True
    assert s.entities["confirmed"] == "yes"


def test_no_repeated_question_after_value_known():
    # Once a value is known, the directive carries it so the model won't re-ask.
    s = CallState(role="appointment")
    s.update_entity("service", "doctor")
    d = s.to_directive()
    assert "service=doctor" in d
    assert "never re-ask" in d.lower()


def test_hello_preserves_state():
    s = CallState(role="appointment")
    s.update_entity("date", "Saturday"); s.update_entity("time", "16:00")
    before = s.snapshot()
    # "Hello?" is a generic ack: it must neither store a fact nor change entities.
    assert s.add_fact("Hello?") is False
    assert s.update_entity("date", "Hello?") is False
    assert s.snapshot()["entities"] == before["entities"]


def test_tool_result_updates_state_and_locks():
    s = CallState(role="appointment")
    s.set_tool_fact("booking", state="confirmed:BK123", entities={"date": "Saturday", "time": "16:00"})
    assert s.tool_state["booking"] == "confirmed:BK123"
    assert s.entities["date"] == "Saturday"
    # LLM/text can't silently mutate a tool-confirmed fact.
    assert s.update_entity("date", "Sunday") is False
    assert s.entities["date"] == "Saturday"
    # A later CONFIRMED tool update still can.
    s.set_tool_fact("booking", state="rescheduled:BK124", entities={"date": "Sunday"})
    assert s.entities["date"] == "Sunday"


def test_generic_acks_not_stored_as_facts():
    s = CallState()
    for ack in ["yes", "okay", "hmm", "ஆமா", "சரி", "Hello"]:
        assert s.add_fact(ack) is False
    assert s.add_fact("Customer runs a 5-person dental clinic") is True
    assert s.known_facts == ["Customer runs a 5-person dental clinic"]


def test_custom_role_uses_same_callstate():
    # Sales / Support / Collections all use the identical engine + schema.
    for role in ("sales", "support", "collections", "custom-x"):
        s = CallState(role=role)
        s.update_entity("order_id", "ORD-9")
        s.set_intent("payment_issue")
        d = s.to_directive()
        assert f"role={role}" in d
        assert "order_id=ORD-9" in d
        assert "intent=payment_issue" in d


def test_state_survives_history_truncation():
    # The structured state is independent of chat history: truncating messages
    # (simulated) does not touch CallState.
    s = CallState(role="appointment")
    s.update_entity("name", "Gautam"); s.update_entity("service", "cleaning")
    history = ["m1", "m2", "m3", "m4", "m5", "m6", "m7"]
    history = history[-6:]                         # simulate MAX_HISTORY_ITEMS trim
    assert s.entities["name"] == "Gautam"
    assert s.entities["service"] == "cleaning"
    assert "name=Gautam" in s.to_directive()


def test_log_callback_emits_transition_events():
    events = []
    s = CallState(role="sales", log=lambda ev, **kw: events.append(ev))
    s.set_intent("pricing")
    s.update_entity("budget", "50k")
    s.update_entity("budget", "60k")               # correction
    s.set_pending("confirm", "ok?")
    s.set_tool_fact("lead", state="created:L1")
    assert "intent_changed" in events
    assert "entity_updated" in events
    assert "correction_applied" in events
    assert "pending_question_changed" in events
    assert "tool_state_changed" in events
