#!/bin/sh
set -e
python /server_setup.py
exec girder serve --host 0.0.0.0 $@
