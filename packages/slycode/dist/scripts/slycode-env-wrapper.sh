#!/bin/bash
# slycode-env-wrapper.sh — sources .env then exec's the service
# Used by systemd/launchd service files so that .env changes
# take effect on service restart without reinstalling.
set -a
[ -f "$SLYCODE_HOME/.env" ] && source "$SLYCODE_HOME/.env"
set +a
exec "$@"
