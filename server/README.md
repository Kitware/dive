# DIVE Python Packages

There are several important python packages in this application

* `dive_server` is a collection of girder plugins for the web server
* `dive_tasks` is a collection of girder worker plugins for the celery worker
* `scripts` has general command-line utilities
* `dive_utils` is shared code between the above packages

## Prerequisites

Set up your system as described in the [Basic Deployment](https://kitware.github.io/dive/Deployment-Docker-Compose/)

## Development

In development, the server and client are run in separate processes.  In production, the client is built and bundled as static files into the server image.

Install the development requirements

```bash
pip install -e .[dev]
```

Install <https://github.com/Kitware/ldc>

```bash
# Change to correct directory
cd ../docker/

# copy .env.default and make any changes
cp .env.default .env

# bring the server up
ldc up -d

# replace a pre-built image with the development version
# for example, here's how to work on the girder server code
# girder has hot reload, so code changes will be detected.
ldc dev up girder

# girder worker does not, so code changes require re-launch
ldc dev up girder_worker_default
# or
ldc dev up girder_worker_pipelines
# or
ldc dev up girder_worker_training

# launch a mongo client to query the database
ldc dev run mc
```

Access the server at <http://localhost:8010>

To work on the Vue client, see development instructions in `../client`.

## Unit Testing and Static Checks

All tests are run using tox which is installed with the `dev` packages.

To run local verification of all tests, linting, and formatting

```bash
# run only lint checks
tox -e check

# run only type checks
tox -e type

# run only unit tests
tox -e testunit

# run only a particular test
tox -e testunit -- -k test_image_sort

# run all three tests above
tox

# automatically format all code to comply to linting checks
tox -e format

# run mkdocs and serve the documentation page
tox -e docs
```

## Integration Testing

Get an API key from production Girder. **DO NOT** use a full-scoped token, use a read only token.

```bash
# start the server
ldc up -d

# set an API key from production girder
export GIRDER_API_KEY=CHANGEME

# run the tests
tox -e testintegration

# run only a particular test (be mindful of dependencies)
tox -e testintegration -- -k test_pipelines
```

After integration tests are complete, visually inspect the results to make sure all jobs completed, new datasets open correctly, etc.

## Debug utils and command line tools

``` bash
# Requires the development installation above
pip install -e .[dev]

# show options
dive --help

# build the standalone executable into ./dist
tox -e buildcli
```

## Metadata properties

This section explains the metadata properties used to record application state in Girder.  These properties can be modified through the Girder UI editor.

### Dataset

Image chips that compose a video are stored as girder items in a folder.  Videos are stored as a single item in its own folder.  The parent folder must have the following metadata.

* `annotate` (boolean) marks a folder as a valid DIVE dataset
* `type` (`'video' | 'image-sequence'`) dataset type
* `fps` (number) annotation framerate, not to be confused with video raw framerate
* `ffprobe_info` (JSON) output of ffprobe for raw input video
* `confidenceFilters` (JSON) map of filter name to float in [0, 1]
* `customTypeStyline` (JSON) map of class name to GeoJS display attributes.
* `published` (boolean) whether to include the dataset in published summary
* `foreign_media_id` (string) For "cloned" datasets, this is an objectId pointer to the source media

### Annotation Item

* `detection` (string) objectId pointer to folder that the annotations belong to

Each time the detection list changes, the old item is moved to a subfolder "auxiliary" and the new copy takes its place.  Pipeline runs completely replace existing annotation data (no merge).

### Video Item

* `codec` (string) video codec
* `source_video` (boolean) whether the video is a raw user upload or a trancoded video
