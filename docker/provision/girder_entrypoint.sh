#!/bin/bash

# Install viame plugin
cd /home/viame_girder && pip3 install -e . -U
python3 /home/provision/init_girder.py
girder serve --database $MONGO_URI --host 0.0.0.0
