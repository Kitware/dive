# VIAME Electron Desktop client

> Codename Heavy


## Why make a desktop version?

* The desktop client is intended for annotation of datasets on your local filesystem.
* It may not be ideal for you to copy large datasets onto a server for annotation.
* Your personal workstation might be ideal for training and pipeline execution.
* You may prefer not to rely on Docker.

## General architecture

Electron applications are comprised of two main threads

* a node.js main thread with full access to the node environment
* a renderer thread which is like a browser tab that runs under a stricter security policy

Due to security concerns in the renderer thread, this app uses a small embedded node.js webserver to serve media content (images and videos) from disk.  This is actually the most reasonable way to stream bytes with range requests into a browser environment.

* The common frontend api is implemented in `api/`
* The backend services are implemented in `backend/`