"""Turn options for the installed LiveKit 1.8.4 runtime; no provider requests."""
import os
import config


def voice_turn_options(profile: dict | None = None, *, has_vad: bool = True) -> dict:
    profile = profile or {}
    # Saved assistant controls take precedence; environment defaults apply
    # only to legacy profiles without those controls. Zero is a valid floor.
    sensitivity = {'LOW': 2., 'MEDIUM': 1., 'HIGH': .4}.get(
        str(profile.get('end_of_speech_sensitivity') or '').upper())
    pause = profile.get('min_pause_ms')
    if pause is not None or sensitivity is not None:
        floor = max(max(0., min(3000., float(pause or 0))) / 1000, sensitivity or 0.)
    else:
        floor = max(config.MIN_ENDPOINTING_DELAY, float(os.getenv('VOICE_PAUSE_FLOOR_MS', '850')) / 1000)
    interrupt = profile.get('interruption_threshold_ms')
    interrupt_s = .5 if interrupt is None else max(50., min(2000., float(interrupt))) / 1000
    prepare = has_vad and os.getenv('VOICE_PREEMPTIVE_GENERATION', 'true').lower() == 'true'
    return {
        # Sarvam sends FINAL before EOS. SDK STT mode cannot speculate on that
        # first final; existing VAD owns the same protected endpoint wait.
        'turn_detection': 'vad' if prepare else 'stt',
        # Learn this caller's pauses without reducing the chosen floor.
        'endpointing': {'mode': 'dynamic', 'min_delay': floor, 'max_delay': max(3., floor), 'alpha': .9},
        'preemptive_generation': {'enabled': prepare, 'preemptive_tts': False, 'max_retries': 1},
        'interruption': {'enabled': True, 'min_duration': interrupt_s,
                         'min_words': 0 if has_vad else 1, 'resume_false_interruption': True},
    }
