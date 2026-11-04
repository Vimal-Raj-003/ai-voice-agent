"""Local-only diagnosis of the November 4 inbound trace and attached recording."""
import json
from pathlib import Path
import sys
import av
import numpy as np
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from inspect_silent_call import objects


def envelope(path):
    arrays = []
    with av.open(str(path)) as container:
        source = container.streams.audio[0]
        rate, channels = source.codec_context.sample_rate, source.codec_context.channels
        resampler = av.AudioResampler(format='s16', layout='mono', rate=8000)
        for frame in container.decode(audio=0):
            arrays.extend(f.to_ndarray().reshape(-1) for f in resampler.resample(frame))
        arrays.extend(f.to_ndarray().reshape(-1) for f in resampler.resample(None))
    samples = np.concatenate(arrays).astype(np.float64)
    samples = samples[:len(samples)//80*80]
    return np.sqrt(np.mean(samples.reshape(-1, 80)**2, axis=1)), dict(
        original_rate=rate, original_channels=channels, duration_s=round(len(samples)/8000, 2))


def main():
    room = 'inbound-_917397075913_JtFBVVurMfo8'
    rows = [r for r in objects((ROOT/'output/verify/localhost-2026-11-04-worker.log').read_text(encoding='utf8'))
            if r.get('room') == room or r.get('call_id') == room]
    report = dict(call_id='93696562-8d30-4ccb-a63f-a9a0d677938a', room=room,
                  customer_audio_uploaded=False, handset_word_timing_verified=False,
                  turns=[r for r in rows if r.get('event') == 'turn_summary'], timings=[])
    stages = [r for r in rows if r.get('event') == 'voice_stage']
    for commit in [r for r in stages if r.get('stage') == 'turn_committed']:
        turn = commit['turn_id']
        origin = commit.get('caller_end_wall')
        if not origin:
            continue
        after = [r for r in stages if r.get('turn_id') == turn and r['at_wall'] >= commit['at_wall']]
        row = dict(caller_turn_id=turn, boundary='SDK-estimated speech end; room events are not handset audio')
        for stage in ('turn_committed','pre_model_start','llm_request_start','first_model_text',
                      'first_released_text','first_tts_input','first_generated_audio','room_playback_started'):
            values = [r for r in after if r.get('stage') == stage]
            if values:
                row[stage+'_ms'] = round((values[0]['at_wall']-origin)*1000)
        report['timings'].append(row)
    report['confidence_rejections'] = sum(r.get('event') == 'assistant_confidence_clarification' for r in rows)
    report['primary_failures'] = [dict(at=r['timestamp'], kind=r.get('error_type'), detail=r.get('detail'))
                                  for r in rows if r.get('event') == 'primary_llm_failed']
    report['knowledge_lookups'] = [dict(ms=r.get('ms'), hits=r.get('hits')) for r in rows
                                    if r.get('event') == 'knowledge_lookup_done']
    attached = Path('/mnt/c/Users/CT/Downloads/WhatsApp Audio 2026-11-04 at 10.14.00 AM.aac')
    audio, report['attached_audio'] = envelope(attached)
    from dotenv import load_dotenv
    load_dotenv(ROOT/'.env')
    from recorder import resolve_recording_path
    recorded = resolve_recording_path('2026/11/04/'+room+'.wav')
    if recorded:
        local, report['local_recording'] = envelope(recorded)
        if len(local) >= len(audio):
            left, right = local-local.mean(), audio-audio.mean()
            size = 1 << (len(left)+len(right)-1).bit_length()
            score = np.fft.irfft(np.fft.rfft(left, size)*np.fft.rfft(right[::-1], size), size)
            offset = int(score[len(right)-1:len(left)].argmax())
            report['audio_alignment'] = dict(local_offset_s=offset/100,
                envelope_correlation=round(float(np.corrcoef(audio,local[offset:offset+len(audio)])[0,1]),4),
                limitation='Summed-channel 100 Hz envelope comparison; no word/speaker/handset timestamps')
    path = ROOT/'output/verify/call-1014-analysis.json'
    path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({k:v for k,v in report.items() if k not in ('turns','room')},ensure_ascii=False))


if __name__ == '__main__':
    main()
