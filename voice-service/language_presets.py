"""Language presets for multilingual TTS/STT directives — ported from InboundAI."""

LANGUAGE_PRESETS: dict[str, dict[str, str]] = {
    "hinglish":     {"label": "Hinglish (Hindi+English)", "tts_language": "hi-IN", "tts_voice": "kavya",
                     "instruction": "Speak in natural everyday Hinglish — mix conversational Hindi with familiar English words (appointment, booking, doctor, fees, timing, course, software) so callers understand effortlessly."},
    "hindi":        {"label": "Hindi",                    "tts_language": "hi-IN", "tts_voice": "ritu",
                     "instruction": "Speak in natural everyday spoken Hindi (avoid stiff Sanskritized/classical Hindi). Keep common English words like appointment, booking, doctor, fees, timing, report, course, and software as-is."},
    "english":      {"label": "English (India)",          "tts_language": "en-IN", "tts_voice": "dev",
                     "instruction": "Speak in clear, warm, natural Indian English with short, polite conversational sentences."},
    "tamil":        {"label": "Tamil",                    "tts_language": "ta-IN", "tts_voice": "priya",
                     "instruction": "Speak in natural everyday spoken Tamil (avoid classical/literary செந்தமிழ்). Mix familiar English words naturally (appointment, booking, doctor, fees, timing, scan, course, software) so callers understand effortlessly."},
    "telugu":       {"label": "Telugu",                   "tts_language": "te-IN", "tts_voice": "kavya",
                     "instruction": "Speak in natural everyday spoken Telugu (avoid classical/grandhika Telugu). Mix familiar English words naturally (appointment, booking, doctor, fees, timing, course, software) for effortless clarity."},
    "gujarati":     {"label": "Gujarati",                 "tts_language": "gu-IN", "tts_voice": "rohan",
                     "instruction": "Speak in natural polite spoken Gujarati, keeping everyday English service words (appointment, booking, doctor, fees, timing) where natural."},
    "bengali":      {"label": "Bengali",                  "tts_language": "bn-IN", "tts_voice": "neha",
                     "instruction": "Speak in natural polite spoken Bengali (Bangla), keeping everyday English service words (appointment, booking, doctor, fees, timing) where natural."},
    "marathi":      {"label": "Marathi",                  "tts_language": "mr-IN", "tts_voice": "shubh",
                     "instruction": "Speak in natural polite spoken Marathi, keeping everyday English service words (appointment, booking, doctor, fees, timing) where natural."},
    "kannada":      {"label": "Kannada",                  "tts_language": "kn-IN", "tts_voice": "rahul",
                     "instruction": "Speak in natural everyday spoken Kannada (avoid stiff literary Kannada). Mix familiar English words naturally (appointment, booking, doctor, fees, timing, course, software) for effortless clarity."},
    "malayalam":    {"label": "Malayalam",                "tts_language": "ml-IN", "tts_voice": "ritu",
                     "instruction": "Speak in natural everyday spoken Malayalam (avoid stiff classical Malayalam). Mix familiar English words naturally (appointment, booking, doctor, fees, timing, course, software) for effortless clarity."},
    "multilingual": {"label": "Multilingual (Auto)",      "tts_language": "hi-IN", "tts_voice": "kavya",
                     "instruction": "Detect the caller's language from their first meaningful message and reply in that SAME language for the entire call. Supported: English, Tamil, Tanglish, Telugu, Kannada, Malayalam, Hindi, Hinglish, Gujarati, Bengali, Marathi. In regional languages, speak everyday conversational language mixed naturally with familiar English words (appointment, booking, doctor, fees, timing, course, software) — never stiff classical/literary style. Switch if the caller explicitly switches."},
}


def get_language_directive(preset: str) -> str:
    p = LANGUAGE_PRESETS.get(preset, LANGUAGE_PRESETS["multilingual"])
    return f"\n\n[LANGUAGE DIRECTIVE]\n{p['instruction']}"


def get_preset_voice(preset: str) -> tuple[str, str]:
    p = LANGUAGE_PRESETS.get(preset, LANGUAGE_PRESETS["multilingual"])
    return p["tts_language"], p["tts_voice"]
