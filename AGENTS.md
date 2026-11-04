# Local development

When asked to run this application on localhost, start and verify all three services:

1. Dashboard: from `dashboard`, run `npm.cmd run dev -- --hostname 127.0.0.1 --port 3000` on Windows.
2. FastAPI: from `voice-service`, run `.venv\Scripts\python.exe -X utf8 -m uvicorn server:app --host 127.0.0.1 --port 8000`.
3. LiveKit worker: from `voice-service`, run `.venv\Scripts\python.exe -X utf8 agent.py start`.

The dashboard's local `VOICE_SERVICE_URL` must point to `http://127.0.0.1:8000`.
Check existing listeners and their checkout paths before starting duplicates or stopping processes.
Check both Windows and WSL: duplicate workers can register under the same LiveKit agent name.
If the original WSL worker is already managed/running, reuse that runtime instead of starting a Windows duplicate.
Its current environment is `/home/jilljill2023/venvs/jilljill-voice/bin/python` in the same checkout under `/mnt/c/Users/CT/Voice Agent/ai-voice-agent/voice-service`.
After changing worker code, restart the worker; `agent.py start` does not hot-reload.
Confirm the new `VOICE_WORKER_BUILD` identifier and cloud registration after restart.
Verify the dashboard login page, `/health` on port 8000, and LiveKit worker registration and availability.
Report service failures accurately; a listening port alone does not prove readiness.
Keep credentials private, preserve existing local changes, and do not push to GitHub unless requested.
