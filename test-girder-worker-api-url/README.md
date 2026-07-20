# Test harness for `GIRDER_WORKER_API_URL` (Girder branch `girder-worker-api-override`)

This folder reproduces the split-worker scenario that motivated the env var:

1. **Girder** stamps jobs with the internal URL `http://girder:8080/api/v1`.
2. **`localworker`** (same Compose network) sets `GIRDER_WORKER_API_URL=http://girder:8080/api/v1`.
3. **CPU worker** (separate Compose project, no shared network) sets
   `GIRDER_WORKER_API_URL=http://host.docker.internal:8010/api/v1` so callbacks reach
   Girder through the host-published Traefik port.

Both images reinstall **only** `girder-worker` from branch `girder-worker-api-override`
(override with `GIRDER_GIT_REF` / `GIRDER_GIT_REPO`). Other Girder packages stay on PyPI
so plugin `web_client/dist` assets remain available.

## Quick start

From the repository root:

```bash
# 1. Main stack + localworker (internal API URL)
docker compose -f test-girder-worker-api-url/docker-compose.yml up -d --build

# 2. Separate CPU worker (host.docker.internal override)
docker compose -f test-girder-worker-api-url/docker-compose.cpu-worker.yml up -d --build
```

UI / API: http://localhost:8010  
RabbitMQ management: http://localhost:15672 (guest/guest)

## What to verify

```bash
# Confirm the branch install exposes the helper
docker compose -f test-girder-worker-api-url/docker-compose.yml exec localworker \
  python -c "from girder_worker.utils import GIRDER_WORKER_API_URL_ENV; print(GIRDER_WORKER_API_URL_ENV)"

docker compose -f test-girder-worker-api-url/docker-compose.cpu-worker.yml exec girder_worker_default \
  python -c "import os; from girder_worker.utils import resolve_girder_api_url; print(os.environ.get('GIRDER_WORKER_API_URL')); print(resolve_girder_api_url('http://girder:8080/api/v1'))"
```

The CPU worker check should print:

```
http://host.docker.internal:8010/api/v1
http://host.docker.internal:8010/api/v1
```

Server-stamped setting (for contrast):

```bash
curl -s "http://localhost:8010/api/v1/system/setting?key=worker.api_url"
# -> "http://girder:8080/api/v1"
```

Dispatch a `local` queue job (handled by `localworker`) and a `celery` queue job
(handled by the external CPU worker). The external worker should succeed only
because `GIRDER_WORKER_API_URL` rewrites the stamped `girder:8080` callback URL.

## Tear down

```bash
docker compose -f test-girder-worker-api-url/docker-compose.cpu-worker.yml down
docker compose -f test-girder-worker-api-url/docker-compose.yml down
```

## Files

| File | Role |
|------|------|
| `docker-compose.yml` | Girder stack + `localworker` with `girder:8080` override |
| `docker-compose.cpu-worker.yml` | Isolated CPU worker with `host.docker.internal` override |
| `Dockerfile.girder` / `Dockerfile.worker` | Builds that install Girder from the test branch |
| `install_girder_branch.sh` | Shared `uv pip install` of `girder-worker` from the test branch |
