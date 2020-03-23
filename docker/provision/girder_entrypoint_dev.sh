#!/bin/bash

cd /home/viame_girder
pip install -e .
python3 /home/provision/init_girder.py
girder serve --host 0.0.0.0 --dev
