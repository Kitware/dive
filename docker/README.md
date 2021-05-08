# Docker Documentation

DIVE is easiest to set up with docker.

**Docker server installation is only supported on Linux distributions**.

* If you would like to run VIAME pipelines/training locally on Windows, Mac, or Linux, try [DIVE Desktop](https://kitware.github.io/dive/Dive-Desktop/)
* If you would like to run VIAME pipelines on your own GPU hardware with data on viame.kitware.com, read through [Google Cloud Integration](https://kitware.github.io/dive/Google-Cloud/) or see the "Running the GPU Worker Standalone" below.

## Local and testing deployment with docker-compose

Follow this section to deploy a demo instance to your workstation or a node in a private network.

* Install [docker and docker-compose](https://docs.docker.com/engine/install)
* Install [nvidia-docker2](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html#docker)

Clone this repository and configure options in `.env` .

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

## Production deployment with docker-compose

If you have a server with a **domain name** and a **public-facing IP address**, you should be able to use our production deployment configuration.  This is the way we deploy on https://viame.kitware.com.

* It is updated on a schedule by `containrrr/watchtower` using automated image builds from docker hub (above).
* It includes `linuxserver/duplicati` for nighly backups.

You should scale the girder server up to an appropriate number.  This stack will automatically load-balance across however many instances you bring up.

```bash
# first modify .env to include the production variables from .env.default
docker-compose -f docker-compose.yml -f docker-compose.prod.yml pull
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d --scale girder=4
```

## Addon management

After initial deployment, a DIVE server will only have basic VIAME pipelines available. VIAME addons are installed and upgraded using a celery task that must be triggered by hand. Run this by issueing a `POST /api/v1/viame/upgrade_pipelines` request from the swagger UI at `/girder/api/v1` .

* Whether you `force` or not, only those pipelines from addons from the exact urls passed will be enabled on the server.
* An old addon can be disabled by simply omitting its download from the upgrade payload.
* `force` should be used to force re-download of all URLs in the payload even if their zipfiles have been cached.
* An upgrade run is always required if the "common" pipelines in the base image change.  These are updated for every run, and do not require `force`.
* See the job log to verify the exact actions taken by an upgrade job.

![Upgrade Pipelines Swagger](/docs/images/UpgradePipelinesSwagger.png)

## Images

A DIVE deployment consists of 2 main services.

* [kitware/viame-web](https://hub.docker.com/r/kitware/viame-web) - the web server
* [kitware/viame-worker](https://hub.docker.com/r/kitware/viame-worker) - the queue worker

In addition, a database (MongoDB) and a queue service (RabbitMQ) are required.

### Web Server config

This image contains both the backend and client.

| Variable | Default | Description |
|----------|---------|-------------|
| GIRDER_MONGO_URI | `mongodb://mongo:27017/girder` | a mongodb connection string |
| GIRDER_ADMIN_USER | `admin` | admin username |
| GIRDER_ADMIN_PASS | `letmein` | admin password |
| CELERY_BROKER_URL | `amqp://guest:guest@rabbit/` | rabbitmq connection string |
| BROKER_CONNECTION_TIMEOUT | `2` | rabbitmq connection timeout |
| WORKER_API_URL | `http://girder:8080/api/v1` | Address for workers to reach web server |

[Read more about configuring girder.](https://girder.readthedocs.io/en/latest/)

### Worker config

This image contains a celery worker to run VIAME pipelines and transcoding jobs.

| Variable | Default | Description |
|----------|---------|-------------|
| CELERY_BROKER_URL | `amqp://guest:guest@rabbit/` | rabbitmq connection string |
| BROKER_CONNECTION_TIMEOUT | `2` | rabbitmq connection timeout |
| WORKER_WATCHING_QUEUES | null | one of `celery`, `pipelines`, `training` |

## Running the GPU Worker Standalone

You can run a standalone worker to process jobs from a remote DIVE Web server.

* It requires a local VIAME installation to mount in addons.
* Set the queue(s) you wish to consume.
* Get the `CELERY_BROKER_URL` from our team.  Email `viame-web@kitware.com`

``` bash
docker run --rm --name dive_worker \
  --gpus all \
  --ipc host \
  --volume "/opt/noaa/viame/configs/pipelines:/tmp/addons:rw" \
  -e "WORKER_WATCHING_QUEUES=celery,pipelines,training,myusername" \
  -e "CELERY_BROKER_URL=amqp://guest:guest@rabbit/" \
  kitware/viame-worker:latest
```

## Build your own images

> **Note:** In order to build images yourself, the `.git` folder must exist, so you must `git clone` from source control.  A release archive zip can be used too, but only to run pre-built images from a container registry.

``` bash
docker-compose build
```
