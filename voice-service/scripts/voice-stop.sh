#!/usr/bin/env bash
# JillJill Voice — stop both services (worker first, then API).
# Uses sudo (system services); WSL may ask for your Linux password once.
set -u
sudo systemctl stop jilljill-voice-worker jilljill-voice-api
echo "stopped."
