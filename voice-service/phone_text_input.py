"""Phone-only text input for Gemini native audio output.

The SDK forwards microphone frames to every realtime session even with an STT
configured. Discard that duplicate path here: Sarvam owns input recognition;
Gemini receives committed caller text and keeps its normal audio/tool protocol.
"""
import asyncio

from livekit.agents import llm
from livekit.plugins.google.realtime.realtime_api import RealtimeModel, RealtimeSession


class PhoneTextSession(RealtimeSession):
    def __init__(self, *args, **kwargs):
        self._phone_context_lock = asyncio.Lock()
        self._phone_reply_tasks = set()
        super().__init__(*args, **kwargs)

    def generate_reply(self, **kwargs):
        if self._active_session is not None and self._pending_chat_ctx is None:
            return super().generate_reply(**kwargs)

        async def after_connection():
            try:
                async with asyncio.timeout(self._opts.conn_options.timeout):
                    while True:
                        # Connect flushes pending context under this same lock.
                        # Queue the turn-complete trigger only after that flush.
                        async with self._session_lock:
                            if self._active_session is not None:
                                break
                            if self._msg_ch.closed:
                                raise llm.RealtimeError('Phone model connection closed before reply.')
                        await asyncio.sleep(.01)
            except TimeoutError as exc:
                raise llm.RealtimeError('Phone model connection not ready before reply.') from exc
            return await super(PhoneTextSession, self).generate_reply(**kwargs)

        task = asyncio.create_task(after_connection())
        self._phone_reply_tasks.add(task)
        task.add_done_callback(self._phone_reply_tasks.discard)
        return task

    async def aclose(self):
        waiting = tuple(self._phone_reply_tasks)
        for task in waiting:
            task.cancel()
        await asyncio.gather(*waiting, return_exceptions=True)
        await super().aclose()

    async def update_chat_ctx(self, chat_ctx):
        # Gemini cannot remove server history. A memory update copied before a
        # concurrent caller commit must not forget that already-submitted item.
        async with self._phone_context_lock:
            merged = self.chat_ctx.copy()
            known = {item.id for item in merged.items}
            merged.items.extend(item for item in chat_ctx.items if item.id not in known)
            await super().update_chat_ctx(merged)

    def _handle_server_content(self, server_content):
        super()._handle_server_content(server_content)
        if server_content.generation_complete:
            # Google's turn_complete can wait for estimated client playout.
            # The room owns playout here; finish the remaining SDK channels as
            # soon as the provider says this generation is finished. Otherwise
            # a barge-in waits on an open function stream and later audio can
            # be attached to the old, already-closed output channels.
            self._mark_current_generation_done()

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
