#!/bin/sh

if [ "$DEVELOPMENT_MODE" = "True" ]; then
  echo "Development mode is enabled, syncing client builds..."
  echo "Syncing Dive client..."
  cp -r /opt/dive/clients/dive/ /opt/dive/src/dive_server/dive_client/
fi

set -e

# Ensure reload/watch paths stay in project source, not filesystem root.
cd /opt/dive/src

# Remove stale project virtualenvs from mounted source trees.
# Runtime uses /opt/dive/local/venv; stale .venv paths can crash uvicorn reload scanning.
if [ -e /opt/dive/src/.venv ] || [ -L /opt/dive/src/.venv ]; then
    rm -rf /opt/dive/src/.venv
fi

# Backward compatibility for older compose overrides.
if [ "$1" = "--dev" ]; then
    shift
    set -- --mode development "$@"
fi

python /server_setup.py
exec girder serve --host 0.0.0.0 $@
