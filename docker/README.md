# Docker Documentation

VIAME-Web is easiest to set up with docker.

## docker-compose

We recommend running VIAME Web with docker-compose. Clone this repository and configure options in `.env`.

> **Note:** Pipeline runner requires [Nividia-Docker2 (deprecated)](https://github.com/nvidia/nvidia-docker/wiki/Installation-(version-2.0)) because GPU support for docker-compose has [not yet landed](https://github.com/docker/compose/issues/6691)

``` bash
# Change to correct directory
cd docker/

# Pull pre-built images
docker-compose pull

# Bring the services up
docker-compose up
```

VIAME server will be running at http://localhost:8010/

You can run the data viewer without needing GPU support as well

``` bash
cd docker
docker-compose up girder
```

## Images

VIAME-web consists of 2 main services.

* [Girder (Web Server)](https://hub.docker.com/r/kitware/viame-web)
* [Worker (GPU Pipeline Runner)](https://hub.docker.com/r/kitware/viame-worker)

In addition, a database (Mongodb) and a queue processor (RabbitMQ) are required.

### Girder Web Server

This image contains both the backend and client.

| Variable | Default | Description |
|----------|---------|-------------|
| VIAME_PIPELINES_PATH | none | A path inside the **other** worker container where VIAME pipelines can be found.  You must mount this path. |
| GIRDER_MONGO_URI | mongodb://mongo:27017/girder | a mongodb connection string |
| GIRDER_ADMIN_USER | admin | admin username |
| GIRDER_ADMIN_PASS | viame | admin password |
| CELERY_BROKER_URL | amqp://guest:guest@rabbit/ | rabbitmq connection string |
| BROKER_CONNECTION_TIMEOUT | 2 | rabbitmq connection timeout |

[Read more about configuring girder.](https://girder.readthedocs.io/en/latest/)

### Girder Worker

This image contains a celery worker to run VIAME pipelines and transcoding jobs.

| Variable | Default | Description |
|----------|---------|-------------|
| VIAME_PIPELINES_PATH | none | A path inside the container where VIAME pipelines can be found.  |
| CELERY_BROKER_URL | amqp://guest:guest@rabbit/ | rabbitmq connection string |
| BROKER_CONNECTION_TIMEOUT | 2 | rabbitmq connection timeout |

## Build your own images

> **Note:** In order to build images yourself, the `.git` folder must exist, so you must `git clone` from source control.  A release archive zip can be used too, but only to run pre-built images from a container registry.

``` bash
cd docker
docker-compose build
```
