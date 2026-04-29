# Merge Results: `girder-5-upgrade` + `main`

## What was done

- Merged `origin/main` into `girder-5-upgrade`.
- Resolved all merge conflicts and completed the merge locally.

## Merge conflict resolutions applied

- Kept `main` deletions for legacy build files:
  - `client/vue.config.js`
  - `client/yarn.lock`
  - `server/poetry.lock`
- Reconciled Docker stack settings in `docker-compose.yml`:
  - Preserved Girder 5 branch worker image and Girder worker env vars.
  - Kept `main`'s `memcached` service and worker GPU healthcheck/autoheal labels.
  - Preserved Redis-related environment settings used by Girder notifications.
- Reconciled Docker build stages in `docker/girder.Dockerfile`:
  - Kept Girder 5 branch static client output paths (`/opt/dive/clients/...`).
  - Kept `main` uv-based Python environment sync path (`uv.lock` + `uv sync`).
- Reconciled API/task changes:
  - `server/dive_server/views_rpc.py`: kept pipeline worker capability checks and pipeline parameter pass-through.
  - `server/dive_tasks/tasks.py`: kept dynamic trained model discovery for ONNX export.
- Reconciled dependency metadata in `server/pyproject.toml`:
  - Retained branch `tool.poetry.dependencies` section.
  - Retained `main` dependency group definitions.

## Notes

- Merge is completed locally on `girder-5-upgrade`.
- There is an unrelated untracked local path still present: `client/.electron/`.
