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
