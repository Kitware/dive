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
| WORKER_API_URL | `http://girder:8080/api/v1` | Address for workers to reach web server |

You can also pass [girder configuration](https://girder.readthedocs.io/en/latest/) and [celery configuration](https://docs.celeryproject.org/en/stable/userguide/configuration.html#std-setting-broker_connection_timeout).

### Worker config

This image contains a celery worker to run VIAME pipelines and transcoding jobs.

> **Note**: Either a broker url or DIVE credentials must be supplied.

| Variable | Default | Description |
|----------|---------|-------------|
| WORKER_WATCHING_QUEUES | null | one of `celery`, `pipelines`, `training` |
| WORKER_CONCURRENCY | `# of CPU cores` | max concurrnet jobs. **Change this if you run training** |
| WORKER_GPU_UUID | null | leave empty to use all GPUs.  Specify UUID to use specific device |
| CELERY_BROKER_URL | null | rabbitmq connection string |
| DIVE_USERNAME | null | Username to start private queue processor |
| DIVE_PASSWORD | null | Password for private queue processor |
| DIVE_API_URL  | `https://viame.kitware.com/api/v1` | Remote URL to authenticate against |

You can also pass [regular celery configuration variables](https://docs.celeryproject.org/en/stable/userguide/configuration.html#std-setting-broker_connection_timeout).

## Running the GPU Job Runner in standalone mode

**Linux Only.**

You can run a standalone worker to process private jobs from VIAME Web.

* Install VIAME from [the github page](https://github.com/VIAME/VIAME) to `/opt/noaa/viame`.
* Install VIAME pipeline addons by running `bin/download_viame_addons.sh` from the VIAME install.
* Enable the private user queue for your jobs by visiting [the jobs page](https://viame.kitware.com/#/jobs)
* Run a worker using the docker command below

> **Note**: The `--volume` mount maps to the host installtion.  You may need to change the source from `/opt/noaa/viame` depending on your install location, but **you should not** change the destination from `/tmp/addons/extracted`.

``` bash
docker run --rm --name dive_worker \
  --gpus all \
  --ipc host \
  --volume "/opt/noaa/viame/:/tmp/addons/extracted:ro" \
  -e "WORKER_CONCURRENCY=4" \
  -e "DIVE_USERNAME=username" \
  -e "DIVE_PASSWORD=CHANGEME" \
  -e "DIVE_API_URL=https://viame.kitware.com/api/v1" \
  kitware/viame-worker:latest
```

## Build your own images

> **Note:** In order to build images yourself, the `.git` folder must exist, so you must `git clone` from source control.  A release archive zip can be used too, but only to run pre-built images from a container registry.

``` bash
docker-compose build
```
