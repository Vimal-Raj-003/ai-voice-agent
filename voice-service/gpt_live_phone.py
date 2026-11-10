"""GPT-Live audio inside the existing call lifecycle, tools and SIP routing."""
from __future__ import annotations

import asyncio
import os
import time

from livekit.agents import Agent, AgentSession, APIConnectOptions, llm
from livekit.plugins.openai.realtime import GPTLiveModel

from gpt_live_gate import ExperimentRejected, configured_voice
from gpt_live_experiment import AudioEvidence, DelegationBridge, build_backend


def phone_instructions(system_prompt: str, direction: str) -> str:
    from assistant_prompts import native_voice_instructions
    return native_voice_instructions(system_prompt, direction)


class PhoneRuntime:
    def __init__(self, *, ctx, profile, system_prompt, state, owner, tools, keys, language_state, route, log,
                 vad, carrier_pattern):
        import knowledge
        self.ctx, self.profile, self.state, self.owner, self.log = ctx, profile, state, owner, log
        self.carrier_pattern = carrier_pattern
        key = keys.get('openai') or os.getenv('OPENAI_API_KEY', '').strip()
        if not key:
            raise ExperimentRejected('OpenAI credential missing for the selected GPT-Live phone assistant.')
        self.voice_name = configured_voice()
        self.backend, self.provider, self.model = build_backend(profile, keys)
        self.started_at = None
        self.closed = False
        self._close_lock = asyncio.Lock()
        self.provider_seconds = 0.0
        self.playback_trace = {}
        self.ready = asyncio.Event()
        cap = max(1, min(120, int(os.getenv('GPT_LIVE_PHONE_BACKEND_REQUEST_CAP', '48'))))
        self.bridge = DelegationBridge(state=state, owner=owner, tools=tools, backend=self.backend,
            backend_prompt=system_prompt + '\n[NATIVE BACKEND] Follow the saved assistant policy above. '
            'Use confirmed call state, retrieved knowledge and actual tool results. '
            'Use existing tools for understood corrections and authorized actions; return a concise verified result.',
            assistant_id=profile['id'], emit=self.emit, lookup=knowledge.search,
            request_cap=cap, sandbox=False, usage_observer=self.usage, language_state=language_state, ready=self.ready)
        self.route = route
        self.evidence = AudioEvidence(self.emit)
        runtime = self

        class PhoneAgent(Agent):
            async def on_enter(self):
                runtime.bridge.duplex = self.duplex_session
                self.duplex_session.on('delegation_created', runtime.bridge.submit)
                self.duplex_session.on('input_speech_started', lambda ev: runtime.emit(
                    'caller_speech_onset', turn_id=state.user_turn_id + 1, sdk_event=str(ev),
                    boundary='native SDK estimate, not handset'))
                self.duplex_session.on('input_speech_stopped', lambda ev: runtime.emit(
                    'caller_speech_end', turn_id=state.user_turn_id, sdk_event=str(ev),
                    boundary='native SDK estimate, not handset'))

            async def realtime_audio_output_node(self, audio, model_settings):
                async for frame in audio:
                    # Same recorder installed by _maybe_start_recording after answer.
                    recorder = getattr(owner, '_recorder', None)
                    if recorder is not None:
                        try:
                            recorder.write_agent_frame(frame)
                        except Exception:
                            runtime.emit('gpt_live_recording_frame_failed')
                    runtime.evidence.frame(frame, state.user_turn_id,
                                           getattr(self.session.current_speech, 'id', None))
                    yield frame

        self.agent = PhoneAgent(instructions=phone_instructions(system_prompt, profile['prompt_direction']), tools=[])
        self.voice = GPTLiveModel(model='gpt-live-1', voice=self.voice_name, delegation='client', api_key=key,
            base_url='https://api.openai.com/v1', max_session_duration=int(profile.get('max_duration_seconds') or 1800),
            conn_options=APIConnectOptions(max_retry=0, timeout=10))
        # Use the process's existing VAD; do not create a second endpointing implementation.
        self.session = AgentSession(llm=self.voice, tools=[], vad=vad,
                                   user_away_timeout=float(profile.get('silence_timeout_seconds') or 30))
        self.session._jj_pipeline = False
        self.session._jj_gpt_live = True
        self.session._jj_tts = None
        self.session._jj_stt_provider = self.session._jj_tts_provider = ''
        self.session.on('user_input_transcribed', self.transcript)
        self.session.on('conversation_item_added', self.item)
        self.session.on('metrics_collected', self.metrics)
        self.session.on('error', self.error)
        self.session.on('user_state_changed', self.user_state)
        self.session.on('close', self.session_closed)
        owner._gpt_live_runtime = self
        ctx.add_shutdown_callback(self.close)

    def emit(self, event, **fields):
        # Observers run inside SDK audio tasks. Never let logging raise there.
        try:
            fields = {k:v for k,v in fields.items() if k not in ('transcript', 'state', 'arguments', 'result')}
            self.log(event, call_id=self.ctx.room.name, voice_engine='gpt-live', **fields)
        except Exception:
            pass

    def transcript(self, ev):
        if not self.carrier_pattern.search(ev.transcript):
            self.bridge.transcript(ev.transcript, ev.is_final)

    def item(self, ev):
        if isinstance(ev.item, llm.ChatMessage) and ev.item.role == 'assistant' and ev.item.text_content:
            self.bridge.assistant(ev.item.text_content, getattr(ev.item, 'interrupted', False))

    def user_state(self, ev):
        self.emit('caller_state', old=ev.old_state, new=ev.new_state, turn_id=self.state.user_turn_id)
        if (ev.new_state == 'away' and getattr(self.owner, '_answered_mono', None) is not None
                and hasattr(self, 'limits') and not self.owner.work.active()):
            asyncio.create_task(self.limits.end('continuous silence timeout'))

    def session_closed(self, ev):
        if not self.closed:
            self.ctx.shutdown(reason='gpt_live_session_closed')

    def usage(self, usage):
        for source, destination in [('prompt_tokens', '_usage_prompt_tokens'), ('completion_tokens', '_usage_completion_tokens'),
                                    ('prompt_cached_tokens', '_usage_cached_tokens')]:
            setattr(self.owner, destination, getattr(self.owner, destination, 0) + int(getattr(usage, source, 0) or 0))
        self.owner._usage_requests = getattr(self.owner, '_usage_requests', 0) + 1
        self.route.record_use(self.provider, self.model)

    def metrics(self, ev):
        if getattr(ev.metrics, 'type', '') == 'realtime_model_metrics':
            self.provider_seconds += max(0.0, float(getattr(ev.metrics, 'session_duration', 0) or 0))
            self.emit('gpt_live_usage', provider_seconds=self.provider_seconds, model='gpt-live-1')

    def error(self, ev):
        self.emit('gpt_live_phone_error', error_type=type(ev.error).__name__)
        self.owner._closed_outcome = 'FAILED'
        self.owner._closed_reason = 'native voice provider failure'
        # Do not silently switch voice architecture or reopen a paid connection.
        self.ctx.shutdown(reason='gpt_live_phone_error')

    def attach_playback(self):
        output = self.session.output.audio
        if output is None:
            raise RuntimeError('GPT-Live room audio output is missing')
        @output.on('playback_started')
        def started(ev):
            self.playback_trace = dict(turn_id=self.state.user_turn_id,
                speech_id=getattr(self.session.current_speech, 'id', None))
            self.emit('room_playback_started', **self.playback_trace, sdk_event=str(ev),
                      semantic_usefulness_verified=False, handset_timing_verified=False)
        @output.on('playback_finished')
        def finished(ev):
            self.emit('room_playback_finished', **self.playback_trace,
                      playback_position=ev.playback_position, interrupted=ev.interrupted,
                      handset_timing_verified=False)
            if ev.interrupted:
                self.owner.interrupt_count = getattr(self.owner, 'interrupt_count', 0) + 1

    async def close(self, reason=None):
        async with self._close_lock:
            if self.closed:
                return
            self.closed = True
            try:
                await self.bridge.close()  # Existing CallTasks settle committed operations.
            finally:
                try:
                    await self.session.aclose()
                finally:
                    await self.backend.aclose()


async def create_phone_runtime(*, vad_factory, **kwargs):
    # Warm the same process VAD off the audio event loop on first use.
    vad = await asyncio.to_thread(vad_factory)
    return PhoneRuntime(vad=vad, **kwargs)
