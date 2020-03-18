#!/bin/bash

python3 /home/provision/init_girder.py
girder serve --host 0.0.0.0
