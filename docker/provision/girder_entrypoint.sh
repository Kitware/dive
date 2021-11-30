#!/bin/sh

python3 /home/provision/init_girder.py
exec girder serve --host 0.0.0.0 $@
