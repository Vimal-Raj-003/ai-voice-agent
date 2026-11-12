from types import SimpleNamespace as NS
from unittest.mock import AsyncMock,MagicMock
import pytest
import voice_usage


async def test_demo_evidence_is_idempotent_redacted_and_has_no_business_writes(monkeypatch):
    conn=NS(fetchrow=AsyncMock(return_value={'id':'demo'}),execute=AsyncMock())
    transaction=MagicMock();transaction.__aenter__=AsyncMock();transaction.__aexit__=AsyncMock(return_value=False)
    conn.transaction=MagicMock(return_value=transaction)
    acquire=MagicMock();acquire.__aenter__=AsyncMock(return_value=conn);acquire.__aexit__=AsyncMock(return_value=False)
    pool=NS(acquire=MagicMock(return_value=acquire))
    monkeypatch.setattr(voice_usage.db,'get_pool',AsyncMock(return_value=pool))
    import recorder
    monkeypatch.setattr(recorder,'resolve_recording_path',lambda key:'/synthetic.wav')
    messages=[{'id':'one','role':'user','content':'My email is synthetic@example.com','timestamp':1700000000},
              {'id':'merged','role':'assistant','content':'A real answer.[APPLICATION CALL MEMORY; turn=2]\n{"private":"state"}'},
              {'id':'internal','role':'assistant','content':'[APPLICATION CALL MEMORY] private state'}]
    await voice_usage.save_demo_artifacts('demo-room',messages,'2026/11/11/demo.wav',12)
    await voice_usage.save_demo_artifacts('demo-room',messages,'2026/11/11/demo.wav',12)
    writes=conn.execute.await_args_list
    transcripts=[c for c in writes if 'INSERT INTO transcript_messages' in c.args[0]]
    assert len(transcripts)==4 and transcripts[0].args[1]==transcripts[2].args[1]
    assert 'synthetic@example.com' not in transcripts[0].args[4]
    assert transcripts[1].args[4]=='A real answer.'
    assert all('contacts' not in c.args[0] and 'appointments' not in c.args[0] for c in writes)
    assert any('recordingObjectKey' in c.args[0] for c in writes)


async def test_rate_snapshot_records_actual_rates_without_changing_usage():
    usage={'provider':'google','model':'saved-live','tokens':{'inputAudio':100}}
    pool=NS(fetch=AsyncMock(return_value=[{'provider':'google','sku':'saved-live/audio','kind':'LLM_INPUT_MTOK','rateUsd':3,'last_verified_at':None}]))
    result=await voice_usage.with_native_rate_snapshot(usage,pool)
    assert result['tokens']==usage['tokens'] and 'rateSnapshot' not in usage
    assert result['rateSnapshot']['rows'][0]['rateUsd']==3
    assert await voice_usage.with_native_rate_snapshot(result,pool)==result
    assert pool.fetch.await_count==1


async def test_phone_speech_input_rate_is_frozen_with_native_modality_rates():
    usage={'provider':'google','model':'saved-live','speechInput':{'provider':'sarvam','model':'saaras:v4'}}
    rows=[{'provider':'google','sku':'saved-live/audio','kind':'LLM_OUTPUT_MTOK','rateUsd':12,'last_verified_at':None}]
    speech=[{'provider':'sarvam','sku':'saaras:v4','kind':'STT_MINUTE','rateUsd':.01,'last_verified_at':None}]
    pool=NS(fetch=AsyncMock(side_effect=[rows,speech]))
    result=await voice_usage.with_native_rate_snapshot(usage,pool)
    assert result['rateSnapshot']['rows'][1]['provider']=='sarvam'
    assert pool.fetch.await_args.args[1:]==('sarvam','saaras:v4')
