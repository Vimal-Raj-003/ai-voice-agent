"""Account model discovery: no generation requests or plaintext credential responses."""
from unittest.mock import AsyncMock

import httpx
import pytest
import respx

import live_model_catalog as catalog
from native_voice import runtime_settings


async def test_live_catalog_pages_filters_and_uses_the_organization_key(monkeypatch):
    catalog._cache.clear()
    monkeypatch.setattr(catalog.provider_credentials,'load_for_org',AsyncMock(return_value={'google':'synthetic-tenant-key'}))
    calls=[]
    def respond(request):
        calls.append(request)
        if request.url.params.get('pageToken'):
            return httpx.Response(200,json={'models':[{'name':'models/gemini-future-live','supportedGenerationMethods':['bidiGenerateContent']} ]})
        return httpx.Response(200,json={'nextPageToken':'next','models':[
            {'name':'models/gemini-3.8-live-extended-thinking','supportedGenerationMethods':['bidiGenerateContent']},
            {'name':'models/gemini-text','supportedGenerationMethods':['generateContent']},
            {'name':'models/gemini-3.5-transcribe-live','supportedGenerationMethods':['bidiGenerateContent']},
            {'name':'models/gemini-flash-tts','supportedGenerationMethods':['generateContent']}]})
    with respx.mock:
        route=respx.get('https://generativelanguage.googleapis.com/v1beta/models').mock(side_effect=respond)
        result=await catalog.list_live_models('synthetic-org')
        assert route.call_count==2
        assert [row['id'] for row in result['models']]==['gemini-3.5-transcribe-live','gemini-3.8-live-extended-thinking','gemini-future-live']
        assert result['models'][0]['compatible'] is False
        assert result['credentialSource']=='organization' and result['billingProject'] is None
        assert 'synthetic-tenant-key' not in str(result)
        assert calls[0].headers['x-goog-api-key']=='synthetic-tenant-key'
        await catalog.list_live_models('synthetic-org')
        assert route.call_count==2


async def test_discovery_failure_is_marked_unverified_not_available(monkeypatch):
    catalog._cache.clear()
    monkeypatch.setattr(catalog.provider_credentials,'load_for_org',AsyncMock(return_value={}))
    monkeypatch.setenv('GOOGLE_API_KEY','synthetic-server-key')
    with respx.mock:
        respx.get('https://generativelanguage.googleapis.com/v1beta/models').respond(403)
        result=await catalog.list_live_models('synthetic-other')
    assert result['stale'] and result['credentialSource']=='server'
    assert all(row['status']=='unverified' for row in result['models'])
    assert 'synthetic-server-key' not in str(result)


def test_runtime_accepts_new_live_ids_without_changing_saved_voice():
    settings=runtime_settings({'metadata':{'voiceRuntime':{'engine':'gemini-live','model':'gemini-future-live','voice':'Despina'}}})
    assert settings.model=='gemini-future-live' and settings.voice=='Despina'
    with pytest.raises(ValueError):
        runtime_settings({'metadata':{'voiceRuntime':{'engine':'gemini-live','model':'gemini-flash-tts','voice':'Despina'}}})
