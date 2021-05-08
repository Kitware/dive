import os

# Overrides girder worker configuration

broker_url = os.environ.get('CELERY_BROKER_URL', None)
if broker_url is None:
    raise RuntimeError('CELERY_BROKER_URL must be set')

broker_transport = 'amqp'
broker_heartbeat = False
worker_send_task_events = False
worker_enable_remote_control = False
result_backend = None
task_ignore_result = True
