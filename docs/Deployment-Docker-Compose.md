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

* Install NVIDIA driver version **>= 450.80.02** and **CUDA 11.0+** `sudo ubuntu-drivers install`
* Install `docker` version **19.03+** [guide](https://docs.docker.com/engine/install/ubuntu/)
* Install `docker-compose` version **1.28.0+** [guide](https://docs.docker.com/compose/install/)
* Install [nvidia-container-toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html#docker)

## Basic deployment

Clone this repository and configure options in `.env` .

``` bash
# Clone this repository
git clone https://github.com/Kitware/dive /opt/dive

# Change to correct directory
cd /opt/dive

# Initiate the .env file
cp .env.default .env

# Edit the .env file
# See configuration options below and inline comments
nano .env

# Pull pre-built images
docker-compose pull

# Bring the services up
# Make sure to specify docker-compose.yml unless you intend to mount code for development
docker-compose -f docker-compose.yml up -d
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

## Splitting services

It's possible to split your web server and task runner between multiple nodes.  This may be useful if you want to run DIVE Web without a GPU or if you want to save money by keeping your GPU instance stopped when not in use.  You could also increase parallel task capacity by running task runners on multiple nodes.

* Make two cloud VM instances, one with NVIDIA drivers and container toolkit, and one without.  This is still a special case of scenario 1 from the [Provisioning Guide](Deployment-Provision.md)
* Clone the dive repository on both, and set up `.env` on both with the same configuration.
* Be sure that `WORKER_API_URL` and `CELERY_BROKER_URL` in particular are uncommented and set to the IP or domain name of your web server.  This is how the worker will talk to the web server, so the web server must be network accessible from the worker.

``` bash
## On the web server
docker-compose -f docker-compose.yml up -d girder rabbit

## On the GPU server(s)
docker-compose -f docker-compose.yml up -d --no-deps girder_worker_pipelines girder_worker_training girder_worker_default
```

In order to run any jobs (video transcoding, pipelines, training, addon upgrades) the GPU server will need to be running.

## Addon management

After initial deployment, DIVE Server will require an addon upgrade in order to download and scan for VIAME addons. Run this by issuing a <u>`POST /dive_configuration/upgrade_pipelines`</u> request from the swagger UI at `http://{server_url}:{server_port}/api/v1`.

* Whether you `force` or not, only those pipelines from addons from the exact urls passed will be enabled on the server.
* An old addon can be disabled by simply omitting its download from the upgrade payload.
* `force` should be used to force re-download of all URLs in the payload even if their zipfiles have been cached.
* An upgrade run is always required if the "common" pipelines in the base image change.  These are updated for every run, and do not require `force`.
* See the job log to verify the exact actions taken by an upgrade job.
* Optional patches are updated occasionally and you can find the [latest urls here](https://github.com/VIAME/VIAME/blob/master/cmake/download_viame_addons.sh).

![Upgrade Pipelines Swagger](images/UpgradePipelinesSwagger.png)

## Configuration Reference

### Server branding config

You can configure the brand and messaging that appears in various places in the DIVE Web UI using the config API.

1. Open the swagger page at /api/v1
1. `PUT /dive_configuration/brand_data` where the body is a JSON object from the template below.  If you do not want to set a value and use the default, omit the key and value from the config body.

``` json
{
  // A JSON Vuetify theme configuration object.
  // https://vuetify.cn/en/customization/theme/#customizing
  "vuetify": {},

  // A URL to a favicon
  "favicon": "",

  // A URL to an image that will be shown as the main logo
  "logo": "",

  // Used in several places, including the main toolbar
  "name": "VIAME",

  // Message that appears on the login screen
  "loginMessage": "",

  // Alert messages are typically used to tell users about maintenance, outages, etc.
  "alertMessage": "",
}
```

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
