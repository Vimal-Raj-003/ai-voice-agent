"""One-second first-voice target, measured separately from substantive playback.

Only a committed turn may emit progress. The existing endpointing policy owns
when that commitment happens. Target misses are recorded, never hidden by
resetting the clock at model/tool start. No extra model request is made.
"""
from __future__ import annotations
import asyncio
from collections import defaultdict, deque
from dataclasses import dataclass, field
import time
from functools import wraps
from typing import Callable
from livekit.agents.types import FlushSentinel


def with_first_voice_target(fn):
    @wraps(fn)
    async def wrapped(owner, *args, **kwargs):
        clock = getattr(owner, '_response_timing', None)
        source = fn(owner, *args, **kwargs)
        if args and getattr(owner, '_skip_model_context', lambda ctx: False)(args[0]):
            async for chunk in source:
                yield chunk
            return  # Ignored audio/direct presence reply is not a silent model turn.
        preview = bool(args and getattr(owner, '_is_uncommitted_generation', lambda ctx: False)(args[0]))
        turn = clock.turn if clock and not preview else None
        text_chars = tool_calls = 0
        outcome = 'completed'
        try:
            stream = clock.stream(source, owner._first_voice_status) if clock and not preview else source
            async for chunk in stream:
                delta = getattr(chunk, 'delta', None)
                # Injected status strings do not count as an answered turn.
                if not isinstance(chunk, str) or not turn or chunk not in turn.status_texts:
                    text_chars += len(chunk if isinstance(chunk, str) else (getattr(delta, 'content', '') or ''))
                tool_calls += len(getattr(delta, 'tool_calls', None) or [])
                yield chunk
        except (asyncio.CancelledError, GeneratorExit):
            outcome = 'cancelled'
            raise
        except Exception:
            outcome = 'error'
            raise
        finally:
            close = getattr(stream, 'aclose', None)
            if close:
                await close()
            if clock:
                clock.emit('llm_turn_outcome', turn_id=turn.id if turn else None,
                           outcome=outcome, text_chars=text_chars, tool_calls=tool_calls,
                           unanswered=(not text_chars and not tool_calls))
            if not clock or clock.turn is turn:
                owner._reply_phase = None
    return wrapped


@dataclass
class ReplyTurn:
    id: int
    speech_end: float
    committed_at: float
    anchor: str
    speech_epoch: int
    progress_sent: bool = False
    first_voice: float | None = None
    answer_voice: float | None = None
    status_texts: set[str] = field(default_factory=set)


class ResponseTiming:
    def __init__(self, *, target_ms=1000, tts_budget_ms=300, now: Callable = time.monotonic,
                 wall_now: Callable = time.time, log=None):
        self.target_ms, self.tts_budget_ms = target_ms, tts_budget_ms
        self.now, self.log = now, log
        self.wall_now = wall_now
        self.turn: ReplyTurn | None = None
        self.speaking = False
        self._speech_end: float | None = None
        self._counter = 0
        self._speech_epoch = 0
        self._segments = defaultdict(deque)

    def emit(self, event, **fields):
        if self.log:
            self.log(event, **fields)

    def speech_started(self):
        self._speech_epoch += 1
        self.speaking = True
        self._speech_end = None

    def speech_stopped(self):
        self.speaking = False
        self._speech_end = self.now()

    def commit(self, stopped_speaking_at: float | None = None):
        self._counter += 1
        stopped = self._speech_end
        anchor = 'speech_end' if stopped is not None else 'commit_fallback'
        if isinstance(stopped_speaking_at, (int, float)) and not isinstance(stopped_speaking_at, bool):
            age = self.wall_now()-stopped_speaking_at
            if 0 <= age < 60:
                stopped = self.now()-age
                anchor = 'sdk_speech_end'
        self.turn = ReplyTurn(self._counter, stopped if stopped is not None else self.now(),
                              self.now(), anchor, self._speech_epoch)
        self.emit('reply_turn_committed', turn_id=self.turn.id, anchor=self.turn.anchor,
                  speech_end_to_commit_ms=round((self.turn.committed_at-self.turn.speech_end)*1000),
                  first_voice_target_ms=self.target_ms)
        return self.turn

    def can_progress(self, turn):
        return (turn is self.turn and not self.speaking and not turn.progress_sent
                and turn.first_voice is None and turn.speech_epoch == self._speech_epoch)

    def classify(self, text: str, *, pending_work=False, failure=False):
        if self.turn is None:
            return None
        if any(text.strip().startswith(value) for value in self.turn.status_texts) or pending_work:
            return 'progress'
        return 'failure' if failure else 'answer'

    def bind_segment(self, speech_id: str, kind: str):
        if self.turn:
            self._segments[speech_id].append((self.turn, kind))
            # Do not let cancelled/unplayed speech metadata grow indefinitely.
            while len(self._segments) > 48:
                self._segments.pop(next(iter(self._segments)))

    def playback_started(self, speech_id: str, *, explicit_progress=False):
        queue = self._segments.get(speech_id)
        if queue:
            turn, kind = queue.popleft()
            if not queue:
                self._segments.pop(speech_id, None)
        elif explicit_progress and self.turn:
            turn, kind = self.turn, 'progress'
        else:
            return  # unmapped audio is not silently labelled as an answer
        if explicit_progress:
            kind = 'progress'
        at = self.now()
        if turn.first_voice is None:
            turn.first_voice = at
            elapsed = round((at-turn.speech_end)*1000)
            self.emit('reply_first_voice', turn_id=turn.id, anchor=turn.anchor, kind=kind,
                      speech_end_to_first_voice_ms=elapsed,
                      commit_to_first_voice_ms=round((at-turn.committed_at)*1000),
                      target_ms=self.target_ms, target_met=(elapsed <= self.target_ms if turn.anchor != 'commit_fallback' else None),
                      measurement='room_playback_started')
        if kind == 'answer' and turn.answer_voice is None:
            turn.answer_voice = at
            self.emit('reply_answer_voice', turn_id=turn.id, anchor=turn.anchor,
                      speech_end_to_answer_voice_ms=round((at-turn.speech_end)*1000),
                      first_voice_to_answer_voice_ms=round((at-turn.first_voice)*1000),
                      measurement='room_playback_started')

    async def stream(self, source, status: Callable[[], str | None]):
        turn = self.turn
        if turn is None:
            try:
                async for chunk in source:
                    yield chunk
            finally:
                close = getattr(source, 'aclose', None)
                if close:
                    await close()
            return
        iterator = source.__aiter__()
        pending = asyncio.create_task(anext(iterator))
        try:
            budget = max(0., turn.speech_end + (self.target_ms-self.tts_budget_ms)/1000 - self.now())
            done, _ = await asyncio.wait([pending], timeout=budget)
            if not done and self.can_progress(turn):
                line = status()  # only factual currently active work, checked at emission
                if line:
                    turn.progress_sent = True
                    turn.status_texts.add(line.strip())
                    self.emit('reply_progress_text_ready', turn_id=turn.id,
                              speech_end_to_status_text_ms=round((self.now()-turn.speech_end)*1000),
                              measurement='text_only_not_audio')
                    yield line
                    yield FlushSentinel()  # SDK serializes progress and answer playout
            try:
                chunk = await pending
            except StopAsyncIteration:
                return
            yield chunk
            async for chunk in iterator:
                yield chunk
        finally:
            if not pending.done():
                pending.cancel()
            await asyncio.gather(pending, return_exceptions=True)
            close = getattr(iterator, 'aclose', None)
            if close:
                await close()
