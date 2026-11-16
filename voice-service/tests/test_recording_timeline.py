"""Recording must preserve PCM frame order when generation/arrival is bursty."""
from types import SimpleNamespace as NS

import numpy as np
import pytest

from recorder import CallRecorder


@pytest.fixture
def recorder(tmp_path, monkeypatch):
    import recorder as module
    clock = NS(now=100.0)
    monkeypatch.setattr(module.time, 'monotonic', lambda: clock.now)
    monkeypatch.setattr(module.config, 'RECORDING_MIN_FREE_MB', 0)
    rec = CallRecorder('offline', str(tmp_path))
    assert rec.start()
    return rec, clock


def frame(value, seconds=.02, rate=16000):
    data = np.full(round(rate * seconds), value, dtype=np.int16)
    return NS(data=data.tobytes(), sample_rate=rate, num_channels=1,
              samples_per_channel=len(data))


def test_generated_audio_burst_is_contiguous_not_summed_on_top_of_itself(recorder):
    rec, clock = recorder
    clock.now += .5
    for value in (1000, 2000, 3000, 4000, 5000):
        rec.write_agent_frame(frame(value))
    start = int(.5 * rec.rate)
    expected = np.repeat([1000, 2000, 3000, 4000, 5000], int(.02 * rec.rate))
    np.testing.assert_array_equal(rec._ch[1][start:start+len(expected)], expected)


def test_jittering_caller_frames_do_not_overlap_or_drop_samples(recorder):
    rec, clock = recorder
    for offset, value in ((.5,1000),(.501,2000),(.503,3000)):
        clock.now = 100 + offset
        rec._write(0, np.full(320, value, dtype=np.float32), offset)
    expected = np.repeat([1000,2000,3000],320)
    np.testing.assert_array_equal(rec._ch[0][8000:8960],expected)


def test_real_pause_is_kept_between_agent_segments(recorder):
    rec, clock = recorder
    clock.now += .5
    rec.write_agent_frame(frame(1000))
    clock.now += 1
    rec.write_agent_frame(frame(2000))
    assert np.all(rec._ch[1][9000:23000] == 0)
    assert np.all(rec._ch[1][24000:24320] == 2000)


def test_room_progress_keeps_a_gap_and_discards_an_unheard_interrupted_tail(recorder):
    rec, clock = recorder
    rec.enable_agent_playout()
    for value in (1000,2000,3000,4000):
        rec.write_agent_frame(frame(value))
    assert rec._written[1] == 0  # Generated audio alone is not recorded speech.
    wall = rec._started_wall
    rec.agent_playback_progress(started_at=wall+.5, offset=0, duration=.04)
    rec.agent_playback_progress(started_at=wall+1, offset=.04, duration=.01)
    rec.agent_playback_finished()
    assert np.all(rec._ch[1][8000:8320] == 1000)
    assert np.all(rec._ch[1][8320:8640] == 2000)
    assert np.all(rec._ch[1][9000:16000] == 0)
    assert np.all(rec._ch[1][16000:16160] == 3000)
    assert not np.any(rec._ch[1] == 4000)
    rec.write_agent_frame(frame(5000))
    rec.agent_playback_progress(started_at=wall+2,offset=0,duration=.02)
    rec.agent_playback_finished()
    assert np.all(rec._ch[1][32000:32320] == 5000)


def test_recording_ends_at_hangup_not_after_slow_shutdown_bookkeeping(recorder):
    import wave
    rec, clock = recorder
    clock.now += .5
    rec.write_agent_frame(frame(1000))
    clock.now = 102
    rec.mark_ended()
    clock.now = 110
    key, duration = rec.stop()
    assert key and duration == 2
    with wave.open(rec.path) as wav:
        assert wav.getnframes() == rec.rate * 2
        assert wav.getnchannels() == 2


def test_native_room_events_reach_a_recorder_attached_after_runtime_start(recorder):
    from livekit import rtc
    from livekit.agents.voice.io import PlaybackFinishedEvent, PlaybackProgressedEvent

    from callstate import CallState
    from gemini_live_runtime import GeminiRuntime
    rec, _ = recorder
    output = rtc.EventEmitter()
    runtime = GeminiRuntime.__new__(GeminiRuntime)
    runtime.session = NS(output=NS(audio=output),current_speech=None)
    runtime.recorder = None
    runtime.owner = NS()
    runtime.state = CallState()
    runtime.emit = lambda *args, **kwargs: None
    runtime._resume_memory_sync = lambda: None
    runtime.attach_playback()
    runtime.owner._recorder = rec
    rec.enable_agent_playout()
    rec.write_agent_frame(frame(1000,seconds=.04))
    output.emit('playback_progressed',PlaybackProgressedEvent(
        started_at=rec._started_wall+1,offset=0,duration=.02))
    output.emit('playback_finished',PlaybackFinishedEvent(playback_position=.02,interrupted=True))
    assert np.all(rec._ch[1][16000:16320] == 1000)
    assert np.all(rec._ch[1][16320:16640] == 0)
    assert not rec._agent_frames
