#!/bin/sh
# Reinstall girder-worker from a specific git branch/ref.
# The GIRDER_WORKER_API_URL feature lives only in the worker package; leave
# girder / girder-jobs / girder-plugin-worker on PyPI so their prebuilt
# web_client/dist assets remain intact.
set -e

GIRDER_GIT_REPO="${GIRDER_GIT_REPO:-https://github.com/girder/girder.git}"
GIRDER_GIT_REF="${GIRDER_GIT_REF:-girder-worker-api-override}"
BASE="git+${GIRDER_GIT_REPO}@${GIRDER_GIT_REF}"

echo "Installing girder-worker from ${GIRDER_GIT_REPO}@${GIRDER_GIT_REF}"

uv pip install --reinstall \
  "girder-worker @ ${BASE}#subdirectory=worker"

python -c "from girder_worker.utils import GIRDER_WORKER_API_URL_ENV; print(f'OK: {GIRDER_WORKER_API_URL_ENV} available')"
