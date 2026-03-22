#!/bin/bash
# slycode-env-wrapper.sh — sources user profile + .env then exec's the service
# Used by systemd/launchd service files so that .env changes
# take effect on service restart without reinstalling.

# Capture login shell PATH (homebrew, nvm, npm global, etc.)
# Uses the user's default shell to source the right profile files.
USER_SHELL="${SHELL:-/bin/bash}"
LOGIN_PATH=$("$USER_SHELL" -l -c 'printf "%s" "$PATH"' 2>/dev/null)
if [ -n "$LOGIN_PATH" ]; then
  export PATH="$LOGIN_PATH"
fi

set -a
[ -f "$SLYCODE_HOME/.env" ] && source "$SLYCODE_HOME/.env"
set +a
exec "$@"
