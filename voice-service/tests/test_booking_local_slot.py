from unittest.mock import AsyncMock,MagicMock
import tools

async def test_local_only_booking_rechecks_occupied_slot_before_writing(monkeypatch):
    monkeypatch.setenv('CALCOM_API_KEY','');monkeypatch.setenv('CALCOM_EVENT_TYPE_ID','')
    monkeypatch.setattr(tools.db,'find_booked_appointment',AsyncMock(return_value=None))
    monkeypatch.setattr(tools.db,'find_booked_slot',AsyncMock(return_value=None))
    monkeypatch.setattr(tools.db,'check_slot',AsyncMock(return_value=False))
    monkeypatch.setattr(tools.db,'get_next_available',AsyncMock(return_value='11:00'))
    insert=AsyncMock(return_value='must-not-book');monkeypatch.setattr(tools.db,'insert_appointment',insert)
    agent=tools.AppointmentTools(MagicMock(),'+919000000000','Synthetic')
    result=await agent._book_appointment('Synthetic','2026-12-20','10:00','consultation')
    insert.assert_not_awaited()
    assert 'taken' in result or 'unavailable' in result
