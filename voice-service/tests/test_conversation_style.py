from types import SimpleNamespace

import pytest

from conversation_style import conversation_tone, guard_spoken_opening


@pytest.mark.parametrize("messages,tone", [
    (["எனக்கு உடம்பு சரியில்லை fever தாங்க முடியல", "இன்னைக்கு 6 மணிக்கு பார்க்க முடியுமா?"], "serious"),
    (["எனக்கு வலி ரொம்ப இருக்குது", "Saturday general checkup appointment வேணும்"], "serious"),
    (["I feel sick and have a headache", "Can we book at six?"], "serious"),
    (["புரியல புரியல, என்ன சொன்னீங்க?"], "frustrated"),
    (["Good news, I got promoted!"], "positive"),
    (["எனக்கு உடம்பு சரியில்லை", "உடம்பு சரியாயிடுச்சு", "Good news, I won!"], "positive"),
    (["I want to book a software consultation"], "neutral"),
])
def test_tone_follows_the_conversation_not_booking_keywords(messages, tone):
    assert conversation_tone(messages) == tone


@pytest.mark.asyncio
@pytest.mark.parametrize("chunks,tone,expected", [
    (["அட ", "சூப்", "பரே! ", "எந்த நேரம் வேண்டும்?"], "serious", "எந்த நேரம் வேண்டும்?"),
    (["Great", "! ", "Let me check the available time."], "serious", "Let me check the available time."),
    (["Great! You won!"], "positive", "Great! You won!"),
    (["உங்களுக்கு ", "எப்படி உதவலாம்?"], "serious", "உங்களுக்கு எப்படி உதவலாம்?"),
])
async def test_serious_tone_guard_handles_split_streamed_tokens(chunks, tone, expected):
    async def stream():
        for chunk in chunks:
            yield chunk
    result = "".join([part async for part in guard_spoken_opening(stream(), tone)])
    assert result == expected


def test_distress_context_reaches_actual_llm_directive_after_booking_followup():
    import agent
    from livekit.agents import llm
    ctx = llm.ChatContext()
    ctx.add_message(role="user", content="எனக்கு உடம்பு சரியில்லை fever இருக்கு")
    ctx.add_message(role="assistant", content="எப்படி உதவலாம்?")
    ctx.add_message(role="user", content="6 மணிக்கு appointment book பண்ணலாமா?")
    owner = SimpleNamespace(_lang_state=None, _call_state=None, _llm_turn=2)
    result = agent.BoundedAgent._apply_language_directive(owner, ctx)
    assert owner._response_tone == "serious"
    assert any("CURRENT CALLER CONTEXT: serious" in (item.text_content or "") for item in result.items)
    assert not any("CURRENT CALLER CONTEXT" in (item.text_content or "") for item in ctx.items)
