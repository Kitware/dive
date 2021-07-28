#!/bin/sh

cd /home/viame_girder
pip install -e .[dev]
python3 /home/provision/init_girder.py
exec /tini -v -- girder serve --dev --host 0.0.0.0
