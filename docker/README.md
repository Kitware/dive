# Docker Documentation

DIVE is easiest to set up with docker.

## docker-compose

We recommend running DIVE with docker-compose. Clone this repository and configure options in `.env`.

> **Note:** Pipeline runner requires [Nividia-Docker2 (deprecated)](https://github.com/nvidia/nvidia-docker/wiki/Installation-(version-2.0)) because GPU support for docker-compose has [not yet landed](https://github.com/docker/compose/issues/6691)

``` bash
# Change to correct directory
cd docker/

# Initiate the .env file
cp .env.default .env

# Pull pre-built images
docker-compose pull

# Bring the services up
docker-compose up
```

VIAME server will be running at http://localhost:8010/

You can run the data viewer without needing GPU support as well

``` bash
docker-compose up girder
```

## Images

A DIVE deployment consists of 2 main services.

* [kitware/viame-web](https://hub.docker.com/r/kitware/viame-web) - the web server
* [kitware/viame-worker](https://hub.docker.com/r/kitware/viame-worker) - the queue worker

In addition, a database (MongoDB) and a queue service (RabbitMQ) are required.

### Girder Web Server

This image contains both the backend and client.

| Variable | Default | Description |
|----------|---------|-------------|
| GIRDER_MONGO_URI | mongodb://mongo:27017/girder | a mongodb connection string |
| GIRDER_ADMIN_USER | admin | admin username |
| GIRDER_ADMIN_PASS | letmein | admin password |
| CELERY_BROKER_URL | amqp://guest:guest@rabbit/ | rabbitmq connection string |
| BROKER_CONNECTION_TIMEOUT | 2 | rabbitmq connection timeout |

[Read more about configuring girder.](https://girder.readthedocs.io/en/latest/)

### Girder Worker

This image contains a celery worker to run VIAME pipelines and transcoding jobs.

| Variable | Default | Description |
|----------|---------|-------------|
| CELERY_BROKER_URL | amqp://guest:guest@rabbit/ | rabbitmq connection string |
| BROKER_CONNECTION_TIMEOUT | 2 | rabbitmq connection timeout |

## Build your own images

> **Note:** In order to build images yourself, the `.git` folder must exist, so you must `git clone` from source control.  A release archive zip can be used too, but only to run pre-built images from a container registry.

``` bash
docker-compose build
```

## Addon management

After initial deployment, a DIVE server will only have basic VIAME pipelines available. VIAME addons are installed and upgraded using a celery task that must be triggered by hand. Run this by issueing a `POST /api/v1/viame/upgrade_pipelines` request from the swagger UI at `/girder/api/v1`.

* Whether you `force` or not, only those pipelines from addons from the exact urls passed will be enabled on the server.
* An old addon can be disabled by simply omitting its download from the upgrade payload.
* `force` should be used to force re-download of all URLs in the payload even if their zipfiles have been cached.
* An upgrade run is always required if the "common" pipelines in the base image change.  These are updated for every run, and do not require `force`.
* See the job log to verify the exact actions taken by an upgrade job.

![Upgrade Pipelines Swagger](/docs/images/UpgradePipelinesSwagger.png)

## Production deployment

Our production deployment on https://viame.kitware.com also uses `docker-compose`.

``` bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

* It is updated on a schedule by `containrrr/watchtower` using automated image builds from docker hub (above).
* It includes `linuxserver/duplicati` for nighly backups.

You should scale the girder server up to an appropriate number.  This stack will automatically load-balance across however many instances you bring up.

```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml scale girder=4
```
