"""Phone-only text input for Gemini native audio output.

The SDK forwards microphone frames to every realtime session even with an STT
configured. Discard that duplicate path here: Sarvam owns input recognition;
Gemini receives committed caller text and keeps its normal audio/tool protocol.
"""
from livekit.plugins.google.realtime.realtime_api import RealtimeModel, RealtimeSession


class PhoneTextSession(RealtimeSession):
    def push_audio(self, frame):
        pass  # Caller PCM goes only to the configured STT node.

    def commit_audio(self):
        pass  # AgentSession commits the recognized user text instead.

    def clear_audio(self):
        pass

    def start_user_activity(self):
        # AgentActivity still stops local playback on barge-in. Gemini's
        # ActivityStart/End protocol is for AUDIO, which this session never sends.
        # The next client-content turn interrupts any remaining server output.
        pass


class PhoneTextModel(RealtimeModel):
    def session(self, *, turn_detection_disabled=False):
        session = PhoneTextSession(self)
        self._sessions.add(session)
        return session
