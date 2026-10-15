#!/usr/bin/env bash
# JillJill Voice — restart both services (API first, then worker).
# Uses sudo (system services); WSL may ask for your Linux password once.
set -u
sudo systemctl restart jilljill-voice-api jilljill-voice-worker
echo "restarted:"
for svc in jilljill-voice-api jilljill-voice-worker; do
  printf "  %-26s %s\n" "$svc" "$(systemctl is-active "$svc" 2>/dev/null)"
done
