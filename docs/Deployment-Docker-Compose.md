# Running with Docker Compose

Start here once you have SSH access and `sudo` privileges for a server or VM. 

!!! note

    Docker server installation is only supported on Linux distributions

## Container Images

A DIVE Web deployment consists of 2 main services.

* [kitware/viame-web](https://hub.docker.com/r/kitware/viame-web) - the web server
* [kitware/viame-worker](https://hub.docker.com/r/kitware/viame-worker) - the queue worker

In addition, a database (MongoDB) and a queue service (RabbitMQ) are required.

![DIVE-Web-Architecture-Diagram.svg](images/Diagrams/DIVE-Web-Architecture-Diagram.svg)

## Install dependencies

SSH into the target server and install these system dependencies.

!!! tip

    You can skip this section if you used Ansible to configure your server, as it already installed all necessary dependencies.

* Install NVIDIA drivers: `sudo ubuntu-drivers install`
* Install [docker and docker-compose](https://docs.docker.com/engine/install/ubuntu/)
* Install [nvidia-docker2](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html#docker)

## Basic deployment

Clone this repository and configure options in `.env` .

``` bash
# Clone this repository
git clone https://github.com/Kitware/dive /opt/dive

# Change to correct directory
cd /opt/dive/docker

# Initiate the .env file
cp .env.default .env

# Edit the .env file
nano .env

# Pull pre-built images
docker-compose pull

# Bring the services up
docker-compose up -d
```

VIAME server will be running at [http://localhost:8010](http://localhost:8010/). You should see a page that looks like this. The default username and password is `admin:letmein`.

![Login Page](images/General/login.png)

## Production deployment

If you have a server with a **public-facing IP address** and a **domain name** that points to it, you should be able to use our production deployment configuration.  This is the way we deploy viame.kitware.com.

* `containrrr/watchtower` updates the running containers on a schedule using automated image builds from docker hub (above).
* `linuxserver/duplicati` is included to schedule nightly backups, but must be manually configured.

You should scale the girder web server up to an appropriate number.  This stack will automatically load-balance across however many instances you bring up.

```bash
# Continuing from above, modify .env again to include the production variables
nano .env

# pull extra containers
docker-compose -f docker-compose.yml -f docker-compose.prod.yml pull

# scale the web service up
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d --scale girder=4
```

## Addon management

After initial deployment, a DIVE server will only have basic VIAME pipelines available. VIAME optional patches are installed and upgraded using a celery task that must be triggered by hand. Run this by issueing a `POST /api/v1/viame/upgrade_pipelines` request from the swagger UI at `/api/v1` .

* Whether you `force` or not, only those pipelines from addons from the exact urls passed will be enabled on the server.
* An old addon can be disabled by simply omitting its download from the upgrade payload.
* `force` should be used to force re-download of all URLs in the payload even if their zipfiles have been cached.
* An upgrade run is always required if the "common" pipelines in the base image change.  These are updated for every run, and do not require `force`.
* See the job log to verify the exact actions taken by an upgrade job.

![Upgrade Pipelines Swagger](images/UpgradePipelinesSwagger.png)

## Configuration Reference

### Web Server config

This image contains both the backend and client.

| Variable | Default | Description |
|----------|---------|-------------|
| GIRDER_MONGO_URI | `mongodb://mongo:27017/girder` | a mongodb connection string |
| GIRDER_ADMIN_USER | `admin` | admin username |
| GIRDER_ADMIN_PASS | `letmein` | admin password |
| CELERY_BROKER_URL | `amqp://guest:guest@default/` | rabbitmq connection string |
| WORKER_API_URL | `http://girder:8080/api/v1` | Address for workers to reach web server |

There is additional configuration for the RabbitMQ Management plugin. It only matters if you intend to allow individual users to configure private job runners in standalone mode, and can otherwise be ignored.

| Variable | Default | Description |
|----------|---------|-------------|
| RABBITMQ_MANAGEMENT_USERNAME | `guest` | Management API username |
| RABBITMQ_MANAGEMENT_PASSWORD | `guest` | Management API password |
| RABBITMQ_MANAGEMENT_VHOST | `default` | Virtual host should match `CELERY_BROKER_URL` |
| RABBITMQ_MANAGEMENT_URL | `http://rabbit:15672/` | Management API Url |

You can also pass [girder configuration](https://girder.readthedocs.io/en/latest/) and [celery configuration](https://docs.celeryproject.org/en/stable/userguide/configuration.html#std-setting-broker_connection_timeout).

### Worker config

This image contains a celery worker to run VIAME pipelines and transcoding jobs.

> **Note**: Either a broker url or DIVE credentials must be supplied.

| Variable | Default | Description |
|----------|---------|-------------|
| WORKER_WATCHING_QUEUES | null | one of `celery`, `pipelines`, `training`.  Ignored in standalone mode. |
| WORKER_CONCURRENCY | `# of CPU cores` | max concurrnet jobs. **Lower this if you run training** |
| WORKER_GPU_UUID | null | leave empty to use all GPUs.  Specify UUID to use specific device |
| CELERY_BROKER_URL | `amqp://guest:guest@default/` | rabbitmq connection string. Ignored in standalone mode. |
| KWIVER_DEFAULT_LOG_LEVEL | `warn` | kwiver log level |
| DIVE_USERNAME | null | Username to start private queue processor. Providing this enables standalone mode. |
| DIVE_PASSWORD | null | Password for private queue processor. Providing this enables standalone mode. |
| DIVE_API_URL  | `https://viame.kitware.com/api/v1` | Remote URL to authenticate against |

You can also pass [regular celery configuration variables](https://docs.celeryproject.org/en/stable/userguide/configuration.html#std-setting-broker_connection_timeout).

## Running the GPU Job Runner in standalone mode

**Linux Only.**

Individual users can run a standalone worker to process private jobs from VIAME Web.

* Install VIAME from [the github page](https://github.com/VIAME/VIAME) to `/opt/noaa/viame`.
* Activate the install with `source setup_viame.sh`.
* Install VIAME pipeline addons by running `cd bin && download_viame_addons.sh` from the VIAME install directory.
* Enable the private user queue for your jobs by visiting [the jobs page](https://viame.kitware.com/#/jobs)
* Run a worker using the docker command below

> **Note**: The `--volume` mount maps to the host installation.  You may need to change the source from `/opt/noaa/viame` depending on your install location, but **you should not** change the destination from `/tmp/addons/extracted`.

``` bash
docker run --rm --name dive_worker \
  --gpus all \
  --ipc host \
  --volume "/opt/noaa/viame/:/tmp/addons/extracted:ro" \
  -e "WORKER_CONCURRENCY=2" \
  -e "DIVE_USERNAME=CHANGEME" \
  -e "DIVE_PASSWORD=CHANGEME" \
  -e "DIVE_API_URL=https://viame.kitware.com/api/v1" \
  kitware/viame-worker:latest
```
