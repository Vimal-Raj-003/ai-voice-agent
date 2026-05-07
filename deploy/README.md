# VPS Deployment (KVM / self-hosted)

Single-VPS Docker deploy for the OutboundAI stack. Vercel is used **for DNS only**; all containers run on your VPS.

## Architecture on the VPS

```
              Internet (HTTPS 443)
                       │
                       ▼
       ┌───────────────────────────────┐
       │  Caddy (TLS + reverse proxy)   │  ports 80/443
       │  ${APP_HOSTNAME}   →  dashboard:3000
       │  ${VOICE_HOSTNAME} →  voice-service:8000
       └──────────┬─────────────┬───────┘
                  │             │
        ┌─────────▼──┐   ┌──────▼────────┐
        │ dashboard  │   │ voice-service  │
        │ Next.js 16 │   │ FastAPI+agent  │
        └────────────┘   └────────────────┘
                  │             │
                  └──────┬──────┘
                         ▼
                    Neon Postgres
                  (managed, off-VPS)
```

## VPS prerequisites

- **OS:** Ubuntu 22.04 or 24.04 LTS (any modern Linux works, this guide uses Ubuntu commands)
- **Specs:** 2 vCPU / 4 GB RAM minimum; 8 GB recommended (the agent loads LiveKit + Silero VAD)
- **Public IP** (IPv4)
- **Open ports:** 22 (SSH), 80 (HTTP, Caddy ACME challenge), 443 (HTTPS)
- **A domain** with DNS you can edit (Vercel-managed is fine)

## Step 1 — install Docker on the VPS

```bash
ssh root@YOUR_VPS_IP

# Install Docker + Compose plugin
curl -fsSL https://get.docker.com | sh
apt-get install -y docker-compose-plugin git

# Verify
docker --version
docker compose version
```

## Step 2 — clone the repo

```bash
mkdir -p /opt && cd /opt
git clone https://github.com/Vimal-Raj-003/ai-voice-agent.git outboundai
cd outboundai
```

## Step 3 — configure DNS (in Vercel)

In the Vercel dashboard → **your domain → DNS**, add two A records:

| Type | Name    | Value          | TTL |
|------|---------|----------------|-----|
| A    | app     | YOUR_VPS_IP    | 60  |
| A    | voice   | YOUR_VPS_IP    | 60  |

Wait until both resolve (`dig app.yourdomain.com +short` should print your VPS IP). Caddy's Let's Encrypt cert request fails if DNS hasn't propagated.

## Step 4 — fill in secrets

```bash
cp .env.example .env
nano .env       # or vim
```

Required values to fill (everything else is optional):

- `APP_HOSTNAME`, `VOICE_HOSTNAME`, `ACME_EMAIL`
- `DATABASE_URL` (and `_UNPOOLED`) — Neon DSN with `?sslmode=require`
- `VOICE_SERVICE_TOKEN` — generate with `openssl rand -base64 32`
- `LIVEKIT_*` — from LiveKit Cloud project settings
- `NEXT_PUBLIC_LIVEKIT_URL` — same WSS URL as `LIVEKIT_URL`
- `GOOGLE_API_KEY` — for Gemini Live
- At least one TTS provider key (`DEEPGRAM_API_KEY` or `SARVAM_API_KEY` or `ELEVENLABS_API_KEY`)
- `VOBIZ_*` + `OUTBOUND_TRUNK_ID` — only needed for outbound phone calls

## Step 5 — apply DB migrations (one-time)

```bash
docker compose run --rm --entrypoint sh dashboard \
  -c "npx prisma migrate deploy && npx prisma db seed"
```

This creates all 22 tables in Neon and seeds the default Organization. Note the printed default-org ID — the voice-service reads it from the `settings.DEFAULT_ORG_ID` row, no manual copy needed.

## Step 6 — bring the stack up

```bash
docker compose up -d --build
docker compose logs -f          # watch all 3 services
```

First run takes ~5–10 minutes (Python deps + Next.js build). Caddy gets Let's Encrypt certs in ~30s once DNS resolves.

Verify:

```bash
curl -I https://app.yourdomain.com         # → 200
curl https://voice.yourdomain.com/health   # → {"status":"ok"}
```

## Step 7 — configure LiveKit webhook + SIP (one-time per LiveKit project)

In the **LiveKit dashboard** → *Settings → Webhooks*:

- Add endpoint: `https://voice.yourdomain.com/api/webhook/livekit`
- Copy the issued secret into `.env` as `LIVEKIT_WEBHOOK_SECRET`, then `docker compose up -d voice-service` to restart with the new value

For outbound calls, create the Vobiz trunks once:

```bash
docker compose exec voice-service python sip/create_trunk.py
docker compose exec voice-service python sip/setup_trunk.py
```

The printed `OUTBOUND_TRUNK_ID` and `INBOUND_TRUNK_ID` go into `.env`, then restart `voice-service`.

## Updates / redeploys

Use the helper script:

```bash
cd /opt/outboundai
./deploy/update.sh
```

It pulls the latest `main`, rebuilds changed images, and rolls the containers without downtime for the database connection.

## Common operations

```bash
# Logs (one service)
docker compose logs -f voice-service
docker compose logs -f dashboard
docker compose logs -f caddy

# Restart only the dashboard (after pulling new commits)
docker compose up -d --build dashboard

# Tail Prometheus metrics
curl https://voice.yourdomain.com/metrics

# Run a Prisma migration after a schema change in main
docker compose run --rm --entrypoint sh dashboard -c "npx prisma migrate deploy"

# Drop into a shell inside voice-service
docker compose exec voice-service bash

# Check Caddy's auto-issued cert
docker compose exec caddy caddy list-certificates
```

## Troubleshooting

**Caddy won't issue a cert** → DNS hasn't propagated. `dig <hostname> +short` from outside the VPS must return your VPS IP. Wait 5 min and retry: `docker compose restart caddy`.

**"connection refused" on /api/dispatch** → voice-service unhealthy. `docker compose logs voice-service` — usually a missing env var.

**Dashboard shows blank** → check browser console for `NEXT_PUBLIC_LIVEKIT_URL`. It must be a `wss://` URL, not `https://`.

**SSE log stream stalls after 60s** → the Caddyfile already disables idle timeout for `/api/logs/stream`. If you've edited it, keep `flush_interval -1` and a long `read_timeout`.

**Outbound calls fail with "trunk not found"** → re-run `sip/create_trunk.py` and update `OUTBOUND_TRUNK_ID` in `.env`.

## Backups

Neon manages Postgres backups. Containers themselves are stateless — only `caddy_data` (Let's Encrypt account + certs) is worth preserving. Snapshot it with:

```bash
docker run --rm -v outboundai_caddy_data:/data -v $PWD:/backup alpine \
  tar czf /backup/caddy_data.tar.gz /data
```
