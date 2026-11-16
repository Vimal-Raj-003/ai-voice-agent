"""Spoken readbacks only. Never replace canonical booking/contact values."""
import re
from datetime import date, datetime
from itertools import groupby

_MONTHS = ('', 'January', 'February', 'March', 'April', 'May', 'June', 'July',
           'August', 'September', 'October', 'November', 'December')
_DIGITS = ('zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine')


def english_date(value: str) -> str:
    try:
        parsed = date.fromisoformat(value)
    except (ValueError, TypeError):
        return ''
    day = parsed.day
    suffix = 'th' if 11 <= day % 100 <= 13 else {1:'st', 2:'nd', 3:'rd'}.get(day % 10, 'th')
    return f'{_MONTHS[parsed.month]} {day}{suffix}, {parsed.year}'


def english_time(value: str) -> str:
    try:
        parsed = datetime.strptime(value, '%H:%M')
    except (ValueError, TypeError):
        return ''
    hour, minute = parsed.hour, parsed.minute
    if not minute and hour in (0, 12):
        return '12 midnight' if hour == 0 else '12 noon'
    period = ('in the morning' if 5 <= hour < 12 else 'in the afternoon' if 12 <= hour < 17
              else 'in the evening' if 17 <= hour < 21 else 'at night')
    clock = f"{hour % 12 or 12} o'clock" if minute == 0 else f'{hour % 12 or 12}:{minute:02d}'
    return f'{clock} {period}'


def phone_readback(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r'\+?[0-9]{8,15}', value):
        return ''
    words = ['plus'] if value.startswith('+') else []
    for digit, repeated in groupby(value.lstrip('+')):
        count = sum(1 for _ in repeated)
        while count:
            size = min(count, 3)
            words.append(('triple ' if size == 3 else 'double ' if size == 2 else '') + _DIGITS[int(digit)])
            count -= size
    return ' '.join(words)


def spoken_readbacks(entities: dict[str, str]) -> dict[str, str]:
    result = {key:formatter(entities.get(key, '')) for key,formatter in
              (('date', english_date), ('time', english_time), ('phone', phone_readback))}
    return {key:value for key,value in result.items() if value}
