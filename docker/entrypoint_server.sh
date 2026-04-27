#!/bin/sh
set -e

# Ensure reload/watch paths stay in project source, not filesystem root.
cd /opt/dive/src

# Backward compatibility for older compose overrides.
if [ "$1" = "--dev" ]; then
    shift
    set -- --mode development "$@"
fi

python /server_setup.py
exec girder serve --host 0.0.0.0 $@
