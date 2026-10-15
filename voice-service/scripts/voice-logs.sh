#!/usr/bin/env bash
# JillJill Voice — tail live logs. Usage: voice-logs.sh [api|worker]  (default: both)
# If it says "No journal files / permission", run with sudo once.
set -u
case "${1:-both}" in
  api)    exec journalctl -u jilljill-voice-api -f -n 100 ;;
  worker) exec journalctl -u jilljill-voice-worker -f -n 100 ;;
  *)      exec journalctl -u jilljill-voice-api -u jilljill-voice-worker -f -n 100 ;;
esac
