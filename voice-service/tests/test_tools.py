from unittest.mock import MagicMock

from tools import AppointmentTools


def test_build_tool_list_returns_all_when_empty():
    ctx = MagicMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    out = t.build_tool_list([])
    names = {fn.__name__ for fn in out}
    assert {"check_availability", "book_appointment", "end_call",
            "transfer_to_human", "send_sms_confirmation", "lookup_contact",
            "remember_details", "book_calcom", "cancel_calcom"} <= names


def test_build_tool_list_filters_by_enabled():
    ctx = MagicMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    out = t.build_tool_list(["check_availability", "end_call"])
    names = {fn.__name__ for fn in out}
    assert names == {"check_availability", "end_call"}
