"""Server-side interactive segmentation and stereo for the web client.

A broker keeps VIAME `interactive_service` processes on the GPU host and
relays JSON requests to them; girder resolves media to paths and forwards.
"""
