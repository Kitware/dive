#!/bin/sh

# Environment variables that may be supplied
# WORKER_CONCURRENCY: The number of concurrent jobs to run at once. If not supplied, the celery default is used.
# WORKER_WATCHING_QUEUES: The comma separated list of queues to take tasks from. If not supplied, the celery default of 'celery' is used.
export PATH="/opt/dive/local/ffmpeg:$PATH"

QUEUE_ARGUMENT=
CONCURRENCY_ARGUMENT=

if [ -n "$WORKER_WATCHING_QUEUES" ]; then
    QUEUE_ARGUMENT="--queues $WORKER_WATCHING_QUEUES"
fi

if [ -n "$WORKER_CONCURRENCY" ]; then
    CONCURRENCY_ARGUMENT="--concurrency $WORKER_CONCURRENCY"
fi

exec poetry run python \
    -m dive_tasks \
    -l info \
    --without-gossip --without-mingle \
    $QUEUE_ARGUMENT $CONCURRENCY_ARGUMENT
