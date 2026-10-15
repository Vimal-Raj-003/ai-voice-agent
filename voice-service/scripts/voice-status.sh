#!/usr/bin/env bash
# JillJill Voice — show status of both services + quick health. No sudo needed.
set -u
echo "──────────── JillJill Voice status ────────────"
for svc in jilljill-voice-api jilljill-voice-worker; do
  state=$(systemctl is-active "$svc" 2>/dev/null || echo unknown)
  enabled=$(systemctl is-enabled "$svc" 2>/dev/null || echo unknown)
  printf "%-26s %-10s (boot: %s)\n" "$svc" "$state" "$enabled"
done
echo "── API port ──"
if ss -ltn 2>/dev/null | grep -q ':8000'; then echo "listening on :8000"; else echo "NOT listening on :8000"; fi
echo "── /health ──"
curl -s --max-time 5 http://127.0.0.1:8000/health 2>/dev/null || echo "(health unreachable)"
echo
