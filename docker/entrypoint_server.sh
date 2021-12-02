#!/bin/sh
set -e
python3.7 /server_setup.py
exec girder serve --host 0.0.0.0 $@
