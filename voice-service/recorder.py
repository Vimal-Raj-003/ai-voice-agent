"""Self-hosted call recording — captures BOTH sides of the call to local disk.

Replaces the LiveKit Egress → Cloudflare R2 upload for NEW recordings. LiveKit
Cloud itself is untouched: we still use the normal Cloud room and simply
subscribe to the caller's audio track with the standard SDK, while the agent's
own speech is teed from the TTS node.

DUAL CHANNEL. The caller is written to the LEFT channel and the agent to the
RIGHT, on one shared wall-clock timeline. Keeping the legs apart means an
operator can listen to either side alone, overlapping speech stays intelligible,
and nothing is lost to additive mixing — which previously summed both sides into
one mono track and needed clip-protection that could quietly attenuate speech.

Design rules:
  * NEVER break the live call. Every public method swallows its own errors; a
    recording failure degrades to "no recording", never an exception into the
    audio path.
  * BOUNDED memory. Fixed-size pre-allocated buffers cap a recording at
    RECORDING_MAX_MINUTES; past that we stop accepting audio and finalize.
  * DISK SAFETY. Before writing we require RECORDING_MIN_FREE_MB free, so a full
    disk can never take the service down.
  * ONE resample, at the edge. Each incoming frame is resampled exactly once to
    the recording rate and never touched again — no repeated resampling.
  * The file spans the CALL, not the last frame. Both channels are finalized to
    the elapsed wall clock, so a 60s call yields a ~60s file and the silences
    (and who was silent) are preserved exactly as they happened.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import time
import wave
from typing import Any

import numpy as np

import config
from observability import get_logger

logger = get_logger("recorder")

# One resample per frame, to this rate. 16 kHz keeps the agent's synthesised
# speech intelligible while staying small; set RECORDING_SAMPLE_RATE=8000 to
# match raw telephony (what a Vobiz-style recorder stores) if preferred.
_SAMPLE_RATE = int(os.getenv("RECORDING_SAMPLE_RATE", "16000"))
_DTYPE = np.int16
_INT16_MAX = 32767

# Channel order in the interleaved output.
_CH_CALLER = 0                # left
_CH_AGENT = 1                 # right


def _frame_to_mono(frame: Any, target_rate: int) -> np.ndarray | None:
    """rtc.AudioFrame -> mono float32 at `target_rate` (or None if unusable)."""
    try:
        raw = bytes(frame.data)
        if not raw:
            return None
        pcm = np.frombuffer(raw, dtype=np.int16).astype(np.float32)
        ch = int(getattr(frame, "num_channels", 1) or 1)
        if ch > 1:                       # interleaved -> mono average
            usable = (len(pcm) // ch) * ch
            pcm = pcm[:usable].reshape(-1, ch).mean(axis=1)
        sr = int(getattr(frame, "sample_rate", target_rate) or target_rate)
        if sr != target_rate and len(pcm):
            # Linear resample — adequate for speech and dependency-free.
            n_out = max(1, int(round(len(pcm) * target_rate / sr)))
            pcm = np.interp(
                np.linspace(0.0, len(pcm) - 1, n_out, dtype=np.float32),
                np.arange(len(pcm), dtype=np.float32),
                pcm,
            ).astype(np.float32)
        return pcm
    except Exception:
        return None


class CallRecorder:
    """Mixes caller + agent audio for one room into a local WAV."""

    def __init__(self, room: str, base_dir: str | None = None):
        self.room = room
        self.base_dir = base_dir or config.RECORDINGS_DIR
        self.rate = _SAMPLE_RATE
        self.path: str | None = None
        self.rel_key: str | None = None
        self.started_at: float | None = None
        self.failed_reason: str | None = None
        # One buffer per leg, same timeline. Separate channels mean no additive
        # clipping, so speech is never attenuated to make room for the other side.
        self._ch: dict[int, np.ndarray | None] = {_CH_CALLER: None, _CH_AGENT: None}
        self._high_water = 0           # furthest sample written on EITHER leg
        self._written = {_CH_CALLER: 0, _CH_AGENT: 0}   # samples per leg, for diagnostics
        self._max_samples = 0
        self._tasks: list[asyncio.Task] = []
        self._closed = False
        self._truncated = False
        # Caller tracks already being pumped. The track can be offered twice —
        # once by the live `track_subscribed` event and once by the sweep of
        # already-subscribed tracks that runs when recording starts — and two
        # pumps on one track would mix the caller in twice (doubling their
        # amplitude and clipping).
        self._attached_track_sids: set[str] = set()

    # ── lifecycle ────────────────────────────────────────────────────────────
    def start(self) -> bool:
        """Allocate the buffer + verify disk. False = recording unavailable."""
        try:
            free_mb = shutil.disk_usage(_ensure_dir(self.base_dir)).free / (1024 * 1024)
            if free_mb < config.RECORDING_MIN_FREE_MB:
                self.failed_reason = f"low disk: {free_mb:.0f}MB free"
                logger.warning("recording_disk_low", free_mb=round(free_mb),
                               required_mb=config.RECORDING_MIN_FREE_MB,
                               room=self.room, source="RECORDING")
                return False
            self._max_samples = int(self.rate * 60 * config.RECORDING_MAX_MINUTES)
            self._ch[_CH_CALLER] = np.zeros(self._max_samples, dtype=np.float32)
            self._ch[_CH_AGENT] = np.zeros(self._max_samples, dtype=np.float32)
            self.started_at = time.monotonic()
            ts = time.gmtime()
            self.rel_key = (f"{ts.tm_year:04d}/{ts.tm_mon:02d}/{ts.tm_mday:02d}/"
                            f"{_safe(self.room)}.wav")
            self.path = os.path.join(self.base_dir, self.rel_key)
            _ensure_dir(os.path.dirname(self.path))
            logger.info("recording_started_local", room=self.room, path=self.rel_key,
                        sample_rate=self.rate, channels=2, layout="L=caller R=agent",
                        max_minutes=config.RECORDING_MAX_MINUTES, source="RECORDING")
            return True
        except Exception as exc:
            self.failed_reason = str(exc)[:200]
            logger.warning("recording_start_failed", error=str(exc)[:200],
                           room=self.room, source="RECORDING")
            return False

    # ── ingest ───────────────────────────────────────────────────────────────
    def _write(self, ch: int, pcm: np.ndarray, at: float) -> None:
        """Place `pcm` on channel `ch` at wall-clock offset `at` seconds.

        Additive within a channel (two frames from the same leg should never
        overlap, but if clocks jitter we sum rather than drop audio). The two
        legs never share a buffer, so one speaker can no longer clip the other.
        """
        buf = self._ch.get(ch)
        if buf is None or self._closed or pcm is None or not len(pcm):
            return
        start = int(at * self.rate)
        if start < 0:
            start = 0
        end = start + len(pcm)
        if start >= self._max_samples:
            if not self._truncated:
                self._truncated = True
                logger.warning("recording_truncated", room=self.room,
                               max_minutes=config.RECORDING_MAX_MINUTES, source="RECORDING")
            return
        if end > self._max_samples:          # clip the tail at the cap
            pcm = pcm[: self._max_samples - start]
            end = self._max_samples
            self._truncated = True
        buf[start:end] += pcm
        self._written[ch] = max(self._written[ch], end)
        if end > self._high_water:
            self._high_water = end

    def write_agent_frame(self, frame: Any) -> None:
        """Tee one TTS/agent audio frame (called from the TTS node)."""
        if self._closed or self.started_at is None:
            return
        try:
            pcm = _frame_to_mono(frame, self.rate)
            if pcm is not None:
                self._write(_CH_AGENT, pcm, time.monotonic() - self.started_at)
        except Exception:
            pass                      # never propagate into the audio path

    def attach_caller_track(self, track: Any, track_sid: str = "") -> None:
        """Subscribe to the caller's audio track and mix it in the background.

        Safe to call more than once for the same track: the caller's audio is
        offered both by the live `track_subscribed` event and by the sweep that
        runs once recording has started, and only one of those wins depending on
        ordering. Attaching twice would mix the caller in twice.
        """
        if self._closed or self.started_at is None:
            return
        sid = str(track_sid or getattr(track, "sid", "") or "")
        if sid and sid in self._attached_track_sids:
            logger.info("recording_caller_already_attached", track_sid=sid,
                        room=self.room, source="RECORDING")
            return
        try:
            from livekit import rtc
            stream = rtc.AudioStream(track)
        except Exception as exc:
            logger.warning("recording_caller_attach_failed", error=str(exc)[:200],
                           track_sid=sid, room=self.room, source="RECORDING")
            return
        if sid:
            self._attached_track_sids.add(sid)

        async def _pump() -> None:
            frames = 0
            try:
                async for ev in stream:
                    if self._closed:
                        break
                    frame = getattr(ev, "frame", ev)
                    pcm = _frame_to_mono(frame, self.rate)
                    if pcm is not None:
                        frames += 1
                        self._write(_CH_CALLER, pcm, time.monotonic() - (self.started_at or 0))
            except asyncio.CancelledError:
                pass
            except Exception as exc:
                logger.warning("recording_caller_stream_error", error=str(exc)[:200],
                               track_sid=sid, room=self.room, source="RECORDING")
            finally:
                # A caller leg that ends BEFORE the call does is the signature of
                # a dropped/resubscribed track — the thing that silently halved
                # earlier recordings. Say so, with when, instead of leaving a
                # short file to be discovered later.
                if not self._closed:
                    at = round(time.monotonic() - (self.started_at or 0), 1)
                    logger.warning("recording_caller_stream_ended_early", track_sid=sid,
                                   at_seconds=at, frames=frames, room=self.room,
                                   detail="caller track ended while the call was still up; "
                                          "a resubscribe will re-attach under a new SID",
                                   source="RECORDING")
                    # Allow a re-subscribe of the SAME sid to attach again.
                    self._attached_track_sids.discard(sid)

        try:
            self._tasks.append(asyncio.create_task(_pump()))
            logger.info("recording_caller_attached", track_sid=sid or "(unknown)",
                        attached_tracks=len(self._attached_track_sids),
                        room=self.room, source="RECORDING")
        except Exception:
            pass

    # ── finalize ─────────────────────────────────────────────────────────────
    def stop(self) -> tuple[str | None, int | None]:
        """Write the stereo WAV. Returns (relative_key, duration_seconds)."""
        if self._closed:
            return self.rel_key, self._duration()
        # Length is the ELAPSED CALL, not the last frame received. Previously a
        # leg that went quiet (or whose pump died) ended the file early — a 122s
        # call produced 64s. Silence is real information: it says nobody spoke.
        elapsed = int((time.monotonic() - self.started_at) * self.rate) if self.started_at else 0
        self._closed = True
        for t in self._tasks:
            try:
                t.cancel()
            except Exception:
                pass

        left, right = self._ch.get(_CH_CALLER), self._ch.get(_CH_AGENT)
        if left is None or right is None or self.path is None or self._high_water <= 0:
            logger.info("recording_empty", room=self.room,
                        reason=self.failed_reason or "no audio captured", source="RECORDING")
            return None, None
        try:
            n = max(self._high_water, min(elapsed, self._max_samples))
            # Per-channel soft limit. The legs are separate so neither can clip the
            # other, but a leg whose SOURCE already sits at full scale (synthesised
            # speech often does) would still square off against the int16 ceiling —
            # a real call clipped 115 agent samples. Scaling only the offending
            # channel, only when it actually exceeds range, removes that without
            # touching levels on a leg that was already within range.
            stereo = np.empty((n, 2), dtype=_DTYPE)
            for idx, leg in ((0, left), (1, right)):
                sig = leg[:n]
                peak = float(np.max(np.abs(sig))) if n else 0.0
                if peak > _INT16_MAX:
                    sig = sig * (_INT16_MAX / peak)
                    logger.info("recording_channel_limited", channel="caller" if idx == 0 else "agent",
                                peak=int(peak), room=self.room, source="RECORDING")
                stereo[:, idx] = np.clip(sig, -_INT16_MAX, _INT16_MAX).astype(_DTYPE)

            tmp = self.path + ".part"
            with wave.open(tmp, "wb") as w:
                w.setnchannels(2)
                w.setsampwidth(2)
                w.setframerate(self.rate)
                w.writeframes(stereo.tobytes())
            os.replace(tmp, self.path)          # atomic — never a half file
            self._high_water = n
            dur = self._duration()
            logger.info("recording_completed_local", room=self.room, path=self.rel_key,
                        duration_seconds=dur, bytes=os.path.getsize(self.path),
                        channels=2, sample_rate=self.rate,
                        caller_seconds=round(self._written[_CH_CALLER] / self.rate, 1),
                        agent_seconds=round(self._written[_CH_AGENT] / self.rate, 1),
                        caller_captured=self._written[_CH_CALLER] > 0,
                        agent_captured=self._written[_CH_AGENT] > 0,
                        truncated=self._truncated, source="RECORDING")
            if self._written[_CH_CALLER] == 0:
                logger.warning("recording_missing_caller_leg", room=self.room,
                               detail="no caller audio reached the recorder",
                               source="RECORDING")
            if self._written[_CH_AGENT] == 0:
                logger.warning("recording_missing_agent_leg", room=self.room,
                               detail="no agent audio reached the recorder",
                               source="RECORDING")
            return self.rel_key, dur
        except Exception as exc:
            self.failed_reason = str(exc)[:200]
            logger.warning("recording_write_failed", error=str(exc)[:200],
                           room=self.room, source="RECORDING")
            return None, None
        finally:
            self._ch[_CH_CALLER] = None         # release memory promptly
            self._ch[_CH_AGENT] = None

    def _duration(self) -> int | None:
        return int(self._high_water / self.rate) if self._high_water else None


# ── path helpers (also used by the HTTP layer) ───────────────────────────────
def _safe(name: str) -> str:
    return "".join(c for c in (name or "") if c.isalnum() or c in "-_.") or "room"


def _ensure_dir(path: str) -> str:
    os.makedirs(path, exist_ok=True)
    return path


def resolve_recording_path(rel_key: str) -> str | None:
    """Map a stored key to an absolute path INSIDE RECORDINGS_DIR.

    Rejects traversal (`..`, absolute keys) so a crafted DB value can never read
    an arbitrary file off the host.
    """
    if not rel_key:
        return None
    base = os.path.abspath(config.RECORDINGS_DIR)
    full = os.path.abspath(os.path.join(base, rel_key.lstrip("/\\")))
    if not full.startswith(base + os.sep) and full != base:
        return None
    return full if os.path.isfile(full) else None
