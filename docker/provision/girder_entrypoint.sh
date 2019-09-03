#!/bin/bash

# Install viame plugin
cd /home/viame_girder && pip install -e .
girder serve --database mongodb://mongo:27017/girder --host 0.0.0.0
