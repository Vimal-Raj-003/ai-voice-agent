"""Read-only Gemini Live discovery using the same key precedence as the voice runtime."""
import hashlib
import os
import time

import httpx

import provider_credentials
from native_voice import GEMINI_MODELS, is_live_model_id

_cache = {}


async def list_live_models(organization_id: str, refresh: bool = False) -> dict:
    keys = await provider_credentials.load_for_org(organization_id)
    key = keys.get('google') or keys.get('gemini') or os.getenv('GOOGLE_API_KEY', '').strip()
    source = 'organization' if keys.get('google') or keys.get('gemini') else 'server' if key else 'unconfigured'
    cache_key = (organization_id, hashlib.sha256(key.encode()).hexdigest())
    cached = _cache.get(cache_key)
    if not refresh and cached and cached[0] > time.monotonic():
        return cached[1]
    result = {'provider':'google','api':'Gemini Developer API','credentialSource':source,
              'billingProject':None,'models':[],'stale':False,'source':'live','error':''}
    try:
        if not key:
            raise ValueError('Google credential is not configured')
        found = {}
        token = ''
        async with httpx.AsyncClient(timeout=12) as client:
            for _ in range(20):
                params = {'pageSize':200, **({'pageToken':token} if token else {})}
                response = await client.get('https://generativelanguage.googleapis.com/v1beta/models',
                    params=params, headers={'x-goog-api-key':key})
                response.raise_for_status()
                page = response.json()
                for model in page.get('models', []):
                    model_id = model.get('name', '').removeprefix('models/')
                    if model_id.startswith('gemini-') and ('live' in model_id or 'native-audio' in model_id) and 'bidiGenerateContent' in model.get('supportedGenerationMethods', []):
                        compatible = is_live_model_id(model_id)
                        found[model_id] = {'id':model_id,'label':model_id,'status':'listed','compatible':compatible,
                            'reason':'' if compatible else 'Dedicated transcription/translation; not supported by this conversational voice engine'}
                token = page.get('nextPageToken', '')
                if not token:
                    break
            if token:
                raise ValueError('Model listing exceeded the pagination limit')
        result['models'] = sorted(found.values(), key=lambda model:model['id'])
    except Exception as exc:
        # Never include exception URLs, headers or provider responses containing credentials.
        result.update(stale=True,source='fallback',error=f'Model discovery unavailable ({type(exc).__name__})',
                      models=[{'id':model,'label':model,'status':'unverified'} for model in sorted(GEMINI_MODELS)])
    result['count'] = len(result['models'])
    _cache[cache_key] = (time.monotonic() + (60 if result['stale'] else 600), result)
    return result
