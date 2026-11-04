"""Read-only provider schema/application diagnosis."""
import asyncio
import json
from pathlib import Path
import sys
import httpx
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from audit_vobiz_number import safe, vobiz

async def main():
    async with httpx.AsyncClient(timeout=15,follow_redirects=True) as http:
        spec=(await http.get('https://www.vobiz.ai/openapi.json')).json()
        paths=spec['paths']
        print(json.dumps({p:{m:d.get('summary') for m,d in value.items() if isinstance(d,dict)}
                          for p,value in paths.items() if 'application' in p.lower() or '/Number' in p},indent=2))
        for p,value in paths.items():
            if ('application' in p.lower() and ('number' in p.lower() or '{app_id}' in p or '{application_id}' in p)):
                print('APPLICATION_SCHEMA',json.dumps({p:value}))
        response=await http.get(vobiz._account_path('/Application/97468014913938513/'),headers=vobiz._headers())
        print('ATTACHED_APPLICATION',response.status_code)
        if response.status_code==200:
            body=response.json()
            # Query strings and authentication fields are not needed for routing.
            print(json.dumps({k:safe(v,k).split('?')[0] if isinstance(v,str) else safe(v,k)
                              for k,v in body.items() if k in ['app_id','app_name','answer_url','fallback_answer_url','sip_uri','default_answer_url','answer_method']},indent=2))
        (ROOT/'output/verify/vobiz-routing-schema.json').write_text(json.dumps(spec),encoding='utf-8')

if __name__=='__main__':
    asyncio.run(main())
