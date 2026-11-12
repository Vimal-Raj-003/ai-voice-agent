"""Conservative caller constraints; refusals never certify an external action."""
import re

def booking_declined(text: str) -> bool:
    matches = re.finditer(
        r"(?:don['’]?t|do not|not now)[^.!?;\n]*?\bbook\b|\bnot\s+(?:a\s+)?booking\b|\bnot\s+book\b|"
        r"\bnot\s+interested\b|விருப்பம்\s*இல்லை|ஆர்வம்\s*இல்லை|"
        r"(?:book(?:ing)?|appointment|அப்பாயின்ட்மென்ட்)[^.!?;\n]*?(?:வேண்டாம்|பண்ணாத|செய்யாத|\bven(?:d)?a+m?\b)|"
        r"(?:details|information)\s*(?:மட்டும்|only)|\b(?:details|information)\s+mattum\b",
        text,re.I)
    # "Don't cancel my booking" preserves it. Likewise, declining an email
    # after requesting a booking is not a refusal of the booking itself.
    return any(not re.search(r'\bcancel\b|ரத்து|\be-?mail\b|மெயில்|\bsms\b|\bmessage\b',
                             match.group(),re.I) for match in matches)

def bare_refusal(text: str) -> bool:
    return bool(re.fullmatch(r"\s*(?:no(?:\s+thanks)?|வேண்டாம்|வேணாம்|venam|vendam)[.! ,]*",text,re.I))

def caller_requested_end(text: str) -> bool:
    # A farewell followed by a continuation is not permission to disconnect.
    if re.search(r"\b(?:wait|hold on|one more|not finished|still talking|don['’]?t hang|do not hang)\b|"
                 r"\b(?:don['’]?t|do not)\b.*\b(?:end|bye|goodbye|disconnect)\b|"
                 r"^\s*(?:why|how|what|when|did you|you said)\b.*\b(?:bye|goodbye|end|hang up)\b|"
                 r"இன்னும்|இன்னொரு|ஒரு\s*கேள்வி|கட்.*பண்ணாத|வச்சி?டாத|முடிக்காத",text,re.I):
        return False
    return bool(re.search(r"\b(?:bye|goodbye|hang up|end (?:the )?call|that['’]?s all)\b|"
        r"(?:கால்|போன்).*?(?:முடி|வச்சிடு|வைத்துவிடு|கட்\s*பண்ணு)|அவ்வளவுதான்|"
        r"\b(?:cut pannunga|phone vechudunga|avvalavuthaan)\b|अलविदा|कॉल\s*(?:बंद|खत्म)|"
        r"కాల్\s*ముగించ|കോൾ\s*അവസാനിപ്പ",text,re.I))
