import os
from kombu import Queue

# from girder_client import GirderClient

# First, check to see if this is a private user queue runner
# dive_username = os.environ.get('DIVE_USERNAME', None)
# dive_password = os.environ.get('DIVE_PASSWORD', None)
# dive_api_url = os.environ.get('DIVE_API_URL', 'https://viame.kitware.com/api/v1')

# if dive_username and dive_password:
#     # Fetch Celery broker credentials from server
#     diveclient = GirderClient(apiUrl=dive_api_url)
#     diveclient.authenticate(username=dive_username, password=dive_password)

# Then, proceed to boot a normal queue.
broker_url = os.environ.get('CELERY_BROKER_URL', None)
if broker_url is None:
    raise RuntimeError('CELERY_BROKER_URL must be set')

broker_transport = 'amqp'
broker_heartbeat = False
worker_send_task_events = False

# Remote control is necessary to handle cancellation
# Needs celery.pidbox, reply.celery.pidbox, uuid.reply.celery.pidbox, celery@uuid.celery.pidbox
worker_enable_remote_control = True

result_backend = None
task_ignore_result = True
