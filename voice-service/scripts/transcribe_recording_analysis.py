"""Transcribe a user-authorized recording, at most 24 Sarvam batch requests."""
import argparse
import asyncio
import json
from pathlib import Path
import sys
import time
import av
import numpy as np
import aiohttp
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from dotenv import load_dotenv
load_dotenv(ROOT/'.env')
from livekit import rtc
from livekit.plugins import sarvam
from livekit.agents.types import APIConnectOptions
import config
import db
import provider_credentials


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--audio', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    pcm = []
    with av.open(args.audio) as source:
        resampler = av.AudioResampler(format='s16', layout='mono', rate=16000)
        for frame in source.decode(audio=0):
            pcm.extend(item.to_ndarray().reshape(-1) for item in resampler.resample(frame))
        pcm.extend(item.to_ndarray().reshape(-1) for item in resampler.resample(None))
    pcm = np.concatenate(pcm)
    starts = list(range(0, len(pcm), 379200))
    if len(starts) > 24:
        raise RuntimeError('24-segment cap exceeded; no audio uploaded')
    profile = await db.get_assistant_as_profile('cmuv65lxx0013v7f4thzf2qtv')
    keys = await provider_credentials.load_for_org(profile.get('organization_id'))
    credential, _ = provider_credentials.resolve('sarvam', 'STT', keys)
    await db.close_pool()
    if not credential:
        raise RuntimeError('Configured STT credential unavailable; no audio uploaded')
    report = dict(file=Path(args.audio).name, duration_s=len(pcm)/16000,
        provider='sarvam', model=config.SARVAM_STT_MODEL, mode=config.SARVAM_STT_MODE,
        request_cap=24, llm_requests=0, business_actions=0,
        diarization=False, word_timestamps_verified=False, chunks=[])
    dest = ROOT/args.output
    async with aiohttp.ClientSession() as http:
        engine = sarvam.STT(language='unknown', model=config.SARVAM_STT_MODEL,
            mode=config.SARVAM_STT_MODE, sample_rate=16000, api_key=credential, http_session=http)
        try:
            for index, start in enumerate(starts):
                segment = pcm[start:start+384000]
                frame = rtc.AudioFrame(data=segment.tobytes(), sample_rate=16000,
                    num_channels=1, samples_per_channel=len(segment))
                begin = time.monotonic()
                event = await engine.recognize([frame], conn_options=APIConnectOptions(max_retry=0, timeout=20))
                result = event.alternatives[0] if event.alternatives else None
                report['chunks'].append(dict(index=index, start_s=start/16000,
                    end_s=min(len(pcm),start+384000)/16000, text=result.text if result else '',
                    language=result.language if result else '', processing_ms=round((time.monotonic()-begin)*1000)))
                dest.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
                print(json.dumps(dict(segment=index+1,total=len(starts))),flush=True)
        finally:
            await engine.aclose()


if __name__ == '__main__':
    asyncio.run(main())
