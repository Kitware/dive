# Upgrading to Girder 5

Current DIVE Web releases run on **Girder 5** with updated worker plugins, notification delivery, and Docker Compose configuration. Use this page when upgrading an existing Girder 3 deployment or aligning a custom `.env` with the current stack.

For general deployment steps, see [Running with Docker Compose](Deployment-Docker-Compose.md). For upstream Girder API and plugin changes, see the [Girder migration guide](https://github.com/girder/girder/blob/v4-integration/docs/migration-guide.rst).

## Summary of infrastructure changes

| Change | Action required |
|--------|-----------------|
| **Girder 5** | Pull or build `kitware/viame-web` and `kitware/viame-worker` images (default tag `latest`; see `TAG` in `.env`). |
| **Redis** | Add a Redis service; required for job and UI notifications. |
| **Notifications** | The web client uses WebSockets (not the legacy Girder EventStream). Ensure browsers can reach the Girder API and that Redis is running. |
| **Environment variables** | Rename broker and worker API settings (table below). |
| **Static client** | Girder no longer runs `girder build` in the image; the Vue app is built into the image at `GIRDER_STATIC_ROOT_DIR`. |

## Environment variable renames

Update your `.env` (and any external orchestration) to use Girder 5 names:

| Girder 4 / legacy name | Girder 5 name | Purpose |
|------------------------|---------------|---------|
| `CELERY_BROKER_URL` | `GIRDER_WORKER_BROKER` | RabbitMQ URL for Celery (message broker). |
| `WORKER_API_URL` | `GIRDER_SETTING_WORKER_API_URL` | Girder REST API URL workers call (e.g. `http://girder:8080/api/v1`). |
| *(not used)* | `GIRDER_WORKER_BACKEND` | Celery result backend (Compose default: `rpc://guest:guest@localhost/`). |
| *(not used)* | `GIRDER_NOTIFICATION_REDIS_URL` | Redis URL for Girder notification fan-out (e.g. `redis://redis:6379`). |
| *(not used)* | `GIRDER_STATIC_ROOT_DIR` | Path to built web client inside the Girder container (set in Compose). |

`GIRDER_WORKER_BACKEND` is **not** a replacement for `WORKER_API_URL`. Do not point it at `http://…/api/v1`; use `GIRDER_SETTING_WORKER_API_URL` for that.

## Recommended upgrade steps

1. **Back up** MongoDB and any asset store data before upgrading.
2. **Merge or checkout** the Girder 5 branch and copy `.env.default` changes into your `.env`.
3. **Set image tag** if needed (for example `TAG=latest` in `.env`), then pull images.
4. **Add Redis** — use the `redis` service from `docker-compose.yml` or an external Redis instance and set `GIRDER_NOTIFICATION_REDIS_URL` on `girder` and all worker services.
5. **Rename variables** in `.env` per the table above.
6. **Multi-node deployments:** set `GIRDER_WORKER_BROKER` to your RabbitMQ URL and `GIRDER_SETTING_WORKER_API_URL` to your Girder API URL on every worker host; workers must reach Redis used by the web tier if they rely on notification-related features configured in Compose.
7. **Rebuild or pull** images, then restart the stack:

```bash
docker-compose -f docker-compose.yml pull
docker-compose -f docker-compose.yml up -d
```

8. **Smoke-test** login, job launch, pipeline/training jobs, and job status updates in the UI (confirms WebSocket notifications and Redis).

## Required: `localworker`

Docker Compose includes a required **`localworker`** service (in `docker-compose.yml`, under the `gpu` and `cpu` profiles) that runs Celery on the `local` queue for lightweight tasks such as batch postprocess and async assetstore import. **Run `localworker` in both development and production**; without it, jobs routed to the `local` queue will not execute.

When using `docker-compose.override.yml` for development, the same service mounts your local `server/` code; Celery workers still require a restart to pick up code changes.

## Python dependencies

Server packages pin Girder 5 (`girder`, `girder_jobs`, `girder_worker`, etc. at 5.0.x in `server/pyproject.toml`). Regenerate the lockfile from `server/` if you change plugin versions:

```bash
cd server && uv lock
```
