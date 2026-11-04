"""Caller-context tone guidance and a streaming guard for serious conversations."""
from __future__ import annotations

import re
from collections.abc import AsyncIterable, AsyncIterator, Iterable

TONE_POLICY = """
[CONTEXTUAL TONE]
Match the caller's situation, not isolated keywords. Illness, pain, grief, fear
or complaints require calm, respectful wording; never celebrate a booking or
say 'great', 'super' or laugh in that context. Carry this context into date/time
follow-ups. Acknowledge once briefly, answer the actual request, then ask at
most one relevant question. Do not repeatedly perform sympathy or claim human
feelings. Use a light, warm tone only for genuinely positive news. If confused,
clarify the latest point instead of guessing or restarting your introduction.
Knowledge supplies verified business facts, not the caller's emotional state.
Only offer services and bookings the business actually provides; an appointment
request does not turn a software business into a clinic. Never invent facts.
For hospital or urgent health concerns use calm, respectful language by default.
Do not joke, diagnose, invent clinical advice or infer hidden emotions. Follow
the assistant's approved escalation rules and configured human transfer targets;
never invent a destination or promise that emergency help has been dispatched.
Address the caller neutrally using நீங்க / நீங்கள். Never use ஐயா, அய்யா,
சார், மேடம், sir, madam, ma'am, or gender/family titles, even if an older
prompt/example uses them. Do not guess gender from the voice.
Retain the original problem and explicit constraints across intake. A date/time
answer is not a name. If the caller changes topic, answer that topic rather
than asking an unrelated intake question. Positive news gets a brief warm
acknowledgement; do not claim to experience human feelings.
Never announce checking/preparing on ordinary questions. Start with the answer.
Only a verified action result can justify booking/email success. No result means
unconfirmed; queued email means queued, not sent. Discussing details is not
permission to book. Respect 'do not book yet' until explicit permission changes.
"""

_ADDRESS = re.compile(r"(?<!\w)(?:ஐயா|அய்யா|சார்|மேடம்|மாம்|அம்மா|அண்ணா|அக்கா|தம்பி|sir|madam|ma['’]?am)(?!\w)[, ]*", re.I)


def neutral_address(text: str) -> str:
    return _ADDRESS.sub('', text)


async def guard_verified_actions(text: AsyncIterable[str], state, *, read_only=False,
                                 language='ta', log=None) -> AsyncIterator[str]:
    """Stream ordinary words; hold only an action clause until its claim is known.

    This is a last-resort check against verified results, not an intent model.
    A changed caller revision cancels the SDK speech that owns this iterator.
    """
    pending = ''
    sensitive = False
    trigger = re.compile(r'booking|booked|appointment|அப்பாயின்ட்மென்ட்|நியமனம்|மின்னஞ்சல்|e-?mail|confirmation', re.I)
    affirmative = re.compile(r'\b(?:confirmed|booked|sent|scheduled|reserved)\b|உறுதி\s*செய்யப்பட்ட|உறுதியா(?:ன|கி)|புக்\s*பண்ணியாச்சு|(?:ஏற்பாடு|புக்)\s*செய்(?:துள்ள|து\s*விட்ட|யப்பட்ட)|அனுப்ப(?:ப்பட்ட|ி(?:யாச்சு|விட்ட))', re.I)

    def verified(clause):
        if not affirmative.search(clause):
            return clause
        email = bool(re.search(r'e-?mail|மின்னஞ்சல்', clause, re.I))
        allowed = (state is not None and not read_only and
                   (state.entities.get('email_delivery') == 'sent' if email else
                    str(state.tool_state.get('booking', '')).startswith('confirmed:')))
        if allowed:
            return clause
        if log:
            log('unverified_spoken_claim_blocked', kind='email' if email else 'booking')
        if language == 'ta':
            return 'Email அனுப்பலை. ' if email else 'Booking இன்னும் உறுதி செய்யலை. '
        return 'No email has been sent. ' if email else 'A booking has not been confirmed. '

    async for chunk in text:
        pending += chunk
        while pending:
            if not sensitive:
                match = trigger.search(pending)
                if match:
                    if match.start():
                        yield pending[:match.start()]
                    pending = pending[match.start():]
                    sensitive = True
            if sensitive:
                # Do not split a dot inside an email address.
                boundary = re.search(r'[!?।\n]|\.(?=\s|$)', pending)
                if not boundary:
                    break
                stop = boundary.end()
                yield verified(pending[:stop])
                pending = pending[stop:]
                sensitive = False
            else:
                split = pending.rfind(' ')
                if split >= 0:
                    yield pending[:split+1]
                    pending = pending[split+1:]
                break
    if pending:
        yield verified(pending) if sensitive else pending

_DISTRESS = re.compile(
    r"\b(?:fever|pain|sick|unwell|illness|hospital|accident|grief|died|depressed|scared|worried|headache|udambu\s+sari\s*ill|vali|kashtam|kastam)\b"
    r"|உடம்பு\s*சரியில்ல|வலி|காய்ச்சல்|தலைவலி|கஷ்ட|பயமா|இறந்த|சோக|கவலை", re.I,
)
_FRUSTRATION = re.compile(
    r"\b(?:frustrated|angry|not\s+understand|don't\s+understand|already\s+told|puriyal|puriyala)\b"
    r"|புரியல|ஏற்கனவே\s*சொன்ன|கோப", re.I,
)
_RESOLVED = re.compile(
    r"\b(?:feeling\s+better|recovered|no\s+longer\s+(?:sick|in\s+pain)|change\s+(?:the\s+)?topic|vera\s+vishayam)\b"
    r"|உடம்பு\s*சரியாயிடுச்சு|வலி\s*இல்லை|வேற\s*விஷயம்|வேறு\s*விஷயம்", re.I,
)
_POSITIVE = re.compile(
    r"\b(?:good\s+news|won|promoted|happy|excited)\b|சந்தோஷ|வெற்றி|நல்ல\s*செய்தி", re.I,
)
_CELEBRATION = re.compile(
    r"^\s*(?:(?:அட\s*)?(?:சூப்பரே|சூப்பர்|அருமை)|(?:அப்படியா[!,… ]*)?ரொம்ப\s*சந்தோஷ(?:ம்|ம்ங்க)?"
    r"|great|awesome|fantastic|wonderful|that's\s+great)[!.,…]+\s*", re.I,
)
_OPENINGS = ("அட சூப்பரே", "அட சூப்பர்", "சூப்பரே", "சூப்பர்", "அருமை", "அப்படியா", "ரொம்ப சந்தோஷ", "great", "awesome", "fantastic", "wonderful", "that's great")


def conversation_tone(user_messages: Iterable[str], *, initial: str = 'neutral') -> str:
    tone = initial
    for text in user_messages:
        if _RESOLVED.search(text):
            tone = "neutral"
        elif _DISTRESS.search(text):
            tone = "serious"
        elif _FRUSTRATION.search(text):
            tone = "frustrated"
        elif _POSITIVE.search(text) and tone not in ("serious", "frustrated"):
            tone = "positive"
    return tone


def tone_directive(tone: str) -> str:
    if tone == 'positive':
        return ('[CURRENT CALLER CONTEXT: positive] Briefly acknowledge the good news warmly. '
                'Do not claim human feelings or redirect to intake or ask what service they need unless requested.')
    if tone in ("serious", "frustrated"):
        return (
            f"[CURRENT CALLER CONTEXT: {tone}] The caller has described distress or confusion. "
            "Keep the next reply calm, short and practical, including booking/date follow-ups. "
            "No cheerful exclamations, congratulations, laughter or repeated sympathy scripts. "
            "Answer their latest question using verified business capabilities; clarify uncertainty."
        )
    return ""


async def guard_spoken_opening(text: AsyncIterable[str], tone: str) -> AsyncIterator[str]:
    """Inspect only a possible celebratory prefix; ordinary speech streams immediately."""
    if tone not in ("serious", "frustrated"):
        async for chunk in text:
            yield chunk
        return
    opening = ""
    checking = True
    async for chunk in text:
        if not checking:
            yield chunk
            continue
        opening += chunk
        cleaned = _CELEBRATION.sub("", opening, count=1)
        if cleaned != opening:
            opening = cleaned
        folded = opening.lstrip().casefold()
        possible = not folded or any(p.startswith(folded) or folded.startswith(p) for p in _OPENINGS)
        if not possible or len(opening) >= 64:
            checking = False
            if opening:
                yield opening
            opening = ""
    if opening:
        yield _CELEBRATION.sub("", opening, count=1)
