# voice-service/redactor.py
"""PII redaction for transcript turns.

Returns the redacted text and a flag indicating whether anything matched.
Designed to run on every transcript-message insert with negligible
overhead — all checks are regex-based, no model calls.
"""

from __future__ import annotations

import re

# Credit cards: 13–19 digits with optional spaces/dashes. Luhn-checked
# before redacting to avoid mangling any 16-digit reference number.
_CC = re.compile(r"\b(?:\d[ -]?){12,18}\d\b")
# Aadhaar (India): 12 digits in 4-4-4 form.
_AADHAAR = re.compile(r"\b\d{4}\s?\d{4}\s?\d{4}\b")
# US SSN: 3-2-4.
_SSN = re.compile(r"\b\d{3}-?\d{2}-?\d{4}\b")
# Email.
_EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
# Phone: any 10+ digit run with optional separators.
_PHONE = re.compile(r"\+?\d[\d\s\-().]{8,}\d")


def _luhn_ok(digits: str) -> bool:
    s = 0
    parity = len(digits) % 2
    for i, d in enumerate(digits):
        n = int(d)
        if i % 2 == parity:
            n *= 2
            if n > 9:
                n -= 9
        s += n
    return s % 10 == 0


def _mask_cc(match: re.Match) -> str:
    raw = match.group(0)
    digits = re.sub(r"\D", "", raw)
    if len(digits) < 13 or len(digits) > 19 or not _luhn_ok(digits):
        return raw
    return "**** **** **** " + digits[-4:]


def _mask_aadhaar(match: re.Match) -> str:
    return "**** **** ****"


def _mask_ssn(match: re.Match) -> str:
    return "***-**-****"


def _mask_email(match: re.Match) -> str:
    raw = match.group(0)
    at = raw.find("@")
    return "***" + raw[at:]


def redact(text: str, protected_numbers: tuple[str, ...] = ()) -> tuple[str, bool]:
    """Redact PII patterns; return (redacted_text, had_pii).

    `protected_numbers` are phone numbers we should NOT redact (typically
    the call's from/to fields — those are legitimate metadata).
    """
    if not text:
        return text, False
    found = False

    def _phone_repl(match: re.Match) -> str:
        raw = match.group(0)
        digits = re.sub(r"\D", "", raw)
        # Skip pure-digit runs longer than 15 digits — those are more likely
        # reference/account numbers than phone numbers (phones are ≤15 E.164).
        if len(digits) > 15 and re.fullmatch(r"\d+", raw.strip()):
            return raw
        for p in protected_numbers:
            if not p:
                continue
            if digits.endswith(re.sub(r"\D", "", p)[-10:]):
                return raw
        return "+" + ("*" * (len(digits) - 4)) + digits[-4:]

    out = _CC.sub(_mask_cc, text)
    if out != text:
        found = True

    new = _AADHAAR.sub(_mask_aadhaar, out)
    if new != out:
        found = True
    out = new

    new = _SSN.sub(_mask_ssn, out)
    if new != out:
        found = True
    out = new

    new = _EMAIL.sub(_mask_email, out)
    if new != out:
        found = True
    out = new

    new = _PHONE.sub(_phone_repl, out)
    if new != out:
        found = True
    out = new

    return out, found
