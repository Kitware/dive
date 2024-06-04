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

This python project uses [Poetry](https://python-poetry.org/).

```bash
# Optional, for intellisense or whatever.  Not required for docker-compose
poetry install
```

### Running in development with docker

```bash
# Copy .env.default and make any changes
cp .env.default .env

# Option 1) Build the project from source
docker-compose build
# Option 2) Pull pre-build images
docker-compose pull

# Start the project
docker-compose up -d

# The web server has hot reload, so code changes will
# immediately trigger a server restart.

# The Celery workers do not have hot reload.
# To test code changes, a restart is needed
docker-compose up girder_worker_default
# or
docker-compose up girder_worker_pipelines
# or
docker-compose up girder_worker_training
```

Access the server at <http://localhost:8010>

To work on the Vue client, see development instructions in `../client`.

## Unit Testing and Static Checks

Automation is done with [Tox](https://pypi.org/project/tox/), installed by poetry above.

```bash
# run only lint checks
poetry run tox -e check

# run only type checks
poetry run tox -e type

# run only unit tests
poetry run tox -e testunit

# run only a particular test
poetry run tox -e testunit -- -k test_image_sort

# run all three tests above
poetry run tox

# automatically format all code to comply to linting checks
poetry run tox -e format

# run mkdocs and serve the documentation page
poetry run tox -e docs

# creates docs in the /site folder for eventual deployment
poetry run tox -e builddocs
```

## Integration Testing

Get an API key from production Girder. **DO NOT** use a full-scoped token, use a read only token.

```bash
# start the server
docker-compose up -d

# set an API key from production girder
export GIRDER_API_KEY=CHANGEME

# run the tests
poetry run tox -e testintegration

# run only a particular test (be mindful of dependencies)
poetry run tox -e testintegrationkeyword test_pipelines
```

After integration tests are complete, visually inspect the results to make sure all jobs completed, new datasets open correctly, etc.

## Debug utils and command line tools

``` bash
# Requires a local poetry installation
poetry install

# show options
poetry run dive --help

# build the standalone executable into ./dist
poetry run tox -e buildcli
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
* `foreign_media_id` (string) For "cloned" datasets, this is an objectId pointer to the source media

### Video Item

* `codec` (string) video codec
* `source_video` (boolean) whether the video is a raw user upload or a trancoded video
