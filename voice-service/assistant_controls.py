"""Apply saved call limits at the existing SDK session boundary; no AI calls."""
import asyncio
from livekit import api


def bounded_number(profile, key, default, minimum, maximum):
    value = profile.get(key)
    if value is None:
        return default
    return max(minimum, min(maximum, float(value)))


class CallLimits:
    def __init__(self, ctx, tools, profile, log):
        self.ctx, self.tools, self.log = ctx, tools, log
        self.duration = bounded_number(profile, 'max_duration_seconds', 1800, 60, 7200)
        self.closed = False
        self.task = None

    def start(self):
        """Called only after the SIP leg answers, never while dialing."""
        self.task = asyncio.create_task(self._deadline())

    async def _deadline(self):
        await asyncio.sleep(self.duration)
        await self.end('maximum call duration reached')

    async def end(self, reason):
        if self.closed:
            return
        self.closed = True
        self.tools._closed_reason = reason
        self.log('assistant_call_limit_reached', reason=reason)
        # Deleting the room closes the actual SIP participant, not just the
        # worker's connection. Normal shutdown hooks still persist the call.
        try:
            await self.ctx.api.room.delete_room(api.DeleteRoomRequest(room=self.ctx.room.name))
        finally:
            self.ctx.shutdown(reason=reason)

    async def aclose(self):
        if self.task and self.task is not asyncio.current_task() and not self.task.done():
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
