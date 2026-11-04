"""Parse explicit contact corrections without guessing missing spelling."""
import re
from collections.abc import AsyncIterable, AsyncIterator

EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
REJECTION = re.compile(r"\b(?:wrong|incorrect|not\s+(?:that|this)|thapp\w*|thap\w*)\b|தப்பா|தப்பு|தவறு", re.I)
CORRECTION = re.compile(REJECTION.pattern + r"|\b(?:correct|change|replace)\s+(?:my|the|that|this|it|email|name)\b|\binstead\b|மாற்ற|மாத்த|\bmaath\w*", re.I)
EMAIL_TOPIC = re.compile(r"e-?mail|ஈமெயில்|மெயில்|மின்னஞ்சல்|mail\s*id", re.I)
CONFIRMATION = re.compile(r"(?:(?:yes|yeah|ஆமா|ஆமாங்க|aama|சரி)[, ]+)?(?:correct|that's correct|that is correct|கரெக்ட்|சரிதான்)", re.I)
PRESENCE = re.compile(
    r'^\s*(?:(?:ம்|ம்ம்|hmm|mm)[, ]+)?(?:(?:hello+|ஹலோ)[, ]+)?(?:hello+|hallo+|hi+|helo+|you\s+there|are\s+you\s+(?:there|still\s+there)'
    r'|can\s+you\s+hear\s+me|still\s+there|கேக்குதா|கேட்குதா|இருக்கீங்களா|ஹலோ|ஹலோவ்'
    r'|(?:நான்\s+)?பேசு(?:ற|ர|வ)து\s+(?:கேக்குதா|கேட்குதா)'
    r'|हलो|हेलो|हैलो|ഹലോ|హలో)\s*[?.!।॥]*\s*$', re.I)


def latest_email(text: str) -> str:
    value = re.sub(r"\s+(?:at)\s+", "@", text, flags=re.I)
    value = re.sub(r"\s+(?:dot|டாட்)\s+", ".", value, flags=re.I)
    value = re.sub(r"\s*@\s*", "@", value)
    # Domain punctuation may be spaced by STT. A preceding sentence's full
    # stop must never become the first character of the next email's local part.
    value = re.sub(r"(@[A-Za-z0-9.\-]+)\s*\.\s*([A-Za-z]{2,})(?=\b)", r"\1.\2", value)
    # Join only explicitly separated single characters, never ordinary words.
    value = re.sub(r"(?<!\w)(?:[A-Za-z0-9][ -]+){1,}[A-Za-z0-9](?=@)",
                   lambda m: re.sub(r"[ -]+", "", m.group()), value)
    matches = list(EMAIL.finditer(value))
    return matches[-1].group().lower().rstrip(".") if matches else ""


def fragmented_spelling(text: str) -> bool:
    """An address suffix is not the whole recipient when letters preceded it."""
    before_at = text.rsplit('@', 1)[0] if '@' in text else ''
    return bool(re.search(r'\b(?:zero|one|two|three|four|five|six|seven|eight|nine)\b', before_at, re.I)
                and re.search(r'[A-Za-z]\s+[A-Za-z]', before_at))


def plausible_name(value: str) -> bool:
    """Reject sentence/slot-shaped values; the existing LLM resolves ambiguity."""
    value = value.strip().rstrip('.!?,')
    if value.casefold() in ('unknown', 'none', 'null', 'not provided', 'not available', 'n/a'):
        return False
    if not value or len(value.split()) > 4 or any(c.isdigit() for c in value):
        return False
    if any(c in value for c in '?@:/'):
        return False
    if re.search(r'\b(?:tomorrow|today|yesterday|afternoon|morning|evening|appointment|website|maintenance|want|need|please|because|hello)\b'
                 r'|எனக்கு|நாளை|இன்னைக்கு|நேற்று|மணிக்கு|வேணும்|வேண்டும்|பண்ண|சொன்ன|புரிய|கேக்கு|கேட்கு|மதியம்|மாலை|காலை', value, re.I):
        return False
    return all(c.isalpha() or c.isspace() or c in ".'-" or '\u0300' <= c <= '\u036f'
               or '\u0900' <= c <= '\u0dff' for c in value)


def correction_requested(text: str) -> bool:
    if CONFIRMATION.fullmatch(text.strip().rstrip('.!? ')):
        return False
    # Mentioning spelling/correctness is not a rejection. Ambiguous natural
    # language is interpreted by the model against the pending question.
    return bool(CORRECTION.search(text))


def rejection_requested(text: str) -> bool:
    """Only explicit rejection may erase a candidate; change requests need context."""
    return bool(REJECTION.search(text)) and not CONFIRMATION.fullmatch(text.strip().rstrip('.!? '))


def turn_intent(text: str) -> str:
    """Recognize only explicit conversational controls; questions remain questions."""
    value = text.strip().lower().rstrip('.!? ')
    if re.fullmatch(r'(?:please\s+)?(?:cancel(?:\s+(?:it|the booking|the appointment))?|stop(?:\s+(?:it|the booking))?|cancel\s+pannunga|வேண்டாம்\s*cancel\s*பண்ணுங்க|(?:கேன்சல்|cancel)\s*பண்ணுங்க|நிறுத்துங்க)', value):
        return 'cancel'
    if correction_requested(value) and not re.fullmatch(r'(?:yes[, ]+)?correct', value):
        return 'correction'
    if PRESENCE.fullmatch(value):
        return 'presence'
    if re.fullmatch(r'(?:paath(?:u|uu)?tt(?:ee|i|e)ngala|paathuteengala|பாத்துட்டீங்களா|பார்த்தீங்களா|பாத்தீங்களா|did you check(?: it)?|have you checked(?: it)?|any update|is it done)', value):
        return 'status'
    return 'content'


def correct_email_part(text: str, previous: str) -> str:
    """A caller may replace an explicitly named part; never infer a missing domain."""
    if '@' not in previous:
        return ''
    local, domain = previous.split('@', 1)
    match = re.search(r'(?:before\s+(?:the\s+)?at|local\s+part|username)\s+(?:is\s+)?([A-Za-z0-9._%+\-]+)(?:\s|$)', text, re.I)
    if match:
        return latest_email(f'{match.group(1)}@{domain}')
    match = re.search(r'(?:domain\s+(?:is\s+)?)([A-Za-z0-9.\-]+\.[A-Za-z]{2,})(?:\s|$)', text, re.I)
    if match:
        return latest_email(f'{local}@{match.group(1)}')
    match = re.search(r'(?:replace|change)\s+([A-Za-z0-9])\s+(?:with|to)\s+([A-Za-z0-9])\b', text, re.I)
    if match and local.lower().count(match.group(1).lower()) == 1:
        local = re.sub(re.escape(match.group(1)), match.group(2), local, flags=re.I)
        return latest_email(f'{local}@{domain}')
    return ''


async def guard_repeated_repair(text: AsyncIterable[str], previous: str, replacement: str) -> AsyncIterator[str]:
    """Release divergent text immediately; stop an identical long repair answer."""
    previous = previous.strip()
    if len(previous) < 40:
        async for chunk in text:
            yield chunk
        return
    buffered = ""
    checking = True
    async for chunk in text:
        if not checking:
            yield chunk
            continue
        buffered += chunk
        candidate = buffered.lstrip()
        if not previous.startswith(candidate):
            checking = False
            yield buffered
            buffered = ""
        elif len(candidate) >= 80:
            yield replacement
            return
    if buffered:
        yield replacement if buffered.strip() == previous else buffered
