"""Per-call task ownership, independent of interruptible speech generations.

Uses the installed SDK's RunContext.update for slow tools. No global task map,
customer data in logs, speculative retries or automatic side-effect retries.
"""
from __future__ import annotations

import asyncio
from contextvars import ContextVar
from dataclasses import dataclass
import time
from typing import Any, Awaitable, Callable


class Superseded(Exception):
    pass


@dataclass
class Work:
    kind: str
    key: tuple
    inputs: dict
    revision: int
    started: float
    status: str = 'running'
    result: str = ''
    committed: bool = False
    task: asyncio.Task | None = None
    finished: float = 0
    progress_reported: bool = False


class CallTasks:
    def __init__(self, state=None, log: Callable | None = None):
        self.state = state
        self.log = log
        self.items: list[Work] = []
        self._current: ContextVar[Work | None] = ContextVar('call_work', default=None)
        self.progress_delay = 1.2
        self.read_timeout = 15.0
        self.last_ack: dict | None = None

    @property
    def revision(self):
        return getattr(self.state, 'input_revision', 0)

    def emit(self, event, **fields):
        if self.log:
            self.log(event, **fields)

    def valid(self, work):
        return (work.revision == self.revision and not getattr(self.state, 'cancel_requested', False)
                and not (work.kind == 'booking' and getattr(self.state, 'booking_hold', False)))

    def check_current(self):
        work = self._current.get()
        if work and not work.committed and not self.valid(work):
            raise Superseded()

    def committing(self):
        self.check_current()
        work = self._current.get()
        if work:
            work.committed = True
            work.status = 'committing'

    def uncertain(self):
        work = self._current.get()
        if work:
            work.status = 'unknown'

    def failed(self):
        work = self._current.get()
        if work:
            work.status = 'failed'

    def invalidate(self):
        """Cancel preparation/reads only. An already submitted write must settle."""
        for work in self.items:
            if work.task and not work.task.done() and not self.valid(work) and not work.committed:
                work.task.cancel()

    def active(self):
        return next((w for w in reversed(self.items) if w.task and not w.task.done()), None)

    def directive(self):
        work = self.active() or (self.items[-1] if self.items else None)
        if not work:
            return ''
        # Inputs go to this caller's prompt only, never to diagnostics.
        return (f'[ACTIVE WORK] task={work.kind}; status={work.status}; inputs={work.inputs}; '
                f'result={work.result or "not available yet"}. '
                'Do not repeat a running tool or claim success before its result. '
                'Presence checks do not restart work. A submitted action cannot be undone by cancelling speech.')

    def acknowledgement(self, text: str, language: str) -> str | None:
        from contact_corrections import turn_intent
        intent = turn_intent(text)
        work = self.active() or (self.items[-1] if self.items else None)
        if intent not in ('presence', 'status') or not work:
            return None
        ta = language == 'ta'
        if work.status == 'completed' and self.valid(work):
            # Results need the LLM to render dates and booking references naturally.
            return None
        if work.status in ('failed', 'timed_out'):
            return 'இப்போ check முடிக்க முடியல. மீண்டும் முயற்சி செய்யலாமா?' if ta else 'The check failed. Would you like me to try again?'
        if work.status in ('cancelled', 'superseded'):
            return 'முந்தைய check நிறுத்தியாச்சு. மாற்றிய விவரத்தைச் சொல்லுங்க.' if ta else 'The earlier check was stopped. Please give me the corrected detail.'
        if not self.active():
            return None
        labels = {'availability': ('appointment availability check', 'appointment availability check'),
                  'booking': ('booking request', 'booking request'),
                  'recipient': ('email update', 'email update')}
        label = labels.get(work.kind, ('request', 'request'))[0 if ta else 1]
        prefix = ('ஆமா, இருக்கேன்; ' if ta else 'Yes, I am here; ') if intent == 'presence' else ''
        return (f'{prefix}{label} இன்னும் நடந்துகிட்டு இருக்கு.' if ta
                else f'{prefix}The {label} is still in progress.')

    async def run(self, kind: str, inputs: dict, fn: Callable[[], Awaitable[str]], context: Any = None):
        self.invalidate()
        if kind == 'booking' and any(w.kind == 'booking' and w.status == 'unknown' and w.committed for w in self.items):
            return 'An earlier booking submission has an unknown outcome. Do not create another booking; verify the calendar or use the approved human transfer.'
        key = (kind, tuple(sorted(inputs.items())), self.revision)
        work = next((w for w in reversed(self.items) if w.key == key
                     and (not w.finished or time.monotonic() - w.finished < 10)
                     and w.status not in ('cancelled', 'superseded', 'failed', 'timed_out')), None)
        if work is None:
            if kind != 'availability' and any(w.committed and w.task and not w.task.done() for w in self.items):
                return 'An earlier action has already been submitted and is still settling. Do not submit another action; report its pending status.'
            work = Work(kind, key, dict(inputs), self.revision, time.monotonic())
            self.items.append(work)
            # Bounded diagnostics/state: preserve all running work, only recent completed work.
            self.items[:] = [w for w in self.items[:-16] if w.status == 'unknown' or (w.task and not w.task.done())] + self.items[-16:]
            async def execute():
                token = self._current.set(work)
                self.emit('call_task_started', kind=kind, revision=work.revision)
                try:
                    self.check_current()
                    if kind == 'availability':
                        async with asyncio.timeout(self.read_timeout):
                            result = await fn()
                    else:
                        result = await fn()
                    if not work.committed:
                        self.check_current()
                    work.result = result
                    if work.status not in ('unknown', 'failed'):
                        work.status = 'completed'
                    if work.committed and not self.valid(work):
                        work.result += ' The caller changed/cancelled the request after submission. Report the committed result accurately; do not claim it was undone or send to a rejected email.'
                except (Superseded, asyncio.CancelledError):
                    work.status = 'cancelled' if getattr(self.state, 'cancel_requested', False) else 'superseded'
                    work.result = 'The earlier preparation/check was stopped. Use the latest corrected details; no new action was submitted by this task.'
                except TimeoutError:
                    work.status = 'timed_out'
                    work.result = 'The lookup timed out. Availability is unknown; no booking was made. Ask before retrying.'
                except Exception:
                    work.status = 'failed'
                    work.result = 'The operation failed. Do not claim success or automatically repeat a booking.'
                finally:
                    work.finished = time.monotonic()
                    self.emit('call_task_finished', kind=kind, revision=work.revision, status=work.status,
                              duration_ms=round((work.finished-work.started)*1000), committed=work.committed)
                    self._current.reset(token)
                return work.result
            work.task = asyncio.create_task(execute())
        assert work.task is not None
        # A cancelled speech waiter never owns/cancels the actual operation.
        done, _ = await asyncio.wait([work.task], timeout=self.progress_delay if context else 0)
        if not done and context is not None and hasattr(context, 'update') and not work.progress_reported:
            work.progress_reported = True
            handle = getattr(context, 'speech_handle', None)
            if handle is not None:
                self.last_ack = {'requested': work.started, 'kind': 'tool_progress',
                                 'first_audio': None, 'speech_id': handle.id}
            await context.update(f'{kind} is still running. Briefly acknowledge actual work, do not give an estimate or start another tool. Keep listening.')
        return await asyncio.shield(work.task)

    async def close(self):
        # Reads can stop on hangup; submitted actions must settle for truthful recording.
        for work in self.items:
            if work.task and not work.task.done() and not work.committed:
                work.task.cancel()
        await asyncio.gather(*(w.task for w in self.items if w.task), return_exceptions=True)
