from logging import info, warn
import os

from girder_client import GirderClient

from dive_utils.constants import UserPrivateQueueEnabledMarker

# First, check to see if this is a private user queue runner
dive_username = os.environ.get('DIVE_USERNAME', None)
dive_password = os.environ.get('DIVE_PASSWORD', None)
dive_api_url = os.environ.get('DIVE_API_URL', 'https://viame.kitware.com/api/v1')
broker_url = os.environ.get('GIRDER_WORKER_BROKER', None)

if dive_username and dive_password:
    info(
        """
     _    _________    __  _________   _       __           __
    | |  / /  _/   |  /  |/  / ____/  | |     / /___  _____/ /_____  _____
    | | / // // /| | / /|_/ / __/     | | /| / / __ \/ ___/ //_/ _ \/ ___/
    | |/ // // ___ |/ /  / / /___     | |/ |/ / /_/ / /  / ,< /  __/ /
    |___/___/_/  |_/_/  /_/_____/     |__/|__/\____/_/  /_/|_|\___/_/

    You are running in private standalone mode.

    Troubleshooting: Try running `docker pull kitware/viame-worker` to get the latest image
    Documentation: https://kitware.github.io/dive/Deployment-Docker-Compose/
    Issues: https://github.com/Kitware/dive/issues
    Support: please email viame-web@kitware.com
    """
    )
    # Fetch Celery broker credentials from server
    diveclient = GirderClient(apiUrl=dive_api_url)
    diveclient.authenticate(username=dive_username, password=dive_password)
    me = diveclient.get('user/me')
    creds = diveclient.post(f'rabbit_user_queues/user/{me["_id"]}')
    broker_url = creds['broker_url']
    queue_name = f"{me['login']}@private"
    if not me.get(UserPrivateQueueEnabledMarker, False):
        warn(" Private queues not enabled for this user.")
        warn(" You can visit https://viame.kitware/com/#jobs to change these settings")
    info("========================")
    task_default_queue = queue_name

if broker_url is None:
    raise RuntimeError('GIRDER_WORKER_BROKER must be set')

worker_send_task_events = False
# https://docs.celeryproject.org/en/stable/userguide/configuration.html#std-setting-worker_prefetch_multiplier
worker_prefetch_multiplier = 1
# https://docs.celeryproject.org/en/v4.4.6/userguide/configuration.html#broker-connection-timeout
broker_connection_timeout = 6
# Remote control is necessary to handle cancellation
# Needs celery.pidbox, reply.celery.pidbox, uuid.reply.celery.pidbox, celery@uuid.celery.pidbox
worker_enable_remote_control = True

result_backend = None
task_ignore_result = True

# https://docs.celeryproject.org/en/stable/userguide/configuration.html#std-setting-task_reject_on_worker_lost
# Run tasks at least once, rescheduling them if the worker crashes.
# TODO: Required to pin to rabbitmq 3.8.14 because of https://github.com/Kitware/dive/issues/995
task_reject_on_worker_lost = True
task_acks_late = True
