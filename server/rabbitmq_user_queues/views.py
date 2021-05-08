import uuid
from typing import Tuple

from girder import logger
from girder.api import access
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import Resource
from girder.constants import AccessType
from girder.models.user import User
from pydantic import ValidationError
from pyrabbit2 import Client as PyRabbitClient

from dive_utils.types import GirderModel

from .constants import UserQueueMarker
from .models import Settings, UserQueueModel


class RabbitUserQueue(Resource):
    def __init__(self):
        super(RabbitUserQueue, self).__init__()
        self.resourceName = "rabbit_user_queues"
        self.route("POST", ("user", ":id"), self.upsert_user_queue)
        self.route("GET", ("ping",), self.ping)

    def getClient(self, settings: Settings) -> PyRabbitClient:
        return PyRabbitClient(
            settings.netloc,
            settings.username,
            settings.password,
            scheme=settings.scheme,
        )

    @access.user
    @autoDescribeRoute(
        Description("Get or create user queue")
        .modelParam("id", description="User ID", model=User, level=AccessType.ADMIN)
        .param('force', description='Force refresh', default=False, dataType='boolean')
    )
    def upsert_user_queue(self, user: GirderModel, force):
        existing = user.get(UserQueueMarker, None)
        settings = Settings()
        if existing is not None and not force:
            try:
                parsed_credentials = UserQueueModel(**existing)
                return parsed_credentials.with_broker_url(settings.broker_url_template)
            except ValidationError as e:
                pass

        # Generate new credentials
        client = self.getClient(settings)
        newUserQueue = UserQueueModel(
            **{
                'username': user['login'],
                'password': str(uuid.uuid4()),
            }
        )
        client.create_user(newUserQueue.username, password=newUserQueue.password)

        # Allow remote control queues, since celery docs are wrong and disabling it isn't possible
        # because celery is a liar https://celery-rabbitmq.readthedocs.io/en/latest/remotecontrol.html
        pattern = f"^({newUserQueue.username}.*|(celery@)?([a-fA-F0-9-]+\.)?(reply\.)?celery\.pidbox)$"
        client.set_vhost_permissions(
            settings.vhost, newUserQueue.username, pattern, pattern, pattern
        )
        user[UserQueueMarker] = newUserQueue.dict()
        User().save(user)
        logger.info(f"Created new RabbitMQ Creds for {newUserQueue.username}")
        return newUserQueue.with_broker_url(settings.broker_url_template)

    @access.admin
    @autoDescribeRoute(Description("Ping"))
    def ping(self, params):
        settings = Settings()
        return self.getClient(settings).get_overview()
