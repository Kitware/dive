#!/bin/sh

python3 /home/provision/init_girder.py
exec /tini -v -- girder serve --host 0.0.0.0
