#!/bin/bash

sleep 25
cd /home/viame_girder && pip install -e .
python3 /home/provision/girder.py
girder-worker-config set celery broker amqp://guest:guest@rabbit/
girder-worker-config set girder_worker plugins_enabled girder_io
girder-worker -l info --broker amqp://guest:guest@rabbit/
