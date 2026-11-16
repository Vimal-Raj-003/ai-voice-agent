"""Parse explicit contact corrections without guessing missing spelling."""
import re
from collections.abc import AsyncIterable, AsyncIterator

EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
REJECTION = re.compile(r"\b(?:wrong|incorrect|not\s+(?:that|this)|thapp\w*|thap\w*)\b|தப்பா|தப்பு|தவறு", re.I)
CORRECTION = re.compile(REJECTION.pattern + r"|\b(?:correct|change|replace)\s+(?:my|the|that|this|it|email|name)\b|\binstead\b|மாற்ற|மாத்த|\bmaath\w*", re.I)
EMAIL_TOPIC = re.compile(r"e-?mail|ஈமெயில்|மெயில்|மின்னஞ்சல்|mail\s*id", re.I)
CONFIRMATION = re.compile(r"(?:(?:ம்|ம்ம்|mm|hmm)[, ]+)?(?:(?:yes|yeah|ஆமா|ஆமாங்க|aama|சரி)[, ]+)?(?:correct|that's correct|that is correct|கரெக்ட்|சரிதான்)(?:\s+(?:தான்|தாங்க|thaan|than))?(?:[, ]+(?:confirm|confirmed|கன்ஃபர்ம்))?(?:[, ]+(?:super|சூப்பர்|thank you|thanks|நன்றி))?", re.I)
PRESENCE = re.compile(
    r'^\s*(?:(?:ம்|ம்ம்|hmm|mm)[, ]+)?(?:(?:hello+|ஹலோ)[, ]+)?(?:hello+|hallo+|hi+|helo+|you\s+there|are\s+you\s+(?:there|still\s+there)'
    r'|can\s+you\s+hear\s+me|still\s+there|கேக்குதா|கேட்குதா|இருக்கீங்களா|ஹலோ|ஹலோவ்'
    r'|(?:நான்\s+)?பேசு(?:ற|ர|வ)து\s+(?:கேக்குதா|கேட்குதா)'
    r'|हलो|हेलो|हैलो|ഹലോ|హలో)\s*[?.!।॥]*\s*$', re.I)


_DIGITS = dict(zip(('zero','one','two','three','four','five','six','seven','eight','nine'), '0123456789'))
_SPOKEN_SYMBOLS = {'dot':'.', 'underscore':'_', 'dash':'-', 'hyphen':'-', 'plus':'+'}
_SPELL_TOKEN = r'(?:[A-Za-z0-9]|zero|one|two|three|four|five|six|seven|eight|nine|dot|underscore|dash|hyphen|plus)'
_SMALL_NUMBERS = dict(zip(('ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'), range(10,20)))
_TENS = dict(zip(('twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'), range(20,100,10)))
_SPELLING_OFFER = re.compile(
    r"(?:I'll|I will|let me)\s+spell(?:\s+it)?|(?:spelling|ஸ்பெல்லிங்)\s+சொல்லட்டுமா", re.I)


def email_spelling_offer(text: str) -> bool:
    return bool(_SPELLING_OFFER.search(text))


def email_spelling_remainder(text: str) -> str:
    """Keep letters supplied after an offer to respell in this same turn."""
    match = _SPELLING_OFFER.search(text)
    return text[match.end():].strip(' :,.!?') if match else ''


def email_readback_requested(text: str) -> bool:
    return bool(re.search(r'\b(?:spell\s+(?:it|that|my|the)|read\s*(?:it\s*)?back)\b|(?:spelling|ஸ்பெல்லிங்)\s+சொல்லு', text, re.I))


def email_fragment(text: str) -> tuple[str, str] | None:
    """Literal local-part chunks, only for an active email collection question.

    No phonetic guesses or inherited domains. A domain is returned only when
    the caller supplies an at delimiter in this utterance.
    """
    if '?' in text:
        return None
    value = text.strip().lower().strip(' ,!?').rstrip('. ')
    # A readback request after a literal address is not another address chunk.
    value = re.sub(r'\s+(?:நீங்களும்\s+சொல்லுங்க|நீங்க\s+சொல்லுங்க|please\s+read\s+(?:it\s+)?back)\s*[.! ]*$', '', value)
    value = re.sub(r'^(?:(?:mm|hmm|okay|ok|ம்|சரி)[, .]+)+', '', value)
    value = re.sub(r'^(?:my (?:email|e-mail)(?: address)? is|email(?: id)? is)\s+', '', value)
    value = re.sub(r'^(?:at|அட்|அட் சைன்)\s+', '@', value)
    value = re.sub(r'\s+(?:at|அட்|அட் சைன்)\s+', '@', value)
    value = re.sub(r'\s*@\s*', '@', value)
    if value.count('@') > 1:
        return None
    local, at, domain = value.partition('@')
    # In a spelling exchange the domain is often a separate turn, without at.
    if not at and re.fullmatch(r'[a-z0-9-]+\.[a-z]{2,}', value):
        return '', value
    if at:
        domain = re.sub(r'\s+(?:dot|டாட்)\s+', '.', domain).replace(' ', '').rstrip('.')
        if not re.fullmatch(r'[a-z0-9-]+(?:\.[a-z0-9-]+)+', domain):
            return None
    else:
        domain = ''
    if at and not local:
        return '', domain
    # Treat the example as evidence for the stated letter, never as address
    # characters. Conflicting pairs (B for Delhi) need clarification.
    phonetics = list(re.finditer(r'\b([a-z])\s+(?:for|as\s+in)\s+([a-z]+)\b', local))
    if any(match[1] != match[2][0] for match in phonetics):
        return None
    local = re.sub(r'\b([a-z])\s+(?:for|as\s+in)\s+([a-z]+)\b', r'\1', local)
    if re.search(r'\b[a-z]\s+[a-z]\b', local):
        # ASR sentence punctuation between spelled chunks is not a spoken dot.
        local = re.sub(r'(?<=[a-z0-9])\.(?=\s)', ' ', local)
    # Conversation/prose is not spelling, even when it contains ASCII words.
    if not re.fullmatch(r'[a-z0-9._%+\s,\-]*', local):
        return None
    tokens = re.findall(r'[a-z0-9]+|[._%+\-]', local)
    if not tokens or len(tokens) > 64:
        return None
    if any(token in {'sorry','correct','wrong','yes','no','yeah','hello','okay','ok','mm','hmm','email','address',
                     'please','send','to','my','is','not','instead','thank','you','the','and','for','as','in'} for token in tokens):
        return None
    chunks = []
    index = 0
    while index < len(tokens):
        token = tokens[index]
        if token in ('double','triple'):
            if index+1 >= len(tokens):
                return None
            digit = _DIGITS.get(tokens[index+1], tokens[index+1])
            if not re.fullmatch(r'[a-z0-9]', digit):
                return None
            chunks.append(digit * (2 if token == 'double' else 3))
            index += 2
            continue
        if token in _TENS:
            number = _TENS[token]
            if index+1 < len(tokens) and tokens[index+1] in _DIGITS and tokens[index+1] != 'zero':
                number += int(_DIGITS[tokens[index+1]])
                index += 1
            chunks.append(str(number))
        else:
            chunks.append(_SPOKEN_SYMBOLS.get(token, _DIGITS.get(token, str(_SMALL_NUMBERS.get(token, token)))))
        index += 1
    return ''.join(chunks), domain


def email_readback_matches(text: str, expected: str) -> bool:
    """Compare a complete spoken address, not a suffix regex match.

    Caller capture and assistant readback use the same literal parser. Only
    a whole address clause or an explicit email label can start the match;
    an extra local-part word must not be silently dropped.
    """
    expected = canonical_recipient(expected)
    if not expected:
        return False
    value = re.sub(r'\s+(?:at|அட் சைன்|அட்)\s+', '@', text, flags=re.I)
    value = re.sub(r'\s+(?:dot|டாட்)\s+', '.', value, flags=re.I)
    # Preserve dot separators in the address while bounding surrounding prose.
    value = re.sub(r'\s*@\s*', '@', value)
    value = re.sub(r'(@[A-Za-z0-9-]+)\s*\.\s*([A-Za-z]{2,})', r'\1.\2', value)
    endings = list(re.finditer(r'@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b', value))
    if len(endings) != 1:
        return False  # Multiple choices are not one complete readback.
    end = endings[0]
    prefix = value[:end.start()]
    # Sentence punctuation can precede the clause, but commas between spelled
    # letters belong to it. Explicit labels also support Tamil framing.
    prefix = re.split(r'[!?;:]|\.\s+(?=[A-Z])', prefix)[-1].strip()
    labels = list(re.finditer(r'(?:e-?mail(?:\s+(?:address|id))?|ஈமெயில்|மெயில்)(?:\s+(?:is|இது))?\s*[:=]?\s+', prefix, re.I))
    if labels:
        prefix = prefix[labels[-1].end():]
    part = email_fragment(prefix + value[end.start():end.end()])
    if not part:
        return False
    return canonical_recipient(part[0] + '@' + part[1]) == expected


def _joined_spelling(value: str) -> str | None:
    match = re.search(r'(?<!\w)(' + _SPELL_TOKEN + r'(?:[\s,.-]+' + _SPELL_TOKEN + r'){2,})[. ]*$', value, re.I)
    if not match or not re.search(r'\s', match.group()):
        return None
    tokens = re.findall(r'[A-Za-z0-9]+', match.group())
    if sum(len(token) == 1 and token.isalpha() for token in tokens) < 2:
        return None
    return value[:match.start()] + ''.join(_SPOKEN_SYMBOLS.get(token.lower(), _DIGITS.get(token.lower(), token)) for token in tokens)


def clean_spoken_name(value: str) -> str:
    return re.split(r'\s+(?:அப்படின்னு|என்று|ன்னு)\s+(?:போட்டுக்கோங்க|வச்சுக்கோங்க|குறிச்சுக்கோங்க|எழுதிக்கோங்க)\b', value, maxsplit=1)[0].strip()


def spelled_name(text: str) -> str:
    """Explicit letters or matching phonetic examples, never a guessed name."""
    value = re.sub(r'\b([A-Za-z])\s+(?:for|as\s+in)\s+([A-Za-z]+)\b',
                   lambda m: m[1] if m[1].lower() == m[2][0].lower() else '?', text, flags=re.I)
    if not re.fullmatch(r'\s*(?:[A-Za-z][\s,.-]+)+[A-Za-z][.\s]*', value):
        return ''
    return ''.join(re.findall(r'[A-Za-z]', value)).upper()


def email_spelling(value: str) -> str:
    local, separator, domain = value.lower().partition('@')
    if not separator:
        return ''
    symbols = {'.':'dot', '_':'underscore', '-':'hyphen', '+':'plus'}
    return ' '.join(symbols.get(char, char) for char in local) + ' @ ' + domain


def canonical_recipient(value: str) -> str:
    """One address only; spoken spelling and recipient lists never go to SMTP."""
    candidate = (value or '').strip().lower()
    if not EMAIL.fullmatch(candidate):
        return ''
    local, domain = candidate.split('@')
    if local.startswith('.') or local.endswith('.') or '..' in local or len(local) > 64 or len(candidate) > 254:
        return ''
    if any(not label or label.startswith('-') or label.endswith('-') for label in domain.split('.')):
        return ''
    return candidate


def confirmed_contact_email(state) -> str:
    """CRM must not promote an unapproved ASR candidate to a usable recipient."""
    if state is None or state.entities.get('email_confirmed') != 'yes':
        return ''
    candidate = state.entities.get('email', '').strip().lower()
    return candidate if EMAIL.fullmatch(candidate) else ''


def latest_email(text: str) -> str:
    value = re.sub(r"\s+(?:at)\s+", "@", text, flags=re.I)
    value = re.sub(r"\s*@\s*", "@", value)
    if '@' in value:
        before, after = value.rsplit('@', 1)
        joined = _joined_spelling(before)
        if joined is not None:
            value = joined + '@' + after
        elif fragmented_spelling(value):
            return ''  # A tail such as "three@example.test" isn't the whole spelling.
    value = re.sub(r"\s+(?:dot|டாட்)\s+", ".", value, flags=re.I)
    # Domain punctuation may be spaced by STT. A preceding sentence's full
    # stop must never become the first character of the next email's local part.
    value = re.sub(r"(@[A-Za-z0-9\-]+)\s*\.\s*([A-Za-z]{2,})(?=\b)", r"\1.\2", value)
    # Join only explicitly separated single characters, never ordinary words.
    value = re.sub(r"(?<!\w)(?:[A-Za-z0-9][ -]+){1,}[A-Za-z0-9](?=@)",
                   lambda m: re.sub(r"[ -]+", "", m.group()), value)
    matches = list(EMAIL.finditer(value))
    return matches[-1].group().lower().rstrip(".") if matches else ""


def fragmented_spelling(text: str) -> bool:
    """An address suffix is not the whole recipient when letters preceded it."""
    before_at = text.rsplit('@', 1)[0] if '@' in text else ''
    return bool(re.search(r'\b(?:zero|one|two|three|four|five|six|seven|eight|nine)\b', before_at, re.I)
                and re.search(r'[A-Za-z]\s+[A-Za-z]', before_at)
                and _joined_spelling(before_at) is None)


def plausible_name(value: str) -> bool:
    """Reject sentence/slot-shaped values; the existing LLM resolves ambiguity."""
    value = value.strip().rstrip('.!?,')
    if value.casefold() in ('unknown', 'none', 'null', 'not provided', 'not available', 'n/a'):
        return False
    if not value or len(value.split()) > 4 or any(c.isdigit() for c in value):
        return False
    if any(c in value for c in '?@:/'):
        return False
    if re.search(r'\b[A-Za-z]\s+(?:for|as\s+in)\s+[A-Za-z]+\b', value, re.I):
        return False  # Phonetic examples must first pass spelled_name, not become a name.
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
    previous = previous.lower()
    local, domain = previous.split('@', 1)
    # Explicit correction of a numeric suffix is not a replacement of the
    # preceding letters. Only use a domain the caller repeats correctly.
    repair = re.split(r'இல்ல(?:ை|ங்க)?|\b(?:instead|sorry|not)\b', text, flags=re.I)
    if len(repair) > 1:
        part = email_fragment(repair[-1])
        if part and part[0].isdigit() and part[1] == domain and re.search(r'\d+$', local):
            return canonical_recipient(re.sub(r'\d+$', part[0], local) + '@' + domain)
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
    match = re.search(r'\b([A-Za-z0-9])\s*(?:வராது|இல்லை|இல்லங்க|இல்ல)\s+([A-Za-z0-9])\s+([A-Za-z0-9])\s*(?:வரும்|வேணும்|தான்)', text, re.I)
    if match:
        old, prefix, new = (part.lower() for part in match.groups())
        pair = prefix + old
        if local.count(pair) == 1:
            return latest_email(local.replace(pair, prefix + new, 1) + '@' + domain)
    match = re.search(r'\b([A-Za-z0-9])\s+([A-Za-z0-9])\s*(?:இல்லை|இல்லங்க|இல்ல|வராது)\s+([A-Za-z0-9])\s+([A-Za-z0-9])(?:\b|[.!])', text, re.I)
    if match:
        old = ''.join(match.groups()[:2]).lower()
        new = ''.join(match.groups()[2:]).lower()
        if local.count(old) == 1:
            return latest_email(local.replace(old, new, 1) + '@' + domain)
    match = re.search(r'\b([A-Za-z])\s*(?:இல்லை|இல்லங்க|இல்ல|வராது)\s+([A-Za-z])\b(?:\s+(?:for|as\s+in)\s+([A-Za-z]+))?', text, re.I)
    if match:
        old, new, example = match.groups()
        if (not example or example[0].lower() == new.lower()) and local.count(old.lower()) == 1:
            return canonical_recipient(local.replace(old.lower(), new.lower(), 1) + '@' + domain)
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
