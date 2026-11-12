"""Saved, assistant-scoped native voice settings. No SDK or network at import."""
from dataclasses import dataclass
import json

from gpt_live_gate import ExperimentRejected, phone_enabled

GEMINI_MODELS = {'gemini-3.8-live', 'gemini-3.1-flash-live-preview'}
GEMINI_VOICES = {
    'Achernar', 'Achird', 'Algenib', 'Algieba', 'Alnilam', 'Aoede', 'Autonoe',
    'Callirrhoe', 'Charon', 'Despina', 'Enceladus', 'Erinome', 'Fenrir', 'Gacrux',
    'Iapetus', 'Kore', 'Laomedeia', 'Leda', 'Orus', 'Puck', 'Pulcherrima',
    'Rasalgethi', 'Sadachbia', 'Sadaltager', 'Schedar', 'Sulafat', 'Umbriel',
    'Vindemiatrix', 'Zephyr', 'Zubenelgenubi',
}


def initial_native_language(profile: dict, fallback: str = 'ta') -> str:
    """Seed from the spoken greeting; legacy STT choices do not control native audio.

    This is only an initial hint. Meaningful caller speech and explicit language
    requests still flow through the existing language observer.
    """
    from lang import normalize_lang, script_lang
    greeting = str(profile.get('first_message') or '')
    return (script_lang(greeting, include_hindi=True)
            or normalize_lang(profile.get('stt_language'))
            or normalize_lang(fallback) or 'ta')


def spoken_native_text(role: str, text: str, carrier_pattern=None) -> str:
    """Separate application snapshots and carrier announcements from speech logs."""
    if role not in ('user', 'assistant'):
        return ''
    if role == 'user':
        return '' if carrier_pattern and carrier_pattern.search(text) else text.strip()
    return text.split('[APPLICATION CALL MEMORY', 1)[0].strip()


@dataclass(frozen=True)
class NativeSettings:
    engine: str
    model: str = ''
    voice: str = ''


def runtime_settings(profile: dict) -> NativeSettings | None:
    metadata = profile.get('metadata') or {}
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except ValueError:
            raise ExperimentRejected('Invalid saved assistant voice settings.') from None
    saved = metadata.get('voiceRuntime') if isinstance(metadata, dict) else None
    if saved is None:
        return None
    if not isinstance(saved, dict):
        raise ExperimentRejected('Invalid saved assistant voice settings.')
    engine = saved.get('engine', 'inherit')
    if engine == 'inherit':
        return None
    if engine in ('pipeline', 'gpt-live'):
        return NativeSettings(engine)
    if engine != 'gemini-live':
        raise ExperimentRejected('Unknown saved voice engine; no automatic fallback.')
    model, voice = saved.get('model') or 'gemini-3.8-live', saved.get('voice') or 'Zephyr'
    if model not in GEMINI_MODELS:
        raise ExperimentRejected('Select a supported Gemini Live audio model.')
    if voice not in GEMINI_VOICES:
        raise ExperimentRejected('Select a supported Gemini Live voice.')
    return NativeSettings(engine, model, voice)


def phone_engine(profile: dict, phone: str, env=None) -> str | None:
    if not phone or phone in ('demo', 'unknown'):
        return None
    saved = runtime_settings(profile)
    if saved is not None:
        return saved.engine if saved.engine != 'pipeline' else None
    return 'gpt-live' if phone_enabled(profile.get('id'), phone, env) else None
