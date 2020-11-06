# VIAME Electron Desktop client

> Codename Heavy(?)

## Why make a desktop version

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

## Desktop Dependencies

Currently, desktop-only dependencies are installed into devdependencies and linting errors are ignored inline.  This is to prevent desktop's dependencies from polluting the installation of `vue-media-annotator` from NPM.  Separating the many packaging needs of this project is an open discussion.

## IPC and data flow

Several kinds of inter-process communication are used between renderer and main.

* Synchronous IPC for short messages that resolve quickly.  Blocking IPC should generally be avoided.
* Asynchronous IPC for short messages that take longer.  This will be the majority of cases.
* HTTP Service running in main for very long messages.  IPC isn't good for passing large blobs.
  * Mostly used to read images and video from disk.
* Direct use of node.js native libraries from renderer, for loading large blobs to and from disk where streaming isn't useful.  HTTP is used for range queries, but for annotation files, there is no benefit to using the HTTP interface over direct filesystem access since JSON files must be loaded into memory 100% to be useful.

## Platform-specific methods

Due to tight OS coupling, some methods will have to be implemented to target a single platform. See `backend/platforms`.
