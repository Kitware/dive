# Running with Docker Compose

Start here once you have SSH access and `sudo` privileges for a server or VM. 

!!! note

    Docker server installation is only supported on Linux distributions

## Container Images

A DIVE Web deployment consists of 2 main application images (default tag `latest`; override with `TAG` in `.env`):

* [kitware/viame-web](https://hub.docker.com/r/kitware/viame-web) — Girder web server and bundled Vue client
* [kitware/viame-worker](https://hub.docker.com/r/kitware/viame-worker) — Celery workers for transcoding, pipelines, and training

Infrastructure services required by the stack:

* **MongoDB** — Girder database
* **RabbitMQ** — Celery message broker
* **Redis** — Girder notification fan-out (job status and UI updates over WebSockets)

Upgrading from Girder 3? See [Upgrading to Girder 5](Deployment-Girder-5-Upgrade.md).

![DIVE-Web-Architecture-Diagram.svg](images/Diagrams/DIVE-Web-Architecture-Diagram.svg)

## Install dependencies

SSH into the target server and install these system dependencies.

!!! tip

    You can skip this section if you used Ansible to configure your server, as it already installed all necessary dependencies.

* Install NVIDIA Driver ([version specified in VIAME](https://github.com/VIAME/VIAME#installations))
    * `sudo ubuntu-drivers install` usually works.
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

### Docker Compose profile behavior

There are two ways to run the stack:

* **Default (GPU-enabled):** runs the web services, `localworker`, the standard worker, and GPU workers.
* **CPU profile (`--profile cpu`):** runs `girder_worker_default` and `localworker` only.

Use these commands:

```bash
# Default mode (GPU-enabled pipeline/training workers)
docker-compose -f docker-compose.yml up -d

# CPU-only mode
docker-compose -f docker-compose.yml --profile cpu up -d
```

When GPU workers are not connected (for example, in CPU-only mode), the UI and API automatically disable pipeline and training features.

### `localworker`

Docker Compose includes a required **`localworker`** service (in `docker-compose.yml`, under the `gpu` and `cpu` profiles) that runs `celery -A girder_worker.app worker -Q local`. It uses the same image as the Girder web server and consumes the **`local`** queue for lightweight tasks such as batch postprocess and async assetstore import. **You must run `localworker` in both development and production**; without it, jobs routed to the `local` queue will not execute.

When developing with `docker-compose.override.yml`, the same service mounts your local `server/` code. See also [Upgrading to Girder 5](Deployment-Girder-5-Upgrade.md).

![Login Page](images/General/login.png)

## Production deployment

If you have a server with a **public-facing IP address** and a **domain name** that points to it, you should be able to use our production deployment configuration.  This is the way we deploy viame.kitware.com.

* `containrrr/watchtower` updates the running containers on a schedule using automated image builds from docker hub (above).
* `linuxserver/duplicati` is included to schedule nightly backups, but must be manually configured.

You should scale the girder web server up to an appropriate number.  This stack will automatically load-balance across however many instances you bring up. Keep **`localworker`** running as well (one instance is enough; it is not scaled with `--scale girder`).

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
* Clone the dive repository on both VMs. The `.env` files are **not** identical — the web VM keeps the internal Compose service names, while the worker VM points at the web VM's IP or hostname (referred to below as `WEB_HOST`).

### Worker API URL settings

Two related variables control how workers call back to Girder. They apply at different layers:

| Variable | Where to set it | Role |
|----------|-----------------|------|
| `GIRDER_SETTING_WORKER_API_URL` | **Girder web server** process | Sets the Girder system setting `worker.api_url`. That value is **stamped into every job** when it is scheduled (Celery headers / `jobInfoSpec`). |
| `GIRDER_WORKER_API_URL` | **Worker** process only | Optional **per-worker override**. When set, the worker uses this URL for API callbacks instead of the URL stamped at schedule time (including job status/log updates). |

!!! tip "When to set `GIRDER_WORKER_API_URL`"

    Use it when a worker cannot reach the API URL stamped by the server — typically remote or external workers that cannot resolve Docker-internal names like `girder:8080`.

    Typical mixed setup:

    * Web VM + `localworker` on the Compose network keep the default stamped URL `http://girder:8080/api/v1`.
    * Remote worker VMs set `GIRDER_WORKER_API_URL=http://WEB_HOST:8010/api/v1` so they reach Girder through the host-published Traefik port.

    Leave `GIRDER_WORKER_API_URL` **unset** on single-node stacks and on any worker that can already reach the stamped URL.

!!! warning

    `GIRDER_SETTING_WORKER_API_URL` only affects the **web server** process that schedules jobs. Setting it on a worker container does **not** change the callback URL that worker uses at runtime — use `GIRDER_WORKER_API_URL` for that.

    Port `8080` is Girder's in-container port and is **not** published on the host. Traefik publishes the API on host port `8010` (base `docker-compose.yml`) or on `80`/`443` when you also use `docker-compose.prod.yml`. Remote workers should use the published port — never `8080` unless you publish it yourself.

### Web VM `.env`

The web VM runs RabbitMQ, Redis, and Mongo as Compose services and should keep internal service names. For a mixed local + remote worker deployment, leave the server stamping the internal URL (the Compose default):

```
# Optional — this is already the Compose default for a single-node / mixed stack
#GIRDER_SETTING_WORKER_API_URL=http://girder:8080/api/v1
```

`localworker` on the same Compose network can reach `girder:8080` and does not need `GIRDER_WORKER_API_URL`.

!!! note

    If **every** worker (including `localworker`) can reach a single public API URL — for example via host hairpin to `WEB_HOST:8010` — you may instead set `GIRDER_SETTING_WORKER_API_URL=http://WEB_HOST:8010/api/v1` on the web VM and omit `GIRDER_WORKER_API_URL`. Prefer `GIRDER_WORKER_API_URL` on remote workers when local and remote workers need different reachable URLs.

### Worker VM `.env`

On the worker VM, uncomment and set these to point at `WEB_HOST`:

* `GIRDER_WORKER_BROKER` — RabbitMQ URL on the web VM (e.g. `amqp://guest:guest@WEB_HOST/default`)
* `GIRDER_WORKER_API_URL` — Girder API URL reachable from this worker (e.g. `http://WEB_HOST:8010/api/v1`)
* `GIRDER_NOTIFICATION_REDIS_URL` — Redis URL on the web VM (e.g. `redis://WEB_HOST:6379`); required so workers can publish job/UI status notifications

Example:

```
GIRDER_WORKER_BROKER=amqp://guest:guest@WEB_HOST/default
GIRDER_WORKER_API_URL=http://WEB_HOST:8010/api/v1
GIRDER_NOTIFICATION_REDIS_URL=redis://WEB_HOST:6379
```

### Required connectivity

The worker VM must be able to reach the web VM on these ports (port `8080` does **not** need to be open between VMs):

| Port | Service | Purpose |
|------|---------|---------|
| `8010` | Girder API (via Traefik) | Worker fetches job data and uploads results |
| `5672` | RabbitMQ | Celery message broker |
| `6379` | Redis | Job/UI status notifications |

You can verify reachability from the worker VM with `nc -zv WEB_HOST 8010 5672 6379`.

``` bash
## On the web server
docker-compose -f docker-compose.yml up -d girder rabbit mongo redis localworker

## On the GPU server(s)
docker-compose -f docker-compose.yml up -d --no-deps girder_worker_default girder_worker_pipelines girder_worker_training
```

In this split setup, `localworker` on the web server handles the `local` queue, `girder_worker_default` handles standard queue jobs, and the GPU workers handle pipeline/training queues. If GPU workers are offline, only non-GPU worker functionality remains available and pipeline/training actions are disabled.

### Verify the configuration

After the stack is up:

1. Confirm what the web server stamps into jobs (Swagger or curl on the web VM):

```
GET /api/v1/system/setting?key=worker.api_url
```

For the recommended mixed setup this is `http://girder:8080/api/v1`. That value is correct for `localworker`; remote workers rely on `GIRDER_WORKER_API_URL` instead.

2. On each remote worker container, confirm the override is present:

```bash
docker compose exec girder_worker_default printenv GIRDER_WORKER_API_URL
# -> http://WEB_HOST:8010/api/v1
```

If remote workers stall while `GET /worker/status` looks healthy (broker only), they usually cannot reach the stamped URL and `GIRDER_WORKER_API_URL` is missing or wrong.

## Addon management

After initial deployment, DIVE Server will require an addon upgrade in order to download and scan for VIAME addons. This job runs on the `pipelines` worker so base pipelines are seeded from `/opt/noaa/viame/configs/pipelines/` in the VIAME image. A GPU pipeline worker must be online. Run the upgrade by issuing a <u>`POST /dive_configuration/upgrade_pipelines`</u> request from the swagger UI at `http://{server_url}:{server_port}/api/v1`.

* Whether you `force` or not, only those pipelines from addons from the exact urls passed will be enabled on the server.
* An old addon can be disabled by simply omitting its download from the upgrade payload.
* `force` should be used to force re-download of all URLs in the payload even if their zipfiles have been cached.
* An upgrade run is always required if the "common" pipelines in the base image change.  These are updated for every run, and do not require `force`.
* See the job log to verify the exact actions taken by an upgrade job.
* Optional patches are updated occasionally and you can find the [latest urls here](https://github.com/VIAME/VIAME/blob/main/cmake/download_viame_addons.csv).

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
| GIRDER_WORKER_BROKER | `amqp://guest:guest@rabbit/default` | RabbitMQ connection string (Celery broker) |
| GIRDER_WORKER_BACKEND | `rpc://guest:guest@localhost/` | Celery result backend (RPC) |
| GIRDER_SETTING_WORKER_API_URL | `http://girder:8080/api/v1` | Girder system setting `worker.api_url` stamped into jobs at schedule time. Default is correct for single-node and for `localworker` on the Compose network. See [Worker API URL settings](#worker-api-url-settings). |
| GIRDER_NOTIFICATION_REDIS_URL | `redis://redis:6379` | Redis URL for notification fan-out |
| GIRDER_STATIC_ROOT_DIR | `/opt/dive/clients/girder` | Built web client static files (set in image/Compose) |

There is additional configuration for the RabbitMQ Management plugin. It only matters if you intend to allow individual users to configure private job runners in standalone mode, and can otherwise be ignored.

| Variable | Default | Description |
|----------|---------|-------------|
| RABBITMQ_MANAGEMENT_USERNAME | `guest` | Management API username |
| RABBITMQ_MANAGEMENT_PASSWORD | `guest` | Management API password |
| RABBITMQ_MANAGEMENT_VHOST | `default` | Virtual host should match `GIRDER_WORKER_BROKER` |
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
| GIRDER_WORKER_BROKER | `amqp://guest:guest@rabbit/default` | RabbitMQ connection string. Ignored in standalone mode. |
| GIRDER_WORKER_API_URL | unset | Optional per-worker override of the Girder API base URL used for callbacks. Set on remote/external workers that cannot reach the URL stamped by the server (e.g. `http://WEB_HOST:8010/api/v1`). See [Worker API URL settings](#worker-api-url-settings). Ignored in standalone mode when using `DIVE_API_URL`. |
| GIRDER_SETTING_WORKER_API_URL | `http://girder:8080/api/v1` | Only meaningful on the **web server** (stamped at schedule time). Setting it on a worker process does not override callback URLs at runtime — use `GIRDER_WORKER_API_URL` instead. |
| GIRDER_NOTIFICATION_REDIS_URL | `redis://redis:6379` | Redis for notifications when running workers in Compose |
| KWIVER_DEFAULT_LOG_LEVEL | `warn` | Log level for VIAME pipeline jobs (env name unchanged; used by the Kwiver logging stack) |
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

